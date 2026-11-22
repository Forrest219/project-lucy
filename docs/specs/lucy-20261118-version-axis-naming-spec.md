# Lucy 版本轴分工与命名规约 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.3-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-51**／REQ-030-072（发版治理；不入核心分母） |
| 台账号 | REQ-030-072 |
| 阶段 | S1 |
| 状态 | S1｜**v0.3-draft。仅方案落盘：不含运行代码、镜像与 CI 改动；未获开发授权；待 Codex 交叉审阅与委托人终稿确权。测试台 not_registered；不入核心分母；≠ 可上线**（≠ S2：终稿未确权） |
| 决策来源 | 委托人 2026-11-18：大／小版本分工方案；批准评审升版；同日确认采纳「`rc.N`＋交付主键、不把候选写成 `0.31`／正式 `X.Y.Z`」；追加诉求——**开发态候选号不得人工定义，每次出镜像自动分配，并支持后期追溯与客户私有化分叉精确定位**。**仍不进入开发** |
| 评审依据 | 2026-11-18 对话评审；现场证据 [`docs/lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md`](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md)；交付仓 [Forrest219/lucy-customer-delivery](https://github.com/Forrest219/lucy-customer-delivery) Releases（含 `lucy-k8s-integration-20261117-r1`） |
| 适用范围 | 产品线分支命名、合并前候选镜像标签、定稿发布标签、构建修订、**客户交付仓发布后追溯**、**私有化部署分叉定位**、相关台账与门禁口径 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」；[`AGENTS.md`](../../AGENTS.md)「部署方式与版本制品解耦（全局原则）」 |
| 关联现状文档 | [`docs/governance/version-matrix.md`](../governance/version-matrix.md) §1.1／§1.2；[`docs/SYSTEM_HANDBOOK.md`](../SYSTEM_HANDBOOK.md) §版本；[`docs/releases/README.md`](../releases/README.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。给出四轴分工与命名规约、生命周期、落地范围与验收标准。只做方案，终稿未确权，开发未授权 |
| v0.2-draft | 按委托人批准的评审修订：补交付修订号别名与交付仓追溯合同（§2.4／§4.6／SC-09–SC-11）；收紧候选用途边界；修正定稿后 hotfix 过渡口径（不再默认挤占开线 rc）；增 OQ-7／OQ-8；同步交互豁免与阶段划分。**仍不进入开发** |
| v0.3-draft | 委托人确认采纳「`rc.N`＋交付主键」方案（否决候选用 `0.31`／正式 `X.Y.Z`）；新增 **自动分配候选号**（§4.2.1／R10，禁止人工起号）；强化 **私有化分叉定位**（§4.7／SC-12–SC-13）；OQ-1／OQ-7 闭合为已决；OQ-8 升为默认倾向并写进分叉定位依赖。同日补入总账 **P1-51／REQ-030-072**（此前仅有 Spec／Plan，未入池）。**仍不进入开发** |

## 闭口层级

- 层级：功能合同
- 本条承诺：四轴互不代用、交付包可双向定位、候选号与交付主键自动分配、私有化分叉可判定分叉点（逐条如下）。
  1. 产品线号（分支号）、合并前候选版本号、定稿产品版本号、构建修订四者互不代用、互不覆盖；任一构建镜像仅凭标签即可判定「合并前候选」或「定稿发布」，并定位到唯一提交。
  2. 任一已发客户交付包，可在源码候选／定稿台账与交付仓索引之间双向定位到：交付主键、完整 40-hex、钉死的镜像 digest、包 SHA256、是否 `productionReady`、取代关系。
  3. **开发态候选号与交付主键由出包流水线自动分配**，人不选号、不改号；同一次成功出包写入镜像身份、源码台账与（若发放）交付索引。
  4. 客户私有化部署现场，仅凭运行中实例可读身份（或镜像 label／`BUILD_REVISION`），可定位到源码提交，并判定相对产品线 tip／定稿 tag 的**分叉点**（共同祖先与领先／落后提交）。
- 本条出口：SC-01–SC-13。
- 不在本条出口：0.30 功能本身是否做够；定稿号是否升到 `1.0.0`；补丁位 hotfix 规则的最终批准（见 §11 OQ-4）；`v0.2.0`／`v2.0.0` 历史 tag 与 Release 的处置；历史镜像 tag／digest 的改写（只允许补追溯卡，见 §5.5）；客户私有仓**内容**的托管（本条只要求身份可定位，不要求托管客户 fork 源码）。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 产品线号（分支号）、候选版本（rc.N）、定稿版本、构建修订、**交付修订号／交付主键（deliveryId）**、**deployPin digest**。均为发版／交付治理术语。

- 前四者默认**不**进入 WebUI 用户可见营销文案。
- **默认（OQ-8＝(a)，委托人 2026-11-18 诉求「私有化可精确定位分叉」所依赖）**：获开发授权后，`deliveryId`、`candidateVersion`（若有）、完整构建修订与钉死 digest 作为「版本信息」页／`/api/health` 的**只读运维字段**；文案须用既有「版本信息」语义，不得把候选号写成「已发布」。

## 交互合同豁免

- 原因：编号与追溯为主；本条不改变用户可见 WebUI 表面，仅追加只读运维字段（OQ-8）。
- 不改变：页面路由、组件、按钮、布局；既有 `/api/health`／`/api/version`／「版本信息」字段形状。授权后只允许追加只读字段，既有字段语义不变，须独立 Task 与回归，不得夹带功能改动。

## 1. 背景与现状事实

### 1.1 分支与版本实测（2026-11-18，`git branch -a` / `git log` / `git show <ref>:VERSION`）

| 引用 | `VERSION` | tip 提交 / 日期 | 状态 |
|---|---|---|---|
| `lucy-v0.30`（当前分支） | `0.30.0` | `6cc0029c` / 2026-11-18 | 开发中；**无** `v0.30.0` tag；有预 tag 台账占位 `docs/releases/v0.30.0.json`（`commit=PENDING`，`deliveryPackage=null`） |
| `origin/main` | `0.25.0` | `2536a7cb` / 2026-11-07 | 含 `v0.25.0` tag 提交 `e84c9ed4`；落后 `lucy-v0.30` 117 提交 |
| 本地 `main` | `0.20.0` | `99f8c2e1` / 2026-10-24 | **落后 `origin/main` 324 提交**；本地读到的「main 是 0.20.0」是假象 |
| `lucy-v0.25` | `0.25.0` | `9c78b0e3` / 2026-11-10 | tip 提交**未**并入 `origin/main`；但已是 `lucy-v0.30` 的祖先 |
| `lucy-v2.0` | `2.0.0` | `edac5830` / 2026-10-24 | 已废止切线的残留分支 |
| `origin/release/lucy-upgrade-ready-M` | `0.20.0` | `b6a0c03c` / 2026-11-03 | 早期升级准备分支，落后 4 提交 |

拓扑事实：`main` → `lucy-v0.25` → `lucy-v0.30` 是**祖先链**，不是平级分支。`lucy-v0.25` 的 tip 落在 `origin/main` 之后，因此 0.30 合并 main 时会连带带上 0.25 尾段修复。

### 1.2 「多次小幅发版」的真实形态：有事实、无编号、无台账位置

1. `VERSION` 在 `lucy-v0.30` 上自开线起**未再变动**——`git log --follow -- VERSION` 只有一条 `387664a9 chore(version): open lucy-v0.30 product line at 0.30.0`。
2. 因此分支上每一次出包都带**同一个版本段 `0.30.0`**，彼此只能靠 `<YYYYMMDD>-<sha7>` 区分。
3. 实证撞车：2026-11-17 部署到云端演示机／客户升级路径的镜像是 `customer-amd64-0.30.0-20261117-abb38913`（错题本与交付仓 Release `lucy-k8s-integration-20261117-r1`）。它与将来的定稿镜像 `customer-amd64-0.30.0-<date>-<sha7>` **版本段完全相同**，而且带的是 `customer-` 前缀，同时 `productionReady` 仍为 false。
4. 源码台账：`docs/releases/v0.30.0.json` 仅为预 tag 占位（`deliveryPackage=null`），**未**回填已发交付包；候选台账目录尚不存在。
5. 结论：合并前的每次交付都能被追溯到**提交**，但无法被引用为一个**与定稿不撞车的版本号**，源码台账与交付仓也未对齐——这就是「乱」的实质。

### 1.3 交付仓追溯乱点（2026-11-18 对照 [lucy-customer-delivery Releases](https://github.com/Forrest219/lucy-customer-delivery/releases)）

| 编号 | 乱点 | 事实 | 后果 |
|---|---|---|---|
| D-1 | 同产品版本多包 | `0.30.0` 同时对应 `20261113-r1` 与 `20261117-r1`（及更早包） | 按「Lucy 0.30.0」搜不到唯一交付物 |
| D-2 | 三套 tag 不对齐 | GH Release `lucy-k8s-integration-20261117-r1` ≠ 构建 tag `customer-amd64-0.30.0-20261117-abb38913` ≠ 私有仓短 tag `…/lucy-runtime:20261117-r1` | 集群里只见短 tag 时，难回指构建全名与源码 |
| D-3 | digest 三角未钉死 | Release 并列 Config ID／Platform manifest／Index／image ID，未标明部署钉哪一个 | 验收与排障对拍口径漂移 |
| D-4 | 无跨 Release 机器索引 | 信息写在长 Markdown body；仓库无统一 `DELIVERY_INDEX` | 排障靠人工翻页，难在 1 分钟内定位 |
| D-5 | 源码台账与交付仓脱节 | 源码 `v0.30.0.json` 仍 `deliveryPackage=null`；交付仓已发多包 | 「仓库里有没有这包」与「客户现场跑哪包」两套叙事 |

### 1.4 三个与编号无关、但必须一并处理的乱点

| 编号 | 乱点 | 事实 | 后果 |
|---|---|---|---|
| R-1 | 本地 `main` 与 `origin/main` 不同步 | 本地 `main` 落后 324 提交，`VERSION` 仍为 `0.20.0` | 任何基于本地 `main` 的版本判断都不可信 |
| R-2 | `lucy-v0.25` 尾段未并入 main | `9c78b0e3`（2026-11-10）不在 `origin/main` 内，但是 `lucy-v0.30` 的祖先 | 0.30 合并 main 时会连带交付 0.25 尾段修复；合并叙述必须写明 |
| R-3 | CI 触发面缺口 | `.github/workflows/lucy-ci.yml` 的 `on.push.branches` 只有 `main` 与 `lucy-v0.25`（TEMPORARY），**没有 `lucy-v0.30`** | 合并前镜像所在分支没有日常门禁背书 |

### 1.5 既有门禁的硬约束（本方案必须落在约束内）

| 门禁 / 文档 | 约束 | 对本方案的影响 |
|---|---|---|
| `npm run lint:version`（`scripts/release/lucy-version-governance.mjs`） | `VERSION` 必须是纯数字 `X.Y.Z`；11 处投影必须与它**逐字相等** | 候选小版本**不能**写进 `VERSION` |
| `npm run lint:release-ledger` | 当前 `VERSION` 必须有对应台账条目；一版一条；`productionReady` 需要 UX 记录 | 候选版本**不能**占用 `docs/releases/vX.Y.Z.json` |
| 镜像 tag 正则 | `isCustomerImageRefForVersion`／`isReleaseTagForVersion` 面向 `customer-…` | 候选 tag 须用 `candidate-` 前缀，不进入发布命名空间 |
| `docs/SYSTEM_HANDBOOK.md` §版本 | 补丁段在矩阵另定规则前保持 `0` | 补丁位不能拿来当开线期「小版本」 |
| `docs/releases/README.md` | 台账扫描 `readdirSync` **非递归** | 候选台账放 `docs/releases/candidates/` 不会被误扫 |

## 2. 决策摘要

**一句话：大版本＝合并 main 时锁定的产品线号（同分支名，如 `0.30`）；开发态候选＝`X.Y.Z-rc.N`（**出包自动分配，禁止人工起号**，不写进 `VERSION`）；对外主键＝自动分配的 `lucy-k8s-integration-YYYYMMDD-rN`；定稿才产出 `customer-`；追溯靠交付索引＋钉死 digest＋运行时只读身份，支撑私有化分叉定位。**

**已决（委托人 2026-11-18）**

| 议题 | 决定 |
|---|---|
| 合并 main 的身份 | 大版本／产品线号，与分支名对齐（`0.30`、`0.35`…） |
| 合并前镜像身份 | 开发态候选 `0.30.0-rc.N`＋交付主键；**不是** `0.31`／正式 `X.Y.Z` |
| 谁分配候选号 | **流水线自动**；人不定义、不手改序列 |
| 追溯底线 | 后期可查；私有化现场可精确定位分叉（共同祖先） |

### 2.1 四轴分工表

| 轴 | 名称 | 形态 | 载体（SSOT） | 谁定 / 何时变 | 语义 | 禁止 |
|---|---|---|---|---|---|---|
| **大版本** | 产品线号（分支号） | `X.Y`（现 `0.30`） | 分支名 `lucy-vX.Y` ＋ `VERSION` 的 `X.Y` 段 | 开线时一次性决定 | 「这批能力属于哪一代产品」 | 不得中途改分支号 |
| **小版本** | 候选版本（合并前镜像） | `X.Y.Z-rc.N` | 根文件 `CANDIDATE_VERSION` ＋ 镜像 tag 段 ＋ `docs/releases/candidates/` | **每次成功出候选镜像由流水线自动 N+1**（见 §4.2.1） | 「这是合并前的第几个候选」 | 不得人工起号／跳号／改号；不得带 `customer-`；不得打 `v*`；不得 `productionReady`；不得写进 `VERSION` |
| **定稿版本** | 产品版本 | `X.Y.Z` | `VERSION` ＋ Chart／values 投影 ＋ `vX.Y.Z` tag ＋ `docs/releases/vX.Y.Z.json` | 合并到 main 后锁定 | 「这是可交付的正式版本」 | 不得复用已发号；定稿前不得宣称可上线 |
| **构建修订** | 构建修订（**不是版本**） | 40-hex commit | `/app/BUILD_REVISION`、`/api/health.data.gitSha` | 每次构建自动产生 | 「具体是哪一次构建」 | 不得当版本用；不表达大小序 |

### 2.2 交付修订号（别名轴，不是第五个产品版本）

| 项 | 口径 |
|---|---|
| 形态 | 交付主键 `deliveryId`＝`lucy-k8s-integration-YYYYMMDD-rN`（与现行交付仓 Release tag 同形） |
| 回答 | 「客户／现场领到的是哪一包」——**对外口头与工单的默认主键**（OQ-7 默认 (a)） |
| 与 rc 关系 | 每个发出的合并前交付包必须在候选台账与交付索引中同时写：`candidateVersion`（`X.Y.Z-rc.N`）与 `deliveryId`；二者互为别名，禁止只记一侧 |
| 与定稿关系 | 定稿交付包仍用 `deliveryId`；另绑 `productVersion`＋`vX.Y.Z`；不得再用新的开线期 `rc.N` 冒充定稿 |
| 私有仓短 tag | 必须与 `deliveryId` 的日期－修订段同形或可机械推导（例：`…/lucy-runtime:20261117-r1` ↔ `lucy-k8s-integration-20261117-r1`） |

### 2.3 命名形态

| 对象 | 现状 | 建议 |
|---|---|---|
| 产品线分支 | `lucy-v0.30` | 不变 |
| **合并前镜像** | `customer-amd64-0.30.0-20261117-abb38913`（与定稿撞版本段） | `candidate-amd64-0.30.0-rc.N-<YYYYMMDD>-<sha7>` |
| **定稿镜像** | `customer-amd64-0.30.0-<date>-<sha7>` | 不变（**只有**定稿 tag 路径能产出 `customer-`） |
| 定稿 tag | `v0.30.0` | 不变 |
| 对外交付主键 | `lucy-k8s-integration-20261117-r1` | **保留**为短期对外主键；与 `rc.N` 双向别名 |
| 候选台账 | 无 | `docs/releases/candidates/0.30.0-rc.N.json`（含 `deliveryId`） |
| 候选 SSOT | 无 | 仓库根 `CANDIDATE_VERSION` |
| 交付仓索引 | 无（仅 Release Markdown） | `Forrest219/lucy-customer-delivery` 根（或约定路径）`DELIVERY_INDEX.json` ＋ 每包 `delivery-manifest.json` |

### 2.4 可判定规则

- **R1 前缀即语义**：`customer-` 只由定稿 tag 路径产出；合并前镜像一律 `candidate-`。
- **R2 候选号单调**：合并前镜像 tag 必须含 `-rc.N`，同产品线内单调 +1，不复用、不跳回。
- **R3 候选不是发布**：候选不写进 `VERSION`、不占顶层 `docs/releases/vX.Y.Z.json`、不打 `v*`、不得 `productionReady`。
- **R4 定稿四步**：合并 main → annotated tag `vX.Y.Z` → 台账＋UX → tag run 产出 `customer-amd64-…`。
- **R5 序关系**：`X.Y.Z-rc.1 < … < X.Y.Z`；交付修订号只表达发放次序，**不**单独充当产品版本大小序。
- **R6 修订不参与大小序**：构建修订只定位构建。
- **R7 对外主键**：工单／现场沟通默认引用 `deliveryId`；需要源码序时再展开为 `rc.N` 或定稿 `X.Y.Z`。
- **R8 双向指针**：源码候选／定稿台账 ↔ 交付仓 index／manifest 必须互指；缺一侧视为追溯合同未闭合。
- **R9 deployPin**：每个交付包只钉死**一种**镜像 digest 为 `deployPin`；其余 digest 标 `alsoKnown`，不得并列争锋。
- **R10 自动起号**：候选 `rc.N` 与（若发放）`deliveryId` 的修订序号**只能**由出包／发放流水线根据已存在台账／索引单调分配；禁止在 PR 说明、口头约定或手工改 `CANDIDATE_VERSION` 来「定义下一版是几」。手工改号视为门禁失败。
- **R11 身份入库**：一次成功候选构建必须在同一流水线步骤内写齐——镜像 tag／label、`CANDIDATE_VERSION` 提交回仓库（或等价机器状态）、候选台账行、完整 40-hex；若同步发放交付仓，同步写 `deliveryId` 与 index。禁止「先出镜像、稍后再补号」。

## 3. 目标与非目标

**目标**

1. 给「合并前镜像」可引用、单调、与定稿不撞号的源码候选编号。
2. 让「候选还是定稿」成为标签层面可判定事实。
3. 大版本（分支号）保持不变；合并 main 时锁定定稿。
4. 保留门禁语义：`VERSION`＝产品身份、镜像 tag＝制品身份、commit＝构建身份。
5. **候选号与交付主键自动分配**，人不定义。
6. 「客户在跑哪一包」可从交付索引或运行时字段约 1 分钟定位到 commit 与 digest。
7. 私有化部署可精确定位相对产品线／定稿的**分叉点**。

**非目标**

1. 不改 `0.30` 功能范围，本草案轮次**不动任何运行代码**（委托人 2026-11-18 明示）。
2. 不在本条内决定 `1.0.0` 的产品含义。
3. 不回溯改写既有 tag／Release／digest 历史事实。
4. 不改 `docs/releases/` 既有定稿台账**文件格式**（候选目录与交付索引为新增）。
5. 不在本条内最终批准补丁位规则（OQ-4）；只规定未批前的过渡口径（§5.4）。
6. 不托管客户私有 fork 的源码内容；只保证**身份与分叉点可计算**（在供应方仍持有对应 commit 对象或等价镜像内 revision 时）。

## 4. 四轴与交付追溯细则

### 4.1 大版本＝产品线号（分支号）

- **形态**：`X.Y`。当前 `0.30`，分支 `lucy-v0.30`。
- **它回答**：这批能力属于哪一代产品。
- **变更条件**：只在新开产品线时变更；新线从**最新的 `origin/main`** 开。
- **现状符合度**：本轴无需改动。

### 4.2 小版本＝候选版本（合并前镜像）

- **形态**：`X.Y.Z-rc.N`，N 从 1 递增。
- **载体**：`CANDIDATE_VERSION`；镜像 tag 段；`docs/releases/candidates/X.Y.Z-rc.N.json`。
- **候选台账必填**：`productVersion`、`candidateVersion`、`deliveryId`（若已发交付包）、分支、完整 40-hex、`imageBuildTag`、`deployPin`（种类＋值）、包 SHA256（若有）、门禁摘要、用途、`productionReady: false`、`customerDeliveryReleaseUrl`（若有）、`productLineRef`（如 `lucy-v0.30`）、`mergeBaseWithMain`（出包时相对 `origin/main` 的 merge-base，40-hex，可空但推荐）。
- **用途边界（收紧，相对 v0.1）**：
  - **默认可用于**：内部验证、演示机、升级演练机。
  - **不得**作为客户正式交付物、不得写入对外「已发布」叙事、不得进 `docs/releases/ux/`。
  - **进入客户生产／准生产**：必须另有「受控候选放行」记录（用途、回滚点、`productionReady=false`、私有仓 tag、批准人）；无该记录不得把候选当现场默认包。
  - 11-17 事故表明：带 `customer-` 前缀且进现网的未定稿包会被当成「0.30 已发」——本条用前缀分流＋用途边界同时堵住。

### 4.2.1 自动分配（禁止人工定义候选号）

**原则**：开发态候选号是**构建副作用**，不是产品经理／发布经理填写的字段。

**候选 `rc.N` 算法（源码仓）**

1. 出包 job 以当前产品线分支为输入；读取已存在的 `docs/releases/candidates/X.Y.Z-rc.*.json` 与根 `CANDIDATE_VERSION`。
2. `N = max(已存在 N, CANDIDATE_VERSION 中的 N, 0) + 1`；写回 `CANDIDATE_VERSION=X.Y.Z-rc.N`。
3. 用该 N 生成镜像 tag、台账文件名与（可选）镜像 label；**同一 job 内**提交台账＋`CANDIDATE_VERSION`（或通过受控 bot 提交），失败则整次出包失败、不推送「无号」镜像。
4. 并发：同一产品线同时只允许一个「分配＋发布」临界区（CI concurrency group 或文件锁）；抢锁失败则重试或失败，禁止两 job 分到同一 N。
5. **禁止**：在 issue／聊天里约定「这次叫 rc.5」；禁止手工编辑 `CANDIDATE_VERSION` 后跳过分配器；禁止复用失败构建已占用但未入库的 N（失败且未入库则可回收，须在分配器状态机写明）。

**交付主键 `deliveryId` 算法（发放到交付仓时）**

1. `YYYYMMDD`＝发放日（UTC 或约定 Asia/Shanghai，写死一种）。
2. `rN`＝当日 index 内已有同前缀最大 N＋1（跨产品线共用日历序号即可；或按 `productVersion` 分桶——实现时选一种并钉死）。
3. 生成 `lucy-k8s-integration-YYYYMMDD-rN`；写入 manifest／index／回填源码台账。
4. 同样禁止人工「指定 r3」；人只触发「发放」，不填号。

**人允许做的事**：触发出包／发放、填写用途与受控放行元数据（非号码）、查阅追溯。  
**人不允许做的事**：选择或修改 `rc.N`／`rN`。

### 4.3 定稿版本＝产品版本

- **形态**：`X.Y.Z`。当前 `0.30.0`。
- **锁定时机**：合并到 main 之后；定稿不是改号，而是给已有号打 tag 与台账。
- **交付回填**：定稿台账的 `deliveryPackage` 必须在发出客户包后回填（digest、包 SHA、`deliveryId`、交付仓 URL）；不得长期保持「现场已发、台账 null」。

### 4.4 构建修订（不是版本）

- **形态**：40-hex；可见文本前 12 位；完整值在 `/app/BUILD_REVISION` 与 `/api/health.data.gitSha`。
- **禁止**用 commit 比版本新旧。

### 4.5 分工边界速查

| 场景 | 用哪个号 | 不用什么号 |
|---|---|---|
| 「这批功能属于哪一代产品？」 | 产品线号 `0.30` | commit、rc.N、deliveryId |
| 「源码仓第几个合并前候选？」 | `0.30.0-rc.N` | 仅 deliveryId（可作别名查找） |
| 「客户／工单说领了哪一包？」 | **deliveryId** | 单独的 `VERSION` |
| 「能不能对外说『0.30 已发布』？」 | 定稿 `0.30.0` ＋ `v*` tag ＋台账 | rc.N、未回填的占位台账 |
| 「现场构建对应哪个提交？」 | 构建修订（40-hex） | 任何版本号单独 |
| 「两个**定稿**包哪个更新？」 | 产品版本序 | commit 时间戳、deliveryId 日期臆断 |
| 「两个**候选／发放**包哪个更新？」 | 同线 `rc.N` 序；或同产品线下 delivery 发放记录的取代链 | 把 deliveryId 当 SemVer |

### 4.6 交付仓追溯合同

**适用范围**：[Forrest219/lucy-customer-delivery](https://github.com/Forrest219/lucy-customer-delivery)（及未来同等角色的客户交付发布面）。

**最低要求**

1. **索引**：维护机器可读 `DELIVERY_INDEX.json`（路径可在交付仓 README 钉死）。每条至少含：

| 字段 | 含义 |
|---|---|
| `deliveryId` | 对外主键 |
| `productVersion` | `X.Y.Z` |
| `candidateVersion` | `X.Y.Z-rc.N` 或定稿后的 `null` |
| `channel` | `pre-ga-candidate`／`ga`／`post-ga-hotfix-candidate` |
| `sourceCommit40` | 完整 40-hex |
| `imageBuildTag` | 构建全名 tag |
| `registryRetag` | 私有仓短 tag（若有） |
| `deployPin` | `{ kind, digest }`，仅一种钉死 |
| `alsoKnownDigests` | 可选数组 |
| `packageSha256` | 外层包 |
| `chartVersion` | Chart 包版本 |
| `productionReady` | boolean |
| `supersedes`／`supersededBy` | 取代链 |
| `sourceLedgerPath` | 源码仓相对路径（候选或定稿台账） |

2. **每包附件**：GitHub Release **必须**附 `delivery-manifest.json`（与 index 单条同构），不得只依赖 Release body Markdown。
3. **README 顶栏**：固定两行——「当前推荐 deliveryId」与「上一稳定回滚 deliveryId」，并链到 index。
4. **digest 口径**：文档与验收脚本只对拍 `deployPin`；禁止口头混用三种 sha256 而不声明种类。
5. **历史包**：已发 `customer-amd64-0.30.0-*` 合并前包**不改** tag／digest；在源码 `docs/releases/candidates/` **与**交付 index **各补追溯卡**（channel=`pre-ga-candidate`，注明非定稿、对应 GH Release、是否被取代）。

**排障标准路径**

```text
集群 image / 短 tag
  →（若有）/api/health.deliveryId 或镜像 label
  → DELIVERY_INDEX / delivery-manifest
  → sourceCommit40 + deployPin + sourceLedgerPath
  → 源码台账 / git show
```

### 4.7 私有化部署与分叉精确定位

**诉求**：客户私有化部署后，即使现场改过 values／旁路补丁／甚至基于交付包衍生私有镜像，供应方仍能回答「相对官方产品线，分叉点在哪」。

**最低身份（须打进候选与定稿镜像）**

| 字段 | 来源 | 用途 |
|---|---|---|
| `BUILD_REVISION`／`gitSha` | 已有 | 精确定位构建提交（40-hex） |
| `productVersion` | `VERSION` | 产品线定稿号意图 |
| `candidateVersion` | 自动 `rc.N`（定稿镜像可空或固定标 GA） | 开发态序号 |
| `deliveryId` | 自动（若曾发放） | 对外主键 |
| `imageBuildTag` | 构建全名 | 与 registry 对拍 |
| `productLineRef` | 如 `lucy-v0.30` | 所属产品线分支 |

以上在 OQ-8 落地后经 `/api/health` 与「版本信息」只读暴露；镜像 OCI label／`/app` 内元数据文件作为离线兜底（集群无法打 health 时仍可读）。

**分叉定位算法（供应方侧，只读）**

```text
现场 revision = 从 health / 镜像文件读到的 40-hex
对照 ref =
  若已定稿且现场 productVersion 有 vX.Y.Z tag → 该 tag
  否则 → origin/lucy-vX.Y tip（或台账记录的 productLineRef）
分叉点 = git merge-base(现场 revision, 对照 ref)   # 若对象在供应方 git 中可得
领先 = 对照 ref 有而现场没有的提交
落后／私有 = 现场有而对照 ref 没有的提交
```

- 若现场 revision **不在**供应方 git 对象库：仍可用 `deliveryId`／`deployPin` 证明「基于哪一包」；分叉点记为「基于 deliveryId＝… 的私有衍生，对象不可达」，不得假装算出版本序。
- 台账在出包时记录 `mergeBaseWithMain`（可选增强），便于 main 已快进后仍解释「当时相对 main 的位置」。
- **不要求**客户开放私有 git；定位输入只来自运行中身份或镜像元数据＋供应方持有的官方历史。

## 5. 生命周期与落地形态

### 5.1 开线

1. 从最新 `origin/main` 开分支 `lucy-vX.Y`。
2. `VERSION` 置 `X.Y.0`；`CANDIDATE_VERSION` 置 `X.Y.0-rc.0`（尚无候选）。
3. `npm run lint:version` 确认 11 处投影一致。

### 5.2 开发期出包（合并前镜像）

1. **触发出包**（人只点「构建／发放」，不填号）。
2. 分配器按 §4.2.1 自动得到 `X.Y.Z-rc.N`，写回 `CANDIDATE_VERSION`＋候选台账（含 `mergeBaseWithMain`、完整 40-hex）。
3. 构建并推送 `candidate-amd64-X.Y.Z-rc.N-<YYYYMMDD>-<sha7>`；写入镜像 label／元数据（§4.7）。
4. 若发放到交付仓：分配器自动生成 `deliveryId`、写 manifest、更新 `DELIVERY_INDEX`、回填双向指针；`channel=pre-ga-candidate`。
5. **不**打 `v*`、**不**进顶层定稿台账、**不**声明 `productionReady`。
6. 任一步失败：不留下「半套号」（无台账的已推送候选 tag 须在 job 失败处理里删除或标记作废）。

### 5.3 定稿

1. 功能闭口通过 → 合并到 `main`。
2. annotated tag `vX.Y.Z`。
3. 写／回填 `docs/releases/vX.Y.Z.json` 与 UX 记录。
4. tag run 产出 `customer-amd64-X.Y.Z-<YYYYMMDD>-<sha7>`。
5. 交付仓发 GA 包：`channel=ga`，`candidateVersion=null`，回填定稿台账 `deliveryPackage`。
6. `CHANGELOG.md` Unreleased 段转正。

### 5.4 定稿后的同线修复（hotfix）

- **目标态（OQ-4＝(a)）**：补丁位 `X.Y.(Z+1)` 真发布（完整台账＋tag＋UX），**不进**开线期 rc 序列。
- **未批准 OQ-4 前的过渡（相对 v0.1 修正）**：
  - **禁止**把定稿后紧急包挤进开线期 `rc.N` 序列冒充「还没定稿」。
  - 允许发放 `channel=post-ga-hotfix-candidate` 的交付包：仍用新的 `deliveryId`，镜像前缀按当时授权（默认可继续 `candidate-` 直至补丁位获批），台账显式写明「定稿后临时包、非 SemVer 升版」。
  - 一旦 OQ-4＝(a) 获批，后续修复改走 `X.Y.(Z+1)` 真发布。

### 5.5 现状对齐（阶段 0）

- R-1／R-2／R-3：同 v0.1（main 同步、0.25 尾段归属、CI 触发面）。
- D-1…D-5：为已发 `20261113-r1`／`20261117-r1` 等补源码候选追溯卡＋交付 index 条目（不改历史 tag／digest）。
- 明确：`docs/releases/v0.30.0.json` 占位≠已发布；已发交付包不得假装已被该台账覆盖。

## 6. 核心流程（伪代码）

```text
function 自动分配候选号(productLine):
    lock(productLine)
    n = max(已入库 rc, 读 CANDIDATE_VERSION, 0) + 1
    写 CANDIDATE_VERSION = product + "-rc." + n
    写 candidates/{product}-rc.{n}.json 骨架（commit、mergeBaseWithMain…）
    unlock
    return CANDIDATE_VERSION   # 人不得传入 n

function 选择镜像标签(branch, commit, purpose):
    line = branch 去掉 "lucy-v" 前缀
    product = 读取("VERSION")

    if purpose 是 "定稿发布":
        assert 已合并 main 且存在 "v" + product
        return "customer-amd64-" + product + "-" + date + "-" + sha7(commit)

    candidate = 自动分配候选号(line)   # 禁止读取「人手填的下一号」
    assert product 主版本段 == line
    return "candidate-amd64-" + candidate + "-" + date + "-" + sha7(commit)

function 发放交付包(image_tag, channel):
    deliveryId = 自动分配 "lucy-k8s-integration-" + YYYYMMDD + "-r" + (当日最大+1)
    deployPin = 钉死一种 digest
    写 delivery-manifest.json 与 DELIVERY_INDEX.json
    回填源码台账 .deliveryId
    assert productionReady == false 若 channel != "ga"
    return deliveryId

function 排障定位(runtime_hint):
    row = 查 DELIVERY_INDEX 或 源码台账
    return row.sourceCommit40, row.deployPin, row.sourceLedgerPath

function 分叉定位(runtime_revision, productLineRef):
    base = merge-base(runtime_revision, 对照 ref(productLineRef))
    return base, ahead_commits, private_only_commits
```

## 7. 落地范围

### 阶段 0｜现状对齐（先止损；可含只读／文档追溯卡）

- 本地 `main` ↔ `origin/main`；0.25 尾段归属；CI 触发面待批清单。
- 历史交付包双向追溯卡（源码 `candidates/` 说明＋交付仓 index 草案字段表）；**不改**历史 tag／digest。

### 阶段 1｜编号机制＋自动分配器落地（需开发授权）

- `CANDIDATE_VERSION`、`docs/releases/candidates/`、镜像 tag 正则与门禁、发布工作流 `candidate-`／`customer-` 分流。
- **分配器**：出包 job 自动 `rc.N`（§4.2.1）；concurrency 锁；禁止手工改号门禁；身份入库同 job（R11）。

### 阶段 1b｜交付仓追溯＋自动 `deliveryId`（需开发授权；可与阶段 1 并行）

- 交付仓 `DELIVERY_INDEX.json`、Release 附 `delivery-manifest.json`、README 顶栏、`deployPin`；源码台账强制 `deliveryId`。
- **发放时自动**分配 `YYYYMMDD-rN`，人不填号。

### 阶段 2｜文档与手册口径对齐

- `version-matrix`／`SYSTEM_HANDBOOK`／`K8S_CONTRACT`／`releases/README`；交付仓 README；分叉定位 runbook 短节。

### 阶段 2b｜运行时交付身份（OQ-8＝(a) 默认；需开发授权）

- 构建写入 §4.7 字段（label／`/app` 元数据）；`/api/health` 与「版本信息」追加只读字段；回归锁既有字段不变。

### 阶段 3｜0.30 定稿

- 按 §5.3；交付仓 GA 包与定稿台账 `deliveryPackage` 回填同次完成。

## 8. 验收标准

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| SC-01 | 任一构建镜像仅凭 tag 可判定候选／定稿 | `candidate-amd64-…-rc.N-…` vs `customer-amd64-…` |
| SC-02 | 同线候选号单调、不复用 | 候选台账序号连续 |
| SC-03 | 候选不写进 `VERSION` | `lint:version`；11 处投影相等 |
| SC-04 | 候选不占顶层发布台账 | `lint:release-ledger`；顶层无 `*-rc.*.json` |
| SC-05 | 候选不被 release tag 正则接受 | `isReleaseTagForVersion(candidate-…)=false` |
| SC-06 | `customer-` 只由定稿路径产出 | 门禁可拦 |
| SC-07 | 构建修订可定位 | `gitSha` 与 `/app/BUILD_REVISION` 一致为 40-hex |
| SC-08 | 序关系自洽 | `rc.1 < rc.2 < 定稿` |
| SC-09 | 任一已发交付包 1 分钟内可定位 | 凭 `deliveryId` 或 index：产品版本、rc 或 GA、40-hex、`deployPin`、包 SHA256、`productionReady`、取代链、源码台账路径均非空（历史补卡允许 `productionReady=false`） |
| SC-10 | 源码台账 ↔ 交付仓双向指针 | 任一侧有 `deliveryId` 则另一侧可反查；缺一侧失败 |
| SC-11 | 候选进客户生产须有受控放行记录 | 无记录则用途字段不得为「客户生产」；抽查 11-17 类包须标 `pre-ga-candidate` |
| SC-12 | 候选号／交付主键自动分配，禁止人工定义 | 连续两次出包 N 单调 +1；分配器单测覆盖并发与失败回收；对「手改 `CANDIDATE_VERSION` 后出包」门禁失败；出包参数不允许传入 `rc`／`rN` |
| SC-13 | 私有化分叉可定位 | 给定含 §4.7 身份的现场实例（或镜像元数据）：能得出 `sourceCommit40`；在对象可达时给出 `merge-base` 与 ahead／private-only 摘要；对象不可达时明确「基于 deliveryId＝… 的私有衍生」而非静默失败 |

## 9. 关联与风险

**关联**

- [`docs/governance/version-matrix.md`](../governance/version-matrix.md) §1.1
- [`docs/governance/release-ci.md`](../governance/release-ci.md)
- [`docs/releases/README.md`](../releases/README.md)
- [`docs/SYSTEM_HANDBOOK.md`](../SYSTEM_HANDBOOK.md)、`deploy/k8s/K8S_CONTRACT.md`
- [`AGENTS.md`](../../AGENTS.md)「部署方式与版本制品解耦」
- 交付仓 [Forrest219/lucy-customer-delivery](https://github.com/Forrest219/lucy-customer-delivery)
- 错题 [`docs/lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md`](../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md)

**风险**

| 风险 | 后果 | 缓解 |
|---|---|---|
| 历史 `customer-amd64-0.30.0-*` 与定稿撞版本段 | 现场混淆 | 追溯卡＋新规则 `candidate-`；历史不改 |
| `rc.N` 与 `YYYYMMDD-rN` 双编号无别名 | 排障更乱 | R7／R8；台账强制双写 |
| 候选进现网无放行记录 | 重复 11-17 叙事混乱 | §4.2 收紧＋SC-11 |
| 人工起号／口头约定 rc | 序列漂移、无法追溯 | R10／R11／SC-12；出包参数禁传号 |
| 并发出包抢同一 N | 撞号 | CI concurrency／锁；分配器单测 |
| 定稿后 hotfix 挤占 rc | 语义崩溃 | §5.4 过渡改走 `post-ga-hotfix-candidate` |
| digest 多值并列 | 对拍失败 | R9 `deployPin` |
| 交付仓只有 Markdown | 难检索 | 阶段 1b index＋manifest |
| 现场无运行时身份 | 私有化分叉难算 | 阶段 2b（OQ-8＝(a)）＋镜像内元数据兜底 |
| 现场 revision 不在供应方 git | 无法算 merge-base | §4.7：退化为「基于 deliveryId 的私有衍生」 |
| 补丁位规则悬空 | 真发布路径不清 | OQ-4；过渡口径已写明 |
| 本地 `main` 不同步 | 误判 | 阶段 0；判断以 `origin/main` 为准 |

## 10. 分阶段交付

| 阶段 | 内容 | 产出 | 前置 |
|---|---|---|---|
| 0 | 现状对齐＋历史追溯卡（文档） | main 同步口径；0.25 归属；CI 待批清单；历史包双端追溯说明 | 无 |
| 1 | 源码候选编号＋**自动分配器** | `CANDIDATE_VERSION`、candidates／、门禁、工作流、分配锁 | 开发授权＋D-1 |
| 1b | 交付仓追溯＋**自动 deliveryId** | `DELIVERY_INDEX`、manifest、README 顶栏、台账联动 | 开发授权＋D-4 |
| 2 | 文档口径＋分叉定位短 runbook | matrix／handbook／K8S／releases README | 阶段 1 |
| 2b | 运行时／镜像内身份（私有化分叉依赖） | health／版本信息／label | 开发授权＋D-5（默认 (a)） |
| 3 | 0.30 定稿 | tag、台账、UX、`customer-` 镜像、GA 交付回填 | 阶段 1／1b／2＋D-3 |

## 11. 待审阅项

| 编号 | 议题 | 选项 | 状态／决定 |
|---|---|---|---|
| OQ-1 | 小版本形态 | (a) `X.Y.Z-rc.N`｜(b) 补丁位递增｜(c) 仅交付 `rN` | **已决 (a)**（委托人 2026-11-18 确认；否决候选用 `0.31`／正式 `X.Y.Z`） |
| OQ-2 | 合并前是否禁用 `customer-` | (a) 禁用｜(b) 允许但带 `-rc.N` | **建议 (a)**（待终稿一并确认） |
| OQ-3 | 候选 SSOT | (a) 根 `CANDIDATE_VERSION`｜(b) 只放 candidates／ | **建议 (a)**（分配器需要单值） |
| OQ-4 | 补丁位 hotfix | (a) `0.30.1` 真发布｜(b) 继续冻 Z=0 | **倾向 (a)**。未批前走 §5.4，**不**挤占开线 rc |
| OQ-5 | 候选 UX 走查 | (a) 不需要｜(b) 需要 | **建议 (a)** |
| OQ-6 | `lucy-v0.25` 归宿 | (a) 只接 hotfix｜(b) 彻底归档 | 待定；矩阵现行 (a) |
| OQ-7 | 对外交付主键 | (a) `lucy-k8s-integration-YYYYMMDD-rN`｜(b) 对外改挂 `rc.N` | **已决 (a)**（委托人确认工单／现场用交付主键；rc 为源码序） |
| OQ-8 | 运行时暴露交付身份 | (a) health／版本信息＋镜像元数据｜(b) 只靠交付仓 index | **默认 (a)**（私有化分叉定位依赖；须开发授权后实现） |
| OQ-9 | 自动分配时区／当日 rN 分桶 | (a) Asia/Shanghai 日历＋全局当日序号｜(b) UTC｜(c) 按 productVersion 分桶 | **建议 (a)**；实现前钉死一种 |
