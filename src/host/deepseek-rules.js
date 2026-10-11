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
 * 命中则该日全天按空闲计费。
 *
 * 来源：**国务院办公厅关于2026年部分节假日安排的通知**
 *   发文字号 国办发明电〔2025〕7号 · 成文/发布日期 2025-11-04 · 发文机关 国务院办公厅
 *   https://www.gov.cn/zhengce/content/202511/content_7047090.htm
 *   （索引号 000014349/2025-00087；国务院公报版 .../gongbao/2025/issue_12406/202511/content_7048922.html）
 *
 * 录入口径（2026-10-10 按原文逐条录入，非二手转述）：
 *   元旦 01-01(四)~01-03(六)｜春节 02-15(日)~02-23(一)｜清明 04-04(六)~04-06(一)
 *   劳动节 05-01(五)~05-05(二)｜端午 06-19(五)~06-21(日)｜中秋 09-25(五)~09-27(日)
 *   国庆 10-01(四)~10-07(三)   → 合计 33 天
 *   - **周末型的节假日也一并录入**（如 01-03、10-03）：它们本就是空闲，录进来只为让这张表
 *     与官方通知逐日对齐、便于对照审计；判定结果不变，只是档位文案会显示为「法定节假日低谷」。
 *   - **调休上班日不录**：官方计价口径明确「其余时段，**包括周末**……均为空闲」，
 *     因此调休上班的周末（2026-01-04、02-14、02-28、05-09、09-20、10-10）仍按空闲计费。
 *
 * ⚠️ 覆盖边界（诚实标注）：本表只含 2026 年。且 2026 年节假日全部早于 2026-10-10，
 * 所以对今年余下的时间它没有行为影响——真正生效要等到 2027 年元旦。
 * **2027 年安排截至 2026-10-10 尚未官宣**（按惯例当年 11~12 月公布），公布后按同一口径补入；
 * 补入之前，2027 年的法定节假日会被**按高峰显示**（偏保守，不会误导成更便宜）。
 */
export const DEEPSEEK_PRICING_RULES = {
  timeZone: 'Asia/Shanghai',
  windows: [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  weekendAllIdle: true,
  /** 中国法定节假日（'YYYY-MM-DD'）；该日全天按空闲计费。来源见上方注释。 */
  holidays: [
    // 元旦（1月1日至3日）
    '2026-01-01', '2026-01-02', '2026-01-03',
    // 春节（2月15日至23日，共 9 天）
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
    '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
    // 清明节（4月4日至6日）
    '2026-04-04', '2026-04-05', '2026-04-06',
    // 劳动节（5月1日至5日）
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    // 端午节（6月19日至21日）
    '2026-06-19', '2026-06-20', '2026-06-21',
    // 中秋节（9月25日至27日）
    '2026-09-25', '2026-09-26', '2026-09-27',
    // 国庆节（10月1日至7日）
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
    '2026-10-06', '2026-10-07',
  ],
  /** 节假日表的出处（随状态下发，便于审计与后续更新） */
  holidaySource: {
    authority: '国务院办公厅',
    document: '国务院办公厅关于2026年部分节假日安排的通知（国办发明电〔2025〕7号）',
    publishedAt: '2025-11-04',
    url: 'https://www.gov.cn/zhengce/content/202511/content_7047090.htm',
    checkedAt: '2026-10-10',
    coveredYears: [2026],
  },
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
