# Cases — UAT-SUITE-TRACE-LEDGER

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health＋MCP `initialize` 探针；容器 `gitSha` | demo healthy；MCP Proxy 可达；记录 `gitSha`／`gitDirty`／当前 `derivation_version` |
| UAT-TRC-01 | 健康时发送清单＝落库清单；全行 `trace_id` | MCP 全真＋SQL | Spec SC-01；E1 | 混合流量脚本产出独立发送清单；审计写入健康时落库行与清单逐类一一对应，无 missing／extra；每行 `trace_id` 非空且唯一；零行即 FAIL |
| UAT-TRC-02 | span 结构完整性 | SQL | Spec SC-02 | 恰一个根 span；全部节点可达根且无环；序号连续；枚举／白名单／`reason_code` 注册表；DB `CHECK` 存在；外键与唯一键生效且既有子表写路径不被拒 |
| UAT-TRC-03 | 同事务原子性＋合法请求结果不变 | 故障注入＋SQL | Spec SC-03；D4 | span 插入失败时行与 span 都不落库；合法请求客户端结果与注入前一致；审计写入失败计数增加；清理触发器后恢复 |
| UAT-TRC-04 | 阶段时间一致性 | SQL | Spec SC-04 | C9a–C9d 零违规（取整容差 1 ms 固定） |
| UAT-TRC-05 | 封存包含 `spans.csv`，与库对账 | HTTP＋文件 | Spec SC-05；D12 | 行数、sha256、截止序号与库一致（`ledger_seq` 经 JOIN）；`unsequenced` 单列；pending＝0 且 S 相等时两次导出规范化内容一致；前缀比较一致；既有文件逐字不变 |
| UAT-TRC-06 | 协议、wiki 与 `tools/call` 的主状态与必有 span 集合 | SQL | Spec SC-06；E2 | 各请求类（含 `tools/call` 最小集合）必有 span 集合齐全；主状态与结果一致且不为 `unknown`；被拒＝`denied`＋`error_category=policy_denied`；旧行不变 |
| UAT-TRC-07 | 脱敏与摘要类型 | MCP＋SQL | Spec SC-07；E5／E6 | 真实内网 IP 与 `sl_query` 错误按预期输出表脱敏，占位保留、无空串／NULL、公网 IP 等不误伤；`digest_kind` 补全（`hdfs://` 由 vitest 表覆盖，不入本用例） |
| UAT-TRC-08 | `ip_source` 与 `trusted_source` 联合取值 | HTTP＋SQL | Spec SC-08；D8 | 两列存在且落账；四种场景联合取值正确；伪造 XFF 不改变 ACL／限流所用地址 |
| UAT-TRC-09 | 热路径开销门槛 | 基准脚本 | Spec SC-09；O1 | `lucy_query` P95 增量 ≤ 5 ms；`initialize` P95 增量 ≤ 3 ms；合法请求成功率不降 |
| UAT-TRC-10 | trace 反查链路 | MCP＋SQL＋导出 | Spec SC-10 | 给定 `trace_id` 还原请求→阶段→结果→导出行；给定会话列出全部 trace，数量与流水行一致 |
| UAT-TRC-11 | 容量：10 万 trace 导出与对账（**必做**） | 脚本 | Spec SC-11 | 导出与对账不撞 SQLite 变量上限；`/api/livez` p99 ≤ 400 ms、max ≤ 1000 ms；索引与库体积不超 O6 预算（同跑 `UAT-SUITE-PAGE-SWEEP`） |

---

## UAT-R0 — 环境门禁

### 步骤

1. `curl -s http://127.0.0.1:55176/api/health`；对 `:57881/mcp` 发 `initialize`（Bearer 取自本机文件，不落盘）。
2. 记录容器 `gitSha`、`gitDirty`，以及新写入行的 `derivation_version`。

### 期望

- healthy；`initialize` 200；信息写进跑次。

### 清理

无。

---

## UAT-TRC-01 — 发送清单＝落库清单；全行 `trace_id`

### 前置

UAT-R0 通过。记下当前最大 `access_log.id` 为起点 `ID0`。

### 步骤

1. 用混合流量脚本（见 fixtures）发一轮请求；**脚本在发送侧独立生成清单**。**关联键（仓库现有列，不新增）**：所有请求带 `User-Agent: lucy-uat/<test_run_id>`（落 `access_log.user_agent`，用于划出本次范围）；带 id 的请求使用唯一 JSON-RPC id `<test_run_id>-<序号>`（落 `rpc_request_id`，逐条对应）；无 id 的通知与 `ping` 按（本次 UA，方法）计数核对。Plan 步骤 0 先只读核对这两列确实被写入。覆盖类别：协议请求（`initialize`、`notifications/initialized`、`tools/list`、`ping`）、`wiki_search`、`wiki_read`、合法 `lucy_query`、ACL 拒绝、门闩拒绝、不存在的工具名。
2. **前置**：确认审计写入 pending＝0（等待后再查）。取 `access_log WHERE id > ID0 AND user_agent = 'lucy-uat/<run>'` 的行，与发送清单做**双向差集**：`missing`（发了没落库）与 `extra`（落库不在清单）。
3. `SELECT tool, COUNT(*), SUM(trace_id IS NULL) FROM access_log WHERE id > ID0 AND <属于本次> GROUP BY tool;`
4. `SELECT trace_id, COUNT(*) FROM access_log WHERE id > ID0 GROUP BY trace_id HAVING COUNT(*) > 1;`

