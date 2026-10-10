/**
 * dsh-model-balance 的对外契约（**第三方接入方只需要读这一个文件**）。
 *
 * 扩展点的唯一入口：host 侧 Service `modelBalance.registerProvider(def)`。
 * 注册进来的 provider 与插件内置的两条 deepseek 路由**走完全相同的一条路**——
 * 内置项本身就是用这个接口注册的，所以这个扩展点不是「给外人看的花架子」。
 */

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** host 侧余额扩展点；插件未加载时为 undefined（用 ctx.get('modelBalance') 软取） */
    modelBalance?: ModelBalanceService;
  }
}

/** 凭证来源：`ref` = 交给 DSH credential 服务解析的环境变量名；`none` = 该路由没有 API Key（如账号路由） */
export type CredentialSpec = { mode: 'ref'; ref: string } | { mode: 'none' };

/** provider 取数时收到的上下文（所有 provider 形状一致，各取所需） */
export interface BalanceFetchContext {
  /** 命中的 provider id，原样回填进结果 */
  provider: string;
  /** 已解析的 API Key；`credential.mode === 'none'` 时为空串 */
  key: string;
  /** 账号余额查询（注入 `ctx.deepseekAccount.getBalance`）；仅 `mode === 'none'` 使用 */
  resolveAccount?: () => Promise<AccountBalanceSnapshot | null | undefined>;
}

/** 账户金额形态（唯一的内置形态；金额都是已格式化的十进制字符串） */
export interface MoneyBalance {
  currency: string;
  /** 总可用余额（= 赠送 + 充值；由数据源给出，不在展示层重算） */
  total: string;
  /** 未过期赠金 */
  granted: string;
  /** 充值余额 */
  toppedUp: string;
}

/** 成功结果 */
export type BalanceSuccess = { ok: true; provider: string; shape: 'money'; data: MoneyBalance };

/**
 * 查询结果。**失败绝不返回伪造数字**：0 余额只能来自数据源，不能来自兜底。
 * - `unsupported`：当前 provider 没有登记取数接口（不显示余额，而不是显示 0）
 * - `credential-missing`：缺凭证 / 账号服务不在场
 * - `fetch-error`：网络或响应异常
 */
export type BalanceResult =
  | BalanceSuccess
  | { ok: false; provider: string; reason: 'unsupported' | 'credential-missing' | 'fetch-error'; message?: string };

/** DSH 账号服务的余额快照（`ctx.deepseekAccount.getBalance()` 返回，只取用到的字段） */
export interface AccountBalanceSnapshot {
  status: 'ready' | 'failed';
  value?: readonly { currency?: unknown; balance?: unknown }[];
  bonusWallets?: readonly { currency?: unknown; balance?: unknown }[];
}

/**
 * 一个模型服务商的余额取数定义 —— **实现这一个接口即可接入**。
 *
 * 约定：`fetch` 只负责成功路径，任何失败（HTTP 非 2xx、字段缺失、未登录、无钱包）一律 `throw`，
 * 由注册表统一落成 `fetch-error`。这样所有 provider 的失败口径一致，也不可能静默伪造 0。
 */
export interface BalanceProvider {
  /** 可命中的 provider id，对齐 `ctx.agentDefaultModel.currentSelection().provider` */
  ids: string[];
  credential: CredentialSpec;
  fetch(ctx: BalanceFetchContext): Promise<BalanceSuccess>;
}

/** host 侧 Service 面（`ctx.modelBalance`） */
export interface ModelBalanceService {
  /**
   * 注册一个 provider。返回幂等的注销函数。
   * 同一个 id 被**不同**注册方占用时直接 throw（配置级冲突应当立刻暴露，不做静默覆盖）。
   */
  registerProvider(def: BalanceProvider): () => void;
  /** 已登记的 provider id 列表（排障用） */
  providers(): string[];
  /** 立即刷新一次并写入轮询状态 */
  refreshNow(): Promise<void>;
  /** 当前轮询状态快照（余额 + 计价规则 + 最近刷新时间） */
  snapshot(): unknown;
}
