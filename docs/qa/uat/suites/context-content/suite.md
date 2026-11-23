# UAT-SUITE-CONTEXT-CONTENT — MCP Wiki／Skill 真读真用 + ACL

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-CONTEXT-CONTENT` |
| 总账 ID | **P1-30**／REQ-030-051（**不入核心分母**） |
| 目标 | 经 MCP 验证业务 Wiki／业务 Skill 真读真用与 ACL，并验证自然问句能否在需要时主动采用已授权的业务上下文 |
| 合同回链 | 设计 [design-2026-11-15-uat-context-content-wiki-skill.md](../../../../design/design-2026-11-15-uat-context-content-wiki-skill.md) v0.2；Plan [lucy-20261115-uat-context-content-landing-plan.md](../../../../plans/lucy-20261115-uat-context-content-landing-plan.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| 必做宿主 | Claude Code CLI + Cursor Agent CLI（套件级必做；见 fixtures） |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |
| 真读真用与 ACL 判定脚本 | `node scripts/uat/judge-context-content.mjs` |
| 真读真用与 ACL 播种脚本 | `node scripts/uat/seed-context-content.mjs`（Admin Cookie 播种 + R0-SEED 探针；可复跑） |

## 真读真用与 ACL 复跑

1. 确认本机 demo WebUI／MCP 健康；按 [fixtures.md](fixtures.md) 取 Admin Cookie（路径 only，不写密码）。  
2. `node scripts/uat/seed-context-content.mjs` → 产出新 run-nonce、三身份 Token、Wiki／Skill；R0-SEED 探针须过。  
3. 双宿主各跑 [cases.md](cases.md) 必做场景（允许／通道 deny／对象 ACL deny；Wiki + Skill）；写 `runs/<date>-claude-*.md` 与 `runs/<date>-cursor-cli-*.md`（只记 sha256 前 12，不写明文 nonce／Token）。  
4. `node scripts/uat/judge-context-content.mjs` → 判定 JSON 落 `inbox/uat-ctx-content-<date>/`；INDEX／e2e-ledger 跟进态与 JSON 同句。  
5. 测后清理：ACL／内容 → Agent → Role（见 fixtures）；空 Wiki stub 残留可接受。

## 真读真用与 ACL 必做／可选

| 必做 | 条件／可选 |
|---|---|
| UAT-R0、UAT-CTX-R0-SEED、WIKI-01／02／03／04、SKILL-01／02／03／04；双宿主各一份跑次 | WIKI-01S（search）；默认 demo 问数 Token 探针（仅凭据可用时） |

## 默认使用业务上下文

[用例](cases.md#默认使用业务上下文) · [夹具](fixtures.md#默认使用业务上下文夹具) · [测试台判定](../../INDEX.md#默认使用业务上下文)

合同回链：[P1-77／REQ-030-098 Spec](../../../../specs/lucy-20261123-default-business-context-adoption-spec.md) · [实施 Plan](../../../../plans/lucy-20261123-default-business-context-adoption-plan.md)。测试台覆盖宿主质量和性能，实际注入及 lint 证据按 Spec 对应项归档。

改前基线（2026-11-23，`322438a2`）：[kscc 跑次](runs/2026-11-23-kscc-ctx-default.md) 复现「需提示才可用」（02/03/04 自然 FAIL、显式 PASS）；[kimi 跑次](runs/2026-11-23-kimi-ctx-default.md) 自然问句均主动采用。必做宿主 Claude/Cursor CLI 本机未装，经委托人当次指示以 kscc＋kimi 替换，基线不构成套件 PASS。

以独立通过 P1-75 的 Docker 候选为 A，以叠加 P1-77 的候选为 B。使用 Claude Code CLI 和 Cursor Agent CLI 的原生 MCP 接入。前置 R0、普通题、自然与显式对照、已治理直通、子结论兜底、[PERF](cases.md#uat-ctx-default-perf) 和 [MIX](cases.md#uat-ctx-default-mix) 均为必做。MIX 同时用真实前台浏览器分开记录名册页面和 API 时延。

此组未来跑次使用 `runs/YYYY-MM-DD-<agent>-ctx-default.md`，按用例表逐项记录。现有 `judge-context-content.mjs` 继续覆盖原真读真用与 ACL 组。默认使用业务上下文组的测程及复算判定由配对 Plan 的 B2 交付，判定登记在测试台。

## 边界

- 本套件主张 **客户／终端用户场景** UAT，**≠** 可上线，**≠** 功能合同收口。  
- 禁止用 vitest／Code Review／`cc-lucy-skill-probe` alone 冒充 PASS。  
- 临时资源前缀 `uat-ctx-content-`；Role／Agent id 带 run-nonce；测后按「ACL／内容 → Agent → Role」清理。  
- 真读真用与 ACL 的 INDEX PASS 须可由判定 JSON 复算。各组均须具备双宿主证据才能登记本组 PASS。
- 跑次不得写入密码、Token 明文、原始 nonce（只写 `sha256` 前 12 位）。
