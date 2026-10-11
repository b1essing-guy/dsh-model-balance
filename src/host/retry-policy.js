/**
 * 启动竞态的重试策略（纯函数，便于单测）。
 *
 * 背景（**真实故障，有实测证据**）：插件激活时会立刻拉一次余额，而那一刻
 * `deepseekAccount` 服务可能还没初始化完 → 这次查询落成 `credential-missing`；
 * 而下一次定时刷新要等 `refreshSec`（默认 600 秒）。于是每次重启 DSH 都会看到
 * 「缺少凭证」长达 10 分钟。
 *
 * 实测：DSH 进程启动 2026-10-11 09:22:56 → 失败记录 09:22:58（启动后 2 秒）
 *      → 此后 1.8 分钟内 /state 没有任何后续刷新。
 *
 * 口径：
 * - **只对「未就绪类」失败快速重试**。这类失败的环境还没准备好，等一会儿会自愈；
 *   而 `unsupported`（服务商根本没登记接口）与 `fetch-error`（网络/响应异常）
 *   重试再快也没用，交给常规周期即可。
 * - 退避序列**有限**：用完落回常规周期。对真正未登录的用户最多多打 4 次，
 *   且集中在启动后约 100 秒内，不会长期制造噪声。
 */

/** 视为「环境尚未就绪、值得快速重试」的失败原因 */
export const NOT_READY_REASONS = ['credential-missing'];

/** 未就绪类的重试退避序列（毫秒）；用完即落回常规刷新周期 */
export const RETRY_SCHEDULE_MS = [3000, 10000, 30000, 60000];

/**
 * 该失败是否属于「未就绪类」——即值得按退避序列再试。
 * 只认明确标记为 `ok:false` 且原因在 {@link NOT_READY_REASONS} 里的结果；
 * `null` / `undefined` / 成功结果一律为 `false`（绝不因为"形状不认识"就重试）。
 */
export function isNotReadyFailure(result) {
  return (
    result !== null &&
    typeof result === 'object' &&
    result.ok === false &&
    NOT_READY_REASONS.includes(result.reason)
  );
}

/**
 * 第 `attempt` 次未就绪失败之后，应等多久再试。
 *
 * @param {number} attempt 已发生的未就绪失败次数（从 0 开始）
 * @returns {number | null} 毫秒；`null` = 退避序列已用尽，落回常规刷新周期
 */
export function nextRetryDelayMs(attempt) {
  const index = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  return index < RETRY_SCHEDULE_MS.length ? RETRY_SCHEDULE_MS[index] : null;
}
