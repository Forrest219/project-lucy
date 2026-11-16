# UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE — 纯 MCP 表级歧义逃生

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE` |
| 总账 ID | **P1-35**／REQ-030-056（主合同）；伴生 **P0-3**／REQ-030-024。本套件专测 **宿主缺席／纯 MCP** 逃生，不替代 [`UAT-SUITE-SOURCE-AMBIGUITY`](../source-ambiguity-gate/suite.md) 修订后「未形成 D1 仍拦」合同 |
| 目标 | 证明：泛化业务词 begin 后，即便 `lucy_query` 已限定可见表完整身份，纯 MCP 客户端仍能查数成交，或拿到 MCP 可达的可执行下一步；不得停在无 `usableTargets`、且仅依赖 person＋attestation 宿主 confirm 的死路 |
| 合同回链 | Spec [`lucy-20261116-source-ambiguity-mcp-escape-spec.md`](../../../../specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md)（P1-35）；父 [`lucy-20261107-source-ambiguity-gate-spec.md`](../../../../specs/lucy-20261107-source-ambiguity-gate-spec.md)；错题 [`2026-11-16-source-ambiguity-gate-deadlock.md`](../../../../lessons/2026-11-16-source-ambiguity-gate-deadlock.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-SAG-ESC-01、UAT-SAG-ESC-02、UAT-SAG-ESC-03 | 无 |

## 边界

- **优化前基线**：[2026-11-16-claude-sag-escape-baseline](runs/2026-11-16-claude-sag-escape-baseline.md) ESC-01 FAIL。  
- **优化后现值**：[2026-11-16-cursor-sag-escape-retest](runs/2026-11-16-cursor-sag-escape-retest.md) 必做全绿＝INDEX **PASS**。  
- **UAT-SAG-ESC-02** 是窄意图对照：证明门闩不是「一律拦所有 query」。  
- **UAT-SAG-ESC-03** 断言：Agent／非 person 不得伪造宿主 confirm（403）——不得为逃生而拆掉 SC-17 HTTP 门。  
- 与 [`UAT-SUITE-SOURCE-AMBIGUITY`](../source-ambiguity-gate/suite.md) 分工：彼套件必做 **SAG-01 v2**＝「未形成 D1 钉选的多表词要拦」；本套件 ESC-01＝「唯一钉选可成交」。历史 SAG-01 单度量步骤已迁义到 ESC-01，不得两边同时要求相反期望。SAG-02（person 确认放行）仍属彼套件可选。  
- 本套件出口须 INDEX＝**PASS**（必做全绿）；**不以** PASS WITH GAP 关闭 `GAP-UAT-P0-3-ESCAPE`。  
- 禁止用 vitest／CR／读代码冒充本套件 PASS。跑次不得写入 Bearer／密码明文。  
- **≠** 可上线；**≠** 功能合同收口；登记本套件 **≠** 开发授权。