### 期望

- 第 2 步 `missing`、`extra` 均为空；逐类落库数＝期望数；**零行落库即 FAIL**（不得空表通过）。若出现 `missing`，如实记为漏记缺口（S02 范畴）并 FAIL 本用例，**不得**以「该行不在库里所以不算」放过。
- 第 3 步 `SUM(trace_id IS NULL)` 全为 0（含 `initialize`、`tools/list`、`notifications/*`、`ping`、`wiki_*`）。
- 第 4 步结果集为空。

### 清理

无。

---

## UAT-TRC-02 — span 结构完整性

### 步骤

1. 对 UAT-TRC-01 产生的 trace 逐个检查：根 span 数＝1；`parent_span_id` 均存在于同 trace；`stage` 在 Spec §5.2 枚举内；`attrs_json` 的键均在 §5.3 白名单；`attrs.dropped` 恒为 0；span 数 ≤ 32。
2. 外键与唯一键：读取 admin 审计状态接口的 `sqlite.foreign_keys`（服务单例连接的实际值）必须为 ON，**不得**用另开 `sqlite3` 连接自查（PRAGMA 逐连接）；`access_trace_span` 无孤儿（`access_log_id` 均存在，且 `trace_id` 与所指行一致）；每个纳入行至少 1 个 span；`UNIQUE(trace_id, seq)` 无冲突；**既有子表写路径不被拒**（跑一次带来源引用的 `lucy_query`，`access_log_sources` 正常写入）。
3. 拓扑：递归查询确认每个 span 沿 `parent_span_id` 可达根且无环；`parent.seq < child.seq`；每个 trace 的 `seq` 从 1 连续无空洞。
4. 列约束：核对 `status` 值域、`duration_ms ≥ 0`、`attrs_json` 的 **UTF-8 字节数** ≤ 1024 且 `json_valid`、`derivation_version`；读表结构确认对应 `CHECK` 存在（含 `reason_code IN (17 项)`）；在测试副本库上尝试写入 1024 个中文字符的 `attrs_json` 与未登记 `reason_code`，两者都必须被 `CHECK` 拒；`reason_code` 均在 Spec §5.4 注册表内。**固定场景表**：为每类拒绝／失败各造一条真实请求（越权表→`acl_denied`；源歧义门闩→`gate_denied`；缺参→`arg_invalid`；预算耗尽→`budget_stopped`；上游错误→`upstream_error`；超时→`timeout`），断言期望 `reason_code`；命中 `unclassified` 即 FAIL。
5. `tools/call` 最小集合：对合法 `lucy_query`／`lucy_read_source`／`lucy_catalog` 各取一条，断言非拒绝请求有 `acl`(ok)＋执行方式（`upstream_call` 或 `local_handler`）＋`response_serialize`；只有根 span 即 FAIL。
6. **不在此用例构造 `truncated`**：真实流量不会触顶，该分支由 vitest 契约覆盖（31＋1、`dropped` 计算），不得把 vitest 结果写成本用例 PASS。

### 期望

- 全部满足；任何一项违规即 FAIL，并列出前 10 个反例 trace。

### 清理

无。

---

## UAT-TRC-03 — 同事务原子性＋合法请求结果不变

### 步骤

1. 记录审计写入失败计数与 `access_log`／`access_trace_span` 行数。
2. 在容器内 demo 审计库建触发器，使对 `access_trace_span` 的 INSERT 抛错（命令原样记录）。
3. 发一个合法 `lucy_query`；记录客户端 HTTP 状态与响应体、`access_log` 与 `access_trace_span` 是否新增行、失败计数。
4. `DROP TRIGGER`；再发同一个 `lucy_query`；对比客户端结果。

### 期望

- 第 3 步：`access_log` 与 `access_trace_span` 都**没有**该请求的行（无孤儿行、无孤儿 span）；**客户端结果与第 4 步（及注入前）一致**，不出现 503、不新增失败形态；审计写入失败计数增加，运行日志有对应记录。
- 第 4 步：恢复正常，行与 span 同时出现。
- 必须清理触发器；未清理即 FAIL。

### 清理

`DROP TRIGGER`；确认库内无遗留触发器。

---

