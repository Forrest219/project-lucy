# Run — 2026-11-18 — SAG-01 v3 硬线（挂 ESCAPE 重建复测）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-SOURCE-AMBIGUITY`（P0-3；SAG-01 v3） |
| Agent | Cursor；证据挂 ESCAPE [post-rebuild](../../source-ambiguity-mcp-escape/runs/2026-11-18-cursor-sag-escape-post-rebuild.md) |
| 环境 | `compose-lucy-1`；`gitSha=7ebedd4eb79b…`；`gitDirty=false` |
| 日期 | 2026-11-18 |
| 总判定 | **PASS**（R0／R0-UPGRADE／SAG-01 v3；SAG-02 仍可选未跑） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health／MCP 同 ESCAPE R0 |
| UAT-R0-UPGRADE | **PASS** | `gitSha` 前缀 `7ebedd4e`（≠ `3aa402c9`） |
| UAT-SAG-01 v3 | **PASS** | 幽灵引用／超上限／跨连接仍拦；合法钉选不拦（见 ESCAPE ESC-05c／08／10／01） |
| UAT-SAG-02 | **NOT RUN** | 可选；无 person／attestation |
