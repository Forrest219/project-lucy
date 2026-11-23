# MCP 问询端到端性能基准与持续门禁 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / **v0.3-draft** |
| 日期 / 功能编号 | 2026-11-23 / **P1-78／REQ-030-099** |
| 状态 | S1｜v0.3-draft。委托人2026-11-23授权新建独立性能测试 Spec／Plan／UAT 设计；终稿未确权；开发未授权；仅设计，不执行性能跑次；不改产品优化代码；≠ 发布取证收口；≠ 可上线。 |
| 授权边界 | 当前仅允许文档设计与登记。Task 1–4／8 的实现须终稿确权及测试基建开发授权；Task 5／7 另须隔离 Docker 与真实 Agent 跑次授权；Task 6 另须 CI／发布接线授权。题目与初始化数据的补充分别由 P1-54 与全局规模基线另行授权，不在本 Plan。任何任务都不得修改 Lucy／KTX 产品运行路径或实施性能优化。 |
| 验收 | [Spec SC-01–SC-15](../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md#10-验收) 全过；`UAT-MIP-R0／01–15` 全部必做并有真实跑次；连续两次无人值守每日跑次形成可比证据链。 |
| 关联 | [Spec](../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md) · [UAT](../qa/uat/suites/mcp-inquiry-performance/suite.md) · [总账 P1-78](lucy-20261107-lucy-0-30-feature-inventory-pool.md) |

## 目标

建立一套独立、可信、持续运行的 MCP 问询性能测程：真实 Agent 自然提问到正确完整答复，确定性 MCP 对照分解阶段，按场景保存全部分母和真实基线，以绝对预算与相对回退阻断出包／升级；产品优化只由其他 Spec 使用同一测程验收。

**本 Plan 不自制题目，也不自制初始化数据**：自然问题、追问链与 oracle 全部引用 P1-54 题库 Spec；身份、凭据、Wiki／Skill／审计行与表夹具全部引用全局规模基线（含 `uat:scale-baseline:seed:*`）与 P1-34。需要新题或新 profile 时，在 owner 侧另行授权与版本化，本 Plan 只消费并在缺失时记 BLOCKED。

## 架构

新增独立性能合同和判定器，不复用 P1-53 的整套聚合与 `mapBudgetClass()` 逻辑。执行层分为真实 Agent 与确定性 MCP 两条 lane，共享 P1-54 题目 ID、场景定义和候选指纹；证据层保存全部尝试并由独立 verifier 重读复算。PR、每日、出包、升级和优化 A/B 共用同一 runner，只改变场景选择器和样本档，不改变计时或预算语义。

**技术栈**：仓库现有 Node.js `.mjs`、YAML、`node:test`、真实 MCP JSON-RPC、既有真实 Agent 适配器、隔离 Docker compose、GitHub Actions、JSON／NDJSON 证据。不新增产品依赖，不修改 KTX。

## 开工前置

1. 委托人完成 Spec 终稿确权，并按上述边界分别发出测试基建开发、真实跑次和 CI 接线授权。
2. 首版绝对预算经 baseline-seed 评审后由委托人具名冻结；在冻结前只能产生 `SEED_ONLY`，不得作为出包 PASS。
3. 可启动隔离 Docker、真实 KTX 和合成数据源；全局规模档先通过 `npm run uat:scale-baseline`，未达标对应规模用例记 BLOCKED。
4. 至少一个候选真实 Agent 可经 Public MCP 完成多轮自然问题；客户端／模型指纹可固定。首 token 不支持时如实记录 `not_available`，完整答复墙钟不可缺。
5. P1-54 题库与 CompatConfigProfile 可用且 digest 匹配；普通问数 Token、拒绝 Token 和合法对照 Token 均来自本机私密文件，目录 0700、文件 0600。
6. **题目依赖**：长追题组由 [P1-79 长追问题组](../specs/lucy-20261123-long-followup-question-pack-spec.md) 承载（独立题组包与独立 `packDigest`，语义继承 P1-54，不改 P1-54 题库与 P1-53 证据）。题组实现、校验与自检证据到位前，`UAT-MIP-15` 及其在 `SOAK` 中的比例判定记 BLOCKED；本 Plan 只消费 `questionRef` 与 digest。
7. **初始化数据依赖**：本专项的 50 路压测身份与持续压力 profile 已登记进[全局规模基线 §1.1 MCP-PERF](../qa/uat/scale-baseline.md)（含精确向量下限与 Wiki／Skill 实读、`lucy_admin` 运行时绑定要求），表与宽表夹具由 P1-34 提供。该 profile 的机器断言扩展（`scripts/uat/check-uat-scale-baseline.mjs`）属测试基建改动，需独立开发授权；断言生效前相关用例记 BLOCKED，不得在本套件私写规模数字、造数脚本或替代夹具。
8. 确认本 Plan 只新增测试基建。若实现中发现必须修改 Lucy／KTX 才能观测完整答复，停止该分支并回到 Spec 评审，不夹带产品优化。

## Task 1：性能场景与纯判定器（TDD）

**文件：**

- Create `scripts/e2e/contracts/mcp-inquiry-performance.yaml`
- Create `scripts/e2e/lib/mcp-inquiry-performance.mjs`
- Create `scripts/e2e/__tests__/mcp-inquiry-performance.test.mjs`

**步骤：**

1. 在 YAML 中定义 `schemaVersion／scenarioId／questionRef／lane／budgetClass／cacheState／concurrencyGroup／sampleFloors／oracleRef`。**只允许写 `questionRef`**：自然语言文本、oracle 和答案期望一律不得出现在本文件；出现即由 lint 拦截。引用不到的题库 ID、题库未提供的长链一律记 BLOCKED，不得就地补题。
2. 先写失败测试，覆盖：最近秩分位、每场景分组、PR／正式样本下限、N<20 的 P95 与 N<100 的 P99 不可声明、simple／complex／denial 分档、绝对预算、相对阈值、全分母和合法对照。
3. 写入专门的反回归夹具：
   - `p95Ms:null` 或 `medianMs:null` 的基线必须 BLOCKED；
   - 34 案共 43 个 MCP 样本不得被解释为每场景≥20；
   - `mapBudgetClass()` 永远返回 simple 的等价输入必须被新判定器拒绝；
   - 快速错误、只留第 3 次成功、仅 initialize 和缺最终答复均不得 PASS。
4. 实现纯函数 `nearestRank／groupAttempts／assertSampleFloors／judgeAbsolute／compareBaseline／aggregatePerformance`。禁止网络、文件写入和产品代码依赖。

**验证：**

```bash
node --test scripts/e2e/__tests__/mcp-inquiry-performance.test.mjs
```

预期：先因模块／断言缺失 FAIL，完成后全部 PASS；以上四个历史假绿夹具均有独立测试名。

## Task 2：基线、原始证据与独立 verifier（TDD）

**文件：**

- Create `scripts/e2e/lib/mcp-inquiry-performance-evidence.mjs`
- Create `scripts/e2e/__tests__/mcp-inquiry-performance-evidence.test.mjs`
- Create `docs/qa/uat/suites/mcp-inquiry-performance/baselines/README.md`
- Create `docs/qa/uat/suites/mcp-inquiry-performance/evidence/README.md`

**步骤：**

1. 定义 `summary.json／attempts.ndjson／negative-controls.json` 与 baseline schema。正式基线必须保存逐场景真实 `sampleCount／p50Ms／p95Ms／medianMs`；P99 在 N<100 时为 `not_estimable`。
2. 写原子写入、0600 私有文件检查、公开证据脱敏、正文 SHA-256、`LATEST.json` 只读解析和具名接受记录。`LATEST.json` 不得随普通跑次自动晋级。
3. 先写 verifier 负控：删一次失败、改一次 RTT、手填 P95、伪造顶层 PASS、改题库／客户端／模型／资源指纹、重复 attemptId、缺失最终答复、摘要与正文 digest 不符均必须失败。
4. 实现 verifier 从 NDJSON 重算分母、分位、预算、相对差和总判定；顶层 `status／verdicts` 只作不受信展示。
5. 在 baselines／evidence README 写明公开文件不得含 Token、Cookie、Session、原始业务行、私有提示词或客户对象名。

**验证：**

```bash
node --test scripts/e2e/__tests__/mcp-inquiry-performance-evidence.test.mjs
```

预期：全部 PASS；将任一正式 baseline 的必填数值改为 `null` 后测试明确 BLOCKED，而非跳过相对比较。

## Task 3：确定性 Public MCP 测程

**文件：**

- Create `scripts/e2e/lib/mcp-inquiry-performance-client.mjs`
- Create `scripts/e2e/run-mcp-inquiry-performance.mjs`
- Create `scripts/e2e/__tests__/run-mcp-inquiry-performance.test.mjs`
- Reuse `scripts/e2e/lib/mcp-compatibility-client.mjs:197` 的 `createMcpClient` 与既有解析／脱敏工具，不改 P1-53 默认行为。

**步骤：**

1. 用依赖注入的单调时钟封装每次 JSON-RPC，记录请求 ID、工具、RTT、终态和服务端审计关联；通知没有响应体时按协议回执单列，不伪造 RTT。
2. 实现 `initialize→notifications/initialized→tools/list→目录／发现→（begin）→query→（continue）`，分别记录首条正确结果和完整 MCP 旅程。`begin` 不可见时按现行能力记录原因，不虚构调用。
3. 每场景独立执行 simple／complex／denial、冷／热和 20／50 路；同步并发只负责发压，另从入口回执计算实际在途峰值。
4. 保存全部错误、超时、取消和重试。每个拒绝场景执行同级合法查询并核对 oracle。
5. CLI 支持 `--trigger pr|nightly|release|upgrade-pre|upgrade-post|optimization-ab`、`--scenario`、`--baseline`、`--evidence-dir`；禁止出现可产生发布证据的 `--skip-query`、`--allow-new-deny`、`--accept-regression`。

**验证：**

```bash
node --test scripts/e2e/__tests__/run-mcp-inquiry-performance.test.mjs
node scripts/e2e/run-mcp-inquiry-performance.mjs --trigger pr --scenario SIMPLE --dry-run
```

预期：单测覆盖完整顺序与错误分母；`--dry-run` 只校验参数和指纹，明确输出 NOT RUN，不写基线、不声称性能 PASS。真实执行归 Task 5／7。

## Task 4：真实 Agent 旅程与并发计划

**文件：**

- Create `scripts/e2e/lib/mcp-inquiry-performance-agent.mjs`
- Create `scripts/e2e/__tests__/mcp-inquiry-performance-agent.test.mjs`
- Reuse `scripts/e2e/lib/mcp-agent-journeys.mjs:494` 的客户端选择、指纹与适配器加载；复用 `docs/qa/mcp-compat-clients.yaml`。
- Modify only if additive timing events are required: `scripts/e2e/adapters/kimi-code.mjs`；不得改变既有 P1-53 答案、重试或计时分母。

**步骤：**

1. 在宿主编排层记录问题提交、首个响应事件、首正文 token（支持时）、最终答复完成及每轮墙钟；将工具轨迹与 MCP 对照按 case／attempt／RPC ID 关联。
2. 答案只按 P1-54 oracle 做有效性检查；最终答复未完成、只有工具结果或错误答案均保留并判无效，不能只记录延迟较小的工具调用。
3. 每场景正式执行≥20 次，连续追问保持同一会话。真实 Agent 选择器缺失、模型变化或适配器不支持多轮时记 BLOCKED。
4. 新建本条自己的 20／50 路计划器，不改变 `runAgentJourneys` 现有并发上限或 P1-53 默认分母。每个角色组独立记录到达、在途、完成、公平性和正确性。
5. 增加观测开关 A/B，证明详细观测自身未造成 >20% 且 >50ms 的额外 P95；观测开销本身越线时先修测程，不得把被测产品判为退化。

**验证：**

```bash
node --test scripts/e2e/__tests__/mcp-inquiry-performance-agent.test.mjs
```

预期：首 token 缺省、只有工具无最终答复、同会话追问、50 路计划与角色公平性均有自动化覆盖；真实宿主执行归 Task 5／7。

## Task 5：隔离 Docker baseline-seed 与预算冻结

**文件：**

- Create `scripts/uat/mcp-inquiry-performance-uat.mjs`
- Create `scripts/uat/lib/mcp-inquiry-performance-docker.mjs`
- Create `scripts/uat/__tests__/mcp-inquiry-performance-docker.test.mjs`（若该目录现有测试约定不适用，则归入 `scripts/e2e/__tests__/`）
- Update `docs/qa/uat/suites/mcp-inquiry-performance/fixtures.md`（只登记实测环境，不擅自改预算）

**步骤：**

1. 启动独立 compose 项目、专用网络／卷和真实 KTX／数据库，应用匹配 CompatConfigProfile；记录候选 digest、资源、存储、反代和缓存状态。
2. 启用 MCP-PERF profile 断言：按[全局规模基线 §1.1](../qa/uat/scale-baseline.md)核对 50 路压测身份与精确向量下限（`check-uat-scale-baseline.mjs` 的 profile 扩展需先获测试基建开发授权）。断言未生效或未达标时，相关用例记 BLOCKED，不缩规模开跑。
3. 执行 R0 测程自检：已知正常请求应通过，受控慢请求、已知错误和 2× 延迟必须被检出；Wiki 检索、Skill 读取、`lucy_admin` 运行时绑定与跨连接查询按 R0 清单实测。负控只存在于隔离环境，结束后恢复并核验无残留。
3. 按正式样本执行 baseline-seed；保存全部原始尝试并生成 `SEED_ONLY`，不自动更新 `LATEST.json`。
4. 将设计预算与实测分布提交委托人具名冻结。若需改 §5，独立修改 Spec 并留评审记录；不得在 runner 里按实测最大值自动抬线。
5. 接受后将真实数值基线写入 baselines 目录， verifier 复算一致后才允许后续相对比较。

**验证：**

```bash
npm run uat:scale-baseline
node scripts/uat/mcp-inquiry-performance-uat.mjs seed --trigger nightly
```

预期：全局规模档前置通过；seed 输出为 `SEED_ONLY`，样本、分位和原始证据完整。没有具名接受记录时不得显示 PASS。此 Task 需要真实跑次授权，当前不执行。

## Task 6：持续调度、发布接线与历史口径迁移

**文件：**

- Modify `package.json`（仅新增本条命令）
- Modify `.github/workflows/lucy-ci.yml`
- Modify `.github/workflows/lucy-release.yml`
- Create `.github/workflows/lucy-mcp-inquiry-performance.yml`
- Modify `docs/governance/test-layers-and-release-gates.md`（Current Commands＋CI Mapping）
- Modify `docs/specs/lucy-20261120-user-journey-performance-gate-spec.md`（移除 MCP 残余范围）
- Modify `docs/plans/lucy-20261120-user-journey-performance-gate-plan.md`（移除 W3）
- Modify `docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md`（性能轴引用本条，保留功能兼容与四入口）
- Modify `scripts/e2e/run-mcp-compatibility.mjs`（只消费本条性能证据，不改功能分母）
- Modify `scripts/e2e/lib/mcp-compatibility.mjs`（删除重复性能判定后保留功能／升级聚合所需接口）

**步骤：**

1. PR 接入最小双测程；小样本 Agent 只作绝对上限与中位数判定，不显示正式 P95 PASS。缺必需真实宿主时检查结果为 BLOCKED，不能静默跳过。
2. 每日 workflow 执行完整矩阵（含 `SOAK` 持续压力与 `LONG_FOLLOW` 长追问）并保存公开证据；同一候选的后续跑次只能读取已接受基线，不自动晋级。持续压力档的墙钟与成本须在 workflow 预算内，超时判失败而不是截断窗口。
3. 出包与升级聚合器只接受本条完整正式 PASS；`SEED_ONLY／FAIL／BLOCKED／NOT RUN` 均令 releaseReady=false。
4. P1-53 性能轴切换为本条证据并保留四入口和功能兼容；先跑既有测试，再删除旧重复算法，避免双源并行。
5. P1-67 只保留 API／WebUI／部署对账。更新索引、总账关系与测试门禁文档，确保新命令和 CI job 均可发现。
6. 用 workflow contract 测试证明跳过、缺文件、错 digest、旧 `null` 基线和 CI 子集都不能产生 releaseReady。

**验证：**

```bash
node --test scripts/e2e/__tests__/mcp-compatibility.test.mjs scripts/e2e/__tests__/mcp-compatibility-evidence.test.mjs scripts/e2e/__tests__/run-mcp-compatibility.test.mjs
npm run test:ci-workflow-contracts
```

预期：P1-53 既有功能／权限／四入口合同测试通过；性能只认本条证据；workflow 负控全部有效。

## Task 7：正式 UAT、连续运行证明与收口

**文件：**

- Create `docs/qa/uat/suites/mcp-inquiry-performance/runs/YYYY-MM-DD-<agent>-baseline-seed.md`
- Create `docs/qa/uat/suites/mcp-inquiry-performance/runs/YYYY-MM-DD-<agent>-formal.md`
- Create `docs/qa/uat/suites/mcp-inquiry-performance/runs/YYYY-MM-DD-<agent>-scheduled-proof.md`
- Update `docs/qa/uat/INDEX.md`
- Update `docs/governance/e2e-ledger.md`
- Create `docs/reviews/YYYY-MM-DD-p1-78-performance-evidence-audit.md`
- Create `docs/reviews/YYYY-MM-DD-p1-78-implementation-cr.md`

**步骤：**

1. 执行 `UAT-MIP-R0／01–15`，保留改前、候选、负控和恢复证据；任何必做失败按实际 INDEX 记 FAIL，不以功能兼容 PASS 代替。
2. 完成 20／50 路真实并发和角色公平性；核对实际在途，不以同步发送日志代替在途证明。
3. 执行 `SOAK`：50 身份、真实宿主会话、≥1800 秒有效窗口、截断正态到达、计划到达与终态一一对应；保留窗口分位、正确性、首尾窗口比较与未派发记录。
4. 执行 `LONG_FOLLOW`：≥10% 场景实例为单进程同会话长链，每链 ≥20 次后续追问、逐轮 oracle 成立；保留链级与逐轮轨迹、进程与会话证据。
5. 连续两次由调度器无人值守完成每日跑次，第二次引用第一次已接受基线；补齐 PR、出包和升级 PRE／POST 负控。
6. 用一个独立测试优化变量演示 A/B 交接，只验证测程能判改前／改后，不在本条实施产品优化。若没有已获授权的优化候选，使用隔离测程自身的已知延迟开关，明确标为测程负控。
7. SC-01–SC-15 逐条挂证据，完成实现 CR、泄露扫描、清理和三台账回写；发布取证终态才允许申报 X_REL。

**验证：**

```bash
node scripts/e2e/run-mcp-inquiry-performance.mjs --trigger release --baseline docs/qa/uat/suites/mcp-inquiry-performance/baselines/LATEST.json
node scripts/uat/check-e2e-ledger.mjs
npm run lint:spec-docs
npm run lint:spec
npm run lint:terminology
npm run lint:ia-boundary
```

预期：真实 release 跑次及独立 verifier 一致 PASS；全部文档门禁通过；若全仓已有失败，按冻结基线列出差集，不修改无关失败。

## Task 8：持续压力与长追问测程（SOAK／LONG_FOLLOW）

**文件：**

- Create `scripts/e2e/lib/mcp-inquiry-performance-soak.mjs`
- Create `scripts/e2e/__tests__/mcp-inquiry-performance-soak.test.mjs`
- Modify `scripts/e2e/contracts/mcp-inquiry-performance.yaml`（新增 `SOAK`／`LONG_FOLLOW` 场景定义，只写引用）
- Modify `scripts/e2e/run-mcp-inquiry-performance.mjs`（新增 `--trigger soak|long_follow`）

**步骤：**

1. 到达模型：固定 seed 的截断正态思考时间，记录 μ、σ、截断上下界与实际分布；实现“计划到达不因系统变慢被静默合并或丢弃”，未派发与未终结单独计数并判失败。
2. 持续压力：50 个独立 Agent 身份与真实宿主会话，有效窗口 ≥1800 秒、12 个 150 秒窗口；每窗口输出分位、正确率、超时、角色分组与公平性，并比较相邻窗口与首尾窗口。
3. 长追问编排：从 P1-79 长追题组读取长链 `questionRef`、逐轮 oracle 与 `packDigest`，按 `turnIndex` 顺序在同一宿主进程与会话内执行；记录 `chainId／processId／hostSessionId`。链内比例按场景实例数计算 `ceil(0.1×N)`。题组缺失或 digest 不符记 BLOCKED。
4. 判定器：链内任一轮错误即整链 FAIL；进程或会话变化、轮次缺失或重号即该链无效；前 5 轮与后 5 轮中位数差适用 D8 双阈值。
5. 依赖守卫：P1-79 题组缺失或 digest 不符、全局规模基线 MCP-PERF profile 断言未生效、宿主不支持多轮时返回 BLOCKED；不得回退到自制题目、直连脚本或降低比例。
6. 负控：把有效窗口缩短、把到达改为均匀、把长链比例降到 10% 以下、把链拆成独立问题，均必须被判定器拒绝。

**验证：**

```bash
node --test scripts/e2e/__tests__/mcp-inquiry-performance-soak.test.mjs
```

预期：上述四类负控逐项可检出；假时钟下窗口统计、链比例计算与链失效判定全部可复算。真实执行归 Task 7，需要跑次授权。

## 验收

- Task 1–4：所有新增单元／合同测试通过，历史假绿夹具逐项转红为可检出；真实执行不得由 dry-run 冒充。
- Task 5：baseline-seed 与预算冻结证据齐，必填基线值不再是 `null`；SEED_ONLY 未被当成发布 PASS。
- Task 6：PR／每日／出包／升级真实接线，P1-53 功能分母不变，P1-67 无并行 MCP runner，命令与 CI Mapping 已登记。
- Task 7：UAT 全部必做执行（含 `UAT-MIP-14／15`），SC-01–SC-15 和实现 CR 关闭；连续两次调度证据成立；INDEX 与 Spec 按各自 SOT 更新。
- Task 8：`SOAK` 与 `LONG_FOLLOW` 的判定器负控全绿，真实跑次证明 ≥1800 秒有效窗口、50 身份、≥10% 长链与逐轮 oracle 成立。
- 全程没有自制题目、自造造数脚本、Lucy／KTX 产品优化代码、阈值自动抬线、样本缩减或失败样本删除。

## 完成定义

1. 任一候选都能用同一命令产出可复算的完整答复性能报告，明确 P50／P95／P99（样本允许时）、正确性、超时、并发公平和未归因区间。
2. 每次出包／升级必须消费本条的正式 PASS；缺少真实基线或环境不可比会失败关闭。
3. 每日调度已连续两次无人值守运行并形成可比链，后续优化 Spec 能复用同一 A/B 证据格式。
4. 持续压力与长追问已成为正式分母：≥1800 秒有效窗口、50 身份、≥10% 单进程长链的证据可复算，窗口退化与链内退化均会被相对闸拦住。
5. 题目与初始化数据仍由 P1-54 与全局规模基线／P1-34 拥有，本条没有第二套题库、第二套造数脚本或第二套规模数字。
6. P1-53／P1-67／P1-13 不再各自维护冲突的 MCP 性能口径。
7. 本条发布取证收口不表示任何产品性能已经优化，也不表示可上线。

## 风险

| 风险 | 处理 |
|---|---|
| 模型／网络波动造成噪声 | 同指纹、多轮完整样本、原始记录和双阈值；慢样本不得删除，BLOCKED 不得转 PASS |
| 全量真实 Agent 成本高 | PR 小样本只作有限判定，完整矩阵放每日／出包；不得用缩题替代正式分母，记录实际成本与墙钟 |
| 测程自身改变被测性能 | 观测开／关 A/B，越线先修测程；详细 span 不得无界写入或携带敏感数据 |
| 基线被手填或自动抬线 | 原始 NDJSON 复算、具名接受、独立审批、digest 和负控；优化提交同改口径直接无效 |
| 题库缺 ≥20 轮长链 | 长链归 P1-79 独立题组包；题组实现与自检到位前 `UAT-MIP-15` 与 `SOAK` 比例判定记 BLOCKED，禁止本条代写题目或拆链凑数 |
| 初始化数据 profile 断言未生效 | MCP-PERF profile 已登记进全局规模基线；机器断言扩展需独立授权，未生效时相关用例记 BLOCKED，禁止私写规模数字或造数脚本 |
| 持续压力把负载悄悄降下来 | 计划到达与终态一一对应、未派发即失败、到达模型参数与实际分布留痕；缩短窗口、改均匀到达等负控必须被检出 |
| 真实宿主成本与时长 | 持续压力与长追问按窗口与链级分列成本；成本只记录不设缩减必做项的上限，缺宿主即 BLOCKED |
| 50 路并发名实不符 | 入口回执重算不同 Agent 在途峰值，未达峰值即未覆盖压力条件 |
| 首 token 不可观测 | 标 `not_available`，完整答复墙钟仍硬门禁；不得以握手或工具事件冒充 |
| 历史迁移形成双判定 | 先接证据消费和 contract 测试，再删除旧算法；P1-53 功能兼容分母保持不变 |

## 浏览器验证

不适用：当前任务为纯 MCP／真实 Agent／后端测程与发布门禁，不改变 WebUI 用户可见面，不强制浏览器测试。若后续新增 WebUI 性能看板，须另立 Spec、独立确认导航 IA，并以真实前台浏览器记录页面计时，不能用 API 耗时替代。
