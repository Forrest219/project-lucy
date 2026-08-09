# Runbook：AC-P1 行策略误配与未证明恢复

| 元数据 | 内容 |
|---|---|
| 文档名称 | AC-P1 / P1.5 行策略与 Agent Constraints 恢复 Runbook |
| 文档类型 | Checklist |
| 版本 | v1.2 |
| 撰写日期 | 2026-08-09 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 99；Spec 100；ADR 上游强制谓词；WO-60 WP-I6；WO-61 WP-I5；总签 `inbox/20260809-ac-p15-gate-c-signoff.md` |
| 适用范围 | Gate C 演练与生产恢复；配合 [`runbook-policy-degrade.md`](runbook-policy-degrade.md) |
| 输出位置 | `docs/access-control/runbook-row-policy.md` |

---

## 症状对照

| 症状 | 常见原因 | 裁决码 / 信号 |
|---|---|---|
| scoped 源无法取数 | proven 未开（默认） | `row_policy_upstream_unproven` |
| 未包装工具 / 整源读失败 | O2 fail-closed | `row_policy_requires_wrapped_tool` |
| 查询被拒（字符串 filter / expr / join） | 受保护源 args 加严 | `invalid_arguments:…` / `row_policy_query_shape_forbidden` |
| Role / Agent 无法保存或 Agent DataPlane 全拒 | 非法 `row_policy`、measure 字段、缺 policy、非法 Agent `constraints`、Role 上 `constraints`、超限 / 不可满足 FinalRows | `row_policy_*` / `constraints_*` / `final_rows_*` / `role_resolution_failed:*` |
| Admin 编译失败 banner | 外部坏 YAML（含非法 scoped / 坏 constraints） | 见 AC-P0 降级 Runbook |
| `row_access:all` 仍无法取数 | Agent Constraints 使 FinalRows≠TRUE + proven 未开 | `row_policy_upstream_unproven` |

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
   - proven=false：`lucy_query` × scoped → **仍** `row_policy_upstream_unproven`（预期，非故障）
   - `lucy_read_source` / `lucy_freshness` / `entity_details` × scoped → `row_policy_requires_wrapped_tool`
   - `lucy_explain_query` → 本地允许（诊断）

---

## 路径 B — 「全员查不了数」其实是未证明

1. 确认环境变量 / 配置：**默认不应**设置 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN`。
2. 若误开 proven 但 **Lucy carrier / bundled KTX 对 `filters[]` 的 AND 行为**未验证或失效（注：KTX 0.16 丢弃 `forced_filters` 是预期；安全边界是 Lucy 写入的 `filters[]` 前缀）：
   - **立即关闭** proven（删 env 或设为 false）并重启同进程 WebUI/Proxy
   - 取数恢复为明确 deny（`row_policy_upstream_unproven`），避免「碰运气放行」
3. 向调用方说明：受保护源须走 `lucy_query`；当前波次在 Gate C 证明完成前不提供行级取数。
4. **禁止**为「恢复业务」而由运维/调用方手写强制条件进用户 `filters` 字符串（与 Proxy 自动 prepend 的 carrier 无关）。

---

## 路径 C — 回滚非法 scoped 配置

1. 若外部手改 YAML 引入非法 scoped / measure field → 按 [`runbook-policy-degrade.md`](runbook-policy-degrade.md) 路径 A 或 B。
2. 回滚到上一份可编译 `access.yaml`（无非法 row_policy）。
3. 确认 `degradedGlobal=false` / banner 消失；抽测 AbsoluteDeny `sl_*` 仍成立。

---

## proven 置真检查单（仅 Gate C）

在设置 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN=true` 之前必须全部满足：

- [x] ADR Gate A + Spec 99 Gate B 已批准
- [x] `npm test -- --run row-policy-ac-p1 ac-security-eval mcp-proxy-row-policy-by01-by18` 绿（含 Lucy 载体 BY-01：`forced_filters` + `filters[]` 前缀；**不**替代部署抽检）
- [x] UAT [`uat-ac-p1.md`](uat-ac-p1.md) BY-01…19 人工项勾选（**含部署环境行集抽检签字**）；Gate C 总签 2026-08-09
- [x] Lucy 侧强制谓词载体已书面证明（见 [`evidence-ktx-forced-filters.md`](evidence-ktx-forced-filters.md)）；**不**要求 `kaelio/ktx` 发版
- [x] Release notes **未**声称 Dynamic RLS / 多租户隔离 — [`release-notes-ac-p1.md`](release-notes-ac-p1.md)

Gate C 总签后：允许在目标环境作为**运维变更**置真；未执行变更前保持 proven=false。

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
   - proven=false + FinalRows≠TRUE → `row_policy_upstream_unproven`
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

