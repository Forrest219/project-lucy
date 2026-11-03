# Lucy 0.30.0 需求池

| 元数据 | 内容 |
|---|---|
| 文档类型 | 候选需求池。**不是**功能 Spec，**不授权**实现 |
| 版本 / 日期 | v0.2 / 2026-11-03 |
| 状态 | **候选需求池（2026-11-03）**。REQ-030-001–007 均为 Deferred，不进入 `0.25.0`。本条不表示任何功能已获授权实现，也不表示可上线 |
| 授权边界 | **只登记、不实现**。条目进入实施前须：需求澄清 → 独立 Spec → Plan → 开发授权；本池自身不构成其中任一步 |
| 验收 | 本池自身的验收＝条目结构完整（ID／标题／来源／优先级／状态齐备）＋ 来源可追。**不构成任何功能验收** |
| 目标版本 | 候选产品线 **`0.30.0`**（尚未开线；当前产品线仍是 `0.25.0`） |
| 维护规则 | 只追加条目；开工前须另立 Spec／Plan 并获授权。不得把本文件当作本版（`0.25.0`）实施依据 |
| 变更 | v0.2（2026-11-03）：按 [A／B 剥离记录](../reviews/2026-11-03-product-close-peel-a-b.md) 追加 REQ-030-002–007 |

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
| REQ-030-003 | 访问关系图与访问日志口径对齐 | Spec `lucy-20261102-access-map-audit-echo` | 待定 | Deferred — 不进 `0.25.0` |
| REQ-030-004 | 运维控制面 W-B（语义发布） | L25-16 W-B；Spec `lucy-20261028-v0p25-lucy-ops-control-plane` | 待定 | Deferred — 不进 `0.25.0` |
| REQ-030-005 | 客户升级 E2E 自动化（L25-07） | Spec `lucy-20261025-v0p25-upgrade-e2e-automation` | 待定 | Deferred — 发布取证；不进 `0.25.0` 产品分母 |
| REQ-030-006 | 升级候选验证环境（L25-13） | Spec `lucy-20261025-v0p25-upgrade-candidate-verification` | 待定 | Deferred — 发布取证；不进 `0.25.0` 产品分母 |
| REQ-030-007 | E2E 主线与旁线优化（harness） | Spec `lucy-20261025-v0p25-e2e-mainline-and-branch-optimization` | 待定 | Deferred — 工程 harness；不进 `0.25.0` 产品分母 |

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

Spec／Plan v0.3 可定稿（Codex 两轮）；定稿不表示开发已授权。2026-11-03 明确本版不开发，迁入池。

### 期望方向

访问关系图工具条与访问日志共用问询种类／访问等级；关联口径降为弱入口。细节以既有 Spec 为准。

### 关联

- Spec：`docs/specs/lucy-20261102-access-map-audit-echo-spec.md`
- Plan：`docs/plans/lucy-20261102-access-map-audit-echo-plan.md`

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