## UAT-TRC-04 — 阶段时间一致性

### 步骤

1. 取 UAT-TRC-01 的所有 trace，按 Spec C9 逐项检查（取整容差固定 1 ms，写进跑次，**不得事后放宽**；根终点与行 `duration_ms` 取自同一读数，故不再需要 20 ms 级容差）：
   - C9a 每个子 span 区间落在根 span 区间内（1 ms 取整容差）。
   - C9b `|根 span.duration_ms − access_log.duration_ms| ≤ 1 ms`。
   - C9c 墙钟锚定：`|(root.started_at_ms + root.duration_ms) − ts_ms| ≤ 1 ms` 且 `|root.started_at_ms − (ts_ms − access_log.duration_ms)| ≤ 1 ms`（`v2p5-2` 行 `ts` 与根终点同一读数）；**反例**：把某 trace 全部 span 的 `started_at_ms` 整体平移一年（只在测试副本库上做），本检查必须 FAIL，否则 C9 恒真。跑次内发生时钟跳变则作废重跑。
   - 另造一个**慢序列化／发送背压**请求（如大结果集的 `lucy_read_source`），确认 C9b 仍成立（根 span 包含 `response_serialize`）。
   - C9d 串行阶段集合在同一父 span 下区间不重叠（1 ms 容差）；并行阶段（`catalog_resolve`／`skills_load`）不检查。
2. **不检查「同级 `duration_ms` 之和」**（并行阶段会合法超过总耗时）。

### 期望

- C9a–C9d 零违规；列出任何违规的前 10 个 trace。

### 清理

无。

---

## UAT-TRC-05 — 封存导出

### 步骤

1. 调 `export-pack-v2`（含 `includeProtocol`）；记录 `ledgerUpperSeq`＝S1、manifest、`exportId`。
2. 校验 `spans.csv`：`wc -l`、`sha256`，与 manifest 登记一致；与库内 `access_trace_span JOIN access_log`（`access_log.ledger_seq ≤ S1`）行数一致；manifest 报出的 `unsequenced` 计数与库内 `ledger_seq IS NULL` 的所属行对应 span 数一致。导出**前**确认审计写入 pending＝0。
3. 保持账本静止并确认 pending＝0，再导一次；记录 S2。若 `S2 ≠ S1`，本次比较**作废**并重做。比较两份 `spans.csv` 的**规范化内容**（按 `trace_id, seq` 排序后逐行）；允许 `exportId`、`exportedAt`、整包字节与 manifest 不同，但版本链字段须按 S06 关联前版。
4. 发一轮新流量并待 pending＝0 后第三次导出（S3 > S1）；`S3` 包中 `ledger_seq ≤ S1` 的 `spans.csv` 行须与第一次逐行一致（前缀比较）。
5. 与改前导出对比既有文件（调用流水 CSV 等）逐字相同。

### 期望

- 行数／哈希／截止序号一致；规范化内容与前缀比较一致；既有文件不变。**不要求整包字节一致。**

### 清理

删除临时导出包。

---

## UAT-TRC-06 — 协议与 wiki 主状态与必有 span 集合

### 步骤

1. 取 UAT-TRC-01 产生的协议、wiki 与 `tools/call` 行，按 Spec §6.2 表逐类核对：该类**必有 span 集合**是否齐全（SQL：每类行 `LEFT JOIN` 期望 span，列出缺失者；含已传证据的既有分支如 `resources/list`）。
2. `SELECT primary_status, error_category, COUNT(*) …` 按 `tool` 分组；核对 `unknown` 计数。
3. 构造三个场景核对映射：①上游可达的 `initialize`；②对 `wiki_search` 触发「上游失败＋本地回退成功」（见 fixtures）；③被 ACL 拒绝的调用。
4. 取升级前已有的旧行抽样：`derivation_version` 与 `primary_status`。

### 期望

- 新行：必有 span 集合**无条件**齐全（缺失即 FAIL，不得以「无凭据」豁免）；协议与 wiki 行 `primary_status` 非 `unknown` 且与最终返回结果一致（成功→`succeeded`，失败→`failed`）。
- 场景②：同时有 `upstream_call(error)` 与 `local_handler(wiki_fallback)`，`primary_status` 按最终返回结果。
- 场景③：`primary_status=denied`，且 `error_category=policy_denied`；**两列分别断言**，不得出现 `primary_status=policy_denied`。
- 旧行：`derivation_version=v2p5-1`，`primary_status` 与升级前相同，不回写。

### 清理

无。

---

## UAT-TRC-07 — 脱敏与摘要类型

### 步骤

