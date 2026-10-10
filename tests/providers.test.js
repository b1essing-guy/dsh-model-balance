/**
 * 内置两条 deepseek 路由的响应解析测试。
 *
 * 用**真实报文结构**喂测（官方接口文档 + 账号服务 AccountDetails['balance'] 形状），
 * 因为这里最容易出的错是「字段名写错却静默算成 0」——必须让它在测试里就炸。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAccountBalance } from '../src/host/providers/deepseek-account.js';
import {
  DEEPSEEK_OFFICIAL_BALANCE_URL,
  deepseekOfficialProvider,
  parseOfficialBalance,
} from '../src/host/providers/deepseek-official.js';
import { deepseekAccountProvider } from '../src/host/providers/deepseek-account.js';
import { messageOf, money, sumMoney } from '../src/host/internal.js';

/** 官方 /user/balance 的真实形状 */
function officialBody(overrides = {}) {
  return {
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '8.79', granted_balance: '0.00', topped_up_balance: '8.79' },
    ],
    ...overrides,
  };
}

test('官方路由：三个金额原样透传（不自己重算 total）', () => {
  const result = parseOfficialBalance(officialBody(), 'deepseek-official');
  assert.equal(result.ok, true);
  assert.equal(result.shape, 'money');
  assert.deepEqual(result.data, {
    currency: 'CNY',
    total: '8.79',
    granted: '0.00',
    toppedUp: '8.79',
    fullBalance: '20',
  });
});

test('官方路由：缺 balance_infos / 空数组 → 抛错（绝不当 0）', () => {
  assert.throws(() => parseOfficialBalance({}, 'deepseek-official'), /balance_infos/);
  assert.throws(() => parseOfficialBalance({ balance_infos: [] }, 'deepseek-official'), /balance_infos/);
  assert.throws(() => parseOfficialBalance(undefined, 'deepseek-official'), /balance_infos/);
});

test('官方路由：字段缺失/非法 → 抛错并点名字段', () => {
  const cases = [
    ['currency', { currency: undefined }],
    ['total_balance', { total_balance: '' }],
    ['granted_balance', { granted_balance: 3 }],
    ['topped_up_balance', { topped_up_balance: null }],
  ];
  for (const [field, patch] of cases) {
    const body = officialBody();
    body.balance_infos[0] = { ...body.balance_infos[0], ...patch };
    assert.throws(() => parseOfficialBalance(body, 'deepseek-official'), new RegExp(field, 'i'), field + ' 非法应抛错');
  }
});

test('官方路由定义：id / 凭证 / 端点都对', () => {
  assert.deepEqual(deepseekOfficialProvider.ids, ['deepseek-official']);
  assert.deepEqual(deepseekOfficialProvider.credential, { mode: 'ref', ref: 'DEEPSEEK_API_KEY' });
  assert.equal(DEEPSEEK_OFFICIAL_BALANCE_URL, 'https://api.deepseek.com/user/balance');
});

test('账号路由：total = 赠金 + 充值（顺序无关，走整数分相加）', () => {
  const result = parseAccountBalance(
    {
      status: 'ready',
      value: [{ currency: 'CNY', balance: '8.79' }],
      bonusWallets: [{ currency: 'CNY', balance: '1.21' }],
    },
    'deepseek-account',
  );
  assert.equal(result.data.currency, 'CNY');
  assert.equal(result.data.toppedUp, '8.79');
  assert.equal(result.data.granted, '1.21');
  assert.equal(result.data.total, '10.00');
  assert.equal(result.data.fullBalance, '20');
});

test('账号路由：高精度原串收敛成两位（界面不该出现 9.9902690000000000）', () => {
  const result = parseAccountBalance(
    { status: 'ready', value: [{ currency: 'CNY', balance: '9.9902690000000000' }] },
    'deepseek-account',
  );
  assert.equal(result.data.toppedUp, '9.99');
});

test('账号路由：没有赠金钱包 → granted 记 0.00，但 total 仍以充值钱包为准', () => {
  const result = parseAccountBalance(
    { status: 'ready', value: [{ currency: 'CNY', balance: '5.00' }] },
    'deepseek-account',
  );
  assert.equal(result.data.granted, '0.00');
  assert.equal(result.data.total, '5.00');
});

test('账号路由：赠金钱包币种不同 → 不硬配（宁可少算也不错算）', () => {
  const result = parseAccountBalance(
    {
      status: 'ready',
      value: [{ currency: 'CNY', balance: '5.00' }],
      bonusWallets: [{ currency: 'USD', balance: '3.00' }],
    },
    'deepseek-account',
  );
  assert.equal(result.data.granted, '0.00');
  assert.equal(result.data.total, '5.00');
});

test('账号路由：未登录 / 查询失败 / 没有钱包 → 一律抛错（绝不显示 ¥0.00）', () => {
  assert.throws(() => parseAccountBalance(null, 'deepseek-account'), /未登录/);
  assert.throws(() => parseAccountBalance(undefined, 'deepseek-account'), /未登录/);
  assert.throws(() => parseAccountBalance({ status: 'failed' }, 'deepseek-account'), /查询失败/);
  assert.throws(() => parseAccountBalance({ status: 'ready', value: [] }, 'deepseek-account'), /没有充值钱包/);
  assert.throws(() => parseAccountBalance({ status: 'ready', value: ['nope'] }, 'deepseek-account'), /结构非法/);
});

test('账号路由定义：无 API Key（credential.mode=none），且 fetch 缺账号查询时明确报错', async () => {
  assert.deepEqual(deepseekAccountProvider.ids, ['deepseek-account']);
  assert.deepEqual(deepseekAccountProvider.credential, { mode: 'none' });
  await assert.rejects(
    () => deepseekAccountProvider.fetch({ provider: 'deepseek-account', key: '' }),
    /缺少账号服务/,
  );
});

test('金额工具：非法值抛错、整数分相加不产生浮点误差', () => {
  assert.equal(sumMoney('0.1', '0.2'), '0.30');
  assert.equal(sumMoney('8.79', '1.21'), '10.00');
  assert.equal(money('5', 'balance'), '5.00');
  assert.throws(() => money('abc', 'balance'), /非法/);
  assert.throws(() => money('', 'balance'), /非法/);
  assert.equal(messageOf(new Error('boom')), 'boom');
  assert.equal(messageOf('plain'), 'plain');
});
