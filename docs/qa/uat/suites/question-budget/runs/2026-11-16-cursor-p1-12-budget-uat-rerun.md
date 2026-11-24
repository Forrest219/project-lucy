# Run — 2026-11-16 — P1-12 问询预算 60／300 UAT 复跑（Docker 重建后，提交 299de2c9）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-QUESTION-BUDGET`（P1-12／REQ-030-033） |
| Agent | Cursor |
| 环境 | 本机 demo Docker `compose-lucy-1`（07:59 重建，healthy）；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；`gitSha=299de2c9c2249c1543b648d4a1e1d0a46ac42037`，`gitDirty=false`，`lucyVersion=0.30.0` |
| 身份 | `demo_agent`（role `demo_readonly`）；token sha256 前 12 位 `8ccee2d00afb`；来源 `~/.cursor/mcp.json`（明文不入档） |
| 开始／结束 | 2026-11-16 09:29 – 09:32（UTC+8） |
| 总判定 | **PASS**（R0／01／02／03／04 全 PASS；未覆盖项见末节，不得据此宣称全量完备） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health `status=ok`，`gitSha=299de2c9…` 与 HEAD 一致；MCP `initialize` 200 |
| UAT-BUDGET-01 | **PASS** | `instructions` 7783 字符；含 60 次与 300 秒表述、`question_budget_exhausted`；**不含**旧「at most 12／within 120 seconds／within 8 minutes」。`lucy_continue_question` 未出现＝符合预期（`demo_readonly` 无该工具，续查行按可见性省略） |
| UAT-BUDGET-02 | **PASS** | 干净窗口：第 1–21 次均 `OK`，无 `question_budget_exhausted` |
| UAT-BUDGET-03 | **PASS** | 第 1–60 次均 `OK`，第 61 次 `{"reason":"question_budget_exhausted","partial":true,"continuable":false}`；窗口 09:31:16，耗时 20.8 s；干净窗口校验：reload `requestId` 前后同为 `eaac9fcf…` |
| UAT-BUDGET-04 | **PASS** | 09:40 委托人在会话内提供 demo 管理员（`xingchen`，owner）后全真跑：自造 Role／Agent／Token（`tokenSha12=551944877fe8`，label `uat-budget-continue`，1 小时有效）。①该身份 `initialize` 指导含 `question_budget_exhausted`、`continuable`、`continueToken`、`lucy_continue_question`、60 次、300 秒，不含旧 12／120 s／8 分钟；`tools/list` 含 `lucy_continue_question`。②同窗第 1–60 次 `OK`（第 21 次 `OK`），第 61 次 `{"reason":"question_budget_exhausted","partial":true,"continueToken":"<redacted>","continuable":true}`。③`lucy_continue_question {token}` → `{"ok":true,"idempotent":false,"declared":true}`。④续查后再发 1 次 `lucy_query` → `OK`，未再耗尽。干净窗口：reload `requestId` 前后同为 `eaac9fcf…`。清理：删 Agent 200、删 Role 200；明文 Token 再 `initialize` → **401**；Admin 列表与 `access.yaml` 无 `uat-budget-continue` 残留 |

## 无效跑次（保留，不作数）

- **09:29:49 第 1 次**：跑次中途共享容器发生 KTX 重载（`requestId` 由 `84680da8…` 变为 `7bac2ef7…`，随后又见 `cf275c06…`），第 37–60 次落入 `KTX upstream unavailable`（24 次），窗口不干净，**作废**。等待 60 秒无重载后复跑得到上表有效结果。
- 证据：`inbox/uat-p1-12-budget-2026-11-16/evidence-budget-rerun-2026-11-16.json`（无效）、`evidence-budget-rerun2-2026-11-16.json`（有效）；`continueToken` 已脱敏。

- **BUDGET-04 前置失败（非产品缺陷，已作废）**：①首次建 Token 缺 `expires_at` → 400 `EXPIRES_AT_REQUIRED`，同时 DELETE 因缺 JSON 体返回 400，导致临时 Role／Agent 一度残留，已手工清理确认无残留；②复用已删除的 Role id → 409 `ROLE_ID_RETIRED`，换后缀重建；③`-b` 跑次中续查参数误传 `continueToken`（工具 schema 实为 `token`），续查返回 `mismatch`，该跑次续查步骤作废，证据 `evidence-budget04-attempt1-wrong-arg.json`，有效跑次为 `-c`（`evidence-budget04.json`）。上述都是用例／脚本问题，已回写 fixtures／cases。

## 观察（非本套件期望；未改任何东西）

- **参数名与指导措辞不一致**：initialize 指导写「with the returned `continueToken`」，而 `lucy_continue_question` 的 schema 参数为 `token`（`additionalProperties:false`）。依 schema 调用的客户端不受影响，但仅依指导措辞调用会得到 `mismatch`。是否需要在指导里点明参数名，由委托人决定。
- 触顶后续查通道在该身份下端到端可用；`demo_readonly` 种子角色仍无续查工具，触顶时 `continuable=false`。

## 与首跑的差异

- 构建由 `d64414d6`（dirty）变为 `299de2c9`（clean，含已提交的修复）；结论不变，说明修复已随提交进入镜像。
- 共享容器仍有他人并发改动连接，影响 UAT 窗口；跑前后必须核对 reload `requestId`。

## 未覆盖（不得据此宣称）

- 第二次续查被拒（SC-T3，另由单测覆盖，本波 `NOT RUN`）、空 catalog 回退路径、失败调用是否计入预算的改进方案、客户 K8s 环境。
- 本记录不等于 UAT 全绿，也不等于可上线。
