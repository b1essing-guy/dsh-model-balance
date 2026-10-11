/**
 * 峰谷计价的**唯一真相来源**（host / client / 测试三方共用）。
 *
 * 为什么单独一个文件：host 半边可以直接 ESM import，client 半边是单文件产物，
 * 必须靠构建内联（见 scripts/build-client.js）。把它抽出来，是为了让「档位判定 +
 * 距下次切换倒计时」这套算法**只有一份实现**——两份实现早跑偏晚跑偏，早晚跑偏。
 *
 * 已核实的业务事实（权威来源：DeepSeek 官方「模型 & 价格」页
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ ，2026-10-10 核对）：
 *   空闲时段价格 = 高峰时段价格的一半。北京时间周一至周五（**不含中国法定节假日**）
 *   9:00-12:00、14:00-18:00 为高峰时段；其余时段，包括**周末及中国法定节假日全天**，
 *   均为空闲时段。
 *
 * 注：早期媒体报道（新浪财经 2026-08-23）只写了「周末不再区分峰谷」，**漏了法定节假日**；
 * 本模块以官方页为准，并为此保留了 `rules.holidays` 入口。
 *
 * 时区口径：一律按 `Asia/Shanghai` 的钟表时间判定，**不依赖运行环境时区**。
 * 本模块所有函数都是纯函数（now 与规则均可注入），因此可以在任意系统时区下被单测钉死。
 */

/** DeepSeek 计价时区（业务事实，不由运行环境决定） */
export const DEEPSEEK_TIME_ZONE = 'Asia/Shanghai';

/** 工作日高峰窗口（本地钟表时间，闭开区间 [start, end)） */
export const DEEPSEEK_PEAK_WINDOWS = [
  { start: '09:00', end: '12:00' },
  { start: '14:00', end: '18:00' },
];

/** 找「下一个工作日」时的最大前探天数（防止规则异常导致死循环） */
const MAX_LOOKAHEAD_DAYS = 400;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** 'HH:MM' → 当日分钟偏移 */
function toMinutes(hhmm) {
  const [hour, minute] = String(hhmm).split(':');
  return Number(hour) * 60 + Number(minute);
}

function pad2(value) {
  return value < 10 ? '0' + value : String(value);
}

/**
 * 「本地钟表毫秒」→ 'YYYY-MM-DD'。
 * wallMs 是以 UTC 午夜为坐标系表示的当地钟表时间，故用 getUTC* 读回即当地日期。
 */
function wallDateKey(wallMs) {
  const at = new Date(wallMs);
  return at.getUTCFullYear() + '-' + pad2(at.getUTCMonth() + 1) + '-' + pad2(at.getUTCDate());
}

/** 「本地钟表毫秒」的星期（0=周日 … 6=周六） */
function wallWeekday(wallMs) {
  return new Date(wallMs).getUTCDay();
}

/**
 * 某个瞬时在某时区的 UTC 偏移（分钟）。
 * 用 Intl 把该瞬时投影成当地钟表字段，再按「同一串字段当成 UTC」反算差值。
 * 对 Asia/Shanghai（固定 +08:00、无夏令时）单次即是精确值。
 */
function offsetMinutesAt(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23', // h23 避免午夜被格式化成 24:00
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(epochMs));
  const pick = (type) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(pick('year'), pick('month') - 1, pick('day'), pick('hour'), pick('minute'), pick('second'));
  return Math.round((asUtc - epochMs) / MS_PER_MINUTE);
}

