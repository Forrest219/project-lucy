# 常青需求池与版本发版列车解耦治理 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan／治理架构演进） |
| 版本 / 日期 | v1.0 / 2026-11-26 |
| 状态 | S5｜v1.0（Wave 0–2 全部执行落地完成，SC-01–SC-08 全量门禁验证通过；不触碰任何业务运行时代码）；≠ 任何产品功能合同收口；≠ 可上线 |
| 关联现状基线 | [`lucy-20261107-lucy-0-30-feature-inventory-pool.md`](lucy-20261107-lucy-0-30-feature-inventory-pool.md)（全表 110 行／111 唯一 REQ，v2.92）· [`lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`](lucy-20261102-lucy-0-30-0-requirement-pool-plan.md)（111 唯一 REQ，v0.183）· [`lucy-20261122-spec-status-funnel-gate-spec.md`](../specs/lucy-20261122-spec-status-funnel-gate-spec.md)（P1-73 v1.3） |
| 授权边界 | **终稿已确权且迁移落地授权已获得（委托人 2026-11-26）**。允许按 Wave 0→1→2 落地常青需求池、`v0.35.0-scope.md`、旧池只读冻结横幅、10 对漏迁 Spec／Plan 阶段格回填与 grandfather 净减、`lint-spec-docs.mjs` 升级及治理文档修订；**严禁触碰任何业务运行时代码**（`webui/src/**`、`webui/server/**`、`deploy/**`）。本计划不构成对任何产品功能的开发授权 |
| 验收 | 总账物理全表 110 行（111 唯一 REQ）＋按 OQ-4 决定的 9 条未来池条目 100% 守恒对账；单行精简不复造巨表；`lint:inventory-stage` 补齐加粗行解析盲区并兼容历史与新稳定 ID；CI 门禁全绿；历史文件与评审证据零断链 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「强制流程：Plan Mode」「产品线执行总账（SOT）」「新增 Spec／Plan 的落盘清单」 |

### Changelog

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0（执行完成） | 2026-11-26 | Wave 0–2 全部落地：建池 `docs/backlog/`（活跃 101 行／均长 195.8 字符／26.4 KB＋归档 18 行）与 `docs/releases/v0.35.0-scope.md`；4 份旧池顶部加只读冻结横幅；10 对历史 Spec/Plan 补齐阶段格与 D7 前缀并净减 grandfather 10 条（95→85）；`lint-spec-docs.mjs` 与单测升级；治理文档与全仓入口切换；SC-01–SC-08 全部验证通过 |
| v1.0 | 2026-11-26 | 委托人明示「授权定稿，并启动执行落地」：OQ-1–OQ-8 按推荐默认全部闭合，R1 按方案 A 闭合；补登 `docs/plans/README.md` 并启动 Wave 1–2 执行落地 |
| v0.3-draft | 2026-11-26 | 吸收复审 R1 阻塞项（方案 A，委托人确认）：核实 9 条加粗 P0（`P0-1`–`P0-7`、`P0-A`、`P0-B`）及同构的 `REQ-030-003` 共 10 份主 Spec 均缺「阶段」元数据格、配对 Plan 均缺阶段码前缀且仍在 `spec-status-funnel-grandfather.json`；将其头部阶段格回填、配对 Plan D7 前缀补齐及 grandfather 移出（净减 10 条）纳入 Wave 1 原子 PR，同步更新涉及文件、SC-05 与附录实证基线，确保 `lint:inventory-stage` 与 `lint:status-funnel` 无需新增基线豁免即可全绿 |
| v0.2-draft | 2026-11-26 | 吸收首轮对抗评审修订：① 实证拆清总账全表 110 行／111 唯一 REQ 与现行 `lint:inventory-stage` 100 行（静默跳过 9 条加粗 `**P0-*`＋1 条 `—` 行）的双口径差异并入附录；② 新增 OQ-6（同句镜像→阶段码同码镜像＋变更流水改由 git／Spec 头部承担）、OQ-7（新需求正文载体）、OQ-8（新目录门禁扫描面）；③ 修正唯一事实源表述（Spec 头部为唯一事实源，常青池为同码镜像）；④ OQ-4 增补「类型」列区分需求／概念并保留原授权边界；⑤ 合并 Wave 1＋2 为单 PR 消除门禁空窗，移出无关 `check-diff-boundary.mjs`，明确 `vX.Y.Z-scope.md` 与 `docs/releases/` 既有制品的关系，增补 SC-08 单行精简验收，OQ-5 默认调整为修订 DEVELOPMENT＋P1-73 v1.3 增补 |
| v0.1-draft | 2026-11-25 | 初稿落盘 |

