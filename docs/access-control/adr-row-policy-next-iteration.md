# ADR — 行级策略后续迭代（维持静态，动态另批）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 行级策略后续迭代决议 |
| 文档类型 | ADR |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-23 |
| 撰写人 | Grok |
| 委托人 | xingchen |
| 基于材料 | 2026-09-23 行级数据策略讨论（Snowflake Row Access Policy、Databricks Unity Catalog Row Filter、Tableau Virtual Connection Data Policy）；Lucy 现行契约见本文 §4 |
| 适用范围 | 访问权限域在**下一次触及行级策略**时的迭代顺序；不授权本轮 runtime 改动 |
| 输出位置 | `docs/access-control/adr-row-policy-next-iteration.md` |
| 状态 | **已确认（2026-09-23，xingchen：按此方向落盘，供未来迭代参考）** |

---

## Terminology Compliance

This decision follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None。本文不登记新的 UI 主术语。

沿用既有术语：行级策略（Row Policy）、行访问（`row_access`）、专用强制字段（`forced_filters`）、Agent 强制约束（Agent Constraints）、最终行约束（Final Rows）。

讨论里的「数据策略」「策略引用」「动态上下文」只作架构用语。做成产品前须先补术语标准，再写界面文案。

禁止口径：不得把本文读成 Dynamic RLS、多租户隔离、TokenScope 行收紧或数据库原生行级安全已经立项或已经交付。

---

## 0. 状态与裁决

| 项 | 内容 |
|---|---|
| 状态 | **已确认** |
| 本确认授权 | 把行级策略的后续顺序写下来：当前维持静态；下一次增量是可复用的静态策略引用；动态数据策略另批 |
| 本确认不授权 | 改 Proxy / Admin / `access.yaml` 运行时；引入 `{user.claims.*}` / `{token.scope.*}` 宏；把未包装工具改成「剥离后放行」 |
| 冲突裁决 | 与 [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md) 一致。冻结项仍然有效。若有人把「下一次大版本」理解成直接做动态数据策略，以本文 §2 为准 |
| 禁止依据 | `feasibility-row-acl.SUPERSEDED.md` |

**一句话：** 继续用挂在角色表选择器上的静态行级策略；下一次值得做的是同一条静态谓词的复用；按人或按 Token 变化的动态策略，要等可信身份源和无法用 Agent 强制约束表达的用例，再单独开波。

2026-09-23 讨论里曾把「下一次大版本」收成「直接做动态数据策略」。确认后的顺序见 §2，动态策略不是下一次的默认项。

---

## 1. 背景

### 1.1 行业参照（只取机制，不照搬表面语法）

| 产品 | 可借鉴的机制 | Lucy 不能直接照搬的部分 |
|---|---|---|
| Snowflake Row Access Policy | 策略是 Schema 级逻辑对象；表通过挂载复用；优化器把布尔表达式注入为不可去掉的行谓词 | Lucy 不拥有表 DDL，也不能把 SQL 表达式写进策略正文 |
| Databricks Row Filter / Unity Catalog | 标量函数做行过滤；`current_user()`、组成员等上下文由服务端会话断言；BI、Spark 与 Genie 走同一治理面 | 上下文必须是服务端身份，不能是调用方自带的 claim |
| Tableau Virtual Connection Data Policy | 策略集中在虚拟连接；下游仪表板、Prep、Ask Data 继承，作者不能自行解绑 | Lucy 的挂载点是角色上的表选择器；多角色对同一张表的行授予取并集 |

四条共同实践：

1. 策略逻辑与宿主资产解耦，表只是挂载目标。
2. 过滤在执行引擎强制注入，不交给生成 SQL 的客户端或模型。
3. 动态上下文来自服务端会话，而不是为每个人复制一条静态规则。
4. 同一策略覆盖预览、采样、新鲜度、聚合和导出，不留旁路。

### 1.2 Lucy 已经对齐的部分

第 2 条和第 4 条的主体已经在现行契约里：

- 受保护源上，唯一取数通道是 `lucy_query`。Proxy 写入 `forced_filters`，并去掉调用方自带的同名字段。
- `lucy_read_source`、`entity_details`、`sl_validate`、`lucy_freshness` 在受保护源上拒绝（`row_policy_requires_wrapped_tool`）。
- `lucy_explain_query` 只返回本地诊断，不转发、不回行。
- 上游强制谓词未证明时，取数拒绝（`row_policy_upstream_unproven`）。
- 谓词只允许行级字段上的 `eq` / `in` 字面量。度量、表达式、SQL 片段在编译期失败。
- 多个 Role 的行授予取并集；Agent 强制约束再与之取交集。

一人一套组织模板、个人范围不同，用「共享 Role + 该 Agent 的强制约束」表达。Token 只鉴权，不改变行域。

---

## 2. 决议

### 2.1 当前版本：维持静态行策略

保持 Spec 99 / Spec 100 的运行时不变：

- 行级策略挂在 Role 的表选择器上，`row_access: scoped` 必须带合法 `row_policy`。
- 取值是编译期字面量。
- 生效路径仍是 `forced_filters` 注入；未包装读数通道继续拒绝，不改为返回剥离后的元数据。
- 新增会碰到受保护源的工具（含 Skill、样本预览、维度取值列举）默认与 `lucy_read_source` 同类，先拒绝，直到证明它走同一条强制谓词。

