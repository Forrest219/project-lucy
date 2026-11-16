# 调用流水 trace 级可追溯与存档（span 模型）Plan（P1-36）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 调用流水 trace 级可追溯与存档（span 模型）Plan |
| 文档类型 | Other（实施 Plan） |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-16 |
| 撰写人 | Claude（Cursor Agent） |
| 委托人 | xingchen |
| 基于材料 | [Spec](../specs/lucy-20261116-trace-span-ledger-spec.md)；[v0.25 审计增量 Spec](../specs/lucy-20261020-v2p5-audit-increment-spec.md)；[P1-32／P1-33 Spec](../specs/lucy-20261115-audit-export-scale-and-equivalence-guard-spec.md)；客户全量调用流水分析（2026-11-16） |
| 适用范围 | P1-36／REQ-030-057：span 表、同事务写入、派生版本、脱敏、`ip_source`、封存导出与对账 |
| 状态 | **终稿确权（委托人 2026-11-17 授权代理修正后定稿，免 Codex 终审）；v1.0；已获开发授权（委托人 2026-11-17「授权开发落地」）；代码已落地（span 表、同事务写入、spans.csv 与 spanCoverage、`/api/admin/audit/status`），vitest 回归无新增失败，本机 demo 已平滑升级并取证；测试台 `UAT-SUITE-TRACE-LEDGER`＝**PASS WITH GAP**（2026-11-17 宽目录沙箱 Tier-A 跑次 `docs/qa/uat/suites/trace-span-ledger/runs/2026-11-17-claude-wide-sandbox-tierA.md`；TRC-01/02/03/04/05/06/10/11 有证据，TRC-07/08/09 NOT RUN，不是整套 PASS）；登记发现 F-1～F-5，其中 F-2（正式完整导出 `mode=complete` 因既有 F-02 失败关闭，`spans.csv` 只在诊断包验证）与 F-3（SC-06 与 §6.2 口径冲突）待委托人裁定。≠ UAT PASS；≠ 可上线** |
| 授权边界 | 本 Plan **只定义步骤与验证**。终稿确权已获得（委托人 2026-11-17 授权代理修正后定稿，免 Codex）；O1–O8 已按 Spec §9 闭合。改运行代码仍须**委托人另发开发授权**。不含：防篡改链与外送（第 2、3 层）、历史行回写、客户现场验证、WebUI 新页面 |
| 验收 | 见 §3 |
| 输出位置 | `docs/plans/lucy-20261116-trace-span-ledger-plan.md` |

**清单**：P1-36（**不入核心分母**）｜**REQ**：REQ-030-057｜**总账**：[功能清单池](lucy-20261107-lucy-0-30-feature-inventory-pool.md)｜**Spec**：[trace-span-ledger-spec](../specs/lucy-20261116-trace-span-ledger-spec.md)

## 1. 目标

让调用流水满足 trace 级追溯与存档：每条已落库的流水行都有调用链路 ID 与阶段记录（入口完整性归 S02，本条只检出漏记）；流水行与阶段记录同事务落库（原子性；**不改响应时序、不新增 503／阻塞分支**）；封存包带阶段记录并可与库对账；协议与 wiki 的主状态不再大面积 `unknown`；审计库不存内网地址与存储路径。**不改任何业务裁决与响应**。

## 开工前置

- 已入总账：P1-36／REQ-030-057（2026-11-16）。
- 终稿确权已获得（2026-11-17）；**开发授权未获得**：未获得前下表所有「实现」步骤冻结，仅文档步骤可做。
- O1–O8 已闭合（见 Spec §9）：O5 客户版本核对归发布取证；**O6 容量预算已冻结（每 trace span 表＋索引平均 ≤ 8 KB），是 UAT-TRC-11 的判据**，实测超限回到委托人。
- 环境：本机 demo Docker（`npm run demo:upgrade` 平滑升级，不清 `lucy-demo-data`）；不触碰客户实例；不 `git commit`。
- 基线：先在改前版本跑 `UAT-SUITE-TRACE-LEDGER` 的 `UAT-TRC-01／06／07／09`，记录基线（预期 FAIL／基线值），写入 `runs/`。

## 2. 步骤与验证

