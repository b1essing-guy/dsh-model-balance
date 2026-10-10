/**
 * 扩展点与失败口径测试（对应验收 AC5 / AC6）。
 *
 * 两条硬红线：
 * 1. **失败绝不伪造数字** —— 任何失败结果里都不能出现 data（尤其不能出现 0 余额）；
 * 2. **扩展点必须真的能用** —— 第三方 provider 注册进来能被查到，注销后立刻失效。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRegistry } from '../src/host/registry.js';

/** 一个合法的 stub provider */
function stubProvider(overrides = {}) {
  return {
    ids: ['stub-provider'],
    credential: { mode: 'ref', ref: 'STUB_API_KEY' },
    async fetch({ provider }) {
      return {
        ok: true,
        provider,
        shape: 'money',
        data: { currency: 'USD', total: '12.34', granted: '2.34', toppedUp: '10.00' },
      };
    },
    ...overrides,
  };
}

const keyPresent = async () => 'secret-key';

test('AC6：注册一个第三方 provider → 可查到；注销 → 立刻失效', async () => {
  const registry = createRegistry();
  assert.deepEqual(registry.providers(), [], '初始为空');

  const dispose = registry.registerProvider(stubProvider(), 'test-suite');
  assert.deepEqual(registry.providers(), ['stub-provider']);
  assert.equal(registry.ownerOf('stub-provider'), 'test-suite');

  const result = await registry.query('stub-provider', keyPresent);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { currency: 'USD', total: '12.34', granted: '2.34', toppedUp: '10.00' });

  dispose();
  assert.deepEqual(registry.providers(), [], '注销后注册表为空');
  const after = await registry.query('stub-provider', keyPresent);
  assert.equal(after.ok, false);
  assert.equal(after.reason, 'unsupported');
});

test('AC6：注销是幂等的（重复调用不炸、也不影响别人）', async () => {
  const registry = createRegistry();
  const disposeA = registry.registerProvider(stubProvider(), 'a');
  const disposeB = registry.registerProvider(stubProvider({ ids: ['other-provider'] }), 'b');
  disposeA();
  disposeA();
  assert.deepEqual(registry.providers(), ['other-provider']);
  disposeB();
  assert.deepEqual(registry.providers(), []);
});

test('AC6：同一个 id 被不同注册方占用 → 直接抛错（不做静默覆盖）', () => {
  const registry = createRegistry();
  registry.registerProvider(stubProvider(), 'first');
  assert.throws(
    () => registry.registerProvider(stubProvider(), 'second'),
    /provider id 已被占用/,
    '冲突必须显式报错',
  );
  // 同一注册方重复注册同一个 id 是允许的（热重载场景会走到）
  assert.doesNotThrow(() => registry.registerProvider(stubProvider(), 'first'));
});

test('AC6：非法 provider 定义在注册时就被拒绝（坏定义不进注册表）', () => {
  const registry = createRegistry();
  const bad = [
    { name: 'ids 为空', def: stubProvider({ ids: [] }) },
    { name: 'ids 非字符串数组', def: stubProvider({ ids: [1] }) },
    { name: 'credential 缺失', def: stubProvider({ credential: undefined }) },
    { name: 'credential.mode 非法', def: stubProvider({ credential: { mode: 'whatever' } }) },
    { name: 'credential.mode=ref 但 ref 为空', def: stubProvider({ credential: { mode: 'ref', ref: '' } }) },
    { name: 'fetch 不是函数', def: stubProvider({ fetch: 42 }) },
    { name: '不是对象', def: null },
  ];
  for (const { name, def } of bad) {
    assert.throws(() => registry.registerProvider(def, 'test-suite'), Error, name + ' 应被拒绝');
  }
  assert.deepEqual(registry.providers(), [], '拒绝之后注册表仍是空的');
});

test('AC5：未登记的 provider → unsupported，且结果里没有 data（不伪造 0）', async () => {
  const registry = createRegistry();
  const result = await registry.query('never-registered', keyPresent);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported');
  assert.equal('data' in result, false, '失败结果绝不能带 data');
});

