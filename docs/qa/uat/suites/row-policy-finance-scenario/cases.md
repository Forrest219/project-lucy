# Cases — UAT-SUITE-ROW-POLICY

> 2026-11-20 P1-72 更新：新版本取消人工证明门槛。历史 2026-11-15 FAIL／BLOCKED 跑次保留；本文件的新期望不追改旧结果。

| ID | 标题 | 层级 | 期望摘要 |
|---|---|---|---|
| UAT-R0 | 环境门禁与档位 | 手工／脚本 | 记录 `gitSha`、proven 原值、跑次档位 |
| UAT-ROW-01 | 默认配置自动执行 | MCP 全真 | 不设置证明变量，查询成功且仅返回授权范围内的行 |
| UAT-ROW-02 | 12 人在表 A 隔离 | WebUI＋MCP | 每人与对照逐值一致；查询不自带行级列过滤 |
| UAT-ROW-03 | 表 B 上范围不同 | MCP 全真 | 两张自造表；至少一人两表范围不同 |
| UAT-ROW-04 | 一次点名两张受保护表 | MCP 全真 | 默认环境；原因码就是 `row_policy_query_shape_forbidden` |
| UAT-ROW-05 | 三条现行合同向量 | MCP 全真 | 伪造载体被剥掉；用户 AND 放宽不得变宽；OR 树被拒 |
| UAT-ROW-06 | 未包装工具拒绝 | MCP 全真 | `lucy_read_source`、`lucy_freshness` 被拒且无样本行 |
| UAT-ROW-07 | 配错取值（单列 P1-29） | WebUI／API | 现行实现预期 FAIL，归 `GAP-UAT-P1-28-VALUE`；**不计入**套件 PASS，不得改期望 |
| UAT-ROW-08 | 清理并恢复环境 | WebUI／API | 无残留；额外变更的环境恢复到开跑前 |
| UAT-ROW-OBS | Wiki／join 观察 | MCP | 不计入套件 PASS／FAIL |

P0-3 表级歧义先于行策略。点名来源必须带连接与 source。返回 `source_ambiguity_gate` 时，先完成来源确认再继续。确认后仍被歧义拦住，记 FAIL。

若拒绝码是 `caliber_binding_violation`、`field_not_exposed` 或 `field_exposure_unavailable`，记 **BLOCKED（其他闸）** 并写上实际码。不得记成行权限 FAIL，也不得改期望。

表 A、表 B 都用本套件自造的 source。不要因为仓库模板只有一张表就跳过 ROW-03／04。

---

## UAT-R0 — 环境门禁与档位

### 步骤

1. `docker ps` 确认容器是 `compose-lucy-1` 且 healthy。端口以实际映射写入跑次。
2. `GET /api/health`，记录 `gitSha`／`lucyVersion`／`ktxRuntime`。
3. `printenv LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN`。未设置就记「未设置」。
4. 按 fixtures 自造至少两张 `uat_row_policy_` 表和对应语义 source。写明 source 名与行级列。
5. 确认即将使用的 Agent 不会挂上 `tables: ["*"]` 或全部行 Role。

### 期望

- health `ok`。
- 跑次写明档位、`gitSha`、proven 原值、source、行级列、至少 3 个真实取值。
- 自造对象清单写在跑次里。测后必须删掉。

---

## UAT-ROW-01 — 默认配置自动执行

### 前置

使用未设置人工证明变量的默认环境，记录 health／`gitSha`；不为启用行权限重建或重启。

### 步骤

1. 建一个只含表 A 行限制的临时 Agent，签发 Token。
2. 对表 A 发单表 `lucy_query`：结构化参数，不带 joins，不带行级列 filter，不带 shape 违规键。

### 期望

- 查询必须成功，结果仅包含该 Agent 的授权域，并与不受限对照中同域的值一致。
- 返回旧 `row_policy_upstream_unproven` 或其他拒绝均不能记 PASS。

---

## UAT-ROW-02 — 12 人在表 A 上隔离

### 前置

沿用默认环境，不设置人工证明变量；记录 health／`gitSha`。

12 个 Agent 覆盖至少 3 个真实取值，每个取值至少一人。每人只挂 `uat-row-policy-role`。用该 Agent 的 Token 调 `lucy_explain_query`，确认 `finalRowsNonTrue=true`，且 `allowedTables` 不含 `*`。角色级预览不算证据。不满足记 **BLOCKED（夹具）**。

### 步骤

1. 不受限查询：不按行级列过滤，按该列分组，记下每个取值的聚合。
2. 每个 Agent 用自己的 Token 对表 A 做**同一次分组**：按同一行级列分组。`filters` 不得包含行级列。跑次贴出实际 filters。
3. 再看 `u01` 与 `u12`：`u01` 的分组集合不得包含 `u12` 的取值；`u12` 的分组集合不得包含 `u01` 的取值。不要交换两人的配置。