| 步骤 | 内容 | 验证 |
|---|---|---|
| 0 | 基线取证与夹具交付：落 `scripts/uat/` 的**混合流量脚本（含发送侧独立清单）**与**规模夹具扩容脚本**；改前跑 UAT-TRC-01／06／07／09，记录 `trace_id` 覆盖率、`unknown` 占比、`lucy_query`／`initialize` P95 | `runs/…-baseline.md`；INDEX 保持 NOT RUN → 基线 FAIL 入账；**夹具就绪门禁**：每个夹具有固定命令、输入、输出格式、清理与失败判据并 dry-run 通过，未通过前依赖它的用例记 **NOT READY**；只读核对 `access_log.user_agent`／`rpc_request_id` 确被写入（发送清单关联键） |
| 1 | 迁移：新表 `access_trace_span`（外键 `ON DELETE CASCADE`、`UNIQUE(trace_id, seq)`、列 `CHECK`、`reason_param`）＋索引；`access_log` 部分唯一索引（`v2p5-2`）；**admin 审计状态接口新增只读 `sqlite.foreign_keys`（服务连接实际值）**；**新增两列 `ip_source`、`trusted_source`**，并修 `classifyTrustedSource()` 同时检查 XFF 与 `X-Real-IP`（只修证据分类，不改 `client_ip` 取值）（补 `AccessLogEntry`／`ACCESS_LOG_COLUMNS`／写入／导出）；`reason_code` 注册表 v1（17 项，Spec §5.4 已冻结，实现只落 `CHECK` 与映射函数，不得自扩）；`attrs_json` 的 `CHECK` 按 UTF-8 字节数＋`json_valid`；**先盘点全部指向 `access_log` 的子表（已知 `access_log_sources`、`access_log_attribution_mutations` 等）并做存量孤儿扫描，再开启 `PRAGMA foreign_keys=ON`**；additive，旧行不动；保留与容量预算按 O6 | vitest `audit-schema-indexes` 扩展（含外键级联、PRAGMA 与既有子表写路径不被拒的断言）；迁移幂等；旧库升级后旧导出逐字等价（SC-12） |
| 2 | `SpanBuffer` 与阶段埋点：准入→门控→构造→上游→本地→响应；`trace_id` 移到准入生成；白名单；32 行上限（31 正常＋1 `truncated`）；以请求起点为锚的区间与单调时钟；根 span 在响应序列化并发送后关闭，与行 `duration_ms` 取同一读数，`v2p5-2` 行 `ts` 取该读数（C9c 墙钟锚定） | vitest 契约：`trace-span-buffer.test.ts`（拟）；SC-01／SC-02 |
| 3 | 同事务写入：`writeLog` 与 span 一次提交（审计仍在响应后异步）；失败＝整笔回滚＋既有失败计数，不新增失败形态 | 故障注入：span 插入失败→行与 span 都不落库且客户端结果不变；SC-03；`UAT-TRC-03` |
| 4 | 派生 `v2p5-2`：协议与 wiki 的 `executionEvidence` 由 span 合成（各请求类必有 span 集合，缺失即完整性违规）；旧行不回写 | vitest `audit-v025-derivation` 扩展；SC-06 |
| 5 | `digest_kind` 补全；`error_detail` 写入前脱敏（占位符替换，不删空；公网 IP 保留；`hdfs://` 等由 vitest 契约表覆盖）；`ip_source` 与 `trusted_source` 联合落账 | vitest 脱敏与摘要契约；SC-07／SC-08 |
| 6 | 导出：`spans.csv`＋manifest；`auditCoverage` 增 `traceLinked`／`spanIntegrity`／`spanTiming`（仅 `v2p5-2` 行，`legacyUnlinked` 单列）；`spans.csv.ledger_seq` 经 JOIN 所属行，`unsequenced` 单列上报；分片让出事件循环 | 等价守卫登记 `spans.csv`（SC-12）；SC-05（pending＝0 且 S 相等时规范化内容一致，不要求整包字节一致） |
| 7 | 热路径与容量：基线对比、10 万 trace 导出与对账、体积对照 O6 预算 | `UAT-TRC-09`（SC-09）；`UAT-TRC-11`＋`sweep:event-loop:gate`（SC-11，必做） |
| 8 | 全套 UAT 跑次 | `UAT-SUITE-TRACE-LEDGER` 必做全绿；INDEX 判定 |

## 3. 验收

- Spec SC-01–SC-12 全部有证据（vitest 与测试台跑次分别标等级，不混写）。
- `UAT-SUITE-TRACE-LEDGER` 必做项（R0、01–11）PASS；UAT-TRC-11 对应 SC-11，**必做**；真实流量触发不了的分支（`truncated`）与 `hdfs://` 脱敏由 vitest 覆盖，不写进 UAT PASS；其余做不到全真的子项按 BLOCKED 停表；夹具未就绪记 NOT READY。
- `UAT-SUITE-EQUIV-GUARD` UAT-EQ-01／02 与 `sweep:event-loop:gate` 不退化。
- 主路径回归：`lucy_query` 与 `initialize` P95 增量在 Spec 阈值内；P1-35 逃生套件必做项复跑不退化。
- 新增 npm 命令或 CI job（若有）登记进 [`test-layers-and-release-gates.md`](../governance/test-layers-and-release-gates.md) §2／§8。

## 浏览器验证

不适用：本条不改 WebUI 页面、组件与文案，不触发交互合同；验收走 MCP、HTTP、SQL 与自动化测试，默认不做浏览器测试，也不做移动窄屏测试（见 DEVELOPMENT「验证策略：浏览器测试约束」）。

## 4. 完成定义

功能合同层：Spec 头部状态更新为收口句并同步镜像（总账、`docs/README.md`、`docs/plans/README.md`）；测试台 INDEX 有跑次与判定。**≠ UAT PASS 的自动推定；≠ 可上线。** 未完成的第 2、3 层（防篡改、外送）另立行，不得在本条状态里暗示已含。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 同事务写入放大热路径开销与写锁时间 | SC-09 门槛；缓冲在内存、单事务批量插入；超过阈值先回到 Spec 评审，不放宽阈值；写失败时行与 span 一并缺失（与现状一致），由 UAT-TRC-01 独立清单发现漏记 |
| 事件环被导出占住 | 分片让出；等价守卫＋性能门禁 |
| 迁移失败或回滚 | additive；停写新表即回退，旧列与旧导出不受影响 |
| 派生版本升级使聚合口径不连续 | 导出带 `derivationVersion`；旧行不回写；报表按版本分列 |
| 客户运行版本与仓库不一致 | O5 先答；基线在本机 demo 取得，不以客户数字当验收值 |
| 选方案 B 的体积与迁移代价 | 已在 Spec §9 登记；容量由 SC-11 与 O6 预算判定 |
| `PRAGMA foreign_keys=ON` 改变连接级行为，暴露既有无 CASCADE 外键 | 先盘点子表与孤儿扫描；专项 vitest；若影响既有表，改为清理事务内显式 `DELETE`（先子后父） |
| 入口完整性被误读为已保证 | 闭口层级与 Spec §9 明写不承担；UAT-TRC-01 检出漏记并 FAIL，修复归 S02 |
