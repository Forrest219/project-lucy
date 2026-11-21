# Runbook：AC-P1 行策略误配与未证明恢复

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1 / P1.5 行策略与 Agent Constraints 恢复 Runbook |
| 文档类型 | Checklist |
| 版本 | v1.3 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 99；Spec 100；ADR 上游强制谓词；WO-60 WP-I6；WO-61 WP-I5；总签 `inbox/20260809-ac-p15-gate-c-signoff.md` |
| 适用范围 | Gate C 演练与生产恢复；配合 [`runbook-policy-degrade.md`](runbook-policy-degrade.md) |
| 输出位置 | `docs/access-control/runbook-row-policy.md` |

---

## 当前启用方式（2026-11-20，P1-72）

合法行策略保存并收到运行确认后，查询自动强制执行，不需要设置 LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN 或重启。旧变量的所有值均已忽略；若需紧急停用问数，使用现有 Agent 停用／Token 吊销。不得删除行策略来代替停用。

当前合同：[行权限自动强制执行](../specs/lucy-20261120-row-policy-automatic-enforcement-spec.md)。以下保留的 2026-08-09 签字属于历史证据，不再构成部署人工启用要求。

## 症状对照

| 症状 | 常见原因 | 裁决码 / 信号 |
|---|---|---|
| scoped 源无法取数 | 检查身份／表权限、字段绑定、策略编译与查询形状；若仍出现旧码，核对是否运行旧版本 | 记录实际裁决码；不靠修改旧变量恢复 |
| 未包装工具 / 整源读失败 | O2 fail-closed | `row_policy_requires_wrapped_tool` |
| 查询被拒（字符串 filter / expr / join） | 受保护源 args 加严 | `invalid_arguments:…` / `row_policy_query_shape_forbidden` |
| Role / Agent 无法保存或 Agent DataPlane 全拒 | 非法 `row_policy`、measure 字段、缺 policy、非法 Agent `constraints`、Role 上 `constraints`、超限 / 不可满足 FinalRows | `row_policy_*` / `constraints_*` / `final_rows_*` / `role_resolution_failed:*` |
| Admin 编译失败 banner | 外部坏 YAML（含非法 scoped / 坏 constraints） | 见 AC-P0 降级 Runbook |
| `row_access:all` 带个人约束 | Agent Constraints 参与最终行约束；自动执行 | 核对约束与查询形状，不需要运维开关 |

---

## 路径 A — 行策略误配（Admin 修复）

1. 确认错误：Admin dryRun / 保存错误，或审计 `decision_reason` 前缀 `row_policy_`。
2. 打开 Role → selector：
   - `scoped` 必须有 `row_policy.predicates`；`op` ∈ {eq, in}
   - `field` 必须是该源 **columns / 行级 dimension**，**禁止** measure 名（如 `total_sales`）
   - `all` 不得带 `row_policy`
3. dryRun → 确认 preview `rowGrant` 为 `all` 或带 `digest` 的 scoped。
4. 保存；确认 `runtimeAck` + 新 `policyVersion`。
5. 抽测：
   - 默认环境：`lucy_query` × scoped → 自动强制过滤，抽查无域外行
   - `lucy_read_source` / `lucy_freshness` / `entity_details` × scoped → `row_policy_requires_wrapped_tool`
   - `lucy_explain_query` → 本地允许（诊断）

---

## 路径 B — 已保存策略但查询失败

1. 核对运行版本：新版本不再产生因缺少人工证明标志导致的拒绝；旧版本仍需按其历史合同排查。
2. 读取实际裁决码，区分字段／目录绑定、策略编译、工具权限与查询形状；按相应错误修复，不改旧证明变量。
3. 对受保护源使用 `lucy_query`；确认返回范围与最终行约束一致，用户过滤只能收紧。
4. 若怀疑强制过滤执行异常，先停用受影响 Agent 或吊销 Token，保留策略和审计，修复后用隔离真实查询验证再恢复。不得去掉行限制恢复查询。
5. 代理自动注入的过滤与调用方手写字符串过滤不同，不能用后者充当行权限。

