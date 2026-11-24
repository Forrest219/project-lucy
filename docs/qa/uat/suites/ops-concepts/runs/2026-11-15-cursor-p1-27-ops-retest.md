# Run — 2026-11-15 — cursor-p1-27-ops-retest — UAT-SUITE-OPS-CONCEPTS

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-OPS-CONCEPTS`（P1-27 修复复测） |
| 总账 | P1-11／REQ-030-032；P1-27／REQ-030-048 |
| Agent | Cursor（本机全真）；Claude Code CLI 本波因 `unrecognized_model`／`-p` 挂起未完成执行，改由 Cursor 按同一 cases／fixtures 全真跑 |
| Plan／Brief | [`lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md`](../../../../../plans/lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md)；[`inbox/20261115-p1-27-ops-retest-claude-brief.md`](../../../../../inbox/20261115-p1-27-ops-retest-claude-brief.md) |
| 环境 | WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；容器 `compose-lucy-1`；compose project `compose` |
| Health | `lucyVersion=0.30.0`；`gitSha=d64414d68a19bd2ade981c74a2c8b23e56a5893b`；`gitDirty=false`；`bundledKtxVersion=0.16.0`；`ktxRuntime.status=ready` |
| 修复祖先 | `ae155f86`（`git merge-base --is-ancestor` 相对 tip `d64414d6`＝true） |
| 凭据 | WebUI：Desktop `lucywebui logi.txt` 不在 → `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（`adminId=xingchen`）。问数 Bearer：`/Users/forrest/Desktop/lucy token.txt`（MCP JSON 片段内 Bearer；sha256 前 12 位 `8e0ae3055cef`）。**口令／Bearer／临时 ops Token 明文未写入本跑次或 inbox 证据** |
| 临时资源 | Role `uat-ops-concept-role-retest`／Agent `uat-ops-concept-agent-retest`／Token label `uat-ops-concept-retest`（原 `uat-ops-concept-role` 已 `ROLE_ID_RETIRED`，改用同前缀新 id）。测后已删除 |
| 证据 | [`inbox/uat-p1-27-28-12-14-2026-11-15/p1-27/`](../../../../../inbox/uat-p1-27-28-12-14-2026-11-15/p1-27/)（health／tools／ops_call_*；无 secret） |
| 开始／结束 | 2026-11-15T14:26Z ／ 2026-11-15T14:32Z（UTC 约） |
| 总判定 | **PASS**（必做 UAT-R0／UAT-R0-FIX／01／02／03 全 PASS；04／05 SKIPPED） |

> **一句话结论**：含 P1-27 修复的干净镜像上，未向 `/data/lucy` 播种 `scripts/`；问数 Token 仍无 ops 工具；带 `allow.ops` 的临时 Agent 对 `list`／`summary`／`scan(dry_run)` **业务受理成功**（空库／preview），首跑 FAIL 的 502／`ERR_MODULE_NOT_FOUND` 未再现。可主张关闭 `GAP-UAT-P1-11-RUNTIME`。≠ 可上线。

---

## UAT-R0 — 环境门禁 — PASS

| 步骤 | 观测 | 结果 |
|---|---|---|
| `docker ps` | `compose-lucy-1` healthy；`55176→5174`、`57881→7879` | PASS |
| `GET /api/health` | `ok`；`gitSha=d64414d6…`；`gitDirty=false`；`ktxRuntime.ready=true` | PASS |
| WebUI 登录 | `POST /api/auth/login` `{adminId,password}` → HTTP 200 `ok=true`；`GET /api/auth/me` → 200 | PASS |
| 问数 MCP initialize | HTTP 200；`serverInfo={name:ktx,version:0.16.0}`；`instructions` 7747 字符 | PASS |

---

## UAT-R0-FIX — P1-27 修复镜像门禁 — PASS

| 步骤 | 观测 | 结果 |
|---|---|---|
| `gitDirty` | `false` | PASS |
| `gitSha` | tip `d64414d68a19bd2ade981c74a2c8b23e56a5893b`；含修复提交 `ae155f86`（祖先核对） | PASS |
| 卷上无 `scripts/` | `NO_VOLUME_SCRIPTS` | PASS |
| 代码根 concepts | `CODE_ROOT_OK`（`/app/scripts/concepts/store.mjs`＋`scan.mjs`） | PASS |
| `KTX_PROJECT_ROOT` | `/data/lucy` | 记录 |

未向 `/data/lucy` 拷贝 `scripts/`。

---

## UAT-OPS-CONCEPT-01 — 问数 Token 无概念运维工具 — PASS

| 期望 | 观测 | 结论 |
|---|---|---|
| tools/list 无 `lucy_ops_concept_*` | 11 工具；ops 可见 0 | ✅ |
| 强调 list 拒绝 | `isError=true`；`Access denied: ops_not_granted:lucy_ops_concept_list` | ✅ |
| 无成功概念清单 | 仅拒绝文本 | ✅ |

---

## UAT-OPS-CONCEPT-02 — 临时 allow.ops Agent 可 list／scan — PASS

| 步骤 | 观测 | 结果 |
|---|---|---|
| 建 Role／Agent／Token | HTTP 200；ops Token sha12=`5c0e1e38f966`（明文仅 `/tmp`，已删） | PASS |
| tools/list | 恰 4 个：`list`／`show`／`summary`／`scan` | PASS |
| `lucy_ops_concept_list` | HTTP 200；业务载荷 `concepts=[]`（空库可接受）；**非** 502 | PASS |
| `lucy_ops_concept_summary` | HTTP 200；`totals.concepts=0` 等；**非** 502 | PASS |
| `lucy_ops_concept_scan` `dry_run=true` | HTTP 200；`mode=preview`＋`plan_id`＋`confirm_digest`；停在 preview，未 commit | PASS |
| 禁止失败形态 | 无 `Proxy error`／`ERR_MODULE_NOT_FOUND`／`/data/lucy/scripts/concepts` | PASS |
| 卷前提 | 事后仍 `NO_VOLUME_SCRIPTS` | PASS |

---

## UAT-OPS-CONCEPT-03 — 清理 — PASS

- 删除 Agent／Role 均为 HTTP 200  
- 问数 Token 再 `tools/list`：11 工具、ops 仍 0  

---

## 可选

| ID | 结果 |
|---|---|
| UAT-OPS-CONCEPT-04 | **SKIPPED**（本波默认） |
| UAT-OPS-CONCEPT-05 | **SKIPPED**（无安全注入） |

---

## 台账主张（供 Cursor 验收）

- 套件判定：**PASS**  
- 建议关闭 e2e-ledger `GAP-UAT-P1-11-RUNTIME`  
- ≠ 可上线；≠ 改 P1-11 功能合同收口句语义以外的「可上线」叙事  