/** 某瞬时在某时区的钟表字段（含星期；0=周日 … 6=周六） */
function wallFieldsAt(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(epochMs));
  const pick = (type) => Number(parts.find((p) => p.type === type)?.value);
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  return {
    year,
    month,
    day,
    hour: pick('hour'),
    minute: pick('minute'),
    // 星期由「钟表日期」反推：用 UTC 构造同一天，getUTCDay 不受本机时区影响
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** 「本地钟表毫秒」→ 真实瞬时（epoch ms）。先按猜测偏移算一次，再用真实偏移校正一次。 */
function wallToEpoch(wallMs, timeZone) {
  const guess = wallMs - offsetMinutesAt(wallMs, timeZone) * MS_PER_MINUTE;
  return wallMs - offsetMinutesAt(guess, timeZone) * MS_PER_MINUTE;
}

/**
 * 从某天起，找到下一个**既非周末也非法定节假日**的工作日，返回相对今天的天数偏移。
 * 周末是否算休息日由 `weekendsAllIdle` 决定；节假日永远算休息日（官方口径）。
 */
function nextWorkdayOffset(wallMidnight, weekendsAllIdle, holidaySet) {
  for (let offset = 1; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    const candidate = wallMidnight + offset * MS_PER_DAY;
    const weekday = wallWeekday(candidate);
    if (weekendsAllIdle && (weekday === 0 || weekday === 6)) continue;
    if (holidaySet.has(wallDateKey(candidate))) continue;
    return offset;
  }
  return 1;
}

/**
 * 判定某时刻的计价档位与距下次切换的时间。
 *
 * @param {Date} [now] 判定时刻（默认此刻；可注入以便测试）
 * @param {{timeZone?: string, windows?: Array<{start: string, end: string}>, weekendAllIdle?: boolean, holidays?: string[]}} [rules]
 *   计价规则；缺省即 DeepSeek 当前规则。规则由 host 侧带出，展示层不写死。
 * @returns {{
 *   tier: 'peak' | 'idle',
 *   basis: 'peak-window' | 'off-window' | 'weekend' | 'holiday',
 *   timeZone: string,
 *   holiday: boolean,
 *   nextSwitchAt: number,
 *   msToSwitch: number,
 *   nextTier: 'peak' | 'idle',
 *   weekendsAllIdle: boolean,
 *   minutesOfDay: number,
 *   weekday: number
 * }}
 */
export function peakValleyAt(now = new Date(), rules = {}) {
  const timeZone = rules.timeZone ?? DEEPSEEK_TIME_ZONE;
  const windows = Array.isArray(rules.windows) && rules.windows.length > 0 ? rules.windows : DEEPSEEK_PEAK_WINDOWS;
  const weekendsAllIdle = rules.weekendAllIdle ?? true;
  const holidaySet = new Set(Array.isArray(rules.holidays) ? rules.holidays : []);

  const epoch = now instanceof Date ? now.getTime() : Number(now);
  const wall = wallFieldsAt(epoch, timeZone);
  const isWeekend = wall.weekday === 0 || wall.weekday === 6;
  const minutesOfDay = wall.hour * 60 + wall.minute;
  const ranges = windows.map((w) => ({ start: toMinutes(w.start), end: toMinutes(w.end) }));

  // 当日零点（本地钟表的「毫秒」坐标系）——用它做日期加减，月/年进位自动处理
  const wallMidnight = Date.UTC(wall.year, wall.month - 1, wall.day);
  // 法定节假日优先于周末：官方口径下两者都全天空闲，但要能区分是哪种（决定文案）
  const isHoliday = holidaySet.has(wallDateKey(wallMidnight));
  const weekendIdle = isWeekend && weekendsAllIdle;
  const allIdle = isHoliday || weekendIdle;

  const inPeakWindow = ranges.some((r) => minutesOfDay >= r.start && minutesOfDay < r.end);
  const tier = !allIdle && inPeakWindow ? 'peak' : 'idle';
  const basis = isHoliday ? 'holiday' : weekendIdle ? 'weekend' : inPeakWindow ? 'peak-window' : 'off-window';

  const firstPeakStart = ranges.length > 0 ? Math.min(...ranges.map((r) => r.start)) : toMinutes('09:00');

  // 候选切换点 = **所有窗口的起点与终点**。
  // 只取起点是错的：正向当前窗口内部（如 10:00 处于 09:00–12:00）时，
  // 下次切换是当前窗口的**终点** 12:00，而不是下一个窗口的起点 14:00。
  const boundaries = [];
  for (const range of ranges) {
    boundaries.push(range.start);
    boundaries.push(range.end);
  }
  boundaries.sort((left, right) => left - right);

  const toNextWorkdayPeak = () =>
    wallMidnight + nextWorkdayOffset(wallMidnight, weekendsAllIdle, holidaySet) * MS_PER_DAY + firstPeakStart * MS_PER_MINUTE;

  let nextWall;
  if (allIdle) {
    // 周末或法定节假日全天空闲：下次切换 = 下个工作日的高峰起点（会跳过周末与节假日）
    nextWall = toNextWorkdayPeak();
  } else {
    const nextBoundary = boundaries.find((boundary) => boundary > minutesOfDay);
    // 已过当日最后一个边界时，同样顺延到下一个工作日的高峰起点
    nextWall = nextBoundary !== undefined ? wallMidnight + nextBoundary * MS_PER_MINUTE : toNextWorkdayPeak();
  }

  const nextSwitchAt = wallToEpoch(nextWall, timeZone);
  return {
    tier,
    basis,
    timeZone,
    holiday: isHoliday,
    nextSwitchAt,
    msToSwitch: Math.max(0, nextSwitchAt - epoch),
    // 高峰只可能切到低谷，低谷只可能切到高峰（休息日之后那个高峰就是下个工作日的高峰起点）
    nextTier: tier === 'peak' ? 'idle' : 'peak',
    weekendsAllIdle,
    minutesOfDay,
    weekday: wall.weekday,
  };
}

/**
 * 时长格式化：用于「距下次切换」倒计时。
 * 口径：>= 1 天 → `2d3h`；>= 1 小时 → `1h13m`；否则 → `45m`；< 1 分钟 → `不足1m`。
 * 刻意不显示秒：倒计时每秒重算，秒级抖动只会让人眼累。
 */
export function formatDuration(ms) {
  const totalMinutes = Math.floor(Math.max(0, Number(ms)) / MS_PER_MINUTE);
  if (totalMinutes <= 0) return '不足1m';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return days + 'd' + hours + 'h';
  if (hours > 0) return hours + 'h' + minutes + 'm';
  return minutes + 'm';
}

/** 币种符号：CNY → ¥，USD → $，其余退回币种代码前缀 */
export function currencySymbol(currency) {
  const code = String(currency ?? '').toUpperCase();
  if (code === 'CNY' || code === 'RMB') return '¥';
  if (code === 'USD') return '$';
  return code.length > 0 ? code + ' ' : '¥';
}

/**
 * 金额展示：`¥12.34`。
 *
 * 内置 provider 已在取数层把金额收敛成两位小数（见 src/host/internal.js 的 money()）；
 * 这里再做一层**展示兜底**：第三方 provider 若回传高精度原串（形如 `9.9902690000000000`），
 * 也收敛到两位，免得界面上出现一串没意义的尾数。非法/空值一律原样回显或显示 `—`，
 * **绝不在这里伪造 0**。
 */
export function formatMoney(amount, currency) {
  const text = amount === undefined || amount === null ? '' : String(amount).trim();
  if (text.length === 0) return '—';
  const normalized = /^-?\d+\.\d{3,}$/.test(text) ? (Math.round(Number(text) * 100) / 100).toFixed(2) : text;
  return currencySymbol(currency) + normalized;
}

/** 某瞬时在某时区的 'HH:MM'（用于把下次切换时刻写成钟点） */
export function formatClock(epochMs, timeZone = DEEPSEEK_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(epochMs));
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return hour + ':' + minute;
}