---

## 路径 C — 回滚非法 scoped 配置

1. 若外部手改 YAML 引入非法 scoped / measure field → 按 [`runbook-policy-degrade.md`](runbook-policy-degrade.md) 路径 A 或 B。
2. 回滚到上一份可编译 `access.yaml`（无非法 row_policy）。
3. 确认 `degradedGlobal=false` / banner 消失；抽测 AbsoluteDeny `sl_*` 仍成立。

---

## 发布验证检查单

证明由产品开发与发布验证承担，不再让运维填写 true。

- 行策略、Agent Constraints、字段绑定、伪造字段剥离与形状拒绝回归通过；
- 普通 MCP 和内部查询入口均有 filters 强制前缀，并在真实 bundled KTX／目标适配路径验证行集和聚合；
- 默认未设置与遗留 false／true 的结果一致；
- 注入失败不转发、不退回全部行；
- 不把本机证据外推为全部数据库／上游版本支持，不宣称 Dynamic RLS／多租户隔离。

历史 Gate C 材料仍见 [uat-ac-p1](uat-ac-p1.md) 与 [载体证据](evidence-ktx-forced-filters.md)。

---

## 路径 D — Agent Constraints 误配 / 超限（AC-P1.5）

1. 确认错误：Agent Admin dryRun / 保存错误码含 `constraints_*` 或 `final_rows_*`；或 Agent 编译失败导致 DataPlane degrade。
2. 打开 **Agent**（非 Role）→ Constraints 编辑器：
   - `names` 中**每一个** name 必须属于该 Agent 当前 Data Capability（半合法 mixed names → 失败，不会静默忽略）
   - `op` ∈ {eq, in}；字段须为 columns / 行级 dimension，**禁止** measure
   - 同字段互斥 `eq`/`in` → `final_rows_unsatisfiable`
   - 超限（Role arms / Constraints preds / DNF）→ `final_rows_limit_exceeded`
3. Role YAML **不得**出现 `constraints`（保存/编译拒绝 `constraints_forbidden_on_role`）。
4. 修复后 dryRun：确认每源 **FinalRows** 摘要 / digest / protected；**不**把「编译通过」当成「行级取数已生效」。
5. 保存须 `runtimeAck === true` + `policyVersion`；失败则盘与 runtime 保持写前（U-REL）。
6. 抽测：
   - FinalRows≠TRUE → 自动强制过滤，抽查结果仅在最终行域内
   - 未包装工具 → `row_policy_requires_wrapped_tool`
   - 清除约束：`PATCH constraints: null` 后 FinalRows 回到 EffectiveRowGrant

---

## 禁止

- 将 Segment / 用户 filters 当作行权限
- 未证明时字符串碰运气注入
- 对外宣称 Dynamic RLS / DB 原生 RLS / **TokenScope 行收紧**已交付
- 宣称「多 Role 自动对人级行集做 AND」（人级收紧仅 Agent Constraints）

---

## 演练签字（Gate C）

> 演练证据：`inbox/20260809-ac-p1-runbook-uat/`（过程见 `09-process-and-conclusion.md`）。  
> `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` 演练结束后已恢复 **false**。

| 项 | 执行人 | 日期 | 结果 |
|---|---|---|---|
| 路径 A 误配修复 | Cursor Agent（执行）/ **xingchen（批准）** | 2026-08-09 | **PASS** |
| 路径 B 关闭误开 proven | Cursor Agent（执行）/ **xingchen（批准）** | 2026-08-09 | **PASS** |
| 路径 C 回滚非法 YAML | Cursor Agent（执行）/ **xingchen（批准）** | 2026-08-09 | **PASS** |
| 路径 D Constraints 误配 / 超限 | Cursor Agent（自动化）/ **xingchen（批准）** | 2026-08-09 | **PASS**（`inbox/20260809-ac-p15-uat/` 13/13；总签 `inbox/20260809-ac-p15-gate-c-signoff.md`） |

— 完

