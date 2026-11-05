# Lucy 0.30.0 需求池

| 元数据 | 内容 |
|---|---|
| 文档类型 | 候选需求池。**不是**功能 Spec，**不授权**实现 |
| 版本 / 日期 | v0.6 / 2026-11-05 |
| 状态 | **候选需求池（2026-11-05）**。REQ-030-001–017 登记在池；除已注明拉出收口者外均为 Deferred，不进入 `0.25.0`。本条不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | **只登记、不实现**。条目进入实施前须：需求澄清 → 独立 Spec → Plan → 开发授权；本池自身不构成其中任一步 |
| 验收 | 本池自身的验收＝条目结构完整（ID／标题／来源／优先级／状态齐备）＋ 来源可追。**不构成任何功能验收** |
| 目标版本 | 候选产品线 **`0.30.0`**（尚未开线；当前产品线仍是 `0.25.0`） |
| 维护规则 | 只追加条目；开工前须另立 Spec／Plan 并获授权。不得把本文件当作本版（`0.25.0`）实施依据 |
| 变更 | v0.6（2026-11-05）：复核实跑归因——REQ-030-013 五合一拆分为编译门禁单条（BY-19），新增 REQ-030-016（各面拒绝码统一）/017（explain E5 形状）；BY-05 改判口径争议（Spec 99 §6 strip-then-inject 合规、harness 更严）移出池归 debug，确认收紧后再入池。v0.5（2026-11-05）：按 row-policy 强度 B 实跑归因（`inbox/row-policy-b-run-notes.md`）追加 REQ-030-013–015，只登记缺陷/能力缺口，不授权实现。v0.4（2026-11-05）：追加 REQ-030-012（语义层宽表字段暴露裁剪；澄清结论已写入条目，仍不授权实现）。v0.3（2026-11-03）：按 [D 剥离记录](../reviews/2026-11-03-product-close-peel-d.md) 追加 REQ-030-008–011。v0.2：按 [A／B](../reviews/2026-11-03-product-close-peel-a-b.md) 追加 REQ-030-002–007 |

## 目标

- 统一登记 `0.30.0` 候选版本的需求，避免散落在 UAT 反馈、对话与临时笔记里。
- 每条需求保留可追的来源（UAT 反馈页、Spec 编号、外部诉求），供开线时做优先级裁决。
- 让「本版不做」有正式落点：本池条目默认不进当前产品线，避免被误读为已承诺交付。

## 与现行版本的关系

- 当前分支 / `VERSION` 产品线是 **`0.25.0`**（见 `docs/governance/version-matrix.md`、`docs/runbooks/lucy-release-train-workflow.md` §2.2）。
- 本文件登记的是**后续候选版本 `0.30.0`** 的需求池，**不进入本版优化或实现**。
- 条目被正式纳入某版本实施前，须：需求澄清 → 独立 Spec → Plan → 开发授权。本池本身不构成其中任一步。

## 条目索引

