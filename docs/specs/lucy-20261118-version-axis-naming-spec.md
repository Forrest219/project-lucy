# Lucy 版本轴分工与命名规约 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | 无（发版治理规约）。挂现行 `0.30` 执行总账，不占用 P 号 |
| 台账号 | 无 |
| 状态 | **v0.1-draft。仅方案落盘：不含运行代码、镜像与 CI 改动；未获开发授权；待 Codex 交叉审阅与委托人批准。≠ 可上线** |
| 决策来源 | 委托人 2026-11-18：「当前 lucy 的版本较乱，当前分支是 0.30.0，但经历了多次小幅发版，但都不是 0.30 的定稿，请给出大版本（分支号）和小版本（分支合并到 main 之前的镜像）的分工和命名建议」；约束「只做方案，不做代码修改」 |
| 适用范围 | 产品线分支命名、合并前候选镜像标签、定稿发布标签、构建修订、相关台账与门禁口径 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」；[`AGENTS.md`](../../AGENTS.md)「部署方式与版本制品解耦（全局原则）」 |
| 关联现状文档 | [`docs/governance/version-matrix.md`](../governance/version-matrix.md) §1.1／§1.2；[`docs/SYSTEM_HANDBOOK.md`](../SYSTEM_HANDBOOK.md) §版本；[`docs/releases/README.md`](../releases/README.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。给出四轴分工与命名规约、生命周期、落地范围与验收标准。只做方案，终稿未确权，开发未授权 |

## 闭口层级

- 层级：功能合同
- 本条承诺：产品线号（分支号）、合并前候选版本号、定稿产品版本号、构建修订四者互不代用、互不覆盖；任一交付镜像仅凭标签即可判定它是「合并前候选」还是「定稿发布」，并定位到唯一提交。
- 本条出口：SC-01–SC-08。
- 不在本条出口：0.30 功能本身是否做够；定稿号是否升到 `1.0.0`；补丁位 hotfix 规则的最终批准（见 §11 OQ-4）；`v0.2.0`／`v2.0.0` 历史 tag 与 Release 的处置；已发给客户现场的 `customer-amd64-0.30.0-*` 镜像的追溯处理（见 §5.5）。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 产品线号（分支号）、候选版本（rc.N）、定稿版本、构建修订。四者均为发版治理术语，不进入 WebUI 用户可见文案。

## 交互合同豁免

- 原因：本条只规范版本编号与镜像标签命名，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`/api/health`、`/api/version` 与「版本信息」页的既有返回形状与展示字段

## 1. 背景与现状事实

### 1.1 分支与版本实测（2026-11-18，`git branch -a` / `git log` / `git show <ref>:VERSION`）

| 引用 | `VERSION` | tip 提交 / 日期 | 状态 |
|---|---|---|---|
| `lucy-v0.30`（当前分支） | `0.30.0` | `6cc0029c` / 2026-11-18 | 开发中；**无** `v0.30.0` tag、**无**台账 |
| `origin/main` | `0.25.0` | `2536a7cb` / 2026-11-07 | 含 `v0.25.0` tag 提交 `e84c9ed4`；落后 `lucy-v0.30` 117 提交 |
| 本地 `main` | `0.20.0` | `99f8c2e1` / 2026-10-24 | **落后 `origin/main` 324 提交**；本地读到的「main 是 0.20.0」是假象 |
| `lucy-v0.25` | `0.25.0` | `9c78b0e3` / 2026-11-10 | tip 提交**未**并入 `origin/main`；但已是 `lucy-v0.30` 的祖先 |
| `lucy-v2.0` | `2.0.0` | `edac5830` / 2026-10-24 | 已废止切线的残留分支 |
| `origin/release/lucy-upgrade-ready-M` | `0.20.0` | `b6a0c03c` / 2026-11-03 | 早期升级准备分支，落后 4 提交 |

拓扑事实：`main` → `lucy-v0.25` → `lucy-v0.30` 是**祖先链**，不是平级分支。`lucy-v0.25` 的 tip 落在 `origin/main` 之后，因此 0.30 合并 main 时会连带带上 0.25 尾段修复。

### 1.2 「多次小幅发版」的真实形态：有事实、无编号、无台账位置

1. `VERSION` 在 `lucy-v0.30` 上自开线起**未再变动**——`git log --follow -- VERSION` 只有一条 `387664a9 chore(version): open lucy-v0.30 product line at 0.30.0`。
2. 因此分支上每一次出包都带**同一个版本段 `0.30.0`**，彼此只能靠 `<YYYYMMDD>-<sha7>` 区分。
3. 实证撞车：2026-11-17 部署到云端演示机的镜像是 `customer-amd64-0.30.0-20261117-abb38913`（`docs/lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md`）。它与将来的定稿镜像 `customer-amd64-0.30.0-<date>-<sha7>` **版本段完全相同**，而且带的是 `customer-` 前缀。
4. 台账侧没有位置：`docs/releases/` 下无 `v0.30.0.json`、无 `v0.30.0` tag；只有 `v0.30.0-user-facing.md`（文件自述「不表示可上线或客户交付」）与 2026-11-13 的中间态出口声明。
5. 结论：合并前的每次交付都能被追溯到**提交**，但无法被引用为一个**版本号**。「客户在跑哪一版」只能靠口头带日期和 sha 回答——这就是「乱」的实质。

### 1.3 三个与编号无关、但必须一并处理的乱点

| 编号 | 乱点 | 事实 | 后果 |
|---|---|---|---|
| R-1 | 本地 `main` 与 `origin/main` 不同步 | 本地 `main` 落后 324 提交，`VERSION` 仍为 `0.20.0` | 任何基于本地 `main` 的版本判断都不可信 |
| R-2 | `lucy-v0.25` 尾段未并入 main | `9c78b0e3`（2026-11-10）不在 `origin/main` 内，但是 `lucy-v0.30` 的祖先 | 0.30 合并 main 时会连带交付 0.25 尾段修复；合并叙述必须写明，否则客户会问「为什么 0.30 里带 0.25 的修复」 |
| R-3 | CI 触发面缺口 | `.github/workflows/lucy-ci.yml` 的 `on.push.branches` 只有 `main` 与 `lucy-v0.25`（后者标注 TEMPORARY），**没有 `lucy-v0.30`** | 合并前镜像所在分支没有日常门禁背书，「候选」比「定稿」更早触达客户现场却更少证据 |

### 1.4 既有门禁的硬约束（本方案必须落在约束内）

| 门禁 / 文档 | 约束 | 对本方案的影响 |
|---|---|---|
| `npm run lint:version`（`scripts/release/lucy-version-governance.mjs`） | `VERSION` 必须是纯数字 `X.Y.Z`；`package.json`／`package-lock.json`／`Dockerfile ARG LUCY_VERSION`／`docker-compose` build args／`Chart.appVersion`／`values.lucy.version`／`values.image.tag`／Vite fallback／server fallback／client fallback 共 11 处投影必须与它**逐字相等** | 候选小版本**不能**写进 `VERSION`：每次出包都要改 11 处投影，改漏即门禁红 |
| `npm run lint:release-ledger` | 当前 `VERSION` 必须有对应台账条目；一版一条；`releaseTag`＝`v${productVersion}`；`productionReady` 需要 `docs/releases/ux/<产品版本>.md` | 候选版本**不能**占用 `docs/releases/vX.Y.Z.json` |
| 镜像 tag 正则（`lucy-version-governance.mjs`） | `isCustomerImageRefForVersion`：`^customer-amd64-<version>-\d{8}-[0-9a-f]{7,}$`；`isReleaseTagForVersion` 另接受 `customer-(amd64\|multiarch)-<version>-...` | 候选 tag 要么改这条正则，要么换一个不进入发布命名空间的前缀 |
| `docs/SYSTEM_HANDBOOK.md` §版本 | 补丁段「矩阵另定 hotfix 规则之前保持 `0`」，`0.30.1` 暂不启用 | 补丁位当前是冻结的，不能拿来当「小版本」 |
| `docs/releases/README.md` | 台账扫描是 `readdirSync` **非递归** | 候选台账放 `docs/releases/candidates/` 不会被现有台账门禁误扫 |

## 2. 决策摘要

**一句话：大版本＝分支号，只在开线时决定；小版本＝合并前镜像的候选号，每次出包 +1；两者都不改 `VERSION`；`VERSION` 只在定稿那一刻被锁定。**

### 2.1 四轴分工表

| 轴 | 名称 | 形态 | 载体（SSOT） | 谁定 / 何时变 | 语义 | 禁止 |
|---|---|---|---|---|---|---|
| **大版本** | 产品线号（分支号） | `X.Y`（现 `0.30`） | 分支名 `lucy-vX.Y` ＋ `VERSION` 的 `X.Y` 段 | 开线时一次性决定；换线＝开新分支 | 「这批能力属于哪一代产品」 | 不得中途改分支号（切断历史与台账链） |
| **小版本** | 候选版本（合并前镜像） | `X.Y.Z-rc.N`（现 `0.30.0-rc.N`） | 新增根文件 `CANDIDATE_VERSION` ＋ 镜像 tag 段 ＋ 候选台账 | 每次出合并前镜像 N+1；同线内不复用 | 「这是合并前的第几个候选」 | 不得带 `customer-` 前缀；不得打 `v*` tag；不得声明 `productionReady`；不得写进 `VERSION` |
| **定稿版本** | 产品版本 | `X.Y.Z`（现 `0.30.0`） | `VERSION` ＋ `Chart.appVersion` ＋ `vX.Y.Z` tag ＋ `docs/releases/vX.Y.Z.json` | 合并到 main 后锁定 | 「这是可交付的正式版本」 | 不得复用已发过的号；不得在定稿前宣称可上线 |
| **构建修订** | 构建修订（**不是版本**） | 40-hex commit（显示前 12 位） | `/app/BUILD_REVISION`、`/api/health.data.gitSha` | 每次构建自动产生 | 「具体是哪一次构建」 | 不得当版本用；不表达大小序 |

### 2.2 命名形态

| 对象 | 现状 | 建议 |
|---|---|---|
| 产品线分支 | `lucy-v0.30` | 不变 |
| **合并前镜像** | `customer-amd64-0.30.0-20261117-abb38913`（与定稿撞版本段） | `candidate-amd64-0.30.0-rc.3-20261118-abb38913` |
| **定稿镜像** | `customer-amd64-0.30.0-<date>-<sha7>` | 不变（但**只有**定稿 tag 路径能产出 `customer-` 前缀） |
| 定稿 tag | `v0.30.0` | 不变 |
| 候选台账 | 无 | `docs/releases/candidates/0.30.0-rc.3.json` |
| 候选 SSOT | 无 | 仓库根 `CANDIDATE_VERSION`（内容形如 `0.30.0-rc.3`） |

### 2.3 可判定规则

- **R1 前缀即语义**：`customer-` 前缀只由定稿 tag 路径产出；合并前镜像一律 `candidate-` 前缀。
- **R2 候选号单调**：合并前镜像 tag 必须含 `-rc.N`，N 在同一产品线内单调 +1，不复用、不跳回。
- **R3 候选不是发布**：候选版本不写进 `VERSION`、不占用 `docs/releases/vX.Y.Z.json`、不打 `v*` tag、不得声明 `productionReady`。
- **R4 定稿四步**：合并 main → 在 merge commit 打 `vX.Y.Z` → 写台账 `docs/releases/vX.Y.Z.json` ＋ UX 记录 `docs/releases/ux/X.Y.Z.md` → tag run 产出 `customer-amd64-X.Y.Z-<date>-<sha7>`。
- **R5 序关系**：`X.Y.Z-rc.1 < X.Y.Z-rc.2 < … < X.Y.Z`（候选低于定稿），与仓库「同线数值递增」不冲突。
- **R6 修订不参与大小序**：构建修订只用于定位构建，不能用来比较版本新旧。

## 3. 目标与非目标

**目标**

1. 给「合并前镜像」一个可被引用的、单调的、与定稿不撞号的编号。
2. 让「这是候选还是定稿」成为**标签层面的可判定事实**，不依赖人读文档。
3. 大版本（分支号）保持不变——它已经是干净的资产，不需要动。
4. 保留既有门禁语义：`VERSION`＝产品身份、镜像 tag＝制品身份、commit＝构建身份，三者继续解耦。

**非目标**

1. 不改 `0.30` 的功能范围，不动任何功能代码。
2. 不在本条内决定 `1.0.0` 的产品含义（矩阵 §1.1 仍要求显式批准）。
3. 不回溯改写既有 `v0.2.0`／`v2.0.0`／`v0.20.0`／`v0.25.0` 的历史事实。
4. 不改 `docs/releases/` 既有台账结构（候选台账是**新增**目录，不改老格式）。
5. 不在本条内决定补丁位 hotfix 规则（见 §11 OQ-4），本条只保证它与候选序列互不污染。

## 4. 四轴分工细则

### 4.1 大版本＝产品线号（分支号）

- **形态**：`X.Y`。当前 `0.30`，分支 `lucy-v0.30`。
- **它回答**：这批能力属于哪一代产品。
- **它不回答**：这批能力是否已上线、是否已交付客户、是否稳定。
- **变更条件**：只在新开产品线时变更。新线从**最新的 `origin/main`** 开，不从旧产品线分支开——否则会把上一条线的未合入尾段再背一次。
- **现状符合度**：§1.1 已确立「分支 `lucy-v0.30` ＝ 产品版本 `0.30.0`」，本轴**无需改动**。

### 4.2 小版本＝候选版本（合并前镜像）

- **形态**：`X.Y.Z-rc.N`，N 从 1 递增。例：`0.30.0-rc.1`、`0.30.0-rc.2`。
- **它回答**：这次出的合并前镜像是本条产品线上的第几个候选。
- **它不回答**：这是正式版；这是可上线版本；客户在生产上跑的就是它。
- **载体**：新增根文件 `CANDIDATE_VERSION`（唯一 SSOT，格式与 `VERSION` 同构但允许 `-rc.N` 后缀）；镜像 tag 段；候选台账 `docs/releases/candidates/X.Y.Z-rc.N.json`。
- **为什么放在根文件而不是文档里**：CI 与发布脚本需要一个**机器可读、单一、无歧义**的当前值；`VERSION` 已经是这个模式（根文件 + 11 处投影 + `lint:version` 对齐），候选号照抄这个模式即可，不引入第二套风格。
- **候选台账记什么**：产品版本、候选号、分支、提交、镜像 tag 与 digest、门禁结论摘要、用途（升级验证／客户现场／内部验证）、以及「非定稿、不带 `customer-` 前缀、不可声明 productionReady」的显式声明。
- **候选的用途边界**：候选镜像可用于升级验证与客户现场演练；**不得**作为客户正式交付物发出、不得写入对外 release notes、不得进 `docs/releases/ux/`。

### 4.3 定稿版本＝产品版本

- **形态**：`X.Y.Z`。当前 `0.30.0`。
- **它回答**：这是可交付的正式版本。
- **载体**：`VERSION` ＋ `Chart.appVersion` ＋ `values.lucy.version` ＋ `vX.Y.Z` tag ＋ `docs/releases/vX.Y.Z.json` ＋ `docs/releases/ux/X.Y.Z.md`。
- **锁定时机**：合并到 main 之后。合并前 `VERSION` 已经是 `0.30.0`（开线时就定好了），**定稿不是改号，而是给这个号打 tag 与台账**——这是本方案与「出一次包改一次号」的根本区别。
- **现状符合度**：`docs/releases/README.md` 已规定「打 tag 前先写条目，`commit` 暂填 `PENDING`；tag 打好后回填真实 SHA」，本轴直接沿用。

### 4.4 构建修订（不是版本）

- **形态**：40-hex commit；对外可见文本取前 12 位，完整值留在 `/api/health.data.gitSha` 与镜像内 `/app/BUILD_REVISION`。
- **它回答**：客户手上的构建对应哪次提交（升级比对用）。
- **它不回答**：版本先后。**禁止**用 commit 比大小（现有 §1.2 已如此规定，本条沿用）。
- **现状符合度**：已落地，本方案不动。

### 4.5 分工边界速查

| 场景 | 用哪个号 | 不用什么号 |
|---|---|---|
| 「这批功能属于哪一代产品？」 | 产品线号 `0.30` | commit、rc.N |
| 「客户现场现在跑的是第几个候选？」 | 候选版本 `0.30.0-rc.N` | `VERSION`、commit |
| 「这次交付能不能对外说『0.30 已发布』？」 | 定稿版本 `0.30.0` ＋ tag | rc.N、chart 版本 |
| 「客户手上的包对应哪个提交？」 | 构建修订（40-hex） | 任何版本号 |
| 「两个客户包哪个更新？」 | 产品版本序（定稿 vs 定稿） | commit 时间戳 |

## 5. 生命周期与落地形态

### 5.1 开线

1. 从最新 `origin/main` 开分支 `lucy-vX.Y`。
2. `VERSION` 置 `X.Y.0`；`CANDIDATE_VERSION` 置 `X.Y.0-rc.0`（表示「尚无候选」）。
3. 跑一次 `npm run lint:version`，确认 11 处投影与 `VERSION` 一致。

### 5.2 开发期出包（合并前镜像）

1. 需要一个可安装、可升级验证的构建时，序号 +1：`CANDIDATE_VERSION` → `X.Y.Z-rc.N`。
2. 构建并推送 `candidate-amd64-X.Y.Z-rc.N-<YYYYMMDD>-<sha7>`。
3. 写候选台账 `docs/releases/candidates/X.Y.Z-rc.N.json`（提交、digest、门禁结论、用途）。
4. 该镜像**不**打 `v*` tag、**不**进 `docs/releases/` 顶层台账、**不**声明 `productionReady`。

### 5.3 定稿

1. 功能闭口通过 → 合并到 `main`（merge commit）。
2. 在该 merge commit 上打 annotated tag `vX.Y.Z`。
3. 写 `docs/releases/vX.Y.Z.json`（回填真实 commit、runs、gates）与 `docs/releases/ux/X.Y.Z.md`。
4. tag run 产出 `customer-amd64-X.Y.Z-<YYYYMMDD>-<sha7>` 并走既有 release-package 链。
5. `CHANGELOG.md` 的 `Unreleased — X.Y.Z` 段转正为正式段。

### 5.4 定稿后的同线修复（hotfix）

- 走**补丁位** `X.Y.(Z+1)`，作为真发布（完整台账 ＋ tag ＋ UX 记录），**不进 rc 序列**。
- 现状：`docs/SYSTEM_HANDBOOK.md` 写明补丁段在矩阵另定规则前保持 `0`，`0.30.1` 暂不启用 → 本条**不单方面改这条**，规则草案见 §11 OQ-4。

### 5.5 现状对齐（阶段 0，与编号方案解耦但必须先做）

- R-1：本地 `main` 与 `origin/main` 同步（fetch 后快进），消除「main 是 0.20.0」的假象。
- R-2：`lucy-v0.25` 尾段（`9c78b0e3` 等 2026-11-10 之后的提交）不单独发布，随 0.30 交付；该结论写进合并叙述。
- R-3：`.github/workflows/lucy-ci.yml` 的 push 触发补上**当前产品线分支**（现为 `lucy-v0.30`），并删除已失效的 `lucy-v0.25` 临时触发（`docs/governance/release-ci.md` 已写明「该分支并入 main、或不再作为集成分支时必须删除该触发」）。
- 已发出的 `customer-amd64-0.30.0-*` 合并前镜像：**不改历史标签**（tag 与 digest 是事实），但需在候选台账目录补一份追溯说明，指明它是 0.30 定稿前的构建，避免与将来的定稿镜像混淆。

## 6. 核心流程（伪代码）

```text
# 输入：一次构建请求（分支、提交、用途）
function 选择镜像标签(branch, commit, purpose):
    line = branch 去掉 "lucy-v" 前缀              # "0.30"
    product = 读取("VERSION")                     # "0.30.0"
    candidate = 读取("CANDIDATE_VERSION")         # "0.30.0-rc.3"

    if purpose 是 "定稿发布":
        assert branch 已合并进 main
        assert tag 已在 merge commit 上打为 "v" + product
        assert 存在 docs/releases/<product>.json 且 commit 已回填
        return "customer-amd64-" + product + "-" + date + "-" + sha7(product, commit)

    else:                                          # 合并前镜像
        assert product 的主版本段 == line          # 候选不得跨产品线
        n = 递增(CANDIDATE_VERSION)                # 同线内单调 +1，不复用
        assert tag 不以 "v" 开头
        assert tag 不含 "productionReady"
        return "candidate-amd64-" + candidate + "-" + date + "-" + sha7(product, commit)

function 判定交付级别(image_tag):
    if image_tag 以 "customer-" 开头:
        return "定稿发布"      # 可对外称版本号
    if image_tag 以 "candidate-" 开头 and 匹配 "-rc.N-":
        return "合并前候选"    # 只可作升级验证/现场演练
    return "未知"              # 不得作为交付物发出
```

## 7. 落地范围

### 阶段 0｜现状对齐（不改编号机制，先止损）

- 本地 `main` 与 `origin/main` 同步；废弃分支（`lucy-v2.0`、`origin/release/lucy-upgrade-ready-M`）标注归档口径。
- `lucy-v0.25` 尾段归属结论写入 `docs/releases/README.md` 与合并叙述。
- CI push 触发补 `lucy-v0.30`，删除 `lucy-v0.25` 临时触发。

### 阶段 1｜编号机制落地

- 新增根 SSOT `CANDIDATE_VERSION`（内容 `0.30.0-rc.0`）。
- 新增 `docs/releases/candidates/` 目录与候选台账格式。
- 扩展 `scripts/release/lucy-version-governance.mjs`：镜像 tag 正则允许 `-rc.N` 段；新增「候选 tag 必须 `candidate-` 前缀、不得被当作 release tag」的门禁。
- 扩发布工作流：`candidate-` 标签携带 `CANDIDATE_VERSION`；`customer-` 标签只在 tag 路径产出。

### 阶段 2｜文档与手册口径对齐

- `docs/governance/version-matrix.md` §1.1 增补候选版本一轴与更新规则。
- `docs/SYSTEM_HANDBOOK.md` §版本、`deploy/k8s/K8S_CONTRACT.md` 同步镜像 tag 形态。
- `docs/releases/README.md` 增补候选台账说明与 `lint:release-ledger` 的适用范围声明。

### 阶段 3｜0.30 定稿

- 按 §5.3 走合并 → tag → 台账 → UX → `customer-` 镜像。

## 8. 验收标准

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | `lucy-v0.30` 分支上出的**任何**镜像，仅凭 tag 即可判定为「合并前候选」或「定稿发布」，不需要查文档 | 标签形态检查：定稿 tag 必含 `customer-amd64-<product>-<date>-<sha7>`；候选 tag 必含 `candidate-amd64-<product>-rc.N-<date>-<sha7>` |
| SC-02 | 同一产品线内候选号单调递增、不复用 | 候选台账目录内序号连续且无重复 |
| SC-03 | 候选版本不写进 `VERSION` | `npm run lint:version` 通过；`VERSION` 仍为 `0.30.0`，11 处投影逐字相等 |
| SC-04 | 候选不占用发布台账命名空间 | `npm run lint:release-ledger` 通过；`docs/releases/` 顶层无 `v0.30.0-rc.*.json` |
| SC-05 | 候选不被 release tag 正则接受 | `isReleaseTagForVersion("candidate-amd64-0.30.0-rc.1-20261118-abc1234", "0.30.0")` 返回 false |
| SC-06 | `customer-` 前缀只由定稿路径产出 | 候选构建路径不产生 `customer-amd64-` 标签；门禁可拦 |
| SC-07 | 构建修订仍可定位到具体构建 | `/api/health.data.gitSha` 为 40-hex；镜像内 `/app/BUILD_REVISION` 一致 |
| SC-08 | 序关系自洽 | `0.30.0-rc.1 < 0.30.0-rc.2 < 0.30.0`；同线无更低号出现在更晚版本之后 |

## 9. 关联与风险

**关联**

- [`docs/governance/version-matrix.md`](../governance/version-matrix.md) §1.1（产品线与部署制品分别编号）——本条在其「制品独立编号」框架下补上**交付包修订号**这一轴（AGENTS.md 第 37 条已列该轴，但至今没有编号落地）。
- [`docs/governance/release-ci.md`](../governance/release-ci.md) §1／§5（CI 触发面、registry 标签）——阶段 0／阶段 1 改这里。
- [`docs/releases/README.md`](../releases/README.md)（发版台账规则）——候选台账是新增目录，不改老格式。
- [`docs/SYSTEM_HANDBOOK.md`](../SYSTEM_HANDBOOK.md) §版本、`deploy/k8s/K8S_CONTRACT.md`——镜像 tag 形态同步点。
- [`AGENTS.md`](../../AGENTS.md)「部署方式与版本制品解耦（全局原则）」——本条是其在该场景下的具体化，不违反。

**风险**

| 风险 | 后果 | 缓解 |
|---|---|---|
| 已发出的 `customer-amd64-0.30.0-20261117-abb38913` 与将来定稿撞版本段 | 现场沟通时可能把候选当定稿 | 阶段 0 补追溯说明；新规则生效后候选一律 `candidate-` 前缀；历史标签不改（tag／digest 是事实） |
| 候选号被误当发布号对外传播 | 客户按候选号提工单，版本矩阵对不上 | R3 三重禁止（不进 `VERSION`／不占台账／不打 tag）；候选台账写明「非定稿」 |
| `CANDIDATE_VERSION` 与 `VERSION` 双 SSOT 漂移 | 候选镜像标签带错版本段 | 候选号仍由 `VERSION` 派生主版本段（伪代码第 2 步断言 `product` 的主版本段 == 分支号），漂移即门禁红 |
| CI 触发面缺口未补 | 候选镜像无日常门禁背书 | 阶段 0 优先补触发 |
| 补丁位规则悬空 | 定稿后的 hotfix 无处安放 | 见 OQ-4；在批准前，hotfix 暂按「新候选 rc 序列」处理并显式记为偏离（该偏离本身须在台账写明） |
| 本地 `main` 不同步持续复发 | 版本判断反复出错 | 阶段 0 对齐；阶段 2 起版本判断一律以 `origin/main` 为准 |

## 10. 分阶段交付

| 阶段 | 内容 | 产出 | 前置 |
|---|---|---|---|
| 0 | 现状对齐（R-1／R-2／R-3） | 本地 main 同步；分支归档口径；CI 触发面修正 | 无 |
| 1 | 编号机制落地 | `CANDIDATE_VERSION`、`docs/releases/candidates/`、镜像 tag 正则与门禁扩展、发布工作流标签改造 | 阶段 0 |
| 2 | 文档口径对齐 | version-matrix／SYSTEM_HANDBOOK／K8S_CONTRACT／releases README 同步 | 阶段 1 |
| 3 | 0.30 定稿 | 合并 → `v0.30.0` → 台账 → UX → `customer-amd64-0.30.0-...` | 阶段 1／2 |

## 11. 待审阅项

| 编号 | 议题 | 选项 | 建议 |
|---|---|---|---|
| OQ-1 | 小版本的形态 | (a) `X.Y.Z-rc.N`（候选低于定稿，SemVer 先例）｜(b) 补丁位递增 `X.Y.(N+1)`｜(c) 交付修订序号 `X.Y.Z-rN` | **(a)**。(b) 会让「补丁位保持 0」的现状与「定稿号 = 开线号」同时失效，且每次出包要改 11 处投影与新增一份台账；(c) 排序语义弱于 (a) |
| OQ-2 | 合并前镜像是否禁用 `customer-` 前缀 | (a) 禁用，一律 `candidate-`｜(b) 允许但必须带 `-rc.N` | **(a)**。前缀是现场最快的一眼判据；两者并用等于没有判据 |
| OQ-3 | 候选 SSOT 位置 | (a) 仓库根 `CANDIDATE_VERSION`｜(b) 只放 `docs/releases/candidates/` | **(a)**。CI 与脚本需要机器可读单值；照抄 `VERSION` 的既有模式，不引入第二套风格 |
| OQ-4 | 补丁位 hotfix 规则 | (a) 现在就定 `0.30.1` 为真发布（完整台账＋tag）｜(b) 继续冻结 Z=0，hotfix 走新候选 rc 序列 | 待委托人定。(a) 更干净但需同步改 `SYSTEM_HANDBOOK` 与矩阵；(b) 是偏离，须在台账写明 |
| OQ-5 | 候选是否需要 UX 走查记录 | (a) 不需要（候选不是交付物）｜(b) 需要 | **(a)**。UX 走查是定稿放行条件，候选不占用该名额 |
| OQ-6 | `0.30` 定稿后 `lucy-v0.25` 的归宿 | (a) 只接 hotfix（矩阵现行）｜(b) 彻底归档 | 待委托人定；矩阵现行口径是 (a)，本条不擅自改 |
