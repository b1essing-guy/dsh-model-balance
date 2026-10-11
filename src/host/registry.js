/**
 * 余额扩展点**本体**：provider 注册表 + 统一的凭证/失败口径。
 *
 * 设计口径（第三方接入方只需读这三条）：
 * 1. **一个 provider = 一个自包含对象**：接口地址、业务常量、响应解析都在注册方自己那份；
 *    本文件只留注册表与统一口径，不认识任何具体服务商。
 * 2. **注册即生效、注销即失效**：`registerProvider` 返回幂等 disposer，与 Cordis 的
 *    `ctx.effect` 一起用，插件卸载时注册自动回收，不会留下悬空 provider。
 * 3. **失败绝不伪造数字**：provider 只负责成功路径，任何失败一律 throw；这里统一落成
 *    `fetch-error`。当前 provider 没登记 → `unsupported`（不显示余额，而不是显示 0）。
 *
 * 内置的两条 deepseek 路由就是走**这个接口**注册的（见 src/index.js），
 * 所以这个扩展点被自身使用——它不是一个没人走过的架子。
 */

/**
 * 构造失败结果。`message` 缺省时**不写这个键**：叶子形状是对外契约，
 * 多一个 `undefined` 键会让消费端的严格比对失效。
 */
function failed(provider, reason, message) {
  return message === undefined ? { ok: false, provider, reason } : { ok: false, provider, reason, message };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 「账号服务尚未就绪」的显式信号（哨兵对象）。
 *
 * 为什么不直接用 `undefined`：它同时表示「服务不在场」和「服务在但没登录」，
 * 但这两种情况**该说的话不一样**——前者会自愈（DSH 还在启动，重试即可），
 * 后者要用户去登录。调用方（src/index.js 的 resolveAccount）在服务缺席时返回本哨兵，
 * 本文件据此给出精确文案；调用方若想当普通"缺席"处理，把它当 `undefined` 即可。
 */
export const ACCOUNT_SERVICE_ABSENT = { dshModelBalance: 'account-service-absent' };

/**
 * 校验一个 provider 定义。第三方代码是不可信输入，**形状不对就直接拒绝**，
 * 否则坏定义会在每次轮询里炸，排障成本远高于注册时立刻失败。
 */
function validateProvider(def, owner) {
  if (def === null || typeof def !== 'object') {
    throw new Error('dsh-model-balance: registerProvider 需要对象（来自 ' + owner + '）');
  }
  const ids = def.ids;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new Error('dsh-model-balance: provider.ids 必须是非空字符串数组（来自 ' + owner + '）');
  }
  const credential = def.credential;
  if (credential === null || typeof credential !== 'object') {
    throw new Error('dsh-model-balance: provider.credential 缺失（来自 ' + owner + '）');
  }
  if (credential.mode === 'ref') {
    if (typeof credential.ref !== 'string' || credential.ref.length === 0) {
      throw new Error('dsh-model-balance: credential.mode=ref 需要非空 ref（来自 ' + owner + '）');
    }
  } else if (credential.mode !== 'none') {
    throw new Error('dsh-model-balance: credential.mode 只能是 ref 或 none（来自 ' + owner + '）');
  }
  if (typeof def.fetch !== 'function') {
    throw new Error('dsh-model-balance: provider.fetch 必须是函数（来自 ' + owner + '）');
  }
}

export function createRegistry() {
  /** @type {Map<string, { def: object, owner: string }>} id → 定义与归属 */
  const byId = new Map();

  return {
    /**
     * 注册一个 provider。
     *
     * @param {object} def 见 types/index.d.ts 的 BalanceProvider
     * @param {string} [owner] 注册方标识（排障与冲突报错用）
     * @returns {() => void} 幂等注销函数
     */
    registerProvider(def, owner = 'anonymous') {
      validateProvider(def, owner);
      const claimed = new Set();
      for (const id of def.ids) {
        const existing = byId.get(id);
        // 同 id 冲突直接抛：静默覆盖会让「余额忽然变成别家的数」成为最难查的一类故障
        if (existing !== undefined && existing.owner !== owner) {
          throw new Error(
            'dsh-model-balance: provider id 已被占用：' + id + '（' + existing.owner + ' ← ' + owner + '）',
          );
        }
        byId.set(id, { def, owner });
        claimed.add(id);
      }
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        for (const id of claimed) {
          const current = byId.get(id);
          if (current !== undefined && current.def === def) byId.delete(id);
        }
      };
    },

    /** 已登记的 provider id（升序，排障用） */
    providers() {
      return [...byId.keys()].sort();
    },

    /** 查询某个 provider id 的归属（排障用） */
    ownerOf(id) {
      return byId.get(String(id ?? ''))?.owner;
    },

    /**
     * 按 provider id 查询余额。
     *
     * @param {string} providerId 取自 `ctx.agentDefaultModel.currentSelection().provider`
     * @param {(ref: string) => Promise<string | undefined>} resolveKey 凭证解析（由调用方注入）
     * @param {() => Promise<object | null | undefined>} [resolveAccount] 账号余额查询
     * @returns {Promise<object>} 成功 / unsupported / credential-missing / fetch-error
     */
    async query(providerId, resolveKey, resolveAccount) {
      const id = String(providerId ?? '');
      const entry = byId.get(id);
      if (entry === undefined) return failed(id, 'unsupported');

      const def = entry.def;
      let key = '';
      let resolveAccountOnce;
      if (def.credential.mode === 'ref') {
        // 凭证解析本身抛错属于意外异常：由调用方（refreshBalance）兜底，不在这一层吞掉
        const resolved = await resolveKey(def.credential.ref);
        if (!resolved) {
          return failed(id, 'credential-missing', '缺少凭证 ' + def.credential.ref);
        }
        key = resolved;
      } else {
        if (typeof resolveAccount !== 'function') {
          return failed(id, 'credential-missing', '账号服务不在场（' + id + '）');
        }
        // 账号路由先探一次快照并**记忆化**：探不到 = 账号服务不在场或未登录，
        // 语义是 credential-missing（可读降级），不能被混淆成一次网络失败。
        // 同时也保证 provider 的 fetch 只触发一次账号查询。
        let snapshot;
        let probed = false;
        resolveAccountOnce = async () => {
          if (!probed) {
            snapshot = await resolveAccount();
            probed = true;
          }
          return snapshot;
        };
        const first = await resolveAccountOnce();
        if (first === ACCOUNT_SERVICE_ABSENT) {
          // 服务缺席：这是启动竞态，会自愈（host 侧会按退避序列快速重试）——
          // 文案必须与"未登录"区分开，否则用户会以为要自己去配置凭证
          return failed(id, 'credential-missing', '账号服务尚未就绪（' + id + '）');
        }
        if (first === undefined || first === null) {
          return failed(id, 'credential-missing', '账号服务不在场或未登录（' + id + '）');
        }
      }

      let result;
      try {
        result = await def.fetch({ provider: id, key, resolveAccount: resolveAccountOnce ?? resolveAccount });
      } catch (error) {
        return failed(id, 'fetch-error', messageOf(error));
      }

      // 第三方 provider 是不可信代码：返回值也必须校验，坏结果不能污染轮询状态
      if (result === null || typeof result !== 'object' || result.ok !== true || result.shape !== 'money') {
        return failed(id, 'fetch-error', 'provider 返回了非法结果（' + id + '）');
      }
      if (result.data === null || typeof result.data !== 'object' || typeof result.data.total !== 'string') {
        return failed(id, 'fetch-error', 'provider 返回的余额缺少 total（' + id + '）');
      }
      return { ...result, provider: id };
    },
  };
}