## 目标

将仓库的需求管理体系升级为业界标准的**「常青需求池（Evergreen Product Backlog）+ 版本发版列车（Release Train Ledger）」**解耦模型：

1. **主键去语义化**：新需求启用不含版本号、不含优先级的永久稳定 ID（如 `REQ-0113`），终结 `REQ-030-xxx` 跨版本漂移和「P0 需求顶着 `P1-83` 编号」的冲突。
2. **需求池回归纯粹**：建立全仓唯一的常青需求池作为需求台 SOT，维护需求实体、类型、可变优先级、开发漏斗阶段（沿用 P1-73 的 `S1–S5 / X_*`）与 Spec/Plan 指针；不再按大版本新建或复制总账。
3. **拉取制发版（Pull Model）**：每次发版（如 `v0.35.0`）维护一份轻量发版范围单，从常青池挑选条目进入本次版本范围；发版窗口关闭时，未完成需求自动解绑该版本标签，自然留在池中等待下一版本挑选，无需「迁池」或改写编号。
4. **控制单文件体积**：活跃池主表采用精简行格式（只登记阶段码与短指针，不再堆砌逐日变更流水），并将已随版本发布或退出的条目定期沉降归档，彻底解决当前 0.30 两文件合计 556 KB 的膨胀问题。
5. **平滑零破坏演进**：历史 `REQ-030-001`–`112` 与 `P0-*/P1-*/P2-*` 冻结为不可变历史别名，不做全仓历史编号大改名，保证 git 历史、评审记录与 UAT 证据链完整不断。

## 目标架构与数据模型

### 三类文档职责边界（杜绝双写）

| 层级 | 建议落位（待 OQ-2／OQ-7 裁定） | 职责（唯一事实源） | 不做什么 |
|---|---|---|---|
| **常青需求池（活跃索引）** | `docs/backlog/README.md` | 登记所有在途与待选条目：稳定 ID、历史别名、类型（`需求`／`概念`）、标题、优先级（`P0`/`P1`/`P2`）、漏斗阶段（`S1`–`S5`/`X_*`，同码镜像 Spec 头部）、`目标版本`（可空）、正文／Spec／Plan／UAT 指针 | 不做漏斗阶段唯一事实源（唯一事实源在 Spec 头部）；不堆砌逐日长篇变更流水 |
| **常青需求池（单条正文）** | `docs/backlog/entries/<ID>.md`（待 OQ-7 裁定） | 承载尚未开 Spec、概念阶段或 `X_DEF` 条目的缺口描述、来源、授权边界与澄清记录（一需一档） | 不替代功能 Spec，不构成开发授权 |
| **常青需求池（历史归档）** | `docs/backlog/archive.md` | 承接已随版本正式发布（`shipped_in` 非空）或已退出（`X_DEF`/`X_SUP`）的沉降条目，保持完整可追溯 | 不承载仍在途的 S1–S4 需求 |
| **版本发版单（按版一份）** | `docs/releases/v0.35.0-scope.md` | 记录从常青池拉取的本次版本范围（引用稳定 ID）、本次发版阻断项（取代旧「核心分母」）、合入 `gitSha` 及发布取证（`X_REL`）结论 | 不复制需求正文与漏斗长文；不作为新需求登记入口 |

### 与 `docs/releases/` 既有制品的分工（不造第四套叙事）

`docs/releases/` 现已有三类制品，新增的发版范围单与其职责严格正交：

- `vX.Y.Z-scope.md`（本 Plan 新增）：**内部开发／发版拉取清单**（列出挑入本版的 `REQ`、发布阻断项与 `X_REL` 取证指针）。
- `vX.Y.Z.json`（既有，如 `v0.35.0.json`）：机器可读的制品摘要与版本台账（`lint:release-ledger`）。
- `vX.Y.Z-release-notes.md` / `vX.Y.Z-user-facing.md`（既有）：面向用户与客户的对外发布叙事。

### 字段与状态流转规则