| ID | 标题 | 来源 | 优先级（池内） | 状态 |
|---|---|---|---|---|
| REQ-030-001 | 发布工作台：分文件勾选发布 | 2026-11-02 `/publish/workbench` UAT 反馈 | 待定 | Deferred — 不进 `0.25.0` |
| REQ-030-002 | 帮助中心体验（L25-12） | Spec `lucy-20261031-help-center-experience` | 待定 | Deferred — 不进 `0.25.0` |
| REQ-030-003 | 访问关系图与访问日志口径对齐 | Spec `lucy-20261102-access-map-audit-echo` | 待定 | **已拉出；功能合同已收口（2026-11-04）**。S1–S3 已落地；SC-14 逐边在出口；SC-12 页序子句已拆出。本条收口不表示可上线。不进 `0.25.0` |
| REQ-030-004 | 运维控制面 W-B（语义发布） | L25-16 W-B；Spec `lucy-20261028-v0p25-lucy-ops-control-plane` | 待定 | Deferred — 不进 `0.25.0` |
| REQ-030-005 | 客户升级 E2E 自动化（L25-07） | Spec `lucy-20261025-v0p25-upgrade-e2e-automation` | 待定 | Deferred — 发布取证；不进 `0.25.0` 产品分母 |
| REQ-030-006 | 升级候选验证环境（L25-13） | Spec `lucy-20261025-v0p25-upgrade-candidate-verification` | 待定 | Deferred — 发布取证；不进 `0.25.0` 产品分母 |
| REQ-030-007 | E2E 主线与旁线优化（harness） | Spec `lucy-20261025-v0p25-e2e-mainline-and-branch-optimization` | 待定 | Deferred — 工程 harness；不进 `0.25.0` 产品分母 |
| REQ-030-008 | 访问关系图 Spec 187 验收矩阵 | `webui/docs/187-access-relation-sankey-spec.md` SC-01–14 | 待定 | Deferred — 已实现；验收不进 `0.25.0` 产品分母 |
| REQ-030-009 | OIDC 功能合同验收（L25-06） | Spec `lucy-20261025-v0p25-oidc-single-sign-on` OIDC-01–21／26 | 待定 | Deferred — 已实施；验收不进 `0.25.0` 产品分母 |
| REQ-030-010 | 语义整批恢复 SRR 验收（L25-15） | Spec `lucy-20261027-v0p25-semantic-release-restore` SRR | 待定 | Deferred — 代码已落；验收不进 `0.25.0` 产品分母 |
| REQ-030-011 | 运维控制面 W-A VOPS 验收 | L25-16 W-A；VOPS（除已拆出） | 待定 | Deferred — 已授权实现；验收不进 `0.25.0` 产品分母 |
| REQ-030-012 | 语义层宽表字段暴露裁剪 | 2026-11-05 产品澄清（对话登记） | 待定 | Deferred — 不进 `0.25.0`；未开 Spec |
| REQ-030-013 | 行权限行策略编译门禁（度量/派生列作谓词字段零上游执行） | 2026-11-05 row-policy 强度 B 实跑（BY-19） | 高 | Deferred — debug 实锤 fail-open；未开 Spec |
| REQ-030-016 | 行权限各面拒绝码统一（row_policy_requires_wrapped_tool） | 2026-11-05 row-policy 强度 B 实跑（BY-06/17） | 待定 | Deferred — 单元期望与实跑不一致；未开 Spec |
| REQ-030-017 | lucy_explain_query 诊断形状补全（E5 summary） | 2026-11-05 row-policy 强度 B 实跑（BY-18） | 低 | Deferred — 未开 Spec |
| REQ-030-014 | 行权限模板展开保留 templateRefs | 2026-11-05 row-policy 强度 B 实跑（ROW25-V01/V03、RTP25-02） | 待定 | Deferred — 归口行权限视图 Spec SC-10 功能闭口；未开 Spec |
| REQ-030-015 | 语义层孤儿路径治理（lucy-ops 反查孤儿） | 2026-11-05 row-policy 强度 B 实跑（RTV25-06） | 待定 | Deferred — 未开 Spec |

---

## 开工前置

条目从本池进入实施前必须依次满足：

1. **需求澄清**：与委托人确认诉求边界、现行约束冲突项与不做项，结论写回本条目。
2. **独立 Spec**：另立或恢复既有 Spec 的开工授权；不得以本池条目代替 Spec。
3. **Plan**：另立或恢复对应 Plan，登记进 `docs/plans/README.md`。
4. **开发授权**：获得明确开工授权后，才可改代码。

未满足上述四步时，条目状态保持 Deferred，不得进入当前版本实施。

## 验收

- 本池级验收：条目 ID／标题／来源／优先级／状态五列齐备；来源可追到 UX 台账条目或 Spec 编号；状态与「本版不做」的表述一致。
- 条目级验收：在该条目的 Spec 中完成，不在本池内验收。
- **本池不产出功能验收结论**，也不作为任何版本的发布取证。

## 完成定义