### 期望

- 12 人的结果都只有自己那一个分组，且该分组与对照格逐值一致。
- 出现别人的分组即 FAIL。
- 人数少于 12，或查询自带了行级列过滤，本条 FAIL。

---

## UAT-ROW-03 — 表 B 上范围可以不同

### 步骤

1. `u12` 在表 B 上的取值与表 A 不同，且在表 B 中真实存在。
2. 不受限对照按表 B 的行级列分组。
3. `u12` 与另外至少两人查询表 B。查询不带行级列过滤，不带 joins。

### 期望

- `u12` 在两张表上的结果各自等于自己的对照，且两张表的范围不同。
- 其他人看不到自己范围外的行。

---

## UAT-ROW-04 — 一次点名两张受保护表

### 前置

沿用默认环境，不得用旧人工证明拒绝代替本条查询形状拒绝。

### 步骤

1. `u01` 在同一次 `lucy_query` 里点名表 A 和表 B。不附加 joins 键。

### 期望

- 拒绝原因**就是** `row_policy_query_shape_forbidden`。其他原因码记 FAIL，并写上实际码。
- 两张表的事实行都不出现。

---

## UAT-ROW-05 — 三条现行合同向量

本条核对现行行为，不新增产品合同。三条都要做，不能只做其中一条。

### 步骤

1. 伪造载体：`u01` 查询表 A 时在参数里放 `forced_filters` 或 `forcedFilters`，试图放宽到别人的取值。
2. 用户 AND 放宽：在结构化 `filters` 里追加一条源限定名条件，字段写成 `<source>.<行级列>`，取值属于别人。除向量 3 外，这是唯一允许出现行级列 filter 的步骤。
3. 形状门禁：filter 必须是带齐 `field`、`op`、`value` 的对象，并额外带 `or` 键。例如 `filters:[{field:"<source>.<行级列>",op:"eq",value:"<u01 的取值>",or:[{field:"<source>.<行级列>",op:"eq",value:"<他人取值>"}]}]`。不要用只有 `or` 键的对象，也不要用字符串 filter。

### 期望

1. 载体被剥掉。结果仍只有 `u01` 自己的分组，并等于对照。
2. 结果不得宽于 `u01`。现行合同下客户端看到的是 **0 行成功响应**。审计里的 `decision_reason=scope_intersection_empty` 可以附记，它不是客户端拒绝码。**不得**把这一条写成「仍等于 u01 的全范围对照」。
3. 客户端拒绝原因是 `row_policy_query_shape_forbidden`。若写成纯 `{or:[...]}` 而得到 `filters_field_required`，本条 FAIL（步骤没按上面的形状写）。

---

## UAT-ROW-06 — 未包装工具拒绝

### 步骤

1. `u01` 对表 A 调用 `lucy_read_source`，参数写明 connection 与 source。
2. 对同一张表调用 `lucy_freshness`，同样写明 connection 与 source。

### 期望

- 两次的拒绝原因都是 `row_policy_requires_wrapped_tool`。缺 source 得到的 `source_required` 记 FAIL。
- 没有样本行。

---

## UAT-ROW-07 — 配错取值

### 步骤

1. 另建 `uat-row-policy-bad`。行取值用选定列上不存在的字面量。跑次写明该字面量。
2. 经 WebUI 或 Admin 正式保存（含预览确认）提交。

### 期望

- 通过线：保存被拒绝，或保存响应里有管理员能看到的「该取值在库中不存在」警告。
- 现行实现只有字段级校验，没有取值级校验。因此本条在现行代码上预期 **FAIL**。失败归缺口 `GAP-UAT-P1-28-VALUE`／P1-29，不得改期望，不得把 0 行查询写成通过。
- **不计入**本套件对核心分母（P1-28）的 PASS（委托人 2026-11-22 解耦口径）。
- 本轮没有承接这个缺口的实现 Spec。要修须另开 Spec 并取得开发授权。

---

## UAT-ROW-08 — 清理并恢复环境

### 步骤

1. 吊销 Token，删除全部 `uat-row-policy-*` Agent 与 Role。
2. 若额外执行了遗留变量兼容测试，恢复开跑前环境；普通场景无需为行权限重建 lucy。
3. `printenv` 与 Admin 列表再查一次。

### 期望

- 无 `uat-row-policy-*` 残留。
- `printenv` 与 UAT-R0 的开跑前一致（未设置就必须是未设置）。
- 本条未过，套件不得写 PASS 或 PASS WITH GAP。

---

## UAT-ROW-OBS — 观察（可选）

- Wiki 若写有其他范围的数字，受限 Token 的 `wiki_read` 读到了就记观察。没有这种内容则 SKIPPED。
- 带 join 的查询若返回范围外的行，记观察缺口。不计入套件 PASS／FAIL，也不得据此改必做期望。
