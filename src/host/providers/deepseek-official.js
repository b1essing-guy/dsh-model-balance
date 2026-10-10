/**
 * DeepSeek 官方 API Key 路由（provider id `deepseek-official`）——账户金额。
 *
 * 接口：`GET https://api.deepseek.com/user/balance`（Bearer）。
 * 响应：`{ is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }`
 * 文档：https://api-docs.deepseek.com/zh-cn/api/get-user-balance/
 *
 * 三个金额由接口**原样透传**，不在本插件里按 `granted + topped_up` 重算 `total_balance`：
 * 官方给的数字比我们推算的可信。
 *
 * 凭证：`DEEPSEEK_API_KEY`，经 DSH credential 服务解析后注入（插件不读凭证存储）。
 */
import { DEEPSEEK_FULL_BALANCE } from '../deepseek-rules.js';
import { fetchWithRetry, str } from '../internal.js';

export const DEEPSEEK_OFFICIAL_PROVIDER_ID = 'deepseek-official';
export const DEEPSEEK_OFFICIAL_BALANCE_URL = 'https://api.deepseek.com/user/balance';

/** 官方报文 → 成功结果（纯函数，便于用真实结构直接喂测） */
export function parseOfficialBalance(body, provider) {
  const infos = body?.balance_infos;
  if (!Array.isArray(infos) || infos.length === 0) {
    throw new Error('dsh-model-balance: deepseek balance 响应缺少 balance_infos');
  }
  const first = infos[0];
  return {
    ok: true,
    provider,
    shape: 'money',
    data: {
      currency: str(first?.currency, 'currency'),
      total: str(first?.total_balance, 'total_balance'),
      granted: str(first?.granted_balance, 'granted_balance'),
      toppedUp: str(first?.topped_up_balance, 'topped_up_balance'),
      fullBalance: DEEPSEEK_FULL_BALANCE,
    },
  };
}

export const deepseekOfficialProvider = {
  ids: [DEEPSEEK_OFFICIAL_PROVIDER_ID],
  credential: { mode: 'ref', ref: 'DEEPSEEK_API_KEY' },
  async fetch({ key, provider }) {
    const response = await fetchWithRetry(DEEPSEEK_OFFICIAL_BALANCE_URL, key);
    if (!response.ok) {
      throw new Error('dsh-model-balance: deepseek balance HTTP ' + response.status);
    }
    return parseOfficialBalance(await response.json(), provider);
  },
};
