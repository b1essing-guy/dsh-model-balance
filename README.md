# dsh-model-balance

在 DSH 客户端**固定位置常驻**显示当前模型服务的**余额**与**峰谷时段**，并以 host 侧 Service 的形式
保留**接入第三方模型服务**的扩展点。

- 默认挂在 `shell.overlay`（全框浮动层）右下角，显示 `¥14.72 · 低谷 · 距高峰 2d13h` 这类紧凑徽标；
- 悬停展开详情：数据源 / 总可用 / 赠金 / 充值 / 计费时段 / 下次切换 / 单价 / 最近更新时间；
- 点击徽标立即刷新；
- 通过 Cordis 配置可切到侧栏底部（`sidebar.footer.action`）。

---

## 一、它解决什么问题

dsh-pet 已经在气泡里显示余额与峰谷档位，但气泡是**瞬时**的（刷新后显示约 10 秒）。
本插件补的是「**常驻可读**」这个缺口：一个始终在场的徽标，外加一个可被其他插件使用的余额扩展点。

## 二、已核实的业务事实（不是猜的）

| 项目 | 事实 | 来源 |
| --- | --- | --- |
| 高峰时段 | 工作日（周一至周五）北京时间 09:00–12:00、14:00–18:00 | [新浪财经 2026-08-23](https://finance.sina.cn/2026-08-23/detail-inipipwn6614291.d.html) |
| 低谷时段 | 其余时段；**周六、周日全天**按低谷计费（自 2026-08-23 起） | 同上 |
| 价格关系 | 低谷价 = 高峰价 × 50% | 同上 |
| 余额接口 | `GET https://api.deepseek.com/user/balance`（Bearer），返回 `is_available` + `balance_infos[]{currency,total_balance,granted_balance,topped_up_balance}` | [DeepSeek API 文档](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/) |

时段与单价都写在 `src/host/deepseek-rules.js`，**展示层不写死任何规则**——DeepSeek 再调价只改那一个文件。
规则与单价随 `/state` 一起下发给展示层，倒计时由展示层用这份规则**本地每秒**算，不产生任何请求。

## 三、安装

```bash
# 1) 在 profile 目录登记本地链接依赖
#    C:\Users\<你>\.dsh\profiles\desktop\package.json 的 dependencies 里加：
#      "dsh-model-balance": "link:/abs/path/to/dsh-model-balance"
# 2) 并把它加入 dsh.profile.bundles 数组
# 3) 重载 DSH（本插件已被实测为免重启热加载生效）
```

> 若 `pnpm install` 被供应链策略拦下（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`），那是**profile 里
> 既有包**的发布时间问题，与本插件无关。本插件是本地目录，不涉及任何下载，
> 直接建立目录链接（junction / symlink）即可，**不要为此放宽供应链策略**。

## 四、配置（可选，全部有默认值）

写在 `cordis.patch.yml` 的 entry `config` 里：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `slot` | `overlay` | `overlay` = 右下角浮动徽标；`sidebar` = 侧栏底部 |
| `refreshSec` | `600` | 余额自动刷新间隔（秒）。小于 60 会被回落到默认值（防配置手误打爆接口） |
| `hoverPrices` | `true` | 悬停详情里是否展示单价表 |

## 五、架构

```
src/
  index.js                 host 半边入口（main）：注册 provider、开路由、暴露扩展点
  shared/pricing.js        峰谷计算 + 时长/金额格式化（**唯一真相来源**，被 client 构建内联）
  host/
    registry.js            扩展点本体：provider 注册表 + 统一凭证/失败口径
    state.js               轮询状态（rev 单调递增）+ 计价规则
    deepseek-rules.js      DeepSeek 时段规则与单价表（业务事实都在这里）
    internal.js            网络重试 / 响应校验 / 金额收敛
    providers/
      deepseek-account.js  DSH 账号路由（无 API Key，经账号服务）
      deepseek-official.js 官方 API Key 路由（GET /user/balance）
  client.js                client 半边源码（单文件，构建时内联 shared）
lib/client.js              **构建产物**（不要手改；由 scripts/build-client.js 生成）
types/index.d.ts           对外契约（第三方接入方只需读这一个文件）
```

**两半边的通道**：host 查一次余额 → 写进轮询状态 → client 每 10s `GET /dsh-model-balance/state`。
余额**只有一个出口**：`/refresh` 只是动作端点（只回 `{ok:true}`），数据仍从 `/state` 读，
避免出现两条数据路径各说各话。

**为什么 client 是构建产物**：浏览器侧经 `window.__ModuleLoader__.load({factory})` 装配，
`factory` 的 `require` 只认平台种子模块（`react` / `@deepseek-ai/*`），**不能用相对 import**，
所以必须把共享计价内核内联成单文件。构建脚本零依赖，并带三道守卫（占位必须被替换、
内联后不得残留 ESM 语法、不得出现未允许的 `require`）。

## 六、第三方接入（扩展点）

host 侧 Service `ctx.modelBalance`。内置的两条 deepseek 路由**也是走这个接口注册的**，
所以这个扩展点被自身使用，不是摆设。

```js
// 你自己的 host 插件里
export const inject = ['modelBalance'];

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.modelBalance.registerProvider({
        ids: ['your-provider-id'],            // 对齐 ctx.agentDefaultModel.currentSelection().provider
        credential: { mode: 'ref', ref: 'YOUR_API_KEY' },  // 或 { mode: 'none' }（走自己的授权）
        async fetch({ provider, key }) {
          // 只负责成功路径：任何失败一律 throw，由注册表统一落成 fetch-error
          return {
            ok: true,
            provider,
            shape: 'money',
            data: { currency: 'CNY', total: '1.00', granted: '0.00', toppedUp: '1.00' },
          };
        },
      }),
    'my-plugin: provider',
  );
}
```

契约与响应形状见 [`types/index.d.ts`](types/index.d.ts)。要点：

- **注册随插件卸载自动回收**（用 `ctx.effect` 包住），不会留悬空 provider；
- 同一个 `id` 被不同注册方占用时**直接抛错**，不做静默覆盖——静默覆盖会让「余额忽然变成别家的数」成为最难查的故障；
- `fetch` 的返回值会被校验（`ok === true`、`shape === 'money'`、`data.total` 必须是字符串），
  第三方代码是不可信输入，坏结果不会污染轮询状态；
- `ctx.modelBalance.providers()` 可列已登记 id，用于排障。

## 七、失败口径（红线）

**任何失败路径都不会输出伪造的数字**，0 余额只能来自数据源：

| reason | 触发条件 | 界面表现 |
| --- | --- | --- |
| `unsupported` | 当前 provider 没登记余额接口 | 「当前服务未登记余额接口」，不显示金额 |
| `credential-missing` | 缺 `DEEPSEEK_API_KEY`，或账号服务不在场/未登录 | 「缺少凭证：…」 |
| `fetch-error` | HTTP 非 2xx、字段缺失、provider 抛错/返回垃圾 | 「余额查询失败：…」 |
| 本地服务不可达 | `/state` 请求失败 | 「本地服务未就绪」，并在详情里把上次数据标注「离线」 |

## 八、开发与验证

```bash
node scripts/build-client.js                                   # 构建 client 产物
node --test-isolation=none --test "tests/*.test.js"            # 56 项单测
# 若在受限沙箱里（禁止 piped stdio 子进程），必须用 --test-isolation=none：
# 默认的 per-file 子进程模式会因 spawn EPERM 失败，那是沙箱边界而非测试失败。
```

测试覆盖：峰谷边界逐点（08:59/09:00/11:59/12:00/13:59/14:00/17:59/18:00 + 周五 18:00 跳到周一 09:00 +
周末全天低谷 + 跨日跨周）、时区无关性、失败三态、扩展点注册/注销/冲突/坏返回值、
两条 deepseek 路由的响应解析、以及对**构建产物本身**的展示逻辑验证。

## 九、已知限制

- **切换当前模型服务后，余额最多滞后一个 `refreshSec` 才反映**（默认 10 分钟）。DSH 没有提供
  「默认模型选择已变更」的宿主事件，因此无法即时感知；需要立即准确时点一下徽标刷新。
- 单价表是**展示用参考数据**（`priceAsOf` 标注了取值日期），不参与任何计费计算。
- `total` 在账号路由下按 赠送 + 充值 求和（对齐官方 `total_balance` 定义），
  若账号的赠金钱包与充值钱包**币种不同**，则只计入同币种赠金（宁可少算也不错算）。

## 十、License

MIT
