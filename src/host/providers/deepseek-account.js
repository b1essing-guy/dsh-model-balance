/**
 * DSH 账号路由（provider id `deepseek-account`）——免费额度 / 平台登录，账户金额。
 *
 * 这条路由**没有 API Key**（`credential.mode === 'none'`）：凭证是 DSH 账号服务持有的
 * 授权记录，因此不发任何 HTTP，只经注入的 `resolveAccount`（= `ctx.deepseekAccount.getBalance`）
 * 取快照。插件不读凭证存储，也不知道凭证明文——这是账号服务与插件之间的边界。
 *
 * 失败口径：未登录 / 查询失败 / 没有钱包 → 一律 throw，由注册表统一落成 `fetch-error`，
 * **绝不显示 ¥0.00**（0 只能来自数据源，不能来自兜底）。
 */
import { DEEPSEEK_FULL_BALANCE } from '../deepseek-rules.js';
import { money, obj, sumMoney } from '../internal.js';

export const DEEPSEEK_ACCOUNT_PROVIDER_ID = 'deepseek-account';

/**
 * 账号余额快照 → 成功结果（纯函数，便于用真实结构直接喂测）。
 *
 * `total` 语义对齐官方定义：`total_balance` = 赠金 + 充值余额，只取充值会让可用余额偏小。
 */
export function parseAccountBalance(snapshot, provider) {
  if (!snapshot) throw new Error('dsh-model-balance: 账号未登录（' + DEEPSEEK_ACCOUNT_PROVIDER_ID + '）');
  if (snapshot.status !== 'ready') throw new Error('dsh-model-balance: 账号余额查询失败');
  const wallets = Array.isArray(snapshot.value) ? snapshot.value : [];
  // 充值钱包为空 = 这个账号没有可展示的余额（常见于只送不充的新号）→ 报错而非显示 ¥0.00
  if (wallets.length === 0) throw new Error('dsh-model-balance: 账号没有充值钱包余额');
  const first = obj(wallets[0]);
  if (!first) throw new Error('dsh-model-balance: 账号钱包结构非法');

  const currency = typeof first.currency === 'string' && first.currency.length > 0 ? first.currency : 'CNY';
  const toppedUp = money(first.balance, 'balance');
  // 赠金钱包：取与充值同币种的那个（币种不同不硬配，宁可少算也不错算）
  const bonusWallet = (Array.isArray(snapshot.bonusWallets) ? snapshot.bonusWallets : [])
    .map((wallet) => obj(wallet))
    .find((wallet) => wallet !== undefined && wallet.currency === currency);
  const granted = bonusWallet ? money(bonusWallet.balance, 'bonus balance') : '0.00';

  return {
    ok: true,
    provider,
    shape: 'money',
    data: {
      currency,
      total: sumMoney(granted, toppedUp),
      granted,
      toppedUp,
      fullBalance: DEEPSEEK_FULL_BALANCE,
    },
  };
}

export const deepseekAccountProvider = {
  ids: [DEEPSEEK_ACCOUNT_PROVIDER_ID],
  credential: { mode: 'none' },
  async fetch({ provider, resolveAccount }) {
    // 注册表对 mode === 'none' 已保证 resolveAccount 在场（否则落 credential-missing）；
    // 这里是「不变量守卫」，只会在接线被改坏时触发。
    if (typeof resolveAccount !== 'function') {
      throw new Error('dsh-model-balance: 缺少账号服务（' + provider + '）');
    }
    return parseAccountBalance(await resolveAccount(), provider);
  },
};
