# UAT：AC-P0 Access Control

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P0 UAT 勾选清单 |
| 文档类型 | Checklist |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | `design-upgrade.md` §5；Spec 98 §11；WO WP-I7；`inbox/20260809-gate-c-uat/` |
| 适用范围 | Gate C 人工验收 |
| 输出位置 | `docs/access-control/uat-ac-p0.md` |

> 勾选规则：关键路径必须人工勾选；已有自动化覆盖的项可标注「自动化」但仍需抽检。  
> **Gate C 签字：** 2026-08-09 由 xingchen 批准勾选（集成环境 `lucy-gate-c-uat`；证据见 `inbox/20260809-gate-c-uat/` 与 `09-uat-signoff.md`）。

## Fixture（对齐 design §5.0）

- [x] Role A/B/C 与 Agent `wang` / `legacy_user` 已在环境准备 — `02-fixture-setup.md`
- [x] AbsoluteDeny 含 `sl_query` / `sl_read_source` — MCP + defaults.deny_tools

## 场景勾选

### S1 多 Token 同权

- [x] T1/T2 `lucy_catalog` 同源集合与同 `policyVersion` — `03-mcp-positive-negative.jsonl`
- [x] 撤销 T1 → 401；T2 不变 — `04-token-revoke.json`

### S2 / S2b Capability

- [x] `lucy_query` × 订单源 allow — demo `superstore_orders`（对照财务源场景）
- [x] `lucy_read_source` × 订单源 **deny** `capability_forbidden`
- [x] Admin Capability Preview 展示元组（非仅双并集） — `screenshots/09-wang-capability-preview.png`
- [x] 跨 Role join：缺一侧 capability → deny — `wang` deny / `join_ok_user` allow

### S3 版本 / prefix

- [x] v2 缺 `row_access` / `scoped` / `prefix` → 保存失败 — Admin API 400（scoped）+ Path A 外部非法 prefix
- [x] Admin 保存 v1 → 升 v2 + `all` + `prefix` 展开；dryRun 可见 — 自动化 U-VER-04 + Role Admin 保存路径抽检

### S5 工具分级

- [x] `sl_*` deny；删 YAML deny_tools 后仍 deny — AbsoluteDeny 代码基线 + MCP 抽检（U-DENY-01 自动化）
- [x] 未分类工具不出现在 list、调用 deny — AC-SEC-CLS / U-CLS-02 自动化绿 + tools/list 抽检

### S6 Legacy

- [x] 单 Role v1 行为与升级前等价（U-COMPAT-01 自动化绿 + 抽检） — 自动化绿；`legacy_user` / `gatec_legacy_prefix` fixture 在位
- [ ] prefix 扩权产生 `policy_scope_expanded` 配置审计 — **本轮 demo UAT 未单独留证**（保留待后续补）

### S7 / S10 编译提交

- [x] 坏 Role 保存失败 / `runtimeAck=false`：错误 Toast，**不**导航、**不**清空 diff/确认态 — scoped 保存拒绝；合法保存 Toast 含 `policyVersion`（`05-admin-ui.md`）
- [x] 外部坏 YAML → banner + DataPlane deny；Wiki Meta 仍可用 — Path B：`degradedGlobal` + banner（`08-*` / `screenshots/19-*`）
- [x] `/api/health` 在策略未初始化或降级时 `status=degraded` — Path A/B health 证据

### S8 Canonical key

- [x] 跨 connection 同名源不串策略 — AC-SEC-KEY / U-KEY-* 自动化绿
- [x] 审计展示 `policyVersion` + capability digest — Audit API `decisionReasonPrefix=capability_forbidden`（`05-admin-ui.json`）

### S11 / S12

- [ ] VIEW 迁 v2+names+all 行为不变 — **demo 环境未覆盖**（见集成 UAT 方案 §5）
- [ ] 语义层新增源：v2 names 不静默扩权；v1 prefix 扩权可观测 — **demo 环境未覆盖**；AC-SEC-SCOPE 自动化绿可作旁证

### I6 可观测

- [x] Admin 降级 banner — Path A/B 截图 18/19
- [x] 保存 Toast 含 `policyVersion`；`runtimeAck=false` 为错误提示 — `05-admin-ui.md` / 截图 17
- [x] Audit 可筛 `capability_forbidden`；行内可见 `policyVersion` — UI + API

### I7 门禁材料

- [x] AC-SEC-SL/CLS/CAP/KEY/SCOPE 自动化绿 — Gate C A4 矩阵
- [x] Runbook 路径 A/B 演练签字（见 `runbook-policy-degrade.md`）

## 签字

| 角色 | 姓名 | 日期 |
|---|---|---|
| 产品 / 数据 | xingchen | 2026-08-09 |
| 工程 | xingchen（批准勾选） / Cursor Agent（执行留证） | 2026-08-09 |
| 安全 / 运维 | xingchen | 2026-08-09 |

**附注：** Gate C 含 `tsc --noEmit` 书面豁免（见 `plans/20260809-gate-c-sc-evidence.md` §1.A3）。已知瑕疵：Agent UI 对 `roles[]` 展示不完整；全局降级时 MCP 曾返回 HTTP 502 而非清晰 `policy_degraded_deny`（控制面 banner/health 正确）。
