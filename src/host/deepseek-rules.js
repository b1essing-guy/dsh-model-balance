/**
 * DeepSeek 的**业务事实**：峰谷时段规则 + 单价表。
 *
 * 这些是 DeepSeek 自己的定价事实，**不属于展示层**。它们住在 host 侧、随轮询状态一起
 * 带给展示层；展示层只认「规则数据」，不写死任何时段或单价——所以规则变了，
 * 只改这一个文件，展示层零改动。
 *
 * 已核实（2026-10-10 核对）：
 * - 规则生效：2026-08-23 00:00 起。工作日高峰 = 北京时间 09:00—12:00、14:00—18:00，
 *   其余为空闲；周六、周日全天按低谷计费。
 *   来源：https://finance.sina.cn/2026-08-23/detail-inipipwn6614291.d.html
 * - 低谷价 = 高峰价 × 50%（同上）。
 * - 单价示例取该报道给出的 DeepSeek-V4-Pro 档位（每百万 tokens）：
 *     高峰：输入(缓存未命中) ¥9、输出 ¥27、缓存命中输入 ¥0.3
 *     低谷：输入(缓存未命中) ¥4.5、输出 ¥13.5、缓存命中输入 ¥0.15
 *
 * 注意：单价是**展示用的参考数据**，不参与任何计费计算。DeepSeek 再次调价时，
 * 只需更新本文件的数值与 `priceAsOf`，无需改代码逻辑。
 */

/** 计价规则（最小时段形状，喂给 src/shared/pricing.js 的 peakValleyAt） */
export const DEEPSEEK_PRICING_RULES = {
  timeZone: 'Asia/Shanghai',
  windows: [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  weekendAllIdle: true,
  /** 规则生效日（区间左端，含） */
  effectiveFrom: '2026-08-23',
  /** 该规则适用的周末口径说明，供悬停详情展示 */
  weekendNote: 'weekend-all-idle',
};

/** 参考单价（每百万 tokens，人民币） */
export const DEEPSEEK_PRICE_TABLE = {
  model: 'DeepSeek-V4-Pro',
  currency: 'CNY',
  unit: 'per-million-tokens',
  priceAsOf: '2026-08-23',
  source: 'https://finance.sina.cn/2026-08-23/detail-inipipwn6614291.d.html',
  peak: { inputCacheMiss: 9, output: 27, inputCacheHit: 0.3 },
  idle: { inputCacheMiss: 4.5, output: 13.5, inputCacheHit: 0.15 },
};

/** 余额档位基准（¥）：余额 ≥ 该值视为「未消耗」，低于它才开始示警；纯展示参照 */
export const DEEPSEEK_FULL_BALANCE = '20';
