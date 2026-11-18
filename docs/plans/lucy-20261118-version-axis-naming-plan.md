# Lucy 版本轴分工与命名规约 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Plan / **v0.3-draft** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 状态 | **v0.3-draft。方案稿：Task 全部未开工；未获开发授权；未改运行代码、镜像与 CI。终稿未确权。总账 P1-51／REQ-030-072；测试台 not_registered；不入核心分母；≠ 可上线** |
| 授权边界 | **本 Plan 当前只授权「读代码与只读核实」以及本轮对 Spec／Plan 文档本身的修订**。任何写运行代码、改镜像标签逻辑、改 CI、改 `VERSION` 投影、改交付仓自动化的动作，须委托人先终稿确权并**单独**开发授权 |
| 验收 | 见 §「验收」（SC-01–SC-13 与阶段 0 对齐事实） |
| 配对 Spec | [`docs/specs/lucy-20261118-version-axis-naming-spec.md`](../specs/lucy-20261118-version-axis-naming-spec.md) **v0.3-draft** |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」「功能闭口与发布取证」；[`AGENTS.md`](../../AGENTS.md)「部署方式与版本制品解耦（全局原则）」 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。配合 Spec v0.1-draft 落盘 Task 分解、验收与回滚口径；全部 Task 未开工 |
| v0.2-draft | 对齐 Spec v0.2-draft：新增 Task 0b／1b／2b（交付仓追溯与可选运行时字段）；收紧候选用途与定稿后 hotfix 过渡；验收扩至 SC-09–SC-11；裁决点增 D-4／D-5。**仍不进入开发** |
| v0.3-draft | 对齐 Spec v0.3：OQ-1／OQ-7 已决；Task 1／1b 强制**自动分配器**（禁人工起号）；Task 2b 默认要做（私有化分叉）；验收 SC-12／SC-13。**仍不进入开发** |

## 1. 目标（Context for Developer）

**问题**：

