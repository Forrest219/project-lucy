# Lucy 版本轴分工与命名规约 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Plan / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 状态 | **v0.1-draft。方案稿：Task 全部未开工；未获开发授权；未改运行代码、镜像与 CI。终稿未确权** |
| 授权边界 | **本 Plan 只授权「读代码与只读核实」**；任何写运行代码、改镜像标签逻辑、改 CI 工作流、改 `VERSION` 投影的动作，须委托人先批准 Spec 终稿并单独授权。本轮交付物＝方案文档本身 |
| 验收 | 见 §「验收」（SC-01–SC-08 与阶段 0 的三条现状对齐事实） |
| 配对 Spec | [`docs/specs/lucy-20261118-version-axis-naming-spec.md`](../specs/lucy-20261118-version-axis-naming-spec.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」；[`AGENTS.md`](../../AGENTS.md)「部署方式与版本制品解耦（全局原则）」 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。配合 Spec v0.1-draft 落盘 Task 分解、验收与回滚口径；全部 Task 未开工 |

## 1. 目标（Context for Developer）

**问题**：0.30 产品线在开发期出过多次合并前镜像，但 `VERSION` 自开线起未变动，导致每个合并前镜像与将来的定稿镜像**版本段完全相同**（实证：`customer-amd64-0.30.0-20261117-abb38913`）。现场无法回答「客户在跑第几版」，台账也没有位置记录这些交付。

**目标**：在不改动 `0.30` 功能范围的前提下，建立四条互不代用的版本轴——产品线号（分支号）／候选版本（合并前镜像）／定稿产品版本／构建修订——并让「这是候选还是定稿」成为标签层面的可判定事实。

**产出**：可执行、可回滚的编号机制 ＋ 与之对齐的文档口径 ＋ 一次按新口径走完的 0.30 定稿。

**不在本 Plan 范围**：0.30 功能本身；`1.0.0` 的产品含义；历史 `v0.2.0`／`v2.0.0`／`v0.20.0`／`v0.25.0` 事实的改写；补丁位 hotfix 规则的最终批准（Spec §11 OQ-4）。

## 2. 开工前置（Non-negotiable boundaries）

**以下边界不可协商，越界即停并回报委托人：**

1. **不改 `VERSION` 语义**。`VERSION` 仍是产品身份与定稿号；候选版本号**永远不**写进 `VERSION`、`package.json`、`Chart.appVersion`、`values.lucy.version`、`values.image.tag` 与三处 fallback。`npm run lint:version` 的 11 处投影必须逐字相等。
2. **不占用发布台账命名空间**。候选台账只进 `docs/releases/candidates/`；`docs/releases/` 顶层仍只放 `vX.Y.Z.json`。不改既有台账文件格式。
3. **不改历史事实**。已发出的 tag、GitHub Release、镜像 digest、已归档的 `v0.2.0`／`v2.0.0` 一律不动。合并前镜像的历史标签**不重打**，只补追溯说明。
4. **候选不得冒充发布**。候选镜像不带 `customer-` 前缀、不打 `v*` tag、不声明 `productionReady`、不写进对外 release notes、不进 `docs/releases/ux/`。
5. **`customer-` 前缀只由定稿 tag 路径产出**。日常／PR 构建只产出 `candidate-`。
6. **不碰 0.30 功能代码与功能范围**。本 Plan 只动发版治理面（版本文件、发布脚本、CI 工作流、文档）。
7. **不单方面启用补丁位**。`0.30.1` 在 OQ-4 获批前不启用。
8. **未获开发授权不改运行代码**。本 Plan 当前状态为「方案稿」，所有 Task 的写操作须等委托人批准。

**开工裁决点**（须委托人明示才可进入执行）：

| 裁决 | 内容 | 阻塞的 Task |
|---|---|---|
| D-1 | 采纳 Spec §2 的四轴分工与命名形态（尤其 `X.Y.Z-rc.N` 与 `candidate-` 前缀） | Task 1 全部 |
| D-2 | OQ-4 补丁位 hotfix 规则（`0.30.1` 是否为真发布） | Task 2 的 §2.4 段落 |
| D-3 | 0.30 定稿时点与合并窗口 | Task 3 |

## 3. Task 分解

### Task 0｜现状对齐（先止损，不依赖 D-1）

- **Files**：
  - 只读核对（无改动）：`git branch -a`、`git show origin/main:VERSION`、`git log --follow -- VERSION`
  - 文档改动：`docs/releases/README.md`（补 0.25 尾段归属说明）、`docs/governance/release-ci.md`（CI 触发面口径）
- **Step 1**：确认本地 `main` 与 `origin/main` 的偏差，并把本地 `main` 快进到 `origin/main`（不改任何文件内容）。
- **Step 2**：在 `docs/releases/README.md` 增补一段：`lucy-v0.25` 在 `v0.25.0` tag 之后的尾段（`9c78b0e3` 等，2026-11-10 之前）**不单独发布**，随 0.30 交付；并写明 `lucy-v0.25` 是 `lucy-v0.30` 的祖先。
- **Step 3**：核对 `.github/workflows/lucy-ci.yml` 的 `on.push.branches` 是否覆盖当前产品线分支；把「删除已失效的 `lucy-v0.25` 临时触发」写进待批清单（该项属 CI 改动，须 D-1 后随 Task 1 一起执行）。
- **Expected**：`origin/main` 的 `VERSION` 为 `0.25.0`；本地 `main` 与之同步；`docs/releases/README.md` 能一句话说清 0.25 尾段归属。
- **Commit**：`docs(webui): record 0.25 tail ownership and main sync state`

### Task 1｜候选版本机制落地（需 D-1）

- **Files**：
  - 新增：根 `CANDIDATE_VERSION`（内容 `0.30.0-rc.0`）
  - 新增：`docs/releases/candidates/`（目录 ＋ `README.md` ＋ 首个候选台账 `0.30.0-rc.1.json`）
  - 改：`scripts/release/lucy-version-governance.mjs`（镜像 tag 正则与新增候选门禁）
  - 改：`scripts/release/release-ledger.mjs`（**只加断言，不改既有条目格式**：候选文件不得出现在 `docs/releases/` 顶层；候选不得含 `productionReady: true`）
  - 改：`.github/workflows/lucy-release.yml`（`candidate-` 标签携带 `CANDIDATE_VERSION`；`customer-` 标签只在 `refs/tags/v*` 路径产出）
  - 测试：`scripts/release/lucy-version-governance.test.mjs`、`scripts/release/release-ledger.test.mjs`
- **Step 1**：新增 `CANDIDATE_VERSION` 与 `CANDIDATE_VERSION_RE`（`^X.Y.Z-rc\.\d+$`），并在 `lucy-version-governance.mjs` 中断言其主版本段与 `VERSION` 一致。
- **Step 2**：扩展 `isCustomerImageRefForVersion` 的姊妹函数 `isCandidateImageRefForVersion`，匹配 `^candidate-amd64-<version>-rc\.\d+-\d{8}-[0-9a-f]{7,}$`；断言候选 tag **不被** `isReleaseTagForVersion` 接受。
- **Step 3**：新增门禁：`docs/releases/` 顶层出现 `*-rc.*.json` 即失败；`docs/releases/candidates/*.json` 出现 `productionReady: true` 即失败；候选 tag 以 `customer-` 开头即失败。
- **Step 4**：在 `lucy-release.yml` 的 `customer-amd64-native` job 中，把 `TAG="candidate-amd64-${LUCY_VERSION}-${date}-${sha7}"` 改为携带 `${CANDIDATE_VERSION}`（形如 `candidate-amd64-0.30.0-rc.1-20261118-abc1234`）；`release-package` 的 `customer-` 标签生成逻辑与 `refs/tags/v*` 触发条件保持不变，并加断言：非 tag 路径不得产出 `customer-` 标签。
- **Step 5**：补测试：候选 tag 正例／反例、`customer-` 前缀拒绝、候选台账不被顶层台账门禁误扫、`CANDIDATE_VERSION` 与 `VERSION` 主版本段不一致时报错。
- **Expected**：`npm run lint:version`、`npm run lint:release-ledger`、`npm run lint:version:test`、`npm run lint:release-ledger:test` 全绿；`git tag` 中不出现 `v*`；候选镜像 tag 一眼可判为候选。
- **Commit**：`feat(webui): add candidate version axis and candidate image tag gate`

### Task 2｜文档与手册口径对齐（需 D-1、D-2）

- **Files**：`docs/governance/version-matrix.md`、`docs/SYSTEM_HANDBOOK.md`、`deploy/k8s/K8S_CONTRACT.md`、`docs/releases/README.md`、`docs/governance/release-ci.md`
- **Step 1**：`version-matrix.md` §1.1 增补「候选版本」一轴与 §7 更新规则；§1.1.1 的序关系补 `X.Y.Z-rc.N < X.Y.Z`。
- **Step 2**：`SYSTEM_HANDBOOK.md` §版本补候选版本行与新镜像 tag 形态；补丁位行按 D-2 结果改写（未获批则原样保留并注明依赖 OQ-4）。
- **Step 3**：`K8S_CONTRACT.md` 的镜像 tag 形态行同步；**注意** `lint:version` 会检查该文件的「current baseline」与兼容矩阵的 `**Current**` 行，改动不得破坏这两处断言。
- **Step 4**：`docs/releases/README.md` 增补候选台账目录说明，并显式声明 `lint:release-ledger` 不扫描子目录。
- **Expected**：`npm run lint:version` 通过（`K8S_CONTRACT` 两处断言未被破坏）；四份文档对四种编号的表述一致。
- **Commit**：`docs(webui): align version matrix, handbook and k8s contract with candidate axis`

### Task 3｜0.30 定稿（需 D-3）

- **Files**：`docs/releases/v0.30.0.json`（新增）、`docs/releases/ux/0.30.0.md`（新增）、`docs/releases/v0.30.0-release-notes.md`（新增）、`CHANGELOG.md`、`docs/releases/v0.30.0-user-facing.md`（转正指针）
- **Step 1**：功能闭口通过后合并 `lucy-v0.30` → `main`，取 merge commit。
- **Step 2**：在该 merge commit 上打 annotated tag `v0.30.0`；先写台账（`commit` 暂填 `PENDING`），tag 打好后回填真实 SHA（沿用 `docs/releases/README.md` 维护规则 1）。
- **Step 3**：走 `docs/releases/ux/README.md` 的 UX 走查记录，结果块为 `passed` 组合。
- **Step 4**：tag run 产出 `customer-amd64-0.30.0-<YYYYMMDD>-<sha7>`；`npm run lint:release-ledger` 通过。
- **Step 5**：`CHANGELOG.md` 的 `Unreleased — 0.30.0` 段转正。
- **Expected**：`git tag` 含 `v0.30.0`；`docs/releases/v0.30.0.json` 的 `commit` 已回填；release run 的 Required 名义检查结论按台账如实记录（红即记 `failed`／`notExecuted`，不得记 `passed`）。
- **Commit**：`docs(spec): land v0.30.0 release ledger and tag`

## 4. 验收

### 4.1 Final Verification Checklist

- [ ] SC-01 任一镜像仅凭 tag 可判定「候选／定稿」：`candidate-amd64-<product>-rc.N-<date>-<sha7>` vs `customer-amd64-<product>-<date>-<sha7>`
- [ ] SC-02 同一产品线候选号单调递增、不复用（候选台账目录序号连续）
- [ ] SC-03 `VERSION` 仍为 `0.30.0`；`npm run lint:version` 通过；11 处投影逐字相等
- [ ] SC-04 `npm run lint:release-ledger` 通过；`docs/releases/` 顶层无 `*-rc.*.json`
- [ ] SC-05 `isReleaseTagForVersion("candidate-amd64-0.30.0-rc.1-20261118-abc1234", "0.30.0")` ＝ false
- [ ] SC-06 候选构建路径不产出 `customer-` 标签（门禁可拦）
- [ ] SC-07 `/api/health.data.gitSha` 为 40-hex；镜像内 `/app/BUILD_REVISION` 一致
- [ ] SC-08 `0.30.0-rc.1 < 0.30.0-rc.2 < 0.30.0`；同线无更低号出现在更晚版本之后
- [ ] 阶段 0：`origin/main` 的 `VERSION` 为 `0.25.0`；本地 `main` 已同步；`docs/releases/README.md` 写明 0.25 尾段归属
- [ ] 阶段 0：CI push 触发覆盖当前产品线分支；已失效的 `lucy-v0.25` 临时触发已按 `release-ci.md` 要求删除

### 4.2 门禁命令

```bash
npm run lint:version
npm run lint:version:test
npm run lint:release-ledger
npm run lint:release-ledger:test
npm run lint:spec-docs
```

## 浏览器验证

不适用：本 Plan 不改任何页面、组件、交互或文案，只改发版治理面（版本文件、发布脚本、CI 工作流、文档）。

## 6. 完成定义

1. Spec 与本 Plan 经 Codex 交叉审阅并按反馈修订，升 `v0.2-cross-review`。
2. 委托人批准 D-1／D-2／D-3，并明示开发授权。
3. Task 0–3 全部完成，§4.1 清单逐项勾上，且五道门禁命令全绿。
4. 0.30 定稿产物齐备：`v0.30.0` tag、`docs/releases/v0.30.0.json`、`docs/releases/ux/0.30.0.md`、`customer-amd64-0.30.0-...` 镜像。
5. `docs/governance/version-matrix.md`、`docs/SYSTEM_HANDBOOK.md`、`deploy/k8s/K8S_CONTRACT.md` 与实现一致。

## 7. 风险

| 风险 | 影响 | 回滚 / 缓解 |
|---|---|---|
| 候选号被误当发布号对外传播 | 客户按候选号提工单 | 候选三重禁止（不进 `VERSION`／不占台账／不打 tag）＋门禁；对外材料只引用定稿号 |
| 已发出的 `customer-amd64-0.30.0-20261117-abb38913` 与定稿撞版本段 | 现场混淆 | Task 0 补候选台账追溯说明；历史标签不重打（tag／digest 是事实） |
| `CANDIDATE_VERSION` 与 `VERSION` 双 SSOT 漂移 | 候选标签带错版本段 | 候选号主版本段由 `VERSION` 派生并断言一致，漂移即门禁红 |
| 扩 `lucy-version-governance.mjs` 正则影响既有发布路径 | 定稿 tag 校验被放宽或误伤 | 新增函数与断言，不改 `isReleaseTagForVersion` 对 `vX.Y.Z` 与 `customer-...` 的既有接受集合；用既有测试回归 |
| CI 触发面改动影响日常跑批 | 跑批堆积或并发组错配 | 只增删分支条目，不改 concurrency 组；改动后看一次 PR 与 push 两类跑批 |
| 补丁位规则未决时 hotfix 无处安放 | 定稿后修复无处落号 | 未获批前 hotfix 走新 rc 序列并在台账写明偏离；偏离本身须可追溯 |
| 本地 `main` 不同步复发 | 版本判断反复出错 | 版本判断一律以 `origin/main` 为准 |

## 8. Reviewer Checklist

- [ ] Spec 与 Plan 的四轴定义、命名形态、序关系三处是否一致（跨文档用词漂移）
- [ ] 候选版本是否确实**不**进入 `VERSION` 及其 11 处投影（读 `scripts/release/lucy-version-governance.mjs` 核对，不只看 Plan 描述）
- [ ] 候选 tag 是否会被 `isReleaseTagForVersion` 误接受（读正则核对）
- [ ] `docs/releases/candidates/` 是否会被 `lint:release-ledger` 扫到（读 `readdirSync` 是否递归核对）
- [ ] `K8S_CONTRACT.md` 的两处 `lint:version` 断言在文档改动后是否仍成立
- [ ] Commit message 是否符合仓库规范（`feat(webui):` / `docs(webui):` / `docs(spec):` / `test(webui):`）
- [ ] 边界第 2／3／4／5 条是否在实现里被守住（候选不进顶层台账、不改历史、不冒充发布、不产 `customer-`）
- [ ] 本轮是否真的只做方案：是否无运行代码、镜像、CI、`VERSION` 投影的改动
