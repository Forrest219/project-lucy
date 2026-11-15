# UAT-SUITE-CONTEXT-CONTENT — MCP Wiki／Skill 真读真用 + ACL

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-CONTEXT-CONTENT` |
| 总账 ID | **P1-30**／REQ-030-051（**不入核心分母**） |
| 目标 | 终端用户经 MCP 真读 Wiki／Skill 正文，并在可见答复中用上 run-nonce；含通道 deny 与对象 ACL deny；防探查通／读不到／用不上假连通 |
| 合同回链 | 设计 [design-2026-11-15-uat-context-content-wiki-skill.md](../../../../design/design-2026-11-15-uat-context-content-wiki-skill.md) v0.2；Plan [lucy-20261115-uat-context-content-landing-plan.md](../../../../plans/lucy-20261115-uat-context-content-landing-plan.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| 必做宿主 | Claude Code CLI + Cursor Agent CLI（套件级必做；见 fixtures） |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |
| 判定脚本 | `node scripts/uat/judge-context-content.mjs` |
| 播种脚本 | `node scripts/uat/seed-context-content.mjs`（Admin Cookie 播种 + R0-SEED 探针；可复跑） |

## 复跑

1. 确认本机 demo WebUI／MCP 健康；按 [fixtures.md](fixtures.md) 取 Admin Cookie（路径 only，不写密码）。  
2. `node scripts/uat/seed-context-content.mjs` → 产出新 run-nonce、三身份 Token、Wiki／Skill；R0-SEED 探针须过。  
3. 双宿主各跑 [cases.md](cases.md) 必做场景（允许／通道 deny／对象 ACL deny；Wiki + Skill）；写 `runs/<date>-claude-*.md` 与 `runs/<date>-cursor-cli-*.md`（只记 sha256 前 12，不写明文 nonce／Token）。  
4. `node scripts/uat/judge-context-content.mjs` → 判定 JSON 落 `inbox/uat-ctx-content-<date>/`；INDEX／e2e-ledger 跟进态与 JSON 同句。  
5. 测后清理：ACL／内容 → Agent → Role（见 fixtures）；空 Wiki stub 残留可接受。

## 必做／可选

| 必做 | 条件／可选 |
|---|---|
| UAT-R0、UAT-CTX-R0-SEED、WIKI-01／02／03／04、SKILL-01／02／03／04；双宿主各一份跑次 | WIKI-01S（search）；默认 demo 问数 Token 探针（仅凭据可用时） |

## 边界

- 本套件主张 **客户／终端用户场景** UAT，**≠** 可上线，**≠** 功能合同收口。  
- 禁止用 vitest／Code Review／`cc-lucy-skill-probe` alone 冒充 PASS。  
- 临时资源前缀 `uat-ctx-content-`；Role／Agent id 带 run-nonce；测后按「ACL／内容 → Agent → Role」清理。  
- INDEX PASS 须可由判定 JSON 复算；缺任一宿主跑次不得写套件 PASS。  
- 跑次不得写入密码、Token 明文、原始 nonce（只写 `sha256` 前 12 位）。
