# 分表 E2E-AGENT：Agent + Lucy MCP 端到端

| 元数据 | 内容 |
|---|---|
| 文档名称 | 分表 E2E-AGENT：Agent + Lucy MCP 端到端 |
| 文档类型 | Checklist / Runbook |
| 版本 | v1.2 |
| 撰写日期 | 2026-08-08 |
| 撰写人 | Cursor Agent |
| 适用范围 | 测试集 `E2E-AGENT`：真实 Agent 经 Lucy MCP 答题并产出证据包 |
| 输出位置 | `docs/qa/suite-agent-mcp.md` |
| 父指引 | [`e2e-sop.md`](e2e-sop.md) |

> **先读父指引** [`e2e-sop.md`](e2e-sop.md)。命令、环境变量、证据路径以  
> [`docs/test-layers-and-release-gates.md`](../test-layers-and-release-gates.md) §2–§3 为事实源。

## 1. 本分表证明什么

数据库支撑的 Lucy MCP 控制面 + main / Hermes / moz 等 Agent **最终答案断言**与可复跑证据（非 stub）。

## 2. 常用命令

| 目的 | 命令 |
|---|---|
| 多 profile Agent E2E | `npm run e2e:agent` |
| 本机 Hermes + moz 可复跑 | `npm run e2e:agent:local-hermes` |
| SOW 可信标准包 | `npm run e2e:sow-trust-standard` |
| 主题占位（如 CEO 一眼报） | `npm run e2e:agent:ceo-one-report` |
| Spider2-lite Pilot MCP-direct（可选） | `npm run e2e:spider2-lite:sample`（见 §5；默认 Cursor `lucy-demo` token，无 Claude CLI） |

环境变量、证据路径见 `test-layers`（如 `LUCY_E2E_*`、`inbox/p1-agent-e2e-*`）。

## 3. 通过标准（摘要）

- `gateKind: e2e`，`stub: false`（真实 Agent 路径）。  
- 证据 JSON / HTML / artifact 齐全；SOW 路径需 `package:sow-trust-evidence -- --strict` → `READY`。  
- 缺 token / adapter 时写 **blocked** 证据，不得当 Pass。

## 4. 与其它测试集边界

| 不要用本分表做 | 改用 |
|---|---|
| 仅 WebUI 点击回归 | [`suite-webui-browser.md`](suite-webui-browser.md) |
| 人工/脚本主题接入并对 gold（未要求 Agent harness） | [`suite-semantic-onboard-mcp-eval.md`](suite-semantic-onboard-mcp-eval.md) |
| Spider2 装载 / catalog / datapath / MCP vs gold（无 Agent） | [`suite-semantic-onboard-mcp-eval.md`](suite-semantic-onboard-mcp-eval.md) §14 |
| 只验证 Docker / health / demo smoke | `test-layers` 的 `smoke:p0*` |

---

## 5. 可选扩展 — Spider2-lite Pilot（Cursor Lucy MCP）

> 父指引选用：Spider2 **Agent / MCP 抽样** → 本分表；接入 → ONBOARD-EVAL §14。  
> **不**进入 `e2e:sow-trust-standard` / 客户 headless 硬门禁。  
> **不**要求 Claude CLI；复用 Cursor MCP `lucy-demo`（`Bearer lucy-demo-agent-token`）。

### 5.1 前置（必须先过 ONBOARD + ACL）

1. [`suite-semantic-onboard-mcp-eval.md`](suite-semantic-onboard-mcp-eval.md) §14：G-rt / G-cat / datapath 已 PASS 或已登记 blocked。  
2. Cursor MCP `lucy-demo` → `http://127.0.0.1:57881/mcp`，token = `lucy-demo-agent-token`（Agent `demo_agent`）。  
3. 该 token 的 role 须含 `starrocks-r1` + `sandbox` `prefix: s2_`（与既有 KSC `ai.*` 可并存）。扩权后 **新开 MCP session** 再验 Visible Scope。

### 5.2 命令与产物

| 项 | 值 |
|---|---|
| MCP-direct 门禁 | `npm run e2e:spider2-lite:sample`（默认 demo token；查 Visible Scope + catalog s2_* + `payment_count=16049`） |
| NL 抽样作答 | Cursor Agent 对本机 Lucy MCP 按 `sample-ids.txt` 逐题 `lucy_catalog` → `lucy_query` / wiki，对照 gold |
| Case 子集 | `evals/spider2_lite_sqlite/sample-ids.txt`（8 题） |
| 证据目录 | `inbox/spider2-lite-sqlite/results/` |
| 摘要 | `inbox/spider2-lite-sqlite/results/e2e-summary.md` |

可选覆盖 token：`LUCY_SPIDER2_E2E_TOKEN=...`（仍走 mcp-direct，不调 Claude）。

### 5.3 通过 / blocked

| 结果 | 判定 |
|---|---|
| mcp-direct：Scope 含 s2_* 且 datapath 正确 | **Pass**（G-sample 门禁） |
| MCP 不可达 / Scope 无 sandbox.s2_* | **blocked**（写原因，禁止假 Pass） |
| datapath 数值错误 | **Fail** |
| NL 8 题对 gold | 另记 Cursor 作答报告；不阻塞 mcp-direct Pass |

### 5.4 清单

```text
[ ] ONBOARD §14 前置通过
[ ] demo token ACL 含 sandbox.s2_*；Cursor lucy-demo 已重载
[ ] npm run e2e:spider2-lite:sample → Pass
[ ] （可选）Cursor 对 sample-ids 作答 vs gold，报告落 OUT_DIR
```
