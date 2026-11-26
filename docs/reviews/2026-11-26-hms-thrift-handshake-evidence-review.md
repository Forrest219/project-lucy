# 客户 HMS thrift 握手失败定性与本机取证边界 Review

| 元数据 | 内容 |
|---|---|
| 文档名称 | 客户 HMS thrift 握手失败定性与本机取证边界 Review |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-26 |
| 撰写人 | Claude |
| 委托人 | zhangxingchen |
| 基于材料 | [`2026-11-25-external-catalog-partition-bound-spike.md`](2026-11-25-external-catalog-partition-bound-spike.md)；[`inbox/hive-lab/REPORT.md`](../../inbox/hive-lab/REPORT.md)（2026-11-15 本机 Doris 2.0.14 + Hive 4.0.0 实测）；2026-11-26 本机 hive-lab 复测与会话内观测 |
| 适用范围 | 外部目录分区边界治理 Spike 的 Go / No-Go 取证策略修订；不构成开发授权 |
| 输出位置 | docs/reviews/2026-11-26-hms-thrift-handshake-evidence-review.md |
| 配套文档 | [非直连外部目录分区边界 Spike · 首轮取证证据评审](2026-11-26-external-catalog-partition-bound-spike-evidence-review.md)（同轮并行产出，覆盖 Spike 全量取证 H1–H4；**Spike 决策口径以该文档为准，本文档为其 §4.3 的专题**） |

## 1. 结论摘要

1. **新证据（2026-11-26）**：连向客户 HMS（`10.69.67.141`，9083/10000）的挂起查询最终返回明确错误，而非无限挂死：

   ```text
   ERROR 1105 (HY000): HMSClientException, msg:
   shade.doris.hive.org.apache.thrift.transport.TTransportException: null
   ```

   这把 [`inbox/hive-lab/REPORT.md`](../../inbox/hive-lab/REPORT.md)「没有覆盖」一节记录的「9083/10000 能 TCP 连通但无应答、`set_ugi` 无回应」从**疑似网络不通/慢**修正为 **Doris 的 HMS 客户端在 thrift 层协议/版本握手失败**。TCP 三次握手能通不代表 thrift RPC 能通。

2. **对照事实**：本机 Hive 4.0.0 HMS 下一切正常（`SHOW DATABASES` / `SHOW CREATE TABLE` / `SHOW PARTITIONS` 全部正常返回）。本机与客户组合的唯一差异因子在客户 HMS 的版本与鉴权方式，不在本机配置。

3. **取证边界修正**：H2 无法靠本机 Docker 闭环——同一份本机 Doris 配置，指向本机 HMS 即通、指向客户 HMS 即失败，说明结论由客户侧组件决定。H2 必须**在客户现网**取证；本机 Hive 3.1.3 / 4.0.0 的剪枝与元数据结论**不能代表客户**。

4. **四项假设的取证落点（修订后）**：

   | 假设 | 取证落点 | 本机 Docker 能否替代 |
   |---|---|---|
   | H1 痛点占比 | 客户现网审计日志（7–14 天） | 不能 |
   | H2 Doris 2.0.14 剪枝行为 | 客户现网引擎（Doris 2.0.14 + 客户 HMS 组合） | **不能（本次新证据）** |
   | H3 只读账号元数据探测 | **已本机闭环**（2026-11-15 REPORT.md：`SHOW CREATE TABLE`/`SHOW PARTITIONS`/`DESC` 输出形态可判别分区表；权限边界仍需客户账号复核） | 大部分能 |
   | H4 软约束有效率 | 客户外部目录 + 真实 Agent 负载 | 不能（本机只能测 Agent 无界调用率，测不出真实超时率差异） |

5. **Docker 的定位不变但更清晰**：价值在**验证机制与回归**（门禁逻辑、探针脚本、Agent 行为对照），不在于替代现场取证。

## 2. 对 S2 取证策略的修订

原 Spike S2 假设「到客户现场直接跑 5 条 EXPLAIN 即可」。基于新证据，S2 前必须增加前置确认，否则可能整步跑不通：

- **S0（新增前置）**：先用客户 Doris 对客户 Hive Catalog 执行最小连通验证（`SWITCH hive; SHOW DATABASES;` + 任选一表 `SELECT COUNT(*) LIMIT` 级别的只读探针），确认**客户 Doris ↔ 客户 HMS 组合本身可读表**。
  - 若客户 Doris 正在跑业务查询（大概率成立），说明其 thrift 层可通，需**采集使能配置**：`hive_jd` 的 Kerberos keytab、`hadoop.username`、`hive.metastore.uris` 实际指向等，Lucy 侧连接必须对齐同一形态。
  - 若组合本身也不通（复现 TTransportException），则 S2/S3 全部降级为「先解决连通性」，Go / No-Go 决策顺延。
- **S2 的 5 条 EXPLAIN 改为条件执行**：仅当 S0 通过后运行；并要求全程 `2>&1 | tee` 落盘。
- **版本对照说明**：本机 lab 曾用与客户一致的 Doris 2.0.14（`inbox/hive-lab` compose），但 HMS 版本（本机 4.0.0 vs 客户未确认版本）不一致且已证实为差异因子，故本机 EXPLAIN 结果只作脚本彩排与记录格式固定，不作 H2 结论。

## 3. 证据落盘说明与缺口

- **TTransportException 原始输出未落盘**：该错误为本会话内挂起查询返回后的观测记录；`inbox/hive-lab/` 既有日志（`big.log` / `before.txt` / `after.txt`）经核对不含该错误文本（`big.log` 中的「1105」命中为宽表建表语句的列名，非错误码）。
- 客户现场取证时须**重新捕获并落盘**该错误（含 Doris FE 日志中的 HMS 客户端栈），作为 H2 边界的一手证据。建议取证脚本统一 `tee` 到带日期的文件并在 Spike §8 登记指针。

## 4. 环境清理记录（2026-11-26）

| 项 | 状态 |
|---|---|
| 本轮启动容器（`doris-lab-2014-fe/be`、`lucy-uat-hive-hms/hs2`、`lucy-uat-hive3-hms/hs2`） | 已移除 |
| 临时文件（`/tmp/hive3-compose.yml`、`/tmp/seed_part*.sql`、`/tmp/lucy_audit_probe.sqlite`、`/tmp/hive_warehouse_pdb`） | 已删除 |
| 三个空壳 volume（`lucy-hive3-warehouse`、`lucy-uat-hive-warehouse`、`tmp_lucy-hive3-warehouse`） | 已清除（`docker volume ls` 无 hive 残留，2026-11-26 复核） |
| demo 栈 | 未受影响：`compose-lucy-1`、`compose-demo-db-1`、`lucy-uat-p18182` 均 healthy（2026-11-26 实测） |

## 5. 后续动作

| 动作 | 状态 |
|---|---|
| 按 §2 修订 S2 取证脚本（加入 S0 前置与 tee 落盘），随 Spike 现场包带走 | 待做（脚本级，不涉运行代码） |
| 客户现场执行 S0–S4，回填 Spike §8 取证记录表 | 待现场 |
| Go / No-Go 评审（按 Spike §7 决策矩阵） | 待 §8 回填后触发 |
| 客户 HMS 版本与鉴权方式信息采集（进 S0 清单） | 待现场 |

登记与本文档均不构成开发授权；正式立项仍以 Spike §7 决策矩阵 + 终稿确权为准。
