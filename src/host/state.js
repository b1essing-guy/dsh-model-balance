/**
 * 轮询状态（host 侧维护的**唯一**「给前端读」的数据源）。
 *
 * 为什么要有它：余额查询是有成本的外部调用（网络 / 账号服务）。如果每个页面各自定时查，
 * 同一份外部 API 会被重复请求，两端还可能看到新旧不一致的数据。所以**只有 host 查一次**，
 * 前端统一从 GET /state 读同一份结果。
 *
 * `rev` 语义（整个设计的地基）：
 * - 每次写入**必须**更新 rev，前端靠「rev 变了」判断要不要重渲染；
 * - 取值 `Date.now()` 并与「上一个 +1」取大 —— 单调、不回退、同毫秒连写两次也不重复。
 *   用自增计数会在宿主重启后归零，而前端手里还存着旧值，对比会**永久失效**。
 */
export class BalanceStateStore {
  /**
   * @param {object} pricing 计价规则（随状态一起带出，展示层不写死）
   */
  constructor(pricing) {
    this.pricing = pricing;
    this.rev = 0;
    this.balance = null;
    this.selectedProvider = '';
  }

  /** 下一个 rev：`Date.now()` 与「上一个 +1」取大 */
  nextRev() {
    this.rev = Math.max(Date.now(), this.rev + 1);
    return this.rev;
  }

  /**
   * 写一次余额结果。整体替换 `balance`（不原地改字段），保证读到的一定是一份完整结果。
   *
   * @param {object} result 注册表 query 的结果（成功或失败都要写——余额不可用必须显式暴露，
   *   不能静默；前端据 reason 给出对应文案）
   */
  writeBalance(result) {
    this.balance = result;
    this.nextRev();
  }

  /** 记录「这次查询时选中的是哪个 provider」（排障：能一眼看出数据源） */
  writeSelectedProvider(providerId) {
    this.selectedProvider = String(providerId ?? '');
    this.nextRev();
  }

  /** 当前状态（GET /state 的响应体） */
  read() {
    return {
      rev: this.rev,
      selectedProvider: this.selectedProvider,
      balance: this.balance,
      pricing: this.pricing,
    };
  }
}