- **稳定主键**：历史条目保留 `REQ-030-001`–`112`（及 `P0-*/P1-*/P2-*` 别名列；`REQ-030-047` 为历史跳号不回填，`P1-2` 合并 `REQ-030-013／016` 保留原映射）；新条目从 `REQ-0113` 起连续递增，**永不嵌入版本号或优先级**。
- **类型列**：`需求` 或 `概念`。概念阶段条目（如 `REQ-CAL-001`）显式标为 `概念`，不得静默抬升为已立项需求。
- **优先级列**：独立可变属性（`P0` / `P1` / `P2`），升降级只改该列，不改编号。
- **漏斗阶段列**：完全复用 [P1-73 漏斗门禁 Spec](../specs/lucy-20261122-spec-status-funnel-gate-spec.md) v1.2 字典（主漏斗 `S1`→`S2`→`S3`→`S4`→`S5`，退出/旁路 `X_REL`、`X_DEF`、`X_SUP`；概念未立项条目按 OQ-4 标注）。**各 Spec 头部「阶段」格为开发漏斗唯一事实源，常青池为同码镜像**，入池时统一归一化去掉 `**` 加粗符号。
- **版本绑定列（`目标版本`）**：
  - 未排期：`—`（纯在池中）；
  - 挑入某次发版：`v0.35.0`（同步登记进 `docs/releases/v0.35.0-scope.md`）；
  - 赶不上该次发版：从 `v0.35.0-scope.md` 移除并将 `目标版本` 置回 `—`（自然回池，漏斗阶段 S1–S4 原样保留）；
  - 随版本正式发布后：在发版单记 `shipped_in = v0.35.0`，条目沉降到 `archive.md`。

## 开工前置

在执行任何台账迁移或脚本修改前，需先完成以下前置项：

1. **委托人裁定 8 项待决问题（OQ-1–OQ-8）**：

| 编号 | 待裁问题 | 推荐默认 | 备选方案 |
|---|---|---|---|
| **OQ-1** | 新需求主键格式 | `REQ-0113` 起连续四位递增（承接最大号 112，无版本／优先级前缀；注明 `047` 为历史跳号不回填） | `LUCY-113` 或从 `REQ-1001` 另起号段 |
| **OQ-2** | 常青池与发版单目录落位 | 新建 `docs/backlog/`（活跃 `README.md`＋`archive.md`）与 `docs/releases/v0.35.0-scope.md`（联动 OQ-7／OQ-8） | 沿用 `docs/plans/lucy-backlog.md`（不新增顶层子目录） |
| **OQ-3** | 历史全表切分与对账基线 | **以总账物理全表 110 行（111 唯一 REQ）为基线**（不采用现行 lint 漏扫 10 行的 100 行口径）：在途 45 条（S1=31／S2=4／S3=3／S4=7）＋未随旧版发布的 S5（44 条）＋X_REL（3 条）共 **92 条**进活跃池；已退出 18 条（X_DEF=17／X_SUP=1）进 `archive.md`；原 0.30 两文件冻结为只读快照；迁入时归一化去掉 21 行 `**S1｜` 与 9 行 `**P0-*` 加粗噪音 | 仅迁在途 45 条进活跃池（风险：44 条 S5＋3 条 X_REL 脱离唯一 SOT，发版单无法直接引用） |
| **OQ-4** | `post-0.30` 两池（9 条）并入方式 | 吸收 `REQ-TE-001`–`008`（`类型=需求`）与 `REQ-CAL-001`（`类型=概念`）进常青池（`目标版本 = —`），**完整携带原池授权边界与升格门槛文本**（入池 ≠ 立项 ≠ 开发授权），旧文件改标已归并重定向 | 保持独立未来池，等立项时再转入常青池 |
| **OQ-5** | 治理契约落位方式 | **修订 `DEVELOPMENT.md` ＋ P1-73 漏斗 Spec v1.3 增补**，不新开独立治理 Spec（沿用 P1-73 v1.1／v1.2 增补先例，避免多造一条 S1 在途项） | 新立一份独立治理 Spec（限定范围：常青池数据模型＋镜像合同） |
| **OQ-6** | 镜像合同降级与变更流水留痕 | 显式将总账与 Spec 头部由「同句镜像」降级为**「阶段码同码镜像」**；取消池内逐日长篇变更流水，池级变更留痕改由 **git 提交历史＋Spec 头部 Changelog** 承担；同步修订 `DEVELOPMENT.md`「状态登记只有一份现值」「产品线执行总账（SOT）」及 P1-73 Spec D7／D17 | 维持总账与 Spec「同句镜像」＋池内变更表（将无法根治单文件膨胀） |
| **OQ-7** | 新需求正文载体（`REQ-0113+`） | **一需一档**：新建 `docs/backlog/entries/REQ-0113.md`（概念、X_DEF、尚未开 Spec 条目各有独立轻量正文文件，历史 `REQ-030-*` 正文继续指向冻结旧需求池锚点） | B：常青池文件内折叠正文区；C：不留独立正文，立项即开 Spec 草案（概念／X_DEF 无处落脚） |
| **OQ-8** | 新目录形态门禁扫描面 | **纳入 `lint-spec-docs.mjs` `scanRepo()` 扫描面**：对 `docs/backlog/README.md`、`archive.md` 与 `docs/releases/v*-scope.md` 启用 `metadata`＋`status-vocab`＋`stale-status`＋`inventory-stage` 检查，消除治理真空带 | 在 `DEVELOPMENT.md` 显式登记常青池仅受 `inventory-stage` 单规则治理 |

