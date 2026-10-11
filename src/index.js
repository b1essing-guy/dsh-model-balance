/**
 * dsh-model-balance —— host 半边（DSH 宿主插件入口）。
 *
 * 职责边界（很重要）：
 * - **host 只做取数与规则**：查余额（经 provider 注册表）、把结果与计价规则写进轮询状态、
 *   开两个 HTTP 路由。host 不做任何展示判定，也不做倒计时——展示层不知道任何计价规则。
 * - **查余额只有这一个点**：前端只从 GET /state 读同一份结果，因此换 provider、改凭证、
 *   改刷新周期都只影响这里一处。
 * - **扩展点**：`ctx.modelBalance.registerProvider(def)`。插件内置的两条 deepseek 路由
 *   也是走这个接口注册的（见下方 ctx.effect），所以扩展点被自身使用，不是摆设。
 *
 * 软依赖：`credentials` 与 `deepseekAccount` 都经 `ctx.get(name, false)` 软取——
 * 没装账号插件时应当报 `credential-missing`（可读的降级文案），而不是让整个插件加载失败。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEEPSEEK_PRICE_SOURCE, DEEPSEEK_PRICE_TABLES, DEEPSEEK_PRICING_RULES } from './host/deepseek-rules.js';
import { messageOf } from './host/internal.js';
import { deepseekAccountProvider } from './host/providers/deepseek-account.js';
import { deepseekOfficialProvider } from './host/providers/deepseek-official.js';
import { createRegistry, ACCOUNT_SERVICE_ABSENT } from './host/registry.js';
import { isNotReadyFailure, nextRetryDelayMs } from './host/retry-policy.js';
import { BalanceStateStore } from './host/state.js';

/** 插件名 / Cordis entry 名（必须与 package.json name 一致） */
export const name = 'dsh-model-balance';

/**
 * 硬依赖服务。`webServer` 开路由；`agentDefaultModel` 告诉我们「当前服务商是谁」——
 * 这是 provider 路由的唯一依据（不是我们自己猜的）。
 */
export const inject = ['webServer', 'agentDefaultModel'];

/** 路由前缀（与 client 半边的 fetch 路径必须一致） */
const ROUTE_PREFIX = '/dsh-model-balance';
/** 注册方标识（provider 冲突报错会显示它） */
const WORKER = 'dsh-model-balance';
/** 包根目录（src/index.js → 上一级） */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 配置默认值与边界 */
const DEFAULT_REFRESH_SEC = 600;
/** 刷新周期下限（秒）：防住配置手误把外部接口打成筛子 */
const MIN_REFRESH_SEC = 60;

/**
 * 规范化 Cordis entry 配置。非法值一律**回落到默认**并保留可用性——
 * 配置写错不该让插件整个不工作，但也不能让 `refreshSec: 1` 把接口打爆。
 */
export function normalizeConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {};
  const slot = raw.slot === 'sidebar' ? 'sidebar' : 'overlay';
  const parsed = Number(raw.refreshSec);
  const refreshSec = Number.isFinite(parsed) && parsed >= MIN_REFRESH_SEC ? Math.floor(parsed) : DEFAULT_REFRESH_SEC;
  const hoverPrices = raw.hoverPrices === undefined ? true : raw.hoverPrices === true;
  return { slot, refreshSec, hoverPrices };
}

let versionCache;
/** 本插件版本（只作为账号服务的请求来源标识；读不到不影响查询） */
function ownVersion() {
  if (versionCache !== undefined) return versionCache;
  try {
    const raw = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    versionCache = typeof raw.version === 'string' && raw.version.length > 0 ? raw.version : '0.0.0';
  } catch {
    versionCache = '0.0.0';
  }
  return versionCache;
}

/**
 * 账号服务要求的调用方身份（`AccountClientMetadata`）：Platform 用它派生客户端头，
 * 只影响请求来源标识与服务端本地化文案，**不参与余额数值与币种**。
 */
