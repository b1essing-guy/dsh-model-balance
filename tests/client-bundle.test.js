/**
 * 对**构建产物** lib/client.js 的验证（不是对源码）。
 *
 * 为什么必须测产物：client 半边是单文件脚本，共享计价内核是被构建**内联**进去的。
 * 只测源码的话，「内联漏了 / 内联顺序错了 / 产物带了相对 import」这类问题会一路漏到线上。
 * 这个测试把产物丢进一个最小 sandbox 跑起来，然后直接验证它的展示逻辑与降级文案。
 *
 * 注意：产物在 vm sandbox 里执行，返回对象属于**另一个 realm**，
 * `assert.deepEqual`（严格原型比较）会失败——所以断言前统一做 JSON 往返归一化。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const BUNDLE_URL = new URL('../lib/client.js', import.meta.url);
const source = readFileSync(BUNDLE_URL, 'utf8');

/** 最小 sandbox：只提供产物真的会碰到的宿主全局 */
function loadBundle() {
  const loads = [];
  const sandbox = {
    window: { __ModuleLoader__: { load: (info) => loads.push(info) } },
    document: {
      querySelector: () => null,
      createElement: () => ({ setAttribute() {}, style: {}, textContent: '' }),
      head: { appendChild() {} },
    },
    console: { info() {}, warn() {}, error() {} },
    fetch: () => Promise.reject(new Error('测试环境不联网')),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    AbortController,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'lib/client.js' });
  assert.equal(loads.length, 1, '产物必须恰好向平台注册一次');
  return loads[0];
}

const loaded = loadBundle();

/** 用最小 react 桩执行 factory，拿到 module.exports */
function loadModule() {
  const reactStub = { useState: (initial) => [initial, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) };
  const jsxStub = (type, props) => ({ type, props });
  return loaded.factory((name) => {
    if (name === 'react') return reactStub;
    if (name === 'react/jsx-runtime') return { jsx: jsxStub };
    throw new Error('产物不该 require：' + name);
  });
}

const module = loadModule();
const T = module.__test__;
const normalise = (value) => JSON.parse(JSON.stringify(value));

/** 北京时间 → 瞬时（UTC+8） */
const beijing = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 8, mi);

