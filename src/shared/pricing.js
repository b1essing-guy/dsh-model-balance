/**
 * 峰谷计价的**唯一真相来源**（host / client / 测试三方共用）。
 *
 * 为什么单独一个文件：host 半边可以直接 ESM import，client 半边是单文件产物，
 * 必须靠构建内联（见 scripts/build-client.js）。把它抽出来，是为了让「档位判定 +
 * 距下次切换倒计时」这套算法**只有一份实现**——两份实现早跑偏晚跑偏，早晚跑偏。
 *
 * 已核实的业务事实（不是猜的）：
 * - 自 2026-08-23 00:00 起，工作日维持峰谷两档，高峰为北京时间 09:00—12:00、
 *   14:00—18:00，其余为空闲；周六、周日**全天**按低谷计费。
 *   来源：https://finance.sina.cn/2026-08-23/detail-inipipwn6614291.d.html
 * - 低谷价 = 高峰价 × 50%（同上）。
 *
 * 时区口径：一律按 `Asia/Shanghai` 的钟表时间判定，**不依赖运行环境时区**。
 * 本模块所有函数都是纯函数（now 可注入），因此可以在任意系统时区下被单测钉死。
 */

/** DeepSeek 计价时区（业务事实，不由运行环境决定） */
export const DEEPSEEK_TIME_ZONE = 'Asia/Shanghai';

/** 工作日高峰窗口（本地钟表时间，闭开区间 [start, end)） */
export const DEEPSEEK_PEAK_WINDOWS = [
  { start: '09:00', end: '12:00' },
  { start: '14:00', end: '18:00' },
];

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** 'HH:MM' → 当日分钟偏移 */
function toMinutes(hhmm) {
  const [hour, minute] = String(hhmm).split(':');
  return Number(hour) * 60 + Number(minute);
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

/** 从某天起，找到下 N 个「工作日」（跳过周六周日） */
function nextWorkdayOffset(weekday, fromOffset) {
  let offset = fromOffset;
  for (;;) {
    const target = (weekday + offset) % 7;
    if (target !== 0 && target !== 6) return offset;
    offset += 1;
  }
}

/**
 * 判定某时刻的计价档位与距下次切换的时间。
 *
 * @param {Date} [now] 判定时刻（默认此刻；可注入以便测试）
 * @param {{timeZone?: string, windows?: Array<{start: string, end: string}>, weekendAllIdle?: boolean}} [rules]
 *   计价规则；缺省即 DeepSeek 当前规则。规则由 host 侧带出，展示层不写死。
 * @returns {{
 *   tier: 'peak' | 'idle',
 *   basis: 'peak-window' | 'off-window' | 'weekend',
 *   timeZone: string,
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

  const epoch = now instanceof Date ? now.getTime() : Number(now);
  const wall = wallFieldsAt(epoch, timeZone);
  const isWeekend = wall.weekday === 0 || wall.weekday === 6;
  const minutesOfDay = wall.hour * 60 + wall.minute;
  const ranges = windows.map((w) => ({ start: toMinutes(w.start), end: toMinutes(w.end) }));

  const weekendIdle = isWeekend && weekendsAllIdle;
  const inPeakWindow = ranges.some((r) => minutesOfDay >= r.start && minutesOfDay < r.end);
  const tier = !weekendIdle && inPeakWindow ? 'peak' : 'idle';
  const basis = weekendIdle ? 'weekend' : inPeakWindow ? 'peak-window' : 'off-window';

  // 当日零点（本地钟表的「毫秒」坐标系）——用它做日期加减，月/年进位自动处理
  const wallMidnight = Date.UTC(wall.year, wall.month - 1, wall.day);
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

  let nextWall;
  if (weekendIdle) {
    // 周末全天低谷：下次切换 = 下个工作日的高峰起点（周一 09:00）
    nextWall = wallMidnight + nextWorkdayOffset(wall.weekday, 1) * MS_PER_DAY + firstPeakStart * MS_PER_MINUTE;
  } else {
    const nextBoundary = boundaries.find((boundary) => boundary > minutesOfDay);
    if (nextBoundary !== undefined) {
      nextWall = wallMidnight + nextBoundary * MS_PER_MINUTE;
    } else {
      // 已过当日最后一个边界：下次切换 = 下个工作日的高峰起点
      nextWall = wallMidnight + nextWorkdayOffset(wall.weekday, 1) * MS_PER_DAY + firstPeakStart * MS_PER_MINUTE;
    }
  }

  const nextSwitchAt = wallToEpoch(nextWall, timeZone);
  return {
    tier,
    basis,
    timeZone,
    nextSwitchAt,
    msToSwitch: Math.max(0, nextSwitchAt - epoch),
    // 高峰只可能切到低谷，低谷只可能切到高峰（周末那个高峰就是下个工作日的高峰起点）
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