function accountClientMetadata() {
  return {
    version: ownVersion(),
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
}

/**
 * 暴露 host Service。DSH 这一代有两个可用写法（分别见于 dshmarket 与
 * @michengai/dsh-agency-agents 的实际源码），这里按可用性依次尝试，
 * 都不行就**明确告警**——扩展点静默失效是最坏的失败方式。
 */
function provideService(ctx, key, value) {
  const attempts = [];
  if (typeof ctx.provide === 'function') {
    try {
      ctx.provide(key, value);
      return 'ctx.provide';
    } catch (error) {
      attempts.push('ctx.provide: ' + messageOf(error));
    }
  }
  if (ctx.reflect !== undefined && typeof ctx.reflect.provide === 'function') {
    try {
      ctx.reflect.provide(key, value);
      return 'ctx.reflect.provide';
    } catch (error) {
      attempts.push('ctx.reflect.provide: ' + messageOf(error));
    }
  }
  console.warn('[dsh-model-balance] 未能暴露 modelBalance 服务，第三方扩展点不可用：' + attempts.join('；'));
  return undefined;
}

/** 读掉请求体（本插件只用 POST 动作端点，不解析内容；读干净是为了别让连接挂着） */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

/** 统一 JSON 响应：no-store，避免任何中间层缓存余额 */
function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(text);
    return;
  }
  // 兜底：极端接线差异下也别把响应丢在地上
  res.end?.(text);
}

