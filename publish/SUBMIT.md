# 上架 awesome-dsh-plugin：逐条清单

> 本文件把 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `contributing.md` 与实际代码里的
> 要求，逐条对到本插件上。**标记 ✅ 的是仓库里已经就绪的，标记 👤 的是只有你能提供的。**

## 一、必须先说清的三件事

1. **投稿不是投给 dshmarket。** dshmarket 是市场客户端，不是目录。目录在
   [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)——
   去那边提 PR，站点与市场会自动收录（通常一天内）。
2. **CI 只查形式，维护者会读源码。** CI 过只是前置条件；合并前有人会打开你的仓库，
   把描述里每一句话对着代码核一遍。**描述夸大是唯一容易被打回的原因。**
3. **同类已有多个条目**（`GeekRicardo/dsh-balance`、`future007s/dsh-peak-indicator`、
   `Imnotndesh/dsh-peak-pricing-warning`、`534119219/chicheng-peak`、
   `guoliyuan97-png/dsh-game-hud` 等）。评审清单第 4 条明确问「是否已被现有条目覆盖」，
   且规则是「谁更好谁上，不是先来后到」。所以差异化必须在 PR 描述里讲清楚：
   本插件**可被代码验证**的不同点是 host 侧 `modelBalance.registerProvider()` 扩展点
   （见 `types/index.d.ts`）与「不收任何 DSH 内部包 import」的零依赖装配。

## 二、仓库侧（提交前）

| # | 要求 | 状态 |
| --- | --- | --- |
| 1 | 公开 GitHub 仓库，`url` 必须与仓库完全一致 | 👤 需要你建仓库并推送 |
| 2 | `package.json` 声明 `dsh.bundle` manifest | ✅ 已声明 `dsh.bundle.patch` |
| 3 | 仓库根有 `cordis.patch.yml` | ✅ 已就绪 |
| 4 | 只声明 `dsh.client` 会被拒——我们同时声明了 bundle + client | ✅ |
| 5 | 仓库创建满 **1 天**（CI 自动查，无 commit 数门槛） | 👤 新仓库必然要先等 |
| 6 | 仓库加 `dsh-plugin` topic | 👤 一次点击 |
| 7 | 真实可用的代码，非占位/纯 README | ✅ 56 项单测 + 已在真实 GUI 验证 |
| 8 | 活跃维护（定期扫停更/归档仓库并移除） | 👤 你的承诺 |
| 9 | 出仓库截图（1-8 张）→ 仓库根放 `screenshots.json` | 👤 需要你截图（我看不到你的屏幕） |
| 10 | `@deepseek-ai/*` 用 `peerDependencies` 声明 | ✅ 已补（含预发布分支，已用真 semver 验证） |
| 11 | 官方包不得放 `dependencies` | ✅ 本插件运行时依赖为零 |

## 三、条目文件（PR 的全部内容）

只需在 fork 里**新增一个文件**：`data/plugins/<owner>__<repo>.yml`。
用 [`awesome-dsh-plugin-entry.yml`](awesome-dsh-plugin-entry.yml) 的内容，
把 `OWNER/REPO` 换成你的。

不要做的事（都已核对）：

- ❌ 不要手工改 `README.md` / `README.zh.md`——它们由 `data/plugins/*.yml` 脚本生成，
  手工改会让你的改动落到邻居那一行上。
- ❌ 不要往 yml 里加 `npm:` 字段——会被校验直接拒绝；npm 映射从 registry 自动采集。
- ❌ 一个 PR 最多 3 条。
- ⚠️ 描述里出现 ASCII「冒号+空格」必须给整行加引号（模板里已用单引号包好）。

## 四、CI 会依次运行

1. 条目数 ≤ 3
2. `dsh.bundle`（从你仓库的 `package.json` 读；根包或 `packages/`·`plugins/`·`apps/` 子包）
3. 仓库年龄 ≥ 1 天
4. `awesome-lint` + 站点构建（双语一致性、分隔符、日期、截图）

任一项失败都会**明确指出改什么**，在同一分支推修复即可，不用重开 PR。

## 五、可选：发布到 npm

- 好处：市场能显示并**按下载量排序**；预构建安装可跳过 `allowBuilds` 构建授权。
- **收录与是否发 npm 无关**，两种都能从 GitHub 安装。
- 若发：已发布的 `package.json` 里 `repository` 字段**必须指回**本列表收录的那个仓库，
  否则两者不会被关联（这是防「包挂到未认领的仓库」）。
- 已就绪：`prepack` 钩子会在 `npm publish` / `npm pack` 前重新构建 `lib/client.js`，
  保证发布的 tarball 里永远是新鲜产物。
  （用 `prepack` 而不是 `prepare`：npm 11 会把 `prepare` 判为未批准的安装脚本。）

## 六、提交步骤

```sh
# 1) 建仓库并推送本插件目录内容到根
git init && git add -A && git commit -m "feat: dsh-model-balance 0.1.0"
git remote add origin https://github.com/OWNER/REPO.git && git push -u origin main

# 2) 到仓库 Settings 加 topic：dsh-plugin   （或网页 Repositories 列表点齿轮）

# 3) 等满 1 天（CI 硬门槛，无法绕过）

# 4) fork 并 clone 列表仓库
git clone https://github.com/OWNER/awesome-dsh-plugin.git && cd awesome-dsh-plugin
git checkout -b add-dsh-model-balance

# 5) 新增条目文件（内容见 publish/awesome-dsh-plugin-entry.yml）
#    data/plugins/OWNER__REPO.yml

# 6) 本地预览你那一行长什么样（可选）
npm ci && node scripts/generate-readme.mjs

# 7) 提交 PR
git add data/plugins/OWNER__REPO.yml && git commit -m "Add dsh-model-balance"
git push origin add-dsh-model-balance
```

## 七、仍然缺的东西（需要你决定/提供）

| 项 | 说明 |
| --- | --- |
| 仓库 owner/repo | 条目 `url` 与 `name` 都用它 |
| 截图 1-8 张 | 你刚才已能看到余额与峰谷——那张就是素材；放仓库 `assets/` 并写 `screenshots.json` |
| 插件图标（可选） | 市场/插件管理页会显示；`icon` 相对 `package.json` 的路径，只认 svg/png/jpg/jpeg/webp，≤256 KiB，且解析后必须留在包目录内 |
| 中英描述措辞 | 我已按「不许夸大」起草，你拍板 |
| 是否发 npm | 决定是否补 `repository` 字段与 npm 账号流程 |
| 署名与许可证主体 | 现为 MIT，需要确认署谁的名 |