- 需求池文件存在、可被索引登记、条目结构完整。
- 每个条目都有来源与明确状态（含 Deferred）。
- 条目索引表与正文条目一一对应，无孤儿条目。
- 本版（`0.25.0`）的交付范围不受本池影响。

## 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 被当成实施依据 | 有人把池内条目直接排进 `0.25.0` | 文件头写明不授权实现；条目状态默认 Deferred |
| 版本号漂移 | 池名写死 `0.30.0`，与实际开线版本不一致 | 开线时由需求澄清环节确认并整体改写，不静默沿用 |
| 需求丢失 | 诉求散落各处，池内漏登记 | 登记时必须回填来源；与 Spec 头部 Deferred 句双向可追 |

---

## REQ-030-001：发布工作台分文件勾选发布

### 背景

用户在 `/publish/workbench`「待发布变更」看到多条「新增」条目，但无勾选，不知道如何发布。左栏文案写明「本批一并同步 N 项（不可分文件勾选）」。现行 Spec（123、20261030 三栏）约定：**整批同步**，主动作在中栏「生效准备」的「同步索引并生效」。

用户曾倾向「左栏勾选再发布」，经澄清后确认：当前 reindex 消费整内容根，真·分文件生效需改发布/索引管线；本版不做。该项纳入 **`0.30.0` 需求池**，**本版不做优化、不开 Spec、不改代码**。

### 期望方向（池内草案，未冻结）

真·分文件发布：操作者勾选待发布文件；仅勾选范围进入本次生效；未勾选项继续留在待发布，且索引实际影响不得与确认面不一致。

### 已知硬约束（开 Spec 前必须回答）

1. 现行 `POST /api/semantic-assets/reindex` 对内容根做整批索引同步，无法用 UI 勾选静默缩小实际影响（Spec 20261030 明确禁止「本页范围缩小索引实际影响」）。
2. 真·分文件生效至少要回答：未选中的脏文件如何不进索引、与镜像/内容根一致性、校验与确认范围、发布记录与恢复边界。
3. 现行 Spec 123 / 20261030 的「整批同步、不可分文件勾选」须在开线时显式修订或取代，不能 silently 绕过。

### 非目标（本条目当前）

- 不在 `0.25.0` 增加勾选框、半真半假的「选了但不生效」交互。
- 不把「仅审阅聚焦多选」误写成已交付分文件发布。
- 本轮不修同页条目阴影一致性等视觉 polish（见关联反馈；同属本版不做）。

### 关联

- 页面：`/publish/workbench`
- UX 台账：`docs/ui-ux-feedback/pages/publish-workbench.md` → `UX-PUBLISH-WORKBENCH-010`
- 现行约束：`webui/docs/123-publish-workbench-activation-ia-spec.md`；`docs/specs/lucy-20261030-publish-workbench-three-column-spec.md`（不引入分文件选择发布）

### 本版临时用法（给操作者，非产品变更）

有待同步文件时：看中栏「生效准备」→「校验变更」→「同步索引并生效」→ 确认侧栏提交。左栏点击只打开差异，不发布。

---

## REQ-030-002：帮助中心体验（L25-12）

### 背景

L25-12 帮助中心 Spec／Plan 已落盘为 v0.1-draft；2026-11-02 起本版不实施、不评审、不开工。2026-11-03 产品收关将本条正式迁入 `0.30.0` 池。

### 期望方向

门户 → 分类 → 文章三层 IA；独立「快速入门」；复制／导出 Markdown；浏览器打印。细节以既有 Spec 为准，开线前须再澄清。

### 关联

- Spec：`docs/specs/lucy-20261031-help-center-experience-spec.md`
- Plan：`docs/plans/lucy-20261031-help-center-experience-plan.md`
- 台账：`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` §2.6

---

## REQ-030-003：访问关系图与访问日志口径对齐

### 背景