1. 0.30 开发期多次出包共用 `VERSION=0.30.0` 与 `customer-` 前缀，与将来定稿撞版本段（实证 `customer-amd64-0.30.0-20261117-abb38913`／交付 `20261117-r1`）。
2. 交付仓 [lucy-customer-delivery](https://github.com/Forrest219/lucy-customer-delivery) 缺机器可读索引；源码台账与交付仓脱节。
3. 开发态号码若靠人定义，易漏记、撞号；私有化现场难精确定位分叉。

**目标**：四轴＋交付主键别名；**出包自动分配** `rc.N`／`deliveryId`；标签可判定候选／定稿；交付索引＋运行时身份支撑追溯与私有化分叉定位。

**产出**：自动分配器 ＋ 编号／门禁 ＋ 交付仓追溯 ＋ 运行时／镜像身份 ＋ 文档 ＋（另授权后）0.30 定稿。

**不在本 Plan 范围**：0.30 功能代码；`1.0.0` 产品含义；改写历史 tag／digest；托管客户私有 fork 源码；本轮实现任何运行代码。

## 2. 开工前置（Non-negotiable boundaries）

1. **不改 `VERSION` 语义**；候选永不写入 11 处投影。
2. **不占用**顶层 `docs/releases/vX.Y.Z.json`；候选只进 `docs/releases/candidates/`。
3. **不改历史事实**；只补追溯卡。
4. **候选不得冒充发布**；无受控放行不得标客户生产。
5. **`customer-` 只由定稿 tag 路径产出**。
6. **不碰 0.30 功能代码**。
7. **不单方面启用补丁位**；未批 OQ-4 前走 `post-ga-hotfix-candidate`，不挤占开线 rc。
8. **未获开发授权不改运行代码／CI／交付仓自动化**。
9. **对外主键**＝`deliveryId`（OQ-7 已决）；台账双写 `candidateVersion`↔`deliveryId`。
10. **每个交付包只钉一种 `deployPin` digest**。
11. **禁止人工定义／传入 `rc.N` 或当日 `rN`**；号码只给出包／发放分配器产生（Spec §4.2.1／R10）。
12. **成功出包必须同 job 身份入库**（R11）；失败不得留下无台账的已推送候选号。

**开工裁决点**（须委托人明示才可进入对应 Task 的写操作）：

| 裁决 | 内容 | 阻塞的 Task |
|---|---|---|
| D-1 | 采纳四轴＋`candidate-`＋自动 `X.Y.Z-rc.N`（OQ-1 已决） | Task 1 |
| D-2 | OQ-4 补丁位规则 | Task 2 补丁段落；影响 Task 1b channel 枚举说明 |
| D-3 | 0.30 定稿时点与合并窗口 | Task 3 |
| D-4 | 采纳交付仓追溯合同（index／manifest／`deployPin`／双向指针） | Task 1b |
| D-5 | OQ-8 运行时／镜像身份（**默认 (a)**，私有化分叉依赖） | Task 2b |
| D-6 | OQ-9 自动分配时区／当日 rN 分桶 | Task 1／1b 分配器实现细节 |

## 3. Task 分解

> **本轮（v0.3-draft 文档修订）不执行下列 Task 的写操作。** 下列分解供终稿确权与开发授权后使用。

### Task 0｜现状对齐（文档／同步；不依赖 D-1）

- **Files**：`docs/releases/README.md`、`docs/governance/release-ci.md`（文档）；git 快进本地 `main`（无文件内容改动）
- **Step 1**：本地 `main` 快进到 `origin/main`。
- **Step 2**：写明 0.25 尾段随 0.30 交付、祖先关系。
- **Step 3**：CI 触发面缺口列入待批（改 workflow 须开发授权，归 Task 1）。
- **Expected**：`origin/main` 的 `VERSION`＝`0.25.0`；README 能一句话说清归属。
- **Commit**（授权后）：`docs(webui): record 0.25 tail ownership and main sync state`

### Task 0b｜历史交付追溯卡（文档；可先于 D-1，建议与 D-4 口径一致）

- **Files（源码仓）**：`docs/releases/candidates/README.md`；为 `20261113-r1`／`20261117-r1` 等各补一份追溯 JSON／Markdown（字段对齐 Spec §4.6，允许 `imageBuildTag` 仍为历史 `customer-amd64-…`）
- **Files（交付仓，授权后）**：`DELIVERY_INDEX.json` 初值（可先手工）；README 顶栏「当前推荐／上一回滚」
- **Step 1**：从 GH Releases 摘录 deliveryId、40-hex、三类 digest（选定一种为 `deployPin` 并注明其余 `alsoKnown`）、包 SHA、Chart、`productionReady=false`、取代关系。
- **Step 2**：源码卡与交付 index 互指 `sourceLedgerPath`／`customerDeliveryReleaseUrl`。
- **Step 3**：注明 `docs/releases/v0.30.0.json` 占位≠覆盖这些包。
- **Expected**：SC-09／SC-10 对历史包可用人工查表满足；不改任何历史 tag／digest。
- **Commit**（授权后）：`docs(webui): backfill pre-ga delivery traceback cards for 0.30`

### Task 1｜候选版本机制＋自动分配器（需 D-1、D-6＋开发授权）

- **Files**：根 `CANDIDATE_VERSION`；`docs/releases/candidates/`；分配器模块（建议 `scripts/release/candidate-version-allocator.mjs`＋test）；`lucy-version-governance.mjs`（+test）；`release-ledger.mjs`（+test）；`.github/workflows/lucy-release.yml`（concurrency group）；必要时 `lucy-ci.yml` 触发面
- **Step 1–5**：`CANDIDATE_VERSION`、候选正则、门禁、`candidate-` tag、测试（同前）。
- **Step 6**：实现 Spec §4.2.1 分配器：`N=max+1`；出包参数**不得**接收 `rc`／`n`；手改 `CANDIDATE_VERSION` 与台账不一致则失败。
- **Step 7**：同 job 写台账（含 `mergeBaseWithMain`、40-hex）并回写 `CANDIDATE_VERSION`；失败回滚／不推无号镜像（R11）。
- **Step 8**：候选台账 schema：已发放则必填 `deliveryId`。
- **Expected**：SC-01–SC-08、SC-12；lint／相关 test 全绿；非 tag 路径不产 `customer-`。
- **Commit**：`feat(webui): auto-allocate candidate rc and gate image tags`

### Task 1b｜交付仓追溯＋自动 deliveryId（需 D-4、D-6＋开发授权；可与 Task 1 并行）

- **Files（交付仓）**：`DELIVERY_INDEX.json`、`README.md`、`delivery-manifest.json` 模板；发放分配器／校验
- **Files（源码仓）**：台账字段说明；`docs/releases/README.md`；可选 schema 校验
- **Step 1**：落地 Spec §4.6；README 顶栏两行。
- **Step 2**：发放时**自动**分配 `YYYYMMDD-rN`（人不填号）；Release 必须附 manifest。
- **Step 3**：钉死 `deployPin` 种类。
- **Step 4**：私有仓短 tag ↔ `deliveryId` 机械推导。
- **Expected**：SC-09／SC-10／SC-12（delivery 侧）。
- **Commit**：分仓提交；源码侧例 `docs(webui): require deliveryId linkage in candidate ledgers`

### Task 2｜文档与手册口径对齐（需 D-1、D-2）

- **Files**：`docs/governance/version-matrix.md`、`docs/SYSTEM_HANDBOOK.md`、`deploy/k8s/K8S_CONTRACT.md`、`docs/releases/README.md`、`docs/governance/release-ci.md`
- **Step 1–4**：同 v0.1，并增补：交付修订号别名、`deployPin`、受控候选放行、§5.4 过渡口径。
- **Expected**：`lint:version` 通过；四处文档与 Spec 一致。
- **Commit**：`docs(webui): align version matrix and delivery traceback contract`

### Task 2b｜运行时／镜像内身份（私有化分叉；需 D-5 默认 (a)＋开发授权）

- **Files**：构建写入 label／`/app` 元数据；`/api/health` 与版本信息 server／client；组件测试；短 runbook（分叉定位命令）
- **Step 1**：写入 Spec §4.7 字段（`BUILD_REVISION` 已有；补 `deliveryId`／`candidateVersion`／`imageBuildTag`／`productLineRef` 等）；未发放则 `deliveryId=unknown`，不得编造。
- **Step 2**：health／版本信息**追加**只读字段；既有字段语义不变。
- **Step 3**：文档化 `merge-base` 分叉定位步骤（供应方侧）；对象不可达时的降级文案。
- **Step 4**：测试：旧字段锁定；SC-13 用夹具 revision 跑通「可达／不可达」两分支。
- **Expected**：SC-07、SC-13；现场可读身份或镜像内兜底。
- **Commit**：`feat(webui): expose delivery identity for private-deploy fork location`

### Task 3｜0.30 定稿（需 D-3＋开发授权）

- **Files**：`docs/releases/v0.30.0.json`（回填）、UX、release notes、`CHANGELOG.md`；交付仓 GA Release＋index
- **Step 1–5**：同 v0.1 定稿链。
- **Step 6**：同次回填 `deliveryPackage`（含 `deliveryId`、`deployPin`、包 SHA）并更新交付 index `channel=ga`。
- **Expected**：tag、台账、UX、`customer-` 镜像、交付回填一致；不得再出现「现场已发、台账 null」。
- **Commit**：`docs(spec): land v0.30.0 release ledger and tag`

## 4. 验收

### 4.1 Final Verification Checklist

- [ ] SC-01 … SC-08（同 Spec §8）
- [ ] SC-09 已发交付包 1 分钟定位（含历史补卡）
- [ ] SC-10 双向指针
- [ ] SC-11 候选进生产须有受控放行记录
- [ ] SC-12 自动分配；出包不可传号；手改号门禁红
- [ ] SC-13 私有化分叉定位（可达／不可达两分支）
- [ ] 阶段 0：main 同步口径；0.25 归属；CI 待批清单已登记
- [ ] OQ-1／OQ-7 已决；OQ-8／OQ-9 裁决已写入手册

### 4.2 门禁命令（开发授权后的实现阶段）

```bash
npm run lint:version
npm run lint:version:test
npm run lint:release-ledger
npm run lint:release-ledger:test
npm run lint:spec-docs
```

## 浏览器验证

不适用：本条只涉版本号命名与交付追溯，不改变用户可见 WebUI 表面，无浏览器验收步骤。仅当 Task 2b 开工时，按 DEVELOPMENT 浏览器约束对「版本信息」页做最小只读核对（非移动窄屏）。

## 6. 完成定义

1. Spec／Plan 经交叉审阅；本 v0.3-draft 已纳入自动分配与私有化分叉诉求。
2. 委托人终稿确权，并明示开发授权（可分批：D-1／D-4／D-5／D-3）。
3. 已授权 Task 完成且对应 SC 勾选；五道 lint 命令在实现阶段全绿。
4. 0.30 定稿产物齐备且交付仓 GA 回填完成（若走到 Task 3）。
5. `version-matrix`／handbook／K8S_CONTRACT／交付仓 README 与实现一致。

## 7. 风险

| 风险 | 影响 | 回滚 / 缓解 |
|---|---|---|
| rc 与 deliveryId 无别名 | 排障乱 | 强制双写；OQ-7 已决 |
| 人工起号 | 序列漂移 | R10／SC-12；参数禁传号 |
| 并发抢同一 N | 撞号 | concurrency／锁；分配器单测 |
| 候选进现网无放行记录 | 重复 11-17 | Spec §4.2＋SC-11 |
| 定稿后 hotfix 挤占 rc | 语义崩 | §5.4；禁开线 rc 承接 post-GA |
| digest 多值 | 对拍失败 | `deployPin` |
| 交付仓只有 Markdown | 难检索 | Task 1b |
| 无运行时身份 | 私有化分叉难 | Task 2b 默认 |
| 现场对象不在供应方 git | 无法 merge-base | §4.7 降级文案 |
| 扩治理正则误伤定稿 | 门禁异常 | 新增函数＋回归 |
| 本地 main 不同步 | 误判 | 以 `origin/main` 为准 |

## 8. Reviewer Checklist

- [ ] Spec／Plan 四轴、自动分配、deliveryId、分叉定位一致
- [ ] 候选永不进 `VERSION` 11 处投影
- [ ] 出包／发放 API **无**人工传号参数
- [ ] 候选 tag 不被 `isReleaseTagForVersion` 接受
- [ ] `docs/releases/candidates/` 不被顶层 ledger 误扫
- [ ] SC-09–SC-13 有对应 Task
- [ ] 历史包只补卡、不改 tag／digest
- [ ] OQ-1／OQ-7 已决；OQ-4 过渡不挤占开线 rc
- [ ] 本轮是否仍无运行代码／CI／镜像改动（v0.3-draft 文档轮次应为是）
