/**
 * 峰谷判定与倒计时的边界测试（对应验收 AC3 / AC4）。
 *
 * 关键点：本模块是**纯函数**，now 可注入，时区口径固定 `Asia/Shanghai`。
 * 所以下面每个用例都用「北京时间钟表时间」构造瞬时，再用 UTC 字符串回验——
 * 无论跑测试的机器在哪个时区，结果都必须一致（AC4 由 TZ 多时区复跑证明）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEEPSEEK_PEAK_WINDOWS,
  DEEPSEEK_TIME_ZONE,
  currencySymbol,
  formatClock,
  formatDuration,
  formatMoney,
  peakValleyAt,
} from '../src/shared/pricing.js';

/** 北京时间钟表时间 → 瞬时（北京时间 = UTC+8，无夏令时） */
function beijing(year, month, day, hour, minute) {
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

/** 该瞬时在北京时间下的 'YYYY-MM-DD HH:MM'（用于把断言写成可读的钟表时间） */
function beijingClock(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEEPSEEK_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

test('前提：2026-10-09 是周五，2026-10-12 是周一（后面用例的星期假设都建立在这上面）', () => {
  assert.equal(beijing(2026, 10, 9, 12, 0).getUTCDay(), 5, '2026-10-09 应为周五');
  assert.equal(beijing(2026, 10, 10, 12, 0).getUTCDay(), 6, '2026-10-10 应为周六');
  assert.equal(beijing(2026, 10, 11, 12, 0).getUTCDay(), 0, '2026-10-11 应为周日');
  assert.equal(beijing(2026, 10, 12, 12, 0).getUTCDay(), 1, '2026-10-12 应为周一');
});

/** AC3：工作日峰谷边界逐点判定 */
const boundaryCases = [
  // [北京时间, 期望档位, 期望依据, 期望下次切换的北京时间, 期望下一档位]
  ['2026-10-09 08:59', 'idle', 'off-window', '2026-10-09 09:00', 'peak'],
  ['2026-10-09 09:00', 'peak', 'peak-window', '2026-10-09 12:00', 'idle'],
  ['2026-10-09 11:59', 'peak', 'peak-window', '2026-10-09 12:00', 'idle'],
  ['2026-10-09 12:00', 'idle', 'off-window', '2026-10-09 14:00', 'peak'],
  ['2026-10-09 13:59', 'idle', 'off-window', '2026-10-09 14:00', 'peak'],
  ['2026-10-09 14:00', 'peak', 'peak-window', '2026-10-09 18:00', 'idle'],
  ['2026-10-09 17:59', 'peak', 'peak-window', '2026-10-09 18:00', 'idle'],
  // 周五 18:00 之后是低谷，且周末全天低谷 —— 下次切换必须跳到**周一 09:00**
  ['2026-10-09 18:00', 'idle', 'off-window', '2026-10-12 09:00', 'peak'],
  ['2026-10-09 23:59', 'idle', 'off-window', '2026-10-12 09:00', 'peak'],
  // 周末全天低谷（含周六日的高峰钟点）
  ['2026-10-10 10:00', 'idle', 'weekend', '2026-10-12 09:00', 'peak'],
  ['2026-10-10 15:00', 'idle', 'weekend', '2026-10-12 09:00', 'peak'],
  ['2026-10-11 09:00', 'idle', 'weekend', '2026-10-12 09:00', 'peak'],
  // 周一恢复峰谷
  ['2026-10-12 00:00', 'idle', 'off-window', '2026-10-12 09:00', 'peak'],
  ['2026-10-12 09:00', 'peak', 'peak-window', '2026-10-12 12:00', 'idle'],
];

for (const [clock, tier, basis, nextClock, nextTier] of boundaryCases) {
  test(`AC3 边界：北京时间 ${clock} → ${tier}（${basis}）`, () => {
    const [datePart, timePart] = clock.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    const now = beijing(year, month, day, hour, minute);

    const result = peakValleyAt(now);
    assert.equal(result.tier, tier, '档位');
    assert.equal(result.basis, basis, '判定依据');
    assert.equal(result.nextTier, nextTier, '下一档位');
    assert.equal(beijingClock(new Date(result.nextSwitchAt)), nextClock, '下次切换时刻');
    assert.ok(result.msToSwitch >= 0, '倒计时不为负');
    assert.equal(result.timeZone, DEEPSEEK_TIME_ZONE);
  });
}

test('AC3：倒计时与「下次切换」严格自洽（差值等于两个钟点之差）', () => {
  const now = beijing(2026, 10, 9, 8, 59);
  const result = peakValleyAt(now);
  // 08:59 → 09:00 恰好 1 分钟
  assert.equal(result.msToSwitch, 60_000);
  assert.equal(formatDuration(result.msToSwitch), '1m');
});

test('AC3：恰好落在切换点时立刻采用新档位（不出现 1 秒的旧档位残留）', () => {
  assert.equal(peakValleyAt(beijing(2026, 10, 9, 12, 0)).tier, 'idle');
  assert.equal(peakValleyAt(beijing(2026, 10, 9, 14, 0)).tier, 'peak');
  assert.equal(peakValleyAt(beijing(2026, 10, 12, 9, 0)).tier, 'peak');
});

test('AC4：判定只看 Asia/Shanghai 钟表时间，与运行环境时区无关', () => {
  const instant = beijing(2026, 10, 9, 9, 30);
  // 同一瞬时在不同机器时区下都是同一个 epoch ms，判定必须相同
  const result = peakValleyAt(instant);
  assert.equal(result.tier, 'peak');
  // 并且这个 epoch 在 UTC 下确实是 01:30（说明 09:30 是北京时间而不是本地时间）
  assert.equal(new Date(instant.getTime()).toISOString(), '2026-10-09T01:30:00.000Z');
});

test('规则可由 host 覆盖：窗口 / 周末口径变了不需要改展示层', () => {
  const friday = beijing(2026, 10, 9, 10, 0);
  // 默认规则：周五 10:00 是高峰
  assert.equal(peakValleyAt(friday).tier, 'peak');
  // 把窗口挪到 22:00–23:00 后，10:00 就不是高峰
  const shifted = peakValleyAt(friday, { windows: [{ start: '22:00', end: '23:00' }] });
  assert.equal(shifted.tier, 'idle');
  assert.equal(beijingClock(new Date(shifted.nextSwitchAt)), '2026-10-09 22:00');
  // 也可以定义「周末不特殊」的规则
  const saturday = beijing(2026, 10, 10, 10, 0);
  assert.equal(peakValleyAt(saturday).tier, 'idle');
  assert.equal(peakValleyAt(saturday, { weekendAllIdle: false }).tier, 'peak');
});

test('法定节假日：命中该日则全天空闲，且下次切换顺延到节假日之后的工作日', () => {
  // 2026-10-12 是周一（工作日），把它标成法定节假日
  const monday = beijing(2026, 10, 12, 10, 0);
  // 默认规则（holidays 为空）：周一 10:00 是高峰
  assert.equal(peakValleyAt(monday).tier, 'peak');
  // 标为节假日后：全天空闲
  const holiday = peakValleyAt(monday, { holidays: ['2026-10-12'] });
  assert.equal(holiday.tier, 'idle');
  assert.equal(holiday.basis, 'holiday');
  assert.equal(holiday.holiday, true);
  assert.equal(beijingClock(new Date(holiday.nextSwitchAt)), '2026-10-13 09:00');
});

test('法定节假日：与周末叠加时仍全天空闲，且不会把节假日当成切换日', () => {
  // 周六本就空闲；再把下周一也标成节假日，下次切换应落到周二
  const saturday = beijing(2026, 10, 10, 10, 0);
  const result = peakValleyAt(saturday, { holidays: ['2026-10-12'] });
  assert.equal(result.tier, 'idle');
  assert.equal(result.basis, 'weekend', '周末优先归类为 weekend（用于区分文案）');
  assert.equal(beijingClock(new Date(result.nextSwitchAt)), '2026-10-13 09:00');
});

test('节假日为空数组时行为与不传完全一致（默认不把任何日期当节假日）', () => {
  const monday = beijing(2026, 10, 12, 10, 0);
  const withEmpty = peakValleyAt(monday, { holidays: [] });
  const withoutKey = peakValleyAt(monday);
  assert.equal(withEmpty.tier, withoutKey.tier);
  assert.equal(withEmpty.basis, withoutKey.basis);
  assert.equal(withEmpty.nextSwitchAt, withoutKey.nextSwitchAt);
});

test('默认规则与 DEEPSEEK_PEAK_WINDOWS 常量一致（防止两处口径漂移）', () => {
  assert.deepEqual(DEEPSEEK_PEAK_WINDOWS, [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ]);
});

test('formatDuration：天/时/分三档，且不显示秒', () => {
  assert.equal(formatDuration(0), '不足1m');
  assert.equal(formatDuration(59_999), '不足1m');
  assert.equal(formatDuration(60_000), '1m');
  assert.equal(formatDuration(45 * 60_000), '45m');
  assert.equal(formatDuration(3_600_000), '1h0m');
  assert.equal(formatDuration(73 * 60_000), '1h13m');
  assert.equal(formatDuration(2 * 86_400_000 + 3 * 3_600_000), '2d3h');
  assert.equal(formatDuration(-5000), '不足1m');
});

test('formatMoney：币种符号 + 高精度兜底；空值显示占位而不是 0', () => {
  assert.equal(formatMoney('12.34', 'CNY'), '¥12.34');
  assert.equal(formatMoney('12.34', 'USD'), '$12.34');
  assert.equal(formatMoney('12.34', 'HKD'), 'HKD 12.34');
  assert.equal(formatMoney('9.9902690000000000', 'CNY'), '¥9.99');
  assert.equal(formatMoney('', 'CNY'), '—');
  assert.equal(formatMoney(undefined, 'CNY'), '—');
  assert.equal(currencySymbol('cny'), '¥');
});

test('formatClock：按 Asia/Shanghai 输出钟点（不随本机时区漂移）', () => {
  // 2026-10-09T04:00Z = 北京时间 12:00
  assert.equal(formatClock(Date.UTC(2026, 9, 9, 4, 0)), '12:00');
  // 2026-10-12T01:00Z = 北京时间 09:00
  assert.equal(formatClock(Date.UTC(2026, 9, 12, 1, 0)), '09:00');
});