2. **清理当前脏工作树**：当前 `lucy-v0.35` 工作区存在大量未提交改动（含两份 0.30 台账本体），须先提交或隔离当前在途批次，避免迁移 diff 与业务变更混杂。
3. **登记索引与终稿确权**：本 Plan 定稿并准备提交前，须补登进 `docs/plans/README.md`（消除 `lint:spec-docs` 对本文件的 `[index]` 告警），经委托人裁定 OQ-1–OQ-8 并授权后，再按 Wave 1 → Wave 2 顺序落地。

## 步骤

> 为消除「新池已建、门禁仍指旧文件」的空窗期，将原 Wave 1（建池迁移）与 Wave 2（门禁切换）合并为同一原子 PR 落地。

| 波次 | 内容 | 涉及文件 | 验证方式 |
|---|---|---|---|
| **Wave 0** | **决策闭合与契约定稿**：委托人裁定 OQ-1–OQ-8；定稿本 Plan v1.0 并登记 `docs/plans/README.md`。**本波次不改任何存量台账或脚本** | 本 Plan、`docs/plans/README.md` | OQ-1–OQ-8 全部闭合；`lint:spec-docs` 对本文件 0 违规 |
| **Wave 1（原子 PR）** | **建池迁移＋历史 MIG 欠账清偿＋门禁同步切换**：① 创建 `docs/backlog/README.md`、`archive.md`、`entries/` 模板与 `docs/releases/v0.35.0-scope.md`；② 脚本辅助无损迁入全表 110 行（111 唯一 REQ，归一化去掉加粗符号）＋按 OQ-4 迁入 9 条未来池条目并保留授权边界；③ 旧 0.30 两文件顶部加只读冻结重定向横幅（不删正文与锚点）；④ **清偿 10 对漏迁 grandfather Spec／Plan（R1 方案 A）**：为 `P0-1`–`P0-5`、`P0-A`、`REQ-030-003`（7 份）主 Spec 补 `\| 阶段 \| S5 \|`、为 `P0-6`、`P0-7`、`P0-B`（3 份）主 Spec 补 `\| 阶段 \| S1 \|`，同步为对应 10 份配对 Plan 的「状态」行补 `S5｜`／`S1｜` 前缀（满足 `status-funnel` D7），并从 `docs/governance/spec-status-funnel-grandfather.json` 移出这 10 条（纯减量，不改任何正文与授权状态）；⑤ 同步升级 `scripts/lint-spec-docs.mjs`（`INVENTORY_STAGE_FILES` 指向常青池；修复 `cells[0]` 未剥离 `**` 的解析盲区；`INVENTORY_ID_RE` 兼容历史别名与新 `REQ-\d{4,}`；按 OQ-8 扩展 `scanRepo()` 扫描面），补齐 `scripts/lint-spec-docs.test.mjs` 夹具测试并确保不向 `docs/governance/spec-plan-doc-baseline.json` 新增违规条目（*不触碰与 CI 无关的 `scripts/concepts/check-diff-boundary.mjs`*） | `docs/backlog/**`、`docs/releases/v0.35.0-scope.md`、旧 0.30 两文件头部、10 对漏迁历史 Spec／Plan（`P0-1`–`P0-7`/`P0-A`/`P0-B`/`REQ-030-003`）头部、`docs/governance/spec-status-funnel-grandfather.json`、`scripts/lint-spec-docs.mjs`、`scripts/lint-spec-docs.test.mjs` | 迁移对账脚本输出 110 行／111 唯一 REQ 100% 守恒；`spec-status-funnel-grandfather.json` 净减 10 条且 `spec-plan-doc-baseline.json` 零新增；`npm run lint:spec-docs:test` 全绿；`npm run lint:inventory-stage`、`lint:status-funnel`、`lint:status-vocab` 全绿 |
| **Wave 2** | **治理文档与全仓入口切换**：按 OQ-5／OQ-6 修订 `docs/governance/DEVELOPMENT.md`（「状态登记只有一份现值」＋「产品线执行总账（SOT）」两节）与 P1-73 漏斗 Spec（v1.3 增补）；更新 `AGENTS.md`（移除「待单独立项 0.35 总账」过渡句）、`docs/governance/e2e-ledger.md`、`docs/governance/test-layers-and-release-gates.md`；核对 `.github/workflows/lucy-ci.yml:76` `lint:inventory-stage` 运行通过；将 `scripts/mig-funnel-inventory-backfill.mjs` 标注为历史迁移脚本 | `AGENTS.md`、`docs/governance/DEVELOPMENT.md`、`docs/specs/lucy-20261122-spec-status-funnel-gate-spec.md`、`docs/governance/e2e-ledger.md`、`docs/governance/test-layers-and-release-gates.md`、`scripts/mig-funnel-inventory-backfill.mjs` | 全仓 `feature-inventory-pool` 引用仅剩历史归档／重定向；CI 门禁全绿 |