export function apply(ctx, config) {
  const settings = normalizeConfig(config);
  const registry = createRegistry();
  const store = new BalanceStateStore({
    ...DEEPSEEK_PRICING_RULES,
    priceTables: DEEPSEEK_PRICE_TABLES,
    priceSource: DEEPSEEK_PRICE_SOURCE,
  });

  // ---- 内置两条 deepseek 路由：走**同一个**扩展点注册 ----
  // 用 ctx.effect 包住：插件卸载（或热重载）时注册自动回收，不留悬空 provider
  ctx.effect(() => registry.registerProvider(deepseekOfficialProvider, WORKER), 'dsh-model-balance: provider deepseek-official');
  ctx.effect(() => registry.registerProvider(deepseekAccountProvider, WORKER), 'dsh-model-balance: provider deepseek-account');

  /** 软取服务：不在场就返回 undefined（不是抛错） */
  const soft = (key) => {
    try {
      return typeof ctx.get === 'function' ? ctx.get(key, false) : undefined;
    } catch {
      return undefined;
    }
  };

  /**
   * 凭证解析。`CredentialRef` 是 `Branded<string>`——品牌只存在于类型层，**运行时就是字符串**，
   * 所以我们不 import `@deepseek-ai/dsh-credentials`（少一个能坏的依赖）。
   * 若某天 DSH 给 ref 加上运行时不变量校验，这里会表现为持续的 `credential-missing`；
   * 那时改为动态引入该包的 `credentialRef()` 包装即可（这是我们预留的退路）。
   */
  const resolveKey = async (ref) => {
    const credentials = soft('credentials');
    if (credentials === undefined || typeof credentials.resolve !== 'function') return undefined;
    const resolved = await credentials.resolve(ref);
    return resolved?.value;
  };

  /**
   * 账号余额查询（仅 `deepseek-account` 路由使用）。
   * 账号服务不在场 → 返回 undefined，注册表据此报 `credential-missing`（可读降级），
   * 而不是把「没装账号插件」伪装成一次网络失败。
   */
  const resolveAccount = async () => {
    const account = soft('deepseekAccount');
    // 服务缺席时返回**哨兵**而不是 undefined：让注册表能区分「还没就绪（会自愈）」
    // 与「服务在但未登录（要用户处理）」，两者的文案不该一样。
    if (account === undefined || typeof account.getBalance !== 'function') return ACCOUNT_SERVICE_ABSENT;
    return account.getBalance(accountClientMetadata());
  };

  /**
   * 刷新余额并写入轮询状态——host 侧**唯一**的余额查询点。
   *
   * @param {boolean} [manual] 是否用户主动触发（影响前端"必弹提示"的口径）
   * @returns {Promise<object>} 本次写进状态的那份结果（调用方据此决定要不要快速重试）
   */
  const refreshBalance = async (manual = false) => {
    let leaf;
    try {
      const selection = ctx.agentDefaultModel.currentSelection();
      const providerId = String(selection?.provider ?? '');
      store.writeSelectedProvider(providerId);
      // 模型 id 也要记：单价按模型不同，展示层要靠它只显示当前模型的价（见 state.js 的说明）
      store.writeSelectedModel(String(selection?.model ?? ''));
      const result = await registry.query(providerId, resolveKey, resolveAccount);
      leaf = { ...result, fetchedAt: Date.now(), manual };
    } catch (error) {
      // 凭证解析之类的意外异常也落成 fetch-error：不吞、不伪造数字
      leaf = {
        ok: false,
        provider: 'unknown',
        reason: 'fetch-error',
        message: messageOf(error),
        fetchedAt: Date.now(),
        manual,
      };
    }
    store.writeBalance(leaf);
    return leaf;
  };

  const handleRoute = async (rawUrl, method) => {
    const url = new URL(rawUrl ?? '/', 'http://localhost');
    const rest = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '');

    // 轮询状态：GET /state。**只读、零副作用**——绝不在这里触发外部调用，
    // 否则前端每次轮询都会拖一次网络请求。
    if (rest === 'state') {
      if (method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
      return { status: 200, body: store.read() };
    }

    // 展示配置：GET /config。展示层据此决定挂哪个槽位、是否展示单价。
    if (rest === 'config') {
      if (method !== 'GET') return { status: 405, body: { error: 'method not allowed' } };
      return { status: 200, body: { ...settings, version: ownVersion(), route: ROUTE_PREFIX } };
    }

    // 手动刷新：POST /refresh。动作端点**不返回余额数据**——数据只有一个出口（/state）。
    if (rest === 'refresh') {
      if (method !== 'POST') return { status: 405, body: { error: 'method not allowed' } };
      await refreshBalance(true);
      return { status: 200, body: { ok: true } };
    }

    return { status: 404, body: { error: 'not found' } };
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          try {
            if (req.method === 'POST' || req.method === 'PUT') await readBody(req);
            const { status, body } = await handleRoute(req.url ?? '/', req.method ?? 'GET');
            sendJson(res, status, body);
          } catch (error) {
            sendJson(res, 500, { error: messageOf(error) });
          }
        },
      }),
    'dsh-model-balance: routes',
  );

  // 周期刷新 + 启动即拉一次。
  //
  // **为什么这里要重试**：插件激活早于 `deepseekAccount` 服务就绪，所以启动那次立刻刷新
  // 很可能拿到 `credential-missing`；若不管它，下一次刷新要等 refreshSec（默认 600 秒），
  // 用户就会看着「缺少凭证」10 分钟。实测证据：进程启动 09:22:56、失败 09:22:58、
  // 随后 1.8 分钟内无任何刷新。因此对「未就绪类」失败按 retry-policy 的退避序列快速重试
  // （3s→10s→30s→60s，成功即复位，用尽则落回常规周期）。
  // 倒计时不在这里——它由展示层按规则本地每秒算，不产生任何请求。
  ctx.effect(() => {
    let stopped = false;
    let retryTimer = null;
    let notReadyAttempts = 0;

    const run = async () => {
      const leaf = await refreshBalance(false);
      if (stopped) return;
      if (isNotReadyFailure(leaf)) {
        const delay = nextRetryDelayMs(notReadyAttempts);
        notReadyAttempts += 1;
        if (delay === null) return; // 退避用尽：落回常规周期，不再额外打扰
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void run();
        }, delay);
        return;
      }
      notReadyAttempts = 0;
    };

    void run();
    const ticker = setInterval(() => {
      if (!stopped) void run();
    }, settings.refreshSec * 1000);

    return () => {
      stopped = true;
      clearInterval(ticker);
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    };
  }, 'dsh-model-balance: refresh timer');

  // ---- 对外扩展点 ----
  const service = {
    registerProvider: (def) => registry.registerProvider(def, 'external'),
    providers: () => registry.providers(),
    refreshNow: () => refreshBalance(true),
    snapshot: () => store.read(),
    rules: () => store.read().pricing,
  };
  const providedVia = provideService(ctx, 'modelBalance', service);

  console.info(
    '[dsh-model-balance] 已装配：slot=' +
      settings.slot +
      ' refresh=' +
      settings.refreshSec +
      's route=' +
      ROUTE_PREFIX +
      ' 扩展点=' +
      (providedVia ?? '不可用') +
      ' 内置 providers=' +
      registry.providers().join(','),
  );
}