1. 按 fixtures 的「输入→预期输出表」逐项触发真实上游错误并读取 `error_detail`（IP 类用真实拒绝连接；`sl_query` 类**仅当基线跑次已证明某个合法入参能触发含 `sl_query` 的真实上游错误**才执行，缺 `measures` 的入参会被本地 `validateLucyToolArgs()` 拦截、不含 `sl_query`，不得使用；基线触发不了则该子项登记为 vitest 覆盖，写进跑次，不 mock）。`hdfs://` 路径脱敏**不在本用例**，由 vitest 契约表覆盖（Spec O8）。
2. 误伤反例：错误文本含公网 IPv4／IPv6、版本号、时间戳、端口样式串、公网文档域名，应原样保留。
3. 查 `lucy_query` 与 `wiki_search` 行的 `digest_kind`。

### 期望

- 每个输入的 `error_detail` 与预期输出表一致：占位符（`[REDACTED_ADDR]`／`[REDACTED_PATH]`／`[REDACTED_TOOL]`）在位，**稳定原因码与非敏感上下文保留**；**不得为空串或 NULL**；误伤反例不被改写。
- `lucy_query` SQL 摘要 `digest_kind=sql`；`wiki_search` 为 `search_text`。

### 清理

删除测试连接（若建过）。

---

## UAT-TRC-08 — `ip_source` 与 `trusted_source`

### 步骤

0. 先确认 `access_log` 已有 `ip_source`、`trusted_source` 两列（只读核对表结构）；缺列即 FAIL。
1. 默认配置下发请求；查 `ip_source`、`trusted_source`、`client_ip`。
2. 设 `LUCY_TRUST_PROXY` 与 `LUCY_TRUSTED_PROXY_CIDRS`（含测试对端），带 `X-Forwarded-For` 发请求；查。
3. 带 `X-Real-IP` 发请求；查。
4. **反例 A**：对端不在可信 CIDR 内，伪造 `X-Forwarded-For`；查 `trusted_source`、`ip_source`、`client_ip`、`client_forwarded_for`。
4b. **反例 B**：同样的不可信对端，只伪造 `X-Real-IP`（不带 XFF）；查同样四列。两种反例的 `trusted_source` 都不得为 `customer`／`trusted_proxy`。另**记录**伪造头是否影响该请求的 ACL 判断／限流所用地址（既有风险，如实写进跑次，不在本条修）。
5. 还原配置。

### 期望

- 默认：`ip_source=socket`，不冒充客户端地址。
- 可信代理＋XFF：`ip_source=xff`，`trusted_source=trusted_proxy`。
- `X-Real-IP`：`ip_source=real_ip`。
- 伪造（XFF 与 `X-Real-IP` 两种）：`trusted_source=untrusted_peer`；伪造值保留可见，不得被报表当作已验证来源；ACL／限流地址受影响与否按实测如实记录。

### 清理

还原 `LUCY_TRUST_PROXY`、`LUCY_TRUSTED_PROXY_CIDRS` 与容器配置。

---

## UAT-TRC-09 — 热路径开销

### 步骤

1. 在改前基线版本记录：`lucy_query` 与 `initialize` 各 N=200 次的 P50／P95（稳态，无人工负载），并记录合法请求成功率。
2. 升级到实现版本（`npm run demo:upgrade`），同样条件再测。

### 期望

- `lucy_query` P95 增量 ≤ 5 ms；`initialize` P95 增量 ≤ 3 ms；合法请求成功率不低于基线。超出即 FAIL，**不得**放宽阈值凑绿（回 Spec 评审）。

### 清理

无。

---

## UAT-TRC-10 — trace 反查链路

### 步骤

1. 分别取五类各一条——合法查询、协议请求、本地处理（wiki 本地）、门闩拒绝、上游失败——用各自 `trace_id` 查 `access_log` 与 `access_trace_span`，还原阶段序列与结果。
2. 在 `export-pack-v2` 的 `spans.csv` 里找到同一 `trace_id` 的所有 span，与库一致。
3. 用 `lucy_session_id` 列出该会话全部 trace，对比调用流水行数。

### 期望

- 能从 `trace_id` 还原完整链路；导出与库一致；会话下 trace 数与流水行数一致。

### 清理

无。

---

## UAT-TRC-11 — 容量（必做）

### 步骤

1. 用规模夹具把沙箱审计库扩到 10 万 trace（见 fixtures），并记录库文件与索引体积。
2. 调 `export-pack-v2` 与对账；记录是否报 `too many SQL variables`。
3. 同跑 `npm --prefix webui run sweep:event-loop:gate`。
4. 对照 O6 冻结的容量预算：每 trace 的 span 表＋索引平均 ≤ 8 KB；平均 span 数协议类 ≤ 6、业务类 ≤ 14。

### 期望

- 无变量上限错误；对账完成；`/api/livez` p99 ≤ 400 ms、max ≤ 1000 ms；`regressions=0`；体积在预算内（超限即 FAIL，回到委托人决策）。未跑，本套件**不得写整体 PASS**。

### 清理

删除沙箱库。