Spec／Plan v0.3 可定稿（Codex 两轮）。2026-11-03 曾迁入池；**2026-11-04 用户批准拉出实施**（Plan 升 v0.4）；同日 **S1–S3 实施完成**，出口修订把 SC-12 页序子句拆出、SC-14 逐边留在出口，并批准 **功能合同已收口（2026-11-04）**。本条收口不表示可上线。实施笔记：`docs/reviews/2026-11-04-access-map-audit-echo-implementation-notes.md`。

### 期望方向

访问关系图工具条与访问日志共用问询种类／访问等级；关联口径降为弱入口；投影集合 E 可打假。细节以既有 Spec 为准。

### 关联

- Spec：`docs/specs/lucy-20261102-access-map-audit-echo-spec.md`
- Plan：`docs/plans/lucy-20261102-access-map-audit-echo-plan.md`（v0.4）

---

## REQ-030-004：运维控制面 W-B（语义发布）

### 背景

L25-16 W-A（连接表／源表导入）已授权实现；W-B（语义发布控制面）仍不可交付开发，依赖 L25-11 审阅通过与 G31。2026-11-03 将 **W-B 单独**迁入池；W-A 仍留在 `0.25.0` 登记（中间带，本轮不动）。

### 期望方向

`lucy_ops_*` 语义发布包装；消费既有 staged 批次；独立授权与审计归因。开线前须重核 G31／批次消费合同。

### 关联

