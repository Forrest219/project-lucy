# UAT-SUITE-OPS-STEP 跑次 — 2026-11-22（Cursor）

| 元数据 | 内容 |
|---|---|
| 文档名称 | UAT-SUITE-OPS-STEP 全真跑次 |
| 文档类型 | Test Report |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-22 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec／Plan P1-68；`scripts/uat/ops-step-suite.mjs`；`inbox/uat-ops-step-20261122/run.json` |
| 适用范围 | 测试台登记；≠ 可上线 |
| 输出位置 | `docs/qa/uat/suites/ops-step/runs/2026-11-22-cursor-ops-step.md` |

## 环境

- 本机 demo Docker；平滑 `demo:upgrade` 后容器 `gitSha=88b2e9ea9ca39e79e65ca26358500126ca7d3ec7`
- WebUI：`http://127.0.0.1:55176`
- MCP Proxy：`http://127.0.0.1:57881`
- 挡板：跑次中 `LUCY_OPS_STEP_UAT=1`；结束后已 recreate 关闭（关闭态 404 复核）
- 凭据：`/private/tmp/lucy-p168-ops-step-uat/`（不入库）
- 机器证据：`inbox/uat-ops-step-20261122/run.json`、`suite-console.log`、`r0-closed.json`

## 结果总览

| 用例 | 判定 |
|---|---|
| UAT-OPS-STEP-R0 | PASS（关闭态 404 预取证＋开启态 bg/reset/steps） |
| UAT-OPS-STEP-01 | PASS（enter 早现、探针＜1s、deadline aborted） |
| UAT-OPS-STEP-02 | PASS（202 先返回；hold 中 stdout enter；leave 配对） |
| UAT-OPS-STEP-03 | PASS（MCP `runtime_reload` 三段有序；WebUI `enabled_tables_save` 五步） |
| UAT-OPS-STEP-04 | PASS（哨兵缺表 `missing`；原句＋`detail.opsStepId`；无 SQL 泄漏） |
| UAT-OPS-STEP-05 | PASS（页面／鉴权／inFlight／row_limit 截断；`age_limit` 1h 墙钟未跑） |
| UAT-OPS-STEP-06 | PASS（暂停后台后 `lucy_catalog` 无新步骤行） |
| UAT-OPS-STEP-07 | PASS（stdout error／short 注入与 writeHealth 字段；重度 Linux／16MiB／UID 未全绿） |
| UAT-OPS-STEP-08 | PASS（问数主路径；关闭态 404 预取证＋结束后 recreate 再证） |

**套件判定：PASS WITH GAP**

## GAP／未全绿设计值

1. SC-09／SC-13：真实 Linux 管道填满 100 ms、服务 UID 追加拒绝 — 未在本跑次构造
2. SC-14：16 MiB／两次 8 MiB 轮转、残行崩溃隔离、强制杀进程孤立 enter — 未全真取证（vitest 有部分内核覆盖）
3. SC-16 `age_limit`：真实墙钟 1 小时 inFlight 保留 — `--skip-age`
4. SC-06／SC-17：51／52 表批量矩阵 — 单表哨兵已证；批量边界未跑
5. SC-05：双连接同组每次 `catalog_reload` 配对 — 单连接三段已证

## 主路径

挡板关闭后 MCP `initialize`＝200；问数 Token 可用。WebUI／MCP 地址见上。