## 浏览器验证

不适用：本 Plan 仅涉及需求治理模型、Markdown 台账结构与文档 lint 门禁，不改变任何用户可见 WebUI 表面。

## 验收

| 编号 | 验收标准 | 验证方式 |
|---|---|---|
| SC-01 | 以总账物理全表 **110 行（111 唯一 REQ，见附录）**＋按 OQ-4 并入的 **9 条未来池**为基线，常青池（活跃 101 条［原 0.30 活跃 92 条＋OQ-4 未来池 9 条］＋归档 18 条＝119 行／120 唯一 REQ）100% 守恒可追，阶段码归一化后与原表一致，无静默丢失（含原被 lint 漏扫的 9 条加粗 P0 与 `REQ-030-003`） | 迁移对账脚本输出比对 |
| SC-02 | 新需求支持纯稳定 ID（如 `REQ-0113`），不含版本段或优先级前缀；升降优先级不改 ID；`类型` 列清晰区分 `需求`／`概念` | `lint-spec-docs.test.mjs` 正反例夹具 |
| SC-03 | `docs/releases/v0.35.0-scope.md` 仅通过 ID 引用常青池条目，不复制需求正文，明确与既有 `v0.35.0.json`／`release-notes` 的分工，列清本次发版阻断项与 `X_REL` 取证指针 | 文档结构走查 |
| SC-04 | 历史 `REQ-030-*`、`P0-*`、`P1-*`、`P2-*` 引用与旧 0.30 两文件均保留可读（仅加顶部只读重定向），全仓无新增断链 | 链接检查与抽查 |
| SC-05 | `lint:inventory-stage`（已修复加粗行盲区并覆盖全部 9 条 P0 与 `REQ-030-003`）、`lint:spec-docs:test`、`lint:status-funnel`、`lint:status-vocab` 全部通过；10 对漏迁 Spec／Plan 已补齐阶段格与 D7 前缀并移出 `spec-status-funnel-grandfather.json`，`spec-plan-doc-baseline.json` 零新增；门禁在 `.github/workflows/lucy-ci.yml:76` 保持生效 | 本地命令行与 CI 跑次 |
| SC-06 | `AGENTS.md`、`DEVELOPMENT.md`（含「状态登记只有一份现值」与「执行总账」两节）及 P1-73 Spec 已完成「同码镜像」与常青池口径同步，无「待单独立项 0.35 总账」过渡句 | 文档 diff 复核 |
| SC-07 | 落地 diff 不触碰任何业务运行时代码（`webui/src/**`、`webui/server/**`、`deploy/**`） | `git diff --stat` 路径检查 |
| SC-08 | **单行精简约束**：常青池主表不写长篇状态散文与变更流水，活跃池全表平均行长 ≤ 220 字符（单行 ≤ 360 字符），总文件体积较旧总账（300 KB）下降 ≥ 85% | 迁移脚本统计输出 |

## 完成定义

- Wave 0–2 全部执行完毕，SC-01 至 SC-08 逐项通过。
- 常青需求池成为唯一需求台 SOT（Spec 头部仍为开发漏斗阶段唯一事实源），`v0.35.0-scope.md` 正式启用；后续切 `v0.36.0` / `v0.40.0` 只需新建轻量发版单、零改写需求池。
- 历史 0.30 两份巨型文档冻结归档，不再作为日常追加写入面。
- **本治理迁移完成 ≠ 任何产品功能合同收口 ≠ 系统可上线。**

