/**
 * DeepSeek 的**业务事实**：各模型单价 + 峰谷时段规则。
 *
 * 这些是 DeepSeek 自己的定价事实，**不属于展示层**。它们住在 host 侧、随轮询状态一起
 * 带给展示层；展示层只认「规则数据」，不写死任何时段或单价——所以规则变了，
 * 只改这一个文件，展示层零改动。
 *
 * 权威来源（2026-10-10 核对「模型 & 价格」页）：
 *   https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 *
 * 该页明确的高峰定义（比早期媒体报道更完整，媒体版漏了节假日）：
 *   空闲时段价格 = 高峰时段价格的一半。北京时间周一至周五（**不含中国法定节假日**）
 *   9:00-12:00、14:00-18:00 为高峰时段；其余时段，**包括周末及中国法定节假日全天**，
 *   均为空闲时段。
 *
 * 单价按**模型 id**索引（对齐 `agentDefaultModel.currentSelection().model`）：
 * 查不到就**不显示任何单价**——绝不套用另一个模型的数字。
 */

/**
 * 时段规则（喂给 src/shared/pricing.js 的 peakValleyAt）。
 *
 * `holidays` 是**中国法定节假日**的当地日期（'YYYY-MM-DD'，按 timeZone 判定）：
 * 命中则该日全天按空闲计费。默认空数组 = 不把任何日期当节假日。
 *
 * ⚠️ 已知缺口（诚实标注，不编数据）：节假日日期表尚未填入，因此当前在法定节假日的
 * 工作日那个时段，本插件会**按高峰**显示，而官方口径是全天空闲。填入时必须用
 * 国务院办公厅公布的年度放假安排作为来源，不要凭常识猜。机制已经就绪（填数组即生效，
 * 含"下一次切换"顺延逻辑）。
 */
export const DEEPSEEK_PRICING_RULES = {
  timeZone: 'Asia/Shanghai',
  windows: [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  weekendAllIdle: true,
  /** 中国法定节假日（'YYYY-MM-DD'）；该日全天按空闲计费。见上方缺口说明。 */
  holidays: [],
  /** 规则生效日（区间左端，含） */
  effectiveFrom: '2026-08-23',
  /** 该规则适用的周末口径说明，供悬停详情展示 */
  weekendNote: 'weekend-all-idle',
};

/** 单价的出处与核对时间（随数据一起下发，界面据此标注新鲜度） */
export const DEEPSEEK_PRICE_SOURCE = {
  url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  checkedAt: '2026-10-10',
  currency: 'CNY',
  unit: 'per-million-tokens',
};

/**
 * 各模型单价（每百万 tokens，人民币）。
 *
 * key 必须是**模型 id**（不是展示名）：profile 的 `agent-default-model.config.model`
 * 写的就是这个值。官方页上两个模型：
 *   - `deepseek-flash`      → DeepSeek-V4.1-Flash
 *   - `deepseek-v4-pro`     → DeepSeek-V4-Pro-0813
 *
 * 注：官方页另有说明——旧模型名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`
 * 仍可调用但底层已下线，请求由 V4.1-Flash 提供服务并按 Flash 计费。它们因此共用
 * Flash 的单价（用别名方式指向同一份数据，避免同一组数字抄两遍）。
 */
const FLASH_PRICES = {
  label: 'DeepSeek-V4.1-Flash',
  peak: { inputCacheMiss: 2, output: 8, inputCacheHit: 0.04 },
  idle: { inputCacheMiss: 1, output: 4, inputCacheHit: 0.02 },
};

const V4_PRO_PRICES = {
  label: 'DeepSeek-V4-Pro-0813',
  peak: { inputCacheMiss: 9, output: 27, inputCacheHit: 0.3 },
  idle: { inputCacheMiss: 4.5, output: 13.5, inputCacheHit: 0.15 },
};

export const DEEPSEEK_PRICE_TABLES = {
  'deepseek-flash': FLASH_PRICES,
  'deepseek-v4-flash': FLASH_PRICES,
  'deepseek-v4-flash-vision-exp': FLASH_PRICES,
  'deepseek-v4-pro': V4_PRO_PRICES,
};

/** 余额档位基准（¥）：余额 ≥ 该值视为「未消耗」，低于它才开始示警；纯展示参照 */
export const DEEPSEEK_FULL_BALANCE = '20';