const RULES = {
  timeZone: 'Asia/Shanghai',
  windows: [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  weekendAllIdle: true,
  holidays: [],
  // 单价**按模型 id**索引（与 host 的 DEEPSEEK_PRICE_TABLES 同形）。数值取自官方定价页。
  priceTables: {
    'deepseek-flash': {
      label: 'DeepSeek-V4.1-Flash',
      peak: { inputCacheMiss: 2, output: 8, inputCacheHit: 0.04 },
      idle: { inputCacheMiss: 1, output: 4, inputCacheHit: 0.02 },
    },
    'deepseek-v4-pro': {
      label: 'DeepSeek-V4-Pro-0813',
      peak: { inputCacheMiss: 9, output: 27, inputCacheHit: 0.3 },
      idle: { inputCacheMiss: 4.5, output: 13.5, inputCacheHit: 0.15 },
    },
  },
  priceSource: { checkedAt: '2026-10-10' },
};

function officialState(overrides = {}) {
  return {
    rev: 1,
    selectedProvider: 'deepseek-account',
    selectedModel: 'deepseek-v4-pro',
    balance: {
      ok: true,
      provider: 'deepseek-account',
      shape: 'money',
      data: { currency: 'CNY', total: '12.34', granted: '2.34', toppedUp: '10.00', fullBalance: '20' },
      fetchedAt: beijing(2026, 10, 9, 8, 30),
      manual: false,
    },
    pricing: RULES,
    ...overrides,
  };
}

const zh = (key) => T.dict.zh[key] ?? key;
const en = (key) => T.dict.en[key] ?? key;

test('产物契约：注册 id / 三件套 / 无相对 import', () => {
  assert.equal(loaded.id, 'dsh-model-balance');
  assert.equal(module.name, 'dsh-model-balance');
  assert.deepEqual(normalise(module.inject), ['slots', 'locale']);
  assert.equal(typeof module.apply, 'function');
  // 单文件约束：产物里不得出现 ESM 语法（否则浏览器加载器解析不了）
  assert.equal(/^(export|import)\b/m.test(source), false, '产物不得残留 ESM 语法');
});

test('产物内联了计价内核（周五 08:59 → 距高峰 1m）', () => {
  const view = normalise(
    T.buildViewModel({
      state: officialState(),
      error: null,
      nowMs: beijing(2026, 10, 9, 8, 59),
      config: { hoverPrices: true },
      t: zh,
      locale: 'zh',
    }),
  );
  assert.equal(view.moneyText, '¥12.34');
  assert.equal(view.tier, 'idle');
  assert.equal(view.tierLabel, '低谷');
  assert.equal(view.basis, 'off-window');
  assert.equal(view.countdownText, '距高峰 1m');
});

test('产物：工作日高峰档位与倒计时正确', () => {
  const view = normalise(
    T.buildViewModel({
      state: officialState(),
      error: null,
      nowMs: beijing(2026, 10, 9, 14, 0),
      config: { hoverPrices: true },
      t: zh,
      locale: 'zh',
    }),
  );
  assert.equal(view.tier, 'peak');
  assert.equal(view.tierLabel, '高峰');
  assert.equal(view.countdownText, '距低谷 4h0m');
});

test('产物：周末全天低谷 → 不显示无意义的 40 小时倒计时', () => {
  const view = normalise(
    T.buildViewModel({
      state: officialState(),
      error: null,
      nowMs: beijing(2026, 10, 10, 10, 0),
      config: { hoverPrices: true },
      t: zh,
      locale: 'zh',
    }),
  );
  assert.equal(view.tier, 'idle');
  assert.equal(view.basis, 'weekend');
  assert.equal(view.countdownText, null);
  const next = view.details.find((pair) => pair[0] === zh('panel.next'));
  assert.ok(next, '详情里应有下次切换');
  assert.match(next[1], /周一 09:00 进入高峰/);
});

test('产物：失败降级文案覆盖三种 reason（且绝不显示金额）', () => {
  const cases = [
    ['unsupported', null, '当前服务未登记余额接口'],
    ['credential-missing', '缺少凭证 DEEPSEEK_API_KEY', '缺少凭证：缺少凭证 DEEPSEEK_API_KEY'],
    ['fetch-error', 'HTTP 500', '余额查询失败：HTTP 500'],
  ];
  for (const [reason, message, expected] of cases) {
    const state = officialState({
      balance: { ok: false, provider: 'p', reason, message, fetchedAt: Date.now() },
    });
    const view = normalise(
      T.buildViewModel({ state, error: null, nowMs: beijing(2026, 10, 9, 10, 0), config: { hoverPrices: true }, t: zh, locale: 'zh' }),
    );
    assert.equal(view.moneyText, null, reason + ' 时不得显示金额');
    assert.equal(view.badgeText, expected, reason + ' 的文案');
    assert.equal(view.tone, 'error');
  }
});

test('产物：本地服务不可达 → 可读降级，且保留上一次数据（标注离线）', () => {
  const view = normalise(
    T.buildViewModel({
      state: officialState(),
      error: 'Failed to fetch',
      nowMs: beijing(2026, 10, 9, 10, 0),
      config: { hoverPrices: true },
      t: zh,
      locale: 'zh',
    }),
  );
  assert.equal(view.tone, 'error');
  assert.equal(view.moneyText, null);
  assert.equal(view.badgeText, '本地服务未就绪');
  assert.equal(view.stale, true);
});

test('产物：还没拿到状态时不显示金额也不报错', () => {
  const view = normalise(
    T.buildViewModel({ state: null, error: null, nowMs: Date.now(), config: {}, t: zh, locale: 'zh' }),
  );
  assert.equal(view.moneyText, null);
  assert.equal(view.badgeText, '查询中…');
  assert.equal(view.tone, 'ok');
  assert.equal(view.updatedText, '尚未取到数据');
});

test('产物：悬停详情含数据源/总可用/赠金/充值/时段/下次切换/单价', () => {
  const view = normalise(
    T.buildViewModel({
      state: officialState(),
      error: null,
      nowMs: beijing(2026, 10, 9, 8, 30),
      config: { hoverPrices: true },
      t: zh,
      locale: 'zh',
    }),
  );
  const labels = view.details.map((pair) => pair[0]);
  assert.ok(labels.includes(zh('panel.source')));
  assert.ok(labels.includes(zh('panel.total')));
  assert.ok(labels.includes(zh('panel.granted')));
  assert.ok(labels.includes(zh('panel.toppedUp')));
  assert.ok(labels.includes(zh('panel.window')));
  assert.ok(labels.includes(zh('panel.next')));
  // 详情里必须明示当前模型（否则用户无从判断单价是不是自己那一档）
  const modelRow = view.details.find((pair) => pair[0] === zh('panel.model'));
  assert.equal(modelRow[1], 'deepseek-v4-pro');
  assert.equal(view.prices.peak, '高峰：输入 9 / 输出 27 / 缓存命中 0.3');
  assert.equal(view.prices.idle, '低谷：输入 4.5 / 输出 13.5 / 缓存命中 0.15');
  assert.match(view.prices.title, /DeepSeek-V4-Pro-0813/);
  assert.match(view.prices.title, /2026-10-10/);
  assert.equal(view.updatedText, '08:30');
});

test('产物：hoverPrices=false 时不带单价段', () => {
  const view = normalise(
    T.buildViewModel({
      state: officialState(),
      error: null,
      nowMs: beijing(2026, 10, 9, 10, 0),
      config: { hoverPrices: false },
      t: zh,
      locale: 'zh',
    }),
  );
  assert.equal(view.prices, null);
  assert.equal(view.pricesNote, null, '关掉单价展示时连说明也不该出现');
});

test('产物：单价按当前模型取 —— deepseek-flash 必须显示 Flash 的价（本次修复的核心回归）', () => {
  const view = normalise(
    T.buildViewModel({
      state: officialState({ selectedModel: 'deepseek-flash' }),
      error: null,
      nowMs: beijing(2026, 10, 9, 10, 0),
      config: { hoverPrices: true },
      t: zh,
      locale: 'zh',
    }),
  );
  // 修复前这里显示的是 V4-Pro 的 9 / 27 / 0.3 —— 拿别的模型的价挂在自己名下
  assert.equal(view.prices.peak, '高峰：输入 2 / 输出 8 / 缓存命中 0.04');
  assert.equal(view.prices.idle, '低谷：输入 1 / 输出 4 / 缓存命中 0.02');
  assert.match(view.prices.title, /DeepSeek-V4.1-Flash/);
});

test('产物：模型未登记单价 → 只给说明，绝不套用其他模型的价', () => {
  const view = normalise(
    T.buildViewModel({
      state: officialState({ selectedModel: 'some-unregistered-model' }),
      error: null,
      nowMs: beijing(2026, 10, 9, 10, 0),
      config: { hoverPrices: true },
      t: zh,
      locale: 'zh',
    }),
  );
  assert.equal(view.prices, null, '未登记时不得显示任何单价数字');
  assert.equal(view.pricesNote, '当前模型未登记单价（不套用其他模型）');
});

test('产物：法定节假日全天空闲（官方口径，早期媒体版漏了这条）', () => {
  const state = officialState({
    selectedModel: 'deepseek-flash',
    pricing: { ...RULES, holidays: ['2026-10-12'] }, // 该日其实是周一，本应高峰
  });
  const view = normalise(
    T.buildViewModel({
      state,
      error: null,
      nowMs: beijing(2026, 10, 12, 10, 0),
      config: { hoverPrices: true },
      t: zh,
      locale: 'zh',
    }),
  );
  assert.equal(view.tier, 'idle');
  assert.equal(view.basis, 'holiday');
  assert.equal(view.countdownText, null);
  assert.equal(view.restLabel, '法定节假日低谷');
  const next = view.details.find((pair) => pair[0] === zh('panel.next'));
  assert.match(next[1], /周二 09:00 进入高峰/);
});

test('产物：英文字典可用（AC8 的文案侧证据）', () => {
  const view = normalise(
    T.buildViewModel({
      state: officialState(),
      error: null,
      nowMs: beijing(2026, 10, 9, 14, 0),
      config: { hoverPrices: true },
      t: en,
      locale: 'en',
    }),
  );
  assert.equal(view.tierLabel, 'Peak');
  assert.equal(view.countdownText, '4h0m to Off-peak');
  const next = view.details.find((pair) => pair[0] === 'Next switch');
  assert.ok(next[1].includes('Off-peak'));
});

test('产物：中英字典键集合一致（防止漏译）', () => {
  const zhKeys = Object.keys(T.dict.zh).sort();
  const enKeys = Object.keys(T.dict.en).sort();
  assert.deepEqual(enKeys, zhKeys);
});
