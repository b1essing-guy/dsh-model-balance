/**
 * 启动竞态重试策略的测试。
 *
 * 这组用例钉住的是**一条真实故障的修复**：插件激活早于账号服务就绪时，
 * 立刻那次查询会失败；若不快速重试，用户要看着「缺少凭证」等满 refreshSec（默认 600 秒）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOT_READY_REASONS,
  RETRY_SCHEDULE_MS,
  isNotReadyFailure,
  nextRetryDelayMs,
} from '../src/host/retry-policy.js';

test('只有「未就绪类」失败才快速重试', () => {
  assert.equal(isNotReadyFailure({ ok: false, reason: 'credential-missing' }), true);
  assert.equal(isNotReadyFailure({ ok: false, reason: 'unsupported' }), false, '服务商没登记接口，重试无意义');
  assert.equal(isNotReadyFailure({ ok: false, reason: 'fetch-error' }), false, '网络失败交给常规周期');
  assert.equal(isNotReadyFailure({ ok: true, data: {} }), false);
  assert.equal(isNotReadyFailure(null), false);
  assert.equal(isNotReadyFailure(undefined), false);
  assert.equal(isNotReadyFailure('credential-missing'), false, '字符串不算结果对象');
  assert.deepEqual(NOT_READY_REASONS, ['credential-missing']);
});

test('退避序列：3s → 10s → 30s → 60s，用尽后落回常规周期', () => {
  assert.equal(nextRetryDelayMs(0), 3000);
  assert.equal(nextRetryDelayMs(1), 10000);
  assert.equal(nextRetryDelayMs(2), 30000);
  assert.equal(nextRetryDelayMs(3), 60000);
  assert.equal(nextRetryDelayMs(4), null, '用尽后不再额外重试');
  assert.equal(nextRetryDelayMs(99), null);
});

test('额外重试有界：总量 < 2 分钟，避免对真正未登录的用户长期制造噪声', () => {
  const total = RETRY_SCHEDULE_MS.reduce((sum, ms) => sum + ms, 0);
  assert.equal(total, 103_000);
  assert.ok(total < 120_000);
});

test('非法 attempt 退化为第一次而不是抛错（防御式）', () => {
  assert.equal(nextRetryDelayMs(-1), 3000);
  assert.equal(nextRetryDelayMs(1.5), 3000);
  assert.equal(nextRetryDelayMs(Number.NaN), 3000);
  assert.equal(nextRetryDelayMs(undefined), 3000);
});

test('启动竞态的时间账：启动后 ~103 秒内会把早失败纠正过来（远小于默认 600s 周期）', () => {
  const cumulative = RETRY_SCHEDULE_MS.reduce(
    (acc, ms) => {
      const at = acc.last + ms;
      return { list: [...acc.list, at], last: at };
    },
    { list: [], last: 0 },
  );
  assert.deepEqual(cumulative.list, [3000, 13000, 43000, 103000]);
  assert.ok(cumulative.last < 600_000, '必须在默认刷新周期之前就把竞态纠正掉');
});