test('AC5：缺凭证 → credential-missing，不发任何请求', async () => {
  const registry = createRegistry();
  let called = 0;
  registry.registerProvider(
    stubProvider({
      async fetch() {
        called += 1;
        throw new Error('不应该被调用');
      },
    }),
    'test-suite',
  );
  const result = await registry.query('stub-provider', async () => undefined);
  assert.equal(result.reason, 'credential-missing');
  assert.match(result.message, /STUB_API_KEY/);
  assert.equal(called, 0, '缺凭证时不得发起请求');
  assert.equal('data' in result, false);
});

test('AC5：provider 抛错 → fetch-error（带原始消息），且没有 data', async () => {
  const registry = createRegistry();
  registry.registerProvider(
    stubProvider({
      async fetch() {
        throw new Error('HTTP 500');
      },
    }),
    'test-suite',
  );
  const result = await registry.query('stub-provider', keyPresent);
  assert.equal(result.reason, 'fetch-error');
  assert.equal(result.message, 'HTTP 500');
  assert.equal('data' in result, false);
});

test('AC5：provider 返回垃圾 → 被拦成 fetch-error（第三方代码不可信）', async () => {
  const registry = createRegistry();
  const shape = [
    null,
    {},
    { ok: false },
    { ok: true, shape: 'windows', data: {} },
    { ok: true, shape: 'money' },
    { ok: true, shape: 'money', data: { total: 12.34 } },
  ];
  for (const [index, value] of shape.entries()) {
    const registryLocal = createRegistry();
    registryLocal.registerProvider(
      stubProvider({
        async fetch() {
          return value;
        },
      }),
      'test-suite',
    );
    const result = await registryLocal.query('stub-provider', keyPresent);
    assert.equal(result.ok, false, '第 ' + index + ' 种坏返回值应被判失败');
    assert.equal(result.reason, 'fetch-error');
    assert.equal('data' in result, false, '第 ' + index + ' 种坏返回值不得带 data');
  }
  assert.ok(registry.providers().length >= 0);
});

test('账号路由（mode=none）：账号服务不在场 → credential-missing（不是 fetch-error）', async () => {
  const registry = createRegistry();
  registry.registerProvider(
    stubProvider({ credential: { mode: 'none' }, ids: ['deepseek-account'] }),
    'test-suite',
  );
  const absent = await registry.query('deepseek-account', keyPresent, async () => undefined);
  assert.equal(absent.reason, 'credential-missing');
  assert.match(absent.message, /账号服务不在场/);

  const noResolver = await registry.query('deepseek-account', keyPresent, undefined);
  assert.equal(noResolver.reason, 'credential-missing');
});

test('账号路由：快照只探一次（记忆化），provider 拿到的就是那份快照', async () => {
  const registry = createRegistry();
  let probes = 0;
  let seen;
  registry.registerProvider(
    {
      ids: ['deepseek-account'],
      credential: { mode: 'none' },
      async fetch({ resolveAccount }) {
        seen = await resolveAccount();
        return { ok: true, provider: 'deepseek-account', shape: 'money', data: { currency: 'CNY', total: '1.00', granted: '0.00', toppedUp: '1.00' } };
      },
    },
    'test-suite',
  );
  const result = await registry.query('deepseek-account', keyPresent, async () => {
    probes += 1;
    return { status: 'ready', value: [{ currency: 'CNY', balance: '1.00' }] };
  });
  assert.equal(result.ok, true);
  assert.equal(probes, 1, '账号服务只应被探一次');
  assert.deepEqual(seen, { status: 'ready', value: [{ currency: 'CNY', balance: '1.00' }] });
});

test('结果里的 provider 一律以命中的 id 为准（provider 不能自己改身份）', async () => {
  const registry = createRegistry();
  registry.registerProvider(
    stubProvider({
      async fetch() {
        return { ok: true, provider: '别人', shape: 'money', data: { currency: 'CNY', total: '1.00', granted: '0', toppedUp: '1' } };
      },
    }),
    'test-suite',
  );
  const result = await registry.query('stub-provider', keyPresent);
  assert.equal(result.provider, 'stub-provider');
});