- Spec：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md`（W-B 段）
- Plan：`docs/plans/2026-10-28-lucy-v0.25-lucy-ops-control-plane-implementation-plan.md`（S5）

---

## REQ-030-005：客户升级 E2E 自动化（L25-07）

### 背景

整条合同对象是真实旧版→候选的升级取证（Docker／K3s／K8s），不是产品功能闭口。脚本在仓；真实升级未授权（`blocked_delivery`）；非门禁。2026-11-03 剥离出 `0.25.0` 产品分母。

### 关联

- Spec：`docs/specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md`
- 上游：`docs/plans/2026-10-19-upgrade-e2e-implementation-plan.md`

---

## REQ-030-006：升级候选验证环境（L25-13）

### 背景

隔离环境备份恢复验证通道，不是交付通道，也不是产品功能闭口。2026-11-03 剥离出 `0.25.0` 产品分母。

### 关联

- Spec：`docs/specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md`
- 上游：`docs/plans/2026-10-22-upgrade-candidate-verification-plan.md`

---

## REQ-030-007：E2E 主线与旁线优化（harness）

### 背景

测试组织与证据 harness，不改变任何功能 Spec 的验收语义。2026-11-03 剥离出 `0.25.0` 产品分母。

### 关联

- Spec：`docs/specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md`
- Plan：`docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md`

---

## REQ-030-008：访问关系图 Spec 187 验收矩阵

### 背景

L25-08 访问关系图已实现。本版叠加条（quiet-reading／chart-first／geometry）各自收口或已实施。Spec 187 的 SC-01–14 主验收矩阵仍未执行。2026-11-03 D2：本版产品闭口只认「已实现」与叠加条，主矩阵进池。

### 关联

- Spec：`webui/docs/187-access-relation-sankey-spec.md`

---

## REQ-030-009：OIDC 功能合同验收（L25-06）

### 背景

OIDC 已实施；OIDC-22–25 已拆出归交付。OIDC-01–21 与 OIDC-26 仍未执行。2026-11-03 D2：本版只记「已实施」，正式验收进池。

### 关联

- Spec：`docs/specs/lucy-20261025-v0p25-oidc-single-sign-on-spec.md`

---

## REQ-030-010：语义整批恢复 SRR 验收（L25-15）

### 背景

S1–S6 运行代码与定向测试已落地；SRR-22 已拆出。SRR-01–21、SRR-23–24 仍未执行。2026-11-03 D2：本版只记代码已落，SRR 验收进池。

### 关联

- Spec：`docs/specs/lucy-20261027-v0p25-semantic-release-restore-spec.md`

---

## REQ-030-011：运维控制面 W-A VOPS 验收

### 背景

W-A 已授权实现；W-B 已是 REQ-030-004。VOPS-27／30 已拆出；其余 VOPS 仍未执行。2026-11-03 D2：本版只记实现授权／代码在仓，W-A VOPS 验收进池。

### 关联

- Spec：`docs/specs/lucy-20261028-v0p25-lucy-ops-control-plane-spec.md`

---

## REQ-030-012：语义层宽表字段暴露裁剪

### 背景

宽表接入语义层后，Agent 经 Catalog / 读源 / 查数看到全量物理列，上下文噪音大、易误用字段。现行合同要求 standalone source 含全部物理列；ACL 仅为表级 + Row Policy；列级权限与脱敏不在现行承诺。合规侧「库内不可见」仍靠 VIEW / 拆表兜底，不是产品化「勾选删列」。

2026-11-05 产品澄清：要的是 **Source 级业务暴露裁剪**（全实例同一套采用集），不是列级 ACL；倾向 **Lucy 门面闸**（库存与暴露分离，不改 KTX 全物理列合同、不手删 Manifest 列）。

### 期望方向（池内草案；澄清已写，设计未冻结，不授权实现）

- **库存 ≠ 暴露**：Manifest / 扫描保留全量物理库存；另维护本 Source 的暴露集供 Agent 数据面使用。
- **运行时（A1）**：未暴露列在 `lucy_catalog` / `lucy_read_source`（及等价发现面）不可见；`lucy_query`（及等价查数）点名未暴露列 → 拒绝（fail-closed）。闸落在 Lucy MCP Proxy 等 Agent 入口，避免半通。
- **发布（B1）**：grain / measure / segment / join / 派生列仍引用未暴露列 → 发布/生效硬失败并指出引用方。
- **新列（C2）**：扫描到的新物理列默认自动进入暴露集；裁剪靠事后在工作台收敛。
- **操作面（D1）**：表语义工作台字段列表维护暴露/取消暴露；变更进待发布；工作台仍能看到「已取消暴露」库存以便恢复。
- **推荐实现方向**：Lucy 门面闸（路线 1）。存量无显式配置的 Source 等价「全库存暴露」。

### 非目标（本条目当前）

- 列级 ACL / 脱敏 / 按 Role 异列。
- 替代合规用 VIEW；不改库表结构。
- 从 Manifest 物理删除列，或改写 KTX「全物理列」合同作为主路径。
- 本版（`0.25.0`）不优化、不开 Spec、不改代码。

### 已知硬约束（开 Spec 前必须再核）

1. 暴露集须版本化并随发布进入运行内容根；不得只活在浏览器本地状态。
2. A1 必须覆盖所有 Agent 查数/发现入口，禁止 Catalog 已裁、Query 仍通的半通形状。
3. 与现行 semantic-author / 上传 / `sl read` 全物理列叙事的文档与门禁对齐方式（库存保留、暴露另册）。
4. 文案与交付口径必须写清：业务暴露裁剪 ≠ 列级安全。

### 关联

- 澄清来源：2026-11-05 产品对话（路线 1 已认可；本池只登记）
- 相关既有边界：`docs/governance/vision.md`（不做列级脱敏）；`docs/access-control/*`（VIEW-as-pseudo-table 兜底）；表语义工作台既有 Spec（`webui/docs/48` 等）；MCP Proxy Catalog/Query 面（`webui/docs/07-mcp-auth-proxy-spec.md`）
- 开线前须另立独立 Spec／Plan；本条目不构成其中任一步


---

## REQ-030-013：行权限行策略编译门禁（度量/派生列作谓词字段）

### 背景

2026-11-05 row-policy 强度 B 两阶段实跑（`inbox/e2e/final-rds-20261105`，证据
`evidence/phase-on/security.json` 的 SEC-11-BY19）实锤：行策略谓词引用语义度量名
（`total_sales` 作谓词字段，语义编译失败类输入）时，门禁未在编译期拦截，实测上游
执行 1 次。合同口径：编译期拒绝且零上游执行（fail-closed）。

### 期望方向（池内草案；不授权实现）

- 行策略编译校验覆盖「度量/派生列作谓词字段」类输入，拒绝发生在任何上游执行之前。
- 拒绝原因码进入行策略专属命名空间，与 REQ-030-016（各面拒绝码统一）一并设计。

### 非目标（本条目当前）

- 不改冻结 catalog 合同字面量；不动 `--pack row-policy` 的只读边界。
- 不涵盖 forged forced 处理口径（BY-05 归 debug，见收工笔记）；本版（`0.25.0`）不修复。

---

## REQ-030-016：行权限各面拒绝码统一

### 背景

同一实跑 BY-06／BY-17：entity_details／sl_validate／lucy_freshness 在 scoped source
上的拒绝码实测为 `tool_forbidden`，而浏览器面同场景（ROW25-V17 通过）与单元期望
（row-policy-ac-p1.test.ts「BY-06/07/17」用例）均为 `row_policy_requires_wrapped_tool`。
同一拒绝语义在不同执行面使用不同 reason code，排障与合同断言都会分叉。

### 期望方向（池内草案；不授权实现）

- 同一拒绝语义在各 MCP 工具面与浏览器面使用同一 reason code 命名空间。
- 以单元合同测试固化各面一致；实跑 BY-06/17 作为验收。

### 非目标（本条目当前）

- 不改变拒绝本身的行为（拒绝已发生，只是码不一致）。
- 本版（`0.25.0`）不修复；修复须另立 Spec／Plan 并获授权。

---

## REQ-030-017：lucy_explain_query 诊断形状补全（E5 summary）

### 背景

同一实跑 BY-18：`lucy_explain_query` 的 forced 谓词本地诊断 E1..E4 可用，但 E5
summary=undefined，响应 envelope 不被实跑识别。诊断形状合同不完整。

### 期望方向（池内草案；不授权实现）

- 补齐 E5 summary 字段并固化形状合同测试；诊断保持本地-only、零上游转发。

### 非目标（本条目当前）

- 不改变 explain 的本地诊断定位；不新增数据返回路径。
- 本版（`0.25.0`）不修复；未开 Spec。

---

## REQ-030-014：行权限模板展开保留 templateRefs

### 背景

同一实跑浏览器腿维度证据（phase-on v025 条目 `executorResults.B.assertions`）：ROW25-V01／ROW25-V03 与 RTP25-02 的 `allow_control` 断言记录 `refs=[]`——模板展开后 templateRefs 丢失，「最终约束引用了哪个模板」不可追溯。row-policy 实施计划风险表已预告此项属产品缺陷，归**行权限视图 Spec SC-10** 功能闭口。

### 期望方向（池内草案；不授权实现）

- 模板展开为 scoped 条件时保留 templateRefs（模板 id／版本）于预览与运行时证据。
- 视图反查与 digest 比对继续以展开后条件为准，templateRefs 不改变判定语义。

### 非目标（本条目当前）

- 不改变 digest／policyVersion 计算口径。
- 本版（`0.25.0`）不修复；归口功能闭口走其既有授权路径。

---

## REQ-030-015：语义层孤儿路径治理（lucy-ops 反查孤儿）

### 背景

同一实跑 RTV25-06（反查与关系图同快照）维度证据：按表反查出现孤儿路径一批，均指向 `lucy-ops::main::ops_*`（`ops_access_paths`／`ops_agent_activity`／`ops_agents`／`ops_call_tables`／`ops_calls`／`ops_edge_signals` 等）。关系图计数与反查路径数因此不一致。性质为语义层/视图数据完整性问题，非用例问题。

### 期望方向（池内草案；不授权实现）

- 清点 `lucy-ops` 语义层孤儿路径来源（残留引用／已删对象／命名漂移三选一归因）。
- 反查与关系图读取同一份快照口径；孤儿不再计入路径数或在两处一致呈现。

### 非目标（本条目当前）

- 不在本条重建语义层对象；不改 RTV25 合同口径。
- 本版（`0.25.0`）不修复；未开 Spec。