## 风险

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| **共享工作区并发写入冲突** | 其他在途会话继续向旧 `0.30` 总账追加条目，导致迁移后漏单 | Wave 1 选在脏工作树提交后的干净节点执行，且建池与 lint 切换合入同一原子 PR；旧文件顶部加醒目冻结重定向横幅 |
| **历史交叉引用断链** | 大量 Spec、Plan、Review 与 UAT 跑次链接到旧 `0.30` 文件及 `#req-030-xxx` 锚点 | **严禁删除或重命名旧 0.30 文件**；仅冻结为只读历史快照并保留全部历史锚点 |
| **阶段双源漂移** | 若误把常青池与 Spec 头部都当作事实源，会出现两套现值 | 明确契约：**Spec 头部「阶段」格为开发漏斗唯一事实源，常青池仅为同码镜像**，由 `lint:inventory-stage` 在 PR CI 强制兜底 |
| **发版单与既有发布制品混淆** | `docs/releases/` 已有 `.json` 与 `release-notes.md`，易被误读为第四套叙事 | 命名为 `vX.Y.Z-scope.md` 并在头部写明仅作内部范围拉取单，不替代对外 release-notes 与机器制品台账 |
| **活跃池再次膨胀** | 初始活跃池约 92 行，若重新写入长状态散文或长期不归档，仍会膨胀 | 靠 SC-08 约束单行精简（只存阶段码＋短指针），并在 `DEVELOPMENT.md` 固定「发版收尾即批量沉降到 `archive.md`」动作 |

## 附录：2026-11-26 现行 0.30 台账双口径实证基线

以下为直接解析 `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md`（v2.90）与 `docs/plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md`（v0.182）的实测结果，作为 SC-01 迁移对账基线：

| 指标 | 总账物理全表口径（SC-01 正式基线） | 现行 `lint-spec-docs.mjs` 口径（`INVENTORY_ID_RE` 未剥离 `**`） | 差异原因 |
|---|---:|---:|---|
| 主表行数 | **110 行** | 100 行 | 现行 lint 未剥离 `cells[0]` 的 `**`，静默跳过 9 行加粗核心分母（`**P0-1**`–`**P0-7**`、`**P0-A**`、`**P0-B**`）＋ 1 行无 `P*` 编号的早期收口项（`—`／`REQ-030-003`） |
| 覆盖唯一 REQ 数 | **111 个**（与需求池 111 个差集为 **0**） | 101 个（漏 10 个） | `P1-2` 合并承载 `REQ-030-013／016`；`REQ-030-047` 全仓跳号不回填 |
| 在途 S1–S4 | **45 条**（S1=31／S2=4／S3=3／S4=7） | 42 条（S1=28／S2=4／S3=3／S4=7） | 差 3 条为被 lint 跳过的加粗核心分母 `**P0-6**`、`**P0-7**`、`**P0-B**`（均待 R2-F） |
| S5 功能合同已收口 | **44 条** | 37 条 | 差 7 条为被 lint 跳过的 `**P0-1**`–`**P0-5**`、`**P0-A**` 与 `REQ-030-003` |
| X_REL 发布取证已收口 | **3 条** | 3 条 | 完全一致（`P1-13`、`P1-30`、`P1-53`） |
| X_DEF 延期／结案 | **17 条** | 17 条 | 完全一致 |
| X_SUP 被取代 | **1 条** | 1 条 | 完全一致（`P1-50` 并入 `P1-45`） |
| 带加粗阶段前缀行 | 21 行（如 `**S1｜`） | 21 行（靠 `replace(/^\*+/,"")` 容忍） | 迁入常青池时统一归一化去掉加粗符号 |
| 漏迁 grandfather 主 Spec／Plan | **10 对**（9 条 P0＋`REQ-030-003`） | 被上述盲区掩盖，未触发 `inventory-stage` | 10 份主 Spec 头部均缺「阶段」格、10 份配对 Plan 均缺阶段前缀且均挂 `spec-status-funnel-grandfather.json`；Wave 1 原子 PR 一并回填并移出 grandfather（R1 方案 A） |
| `post-0.30` 两未来池 | **9 条**（`REQ-TE-001`–`008`＋`REQ-CAL-001`） | 未纳入扫描 | 按 OQ-4 裁定是否携带原授权边界与 `类型` 列并入 |