### 2.2 下一次增量：可复用的静态策略引用

当同一条谓词被复制到很多张表、手工重复配置 `op` / 取值成为主要成本时，再做这一层。在此之前继续「表上挂载」。

将来的 Spec 必须同时满足：

1. 命名模板只声明行级字段、比较符和字面量取值。引用与手写条件都编译成今天的 `row_policy` / `RowPolicyAST`，不产生第二套权限代数。
2. 挂载点仍是角色上的表选择器。字段是否兼容，沿用 Spec 99 §3.2 的行级字段校验。
3. 模板与 `access.yaml` 一起版本化，挂载结果进入同一份生效策略摘要。
4. 保存前展示该表的最终行约束：Role 之间的并集，以及与 Agent 强制约束的交集。只显示策略名不够，并集会把权限放宽。
5. 本文不授权开工。开做时另写实现 Spec，并包含 `docs/governance/DEVELOPMENT.md` 要求的「核心流程（伪代码）」。

### 2.3 动态数据策略：另批

按人或按 Token 变化的策略（动态 claim、`{user.claims.*}`、`{token.scope.*}`、请求期宏替换）不进入下一次大版本的默认范围。

与 [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md) §2.3 相同，重开至少要同时有：

- 产品范围明确包含多租户或 SSO claim，且租户边界与身份事实源已经设计；
- 存在不能用「多个 Agent + 各自的强制约束」表达的生产用例；
- 另立 WO，并走新的 Gate A。Token 级行收紧仍属冻结项，不能借动态策略绕过。

若该波获批，值侧应是编译期绑定（由 Proxy 从可信目录解析），缺身份则拒绝。不得把宏插进用户 filters，也不得把调用方写入的 JWT claim 当作行域。该变更会改 digest、预览和审计，不能塞进策略引用的同一个 Spec。

### 2.4 与冻结 ADR 的关系

| 议题 | 本文 | 冻结 ADR |
|---|---|---|
| 静态行策略运行时 | 维持 | 主线已收束，不另开权限波次 |
| 可复用静态策略引用 | 下一次行策略增量的候选；仍是静态模型 | 未点名；不构成 Dynamic RLS |
| Dynamic claim / TokenScope / 多租户 | 另批 | F1–F3 继续不做 |

本文不修订、不推翻冻结 ADR。

---

## 3. 未来打开本文时的阅读顺序

1. 本文 §2，确认当前允许做什么。
2. [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md)，确认动态 claim 与 TokenScope 仍冻结。
3. [`webui/docs/99-access-control-p1-row-policy-spec.md`](../../webui/docs/99-access-control-p1-row-policy-spec.md) 与 [`webui/docs/100-access-control-p15-agent-constraints-spec.md`](../../webui/docs/100-access-control-p15-agent-constraints-spec.md)，确认谓词形状、并集 / 交集和工具闸门。
4. [`adr-upstream-forced-predicate.md`](adr-upstream-forced-predicate.md)，确认注入载体是 `forced_filters`，未证明则拒绝。

---

## 4. 引用材料

| 材料 | 用途 |
|---|---|
| 2026-09-23 讨论 | Snowflake `CREATE ROW ACCESS POLICY` + `ALTER TABLE ... ADD ROW ACCESS POLICY`；Databricks `SET ROW FILTER` 与 `is_account_group_member()` / `current_user()`；Tableau 从工作簿 `ISMEMBEROF()` / `USERNAME()` 转到 Virtual Connection Data Policy |
| [`webui/docs/99-access-control-p1-row-policy-spec.md`](../../webui/docs/99-access-control-p1-row-policy-spec.md) | 静态 `row_policy`、`forced_filters`、受保护源工具矩阵 |
| [`webui/docs/100-access-control-p15-agent-constraints-spec.md`](../../webui/docs/100-access-control-p15-agent-constraints-spec.md) | Agent 强制约束；`TokenScope ≡ TRUE` |
| [`adr-upstream-forced-predicate.md`](adr-upstream-forced-predicate.md) | 上游强制谓词契约；未包装工具一律拒绝 |
| [`adr-post-p15-roadmap-freeze.md`](adr-post-p15-roadmap-freeze.md) | Dynamic RLS / TokenScope 冻结与重开条件 |
| [`docs/access-control/runbook-row-policy.md`](runbook-row-policy.md) | 现行配置与运维口径 |
| `webui/server/proxy/row-policy.ts`、`webui/server/proxy/acl.ts` | 编译与闸门实现锚点 |

---

## 5. 后果

| 义务 | 说明 |
|---|---|
| 域 README | 索引指向本文，避免后续迭代只看到冻结 ADR 或只看到行业讨论稿 |
| 新 WO / Spec | 做策略引用或动态策略时引用本文 §2；动态策略还须先满足冻结 ADR 的重开条件 |
| Release notes | 继续遵守 Non-Claim |
| `design-upgrade.md` | 本文不替代 v1.1.2 |

---

## 6. 确认记录

| 项 | 签名 | 日期 | 结论 |
|---|---|---|---|
| 讨论与正文 | Grok（起草） | 2026-09-23 | 提交落盘 |
| **方向确认** | **xingchen** | **2026-09-23** | **按此迭代方向落盘，供未来迭代参考**（当前维持静态行策略；动态数据策略不作为下一次大版本的默认项） |

— 完
