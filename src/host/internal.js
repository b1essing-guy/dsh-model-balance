/**
 * provider 取数的**内部工具**：网络策略 + 响应校验 + 金额处理。
 *
 * 与内置 provider 之外**没有耦合**：第三方 provider 不必用这里的函数（它可以用 SDK、
 * 读本地文件、走账号服务……），但内置两条路由共用同一套口径：
 * - 网络：20s 超时 + 3 次重试（该环境对境外端点存在间歇性超时）；
 * - 校验：必填字段缺失/非法一律 `throw`，**绝不静默当 0**；
 * - 金额：收敛到两位小数字符串，绝不在展示层做浮点运算。
 */

/** 抓取超时（ms） */
const FETCH_TIMEOUT_MS = 20_000;
/** 单次抓取失败后的重试次数（失败间隔 800ms 线性退避） */
const RETRIES = 3;
/** 重试间隔（ms） */
const RETRY_DELAY_MS = 800;

/** fetch 一次，带超时；失败抛错（由调用方决定是否重试） */
async function fetchOnce(url, key, label) {
  return fetch(url, {
    headers: {
      Authorization: 'Bearer ' + key,
      Accept: 'application/json',
      'User-Agent': 'dsh-model-balance',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

/** fetch + 重试；全败抛最后一个错误 */
export async function fetchWithRetry(url, key, label = 'response') {
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      return await fetchOnce(url, key, label);
    } catch (error) {
      last = error;
      if (attempt < RETRIES) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** 取对象：不是对象（含数组 / null）→ undefined */
export function obj(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

/** 非空字符串，否则 throw */
export function str(value, what) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('dsh-model-balance: 余额数据非法字段 ' + what);
  }
  return value;
}

/**
 * 金额 → 两位小数字符串。
 * 服务端回传的是保留精度的原始串（形如 `9.9902690000000000`），直接显示会很难看，
 * 故在这里收敛到两位小数；非法值仍抛错，绝不伪造 0。
 */
export function money(value, what) {
  const raw = str(value, what);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error('dsh-model-balance: 金额非法 ' + what);
  }
  return parsed.toFixed(2);
}

/** 两个金额串相加 → 两位小数（走整数分相加，避免浮点误差在金额上显形） */
export function sumMoney(left, right) {
  return ((Math.round(Number(left) * 100) + Math.round(Number(right) * 100)) / 100).toFixed(2);
}

/** 错误 → 人类可读消息（统一失败口径用） */
export function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
