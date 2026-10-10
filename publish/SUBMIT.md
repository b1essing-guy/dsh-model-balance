# 上架 awesome-dsh-plugin：逐条清单

> 本文件把 `awesome-dsh-plugin/awesome-dsh-plugin` 的 `contributing.md` 与实际代码里的要求，
> 逐条对到本插件上。**✅ = 已就绪，👤 = 需要你本人操作，❓ = 待你决定。**

仓库：https://github.com/b1essing-guy/dsh-model-balance

## 一、必须先说清的三件事

1. **投稿不是投给 dshmarket。** dshmarket 是市场客户端，不是目录。目录在
   [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)——
   去那边提 PR，站点与市场会自动收录（通常一天内）。
2. **CI 只查形式，维护者会读源码。** CI 过只是前置条件；合并前有人会打开你的仓库，
   把描述里每一句话对着代码核一遍。**描述夸大是唯一容易被打回的原因。**
3. **同类已有多个条目**（`GeekRicardo/dsh-balance`、`future007s/dsh-peak-indicator`、
   `Imnotndesh/dsh-peak-pricing-warning`、`534119219/chicheng-peak`、
   `guoliyuan97-png/dsh-game-hud` 等）。评审清单第 4 条明确问「是否已被现有条目覆盖」，
   且规则是「谁更好谁上，不是先来后到」。所以 PR 里要讲清可被代码验证的差异：
   本插件的 host 侧 `modelBalance.registerProvider()` 扩展点
   （见 [`types/index.d.ts`](../types/index.d.ts)）与「不收任何 DSH 内部 import」的零依赖装配。

## 二、仓库侧

| # | 要求 | 状态 |
| --- | --- | --- |
| 1 | 公开 GitHub 仓库，条目 `url` 与仓库完全一致 | ✅ `b1essing-guy/dsh-model-balance` |
| 2 | `package.json` 声明 `dsh.bundle` manifest | ✅ `dsh.bundle.patch` |
| 3 | 仓库根有 `cordis.patch.yml` | ✅ |
| 4 | 只声明 `dsh.client` 会被拒——本包 bundle + client 都声明了 | ✅ |
| 5 | 仓库创建满 **1 天**（CI 硬门槛，从 `created_at` 算） | ⏳ 自然等待 |
| 6 | 仓库加 `dsh-plugin` topic | 👤 仓库页 About 右侧齿轮 → Topics |
| 7 | 真实可用的代码，非占位/纯 README | ✅ 56 项单测 + 已在真实 GUI 验证 |
| 8 | 活跃维护 | 👤 你的承诺 |
| 9 | 截图 1-8 张 → 仓库根 `screenshots.json` | 👤 需要你截图 |
| 10 | `@deepseek-ai/*` 用 `peerDependencies` 声明 | ✅ 含预发布分支，已用真 semver 验证 |
| 11 | 官方包不得放 `dependencies` | ✅ 运行时依赖为零 |

## 三、条目文件（PR 的全部内容）

只需在 fork 里**新增一个文件**：
`data/plugins/b1essing-guy__dsh-model-balance.yml`
内容见 [`awesome-dsh-plugin-entry.yml`](awesome-dsh-plugin-entry.yml)。

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
- 若发：已发布包的 `repository` 字段必须指回本列表收录的仓库——**本包已填好**
  （`git+https://github.com/b1essing-guy/dsh-model-balance.git`）。
- 已就绪：`prepack` 钩子在 `npm publish` / `npm pack` 前重建 `lib/client.js`，
  保证发布产物永远新鲜。（用 `prepack` 而非 `prepare`：npm 11 会把 `prepare`
  判为未批准的安装脚本。）

## 六、提交步骤（**用 SSH**，因为本机 HTTPS 到 github.com 被重置）

本机已配置 `~/.ssh/config`：`github.com` 自动走 `ssh.github.com:443`，
所以下面可以照常写 `git@github.com:...`，不需要开代理。

```sh
# 1) 在 GitHub 网页上点一次 Fork：
#    https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/fork

# 2) 克隆你 fork 出来的那个（SSH 地址）
git clone git@github.com:b1essing-guy/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git checkout -b add-dsh-model-balance

# 3) 新增条目文件
#    data/plugins/b1essing-guy__dsh-model-balance.yml
#    内容照抄 publish/awesome-dsh-plugin-entry.yml

# 4) 本地预览你那一行长什么样（可选）
npm ci && node scripts/generate-readme.mjs

# 5) 提交并推到你自己的 fork
git add data/plugins/b1essing-guy__dsh-model-balance.yml
git commit -m "Add dsh-model-balance"
git push -u origin add-dsh-model-balance

# 6) 打开 PR（GitHub 会在你 push 后给出 Compare & pull request 提示）
#    标题建议：Add dsh-model-balance
#    正文里点明与既有余额类条目的差异（扩展点 + 零依赖），并附上仓库与截图链接
```

## 七、仍然需要你处理的

| 项 | 说明 |
| --- | --- |
| 邮箱验证 | 未验证的邮箱**不能创建 PR**。注册后请确认验证信已点掉（没收到的查 QQ 邮箱垃圾箱） |
| `dsh-plugin` topic | 仓库页 About 右侧齿轮 → Topics 填 `dsh-plugin` |
| 截图 1-8 张 | 你已能看到余额与峰谷徽标——把那张图存进仓库 `assets/`，再写一个 `screenshots.json` 列出路径（相对路径不能以 `/` 开头、不能含 `..`） |
| 插件图标（可选） | 市场/插件管理页会显示；`icon` 相对 `package.json` 的路径，只认 svg/png/jpg/jpeg/webp，≤256 KiB，且解析后必须留在包目录内 |
| 是否发 npm | 决定要不要走 npm 账号流程（`repository` 已填好） |
| 许可证署名主体 | 现为 MIT，`LICENSE` 文件还没建，需要确认署谁的名 |
| 1 天等待 | 从**仓库创建时刻**起算 24 小时。现在建好了，明天即可提 PR |
