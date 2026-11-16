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
| UAT-R0、UAT-SAG-ESC-01～ESC-10（04～08 为 v2，2026-11-16 夜升必做；09～10 为 v0.4 新增；全部必做，v0.4 跑次 PASS） | 无 |

## v2 扩展（2026-11-16 夜；已升必做）

**升必做依据**：Lucy 用户群体是数据／商业／财务分析师等高强度用 Agent 消费数据的人。样例行查询、带业务过滤条件的即席度量、不先 `begin` 的 Agent、事实表＋维度表 join、以及拒绝后能自愈的载荷，都是这类用户的主路径，具备通用性；ESC-01～03 只覆盖单度量单表这一种理想形态。

ESC-04～08 补客户形态、explain／never_begun／重试路径、合法多表 join、拒绝载荷可执行性。跑次 [2026-11-16-cursor-sag-escape-fidelity](runs/2026-11-16-cursor-sag-escape-fidelity.md)：ESC-04／05／06 **PASS**；ESC-07／08 在 v0.3 构建 **FAIL**（曾重开 GAP；v0.4 已转绿，见下）。

**v0.4 容错三档（委托人 2026-11-16 夜批准并授权开发）**：选表歧义由强拦降为「放行＋披露＋审计」，ESC-06／07／08 期望按 Spec §4.5 修订，新增 ESC-09（披露与审计）／ESC-10（跨连接）。fidelity 跑次的 ESC-06 PASS 按**修订前** v0.3 合同判定；v0.4 实现后已复跑：[2026-11-16-cursor-sag-escape-v04](runs/2026-11-16-cursor-sag-escape-v04.md) 全绿，套件 INDEX＝**PASS**，`GAP-UAT-P0-3-ESCAPE` 已关。父套件 SAG-01 改为 **v3**（验硬线仍拦，见 Spec §5.2）。

## 边界

- **优化前基线**：[2026-11-16-claude-sag-escape-baseline](runs/2026-11-16-claude-sag-escape-baseline.md) ESC-01 FAIL。  
- **现值**：[2026-11-16-cursor-sag-escape-v04](runs/2026-11-16-cursor-sag-escape-v04.md)（v0.4，ESC-01～10 全绿）＝INDEX **PASS**；历史 [retest](runs/2026-11-16-cursor-sag-escape-retest.md) 仅覆盖 v1 三条。  
- **UAT-SAG-ESC-02** 是窄意图对照：证明门闩不是「一律拦所有 query」。  
- **UAT-SAG-ESC-03** 断言：Agent／非 person 不得伪造宿主 confirm（403）——不得为逃生而拆掉 SC-17 HTTP 门。  
- 与 [`UAT-SUITE-SOURCE-AMBIGUITY`](../source-ambiguity-gate/suite.md) 分工：彼套件必做 **SAG-01 v2**＝「未形成 D1 钉选的多表词要拦」；本套件 ESC-01＝「唯一钉选可成交」。历史 SAG-01 单度量步骤已迁义到 ESC-01，不得两边同时要求相反期望。SAG-02（person 确认放行）仍属彼套件可选。  
- 本套件出口须 INDEX＝**PASS**（ESC-01～10 必做全绿）；**不以** PASS WITH GAP 关闭 `GAP-UAT-P0-3-ESCAPE`。  
- 禁止用 vitest／CR／读代码冒充本套件 PASS。跑次不得写入 Bearer／密码明文。  
- **≠** 可上线；**≠** 功能合同收口；登记本套件 **≠** 开发授权。
