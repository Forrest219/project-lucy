# Run — 2026-11-19 — cursor-rpb-reuat-3b1c62af（重建后短复验）

| 元数据 | 内容 |
|---|---|
| 套件 | `UAT-SUITE-REBUILD-PROBE-BUDGET`（短复验）＋空载冒烟＋MCP 短测 |
| 目的 | 镜像重建后按「不回滚／MCP 不明显变慢」口径确认最新代码可交付评估 |
| 被测 | `project-lucy:demo`；`BUILD_REVISION=3b1c62af…-dirty`（与 compose-lucy-1 一致） |
| 证据 | `inbox/uat-reuat-3b1c62af-2026-11-19/`；`inbox/uat-rebuild-probe-budget-2026-11-19-reuat-3b1c62af/` |

## 结果

| 步 | 结果 | 关键数 |
|---|---|---|
| 空载冒烟 livez／readyz／health ×10 | **PASS** | livez max 40ms；readyz／health max ≤4ms |
| RPB 默认配置确认 1 次 | **PASS** | ready 23.6s；livez max **12**／p99 **8**；readyz p99 11；maxStreak **0** |
| MCP 短测（Cursor `user-lucy-demo`） | **PASS** | `lucy_catalog` OK；`lucy_query` 成交：`order_count=1000`、`total_sales=1459476.0953`；体感无 20%～50% 级变慢。本机 `LUCY_LOCAL_TOKEN` curl 401（旧 token，不计入失败） |

对照昨夜 shave2（max 7–17ms）：本跑 max 12ms，同量级。  

**用户口径**：① 不因探针回滚——本跑 livez／readyz 远低于 3s，streak=0；② MCP 可消费且未觉明显变慢——PASS。  
≠ 客户现网；≠ amd64；dirty 工作区含未提交 Dockerfile。
