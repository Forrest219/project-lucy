# MCP 问询端到端性能夹具

## 1. 环境与身份

- 使用本机独立 Docker compose 项目、专用网络和卷、真实 KTX 与真实合成数据库。被测入口只能是 Public MCP；Agent 不携带 WebUI 会话。
- **初始化数据来源（本套件不造数）**：人口／角色／凭据／Wiki／Skill／审计行＝[全局规模基线](../../scale-baseline.md)及其 `npm run uat:scale-baseline:seed:access`、`npm run uat:scale-baseline:seed:wiki-skills`、`npm run uat:scale-baseline:seed:audit` 入口；本专项的 50 路压测身份与持续压力下限＝该文件 §1.1 **MCP-PERF profile**；表与宽表夹具＝[P1-34 大 Schema 接入](../../../../specs/lucy-20261115-large-schema-ingestion-spec.md)。正式全局档开跑前执行 `npm run uat:scale-baseline`，任何维度未达标，对应规模用例记 BLOCKED，不缩夹具开跑。
- **开跑实测核验（R0）**：除 COUNT 外，还须真实执行 `wiki_search` 命中合成标记、`lucy_skill_read` 读到指定 Skill；用视图或独立 SQL 核对最热 Agent、窗边界前后、同毫秒不同 id、无历史 Agent、仅 90 天前活跃 Agent；核对 seed 的备份与还原回执，并确认 demo 基座的无关角色／Agent／凭据未被覆盖。上述精确向量的数值下限只以全局规模基线为准，本套件不复制第二套数字；需要高于该 SOT 的下限时先改 SOT。
- 至少准备普通只读身份、预期拒绝身份、同级合法对照身份，以及全局档正式 `lucy_admin` 和两个受限角色。每个身份有独立 Token、Agent ID 和预期 Source／结果集合，不用管理员高权替代普通问数身份。`lucy_admin` 须核对**运行时生效**的角色绑定、全局 Source 集合与至少两个业务连接的正确查询，不能只看名字。
- 真实 Agent 从 `docs/qa/mcp-compat-clients.yaml` 选择。PRE／POST、改前／改后和同一基线族必须保持客户端、模型、适配器和参数指纹一致。
- 凭据从仓库外私密文件注入，目录 0700、文件 0600。不得把 Token、Cookie、Session、客户提示词或原始业务行写入 fixtures、证据或日志。

## 2. 场景定义

自然问题、追问轮次与 oracle 唯一引用 [P1-54 可执行题库](../../../../../scripts/e2e/contracts/mcp-upgrade-journeys.yaml)及其[语义 Spec](../../../../specs/lucy-20261118-mcp-upgrade-question-bank-spec.md)。下表只定义性能编排，不复制题目文本。

| scenarioId | 题目引用 | budgetClass | lane / 特殊条件 |
|---|---|---|---|
| `SIMPLE` | `QB-BIZ-01` | simple | Agent＋MCP；已知单值结果 |
| `FILTER` | `QB-BIZ-02a` | simple | Agent＋MCP；过滤与已知分组结果 |
| `FOLLOW` | `QB-FOLLOW-01` | owner `follow-up`→按 Spec §4.1.1 映射为 simple；表外取值 BLOCKED | 同一 Agent 会话逐轮计时，禁止拆轮 |
| `JOIN` | `QB-JOIN-01` | complex | Agent＋MCP；已声明 join |
| `MULTI_DB` | `QB-DB-01`＋`QB-DB-02` | complex | 分连接执行；禁止跨连接发明 join |
| `DENIAL` | `QB-ACL-01` | denial | MCP 必测；另以 `SIMPLE` 合法对照，Agent 只测合法对照 |
| `WIDE` | `QB-BIZ-01`＋`QB-JOIN-01` | simple／complex 分开 | 全局规模档、正式角色与宽目录 |
| `COLD` | `QB-BIZ-01`＋`QB-JOIN-01` | simple／complex 分开 | Ready 后首轮、真实首次构建或正式代次失效；逐轮证明冷态 |
| `CONCURRENT` | `QB-BIZ-01`＋`QB-JOIN-01`＋`QB-FOLLOW-01` | simple／complex 分开 | 20／50 个独立 Agent；正式 `lucy_admin` 与两个受限角色分组 |
| `SOAK` | 引用题库既有题 ID 循环组合 | 按被测题档 | 50 个独立 Agent 身份与真实宿主会话；有效窗口 ≥1800 秒；截断正态到达 |
| `LONG_FOLLOW` | [P1-79 长追题组](../../../../specs/lucy-20261123-long-followup-question-pack-spec.md)提供的长链（首轮＋≥20 次后续追问）及逐轮 oracle；题组文件 `scripts/e2e/contracts/mcp-inquiry-long-followups.yaml`，`packDigest: sha256:41ce9d18…`，链模板 `QB-LONG-01`–`QB-LONG-05` 各 21 轮（普通只读／`lucy_admin`／受限 A／受限 B 四类角色齐备） | 按被测题档 | 同一宿主进程与会话；链比例 ≥10%（50 身份档至少 5 条） |

如题库 ID 改名或语义变化，先修改 P1-54 并产生新 questionSetDigest；不得在本套件静默换题保持原基线。**长链（≥20 轮）由 [P1-79 长追问题组](../../../../specs/lucy-20261123-long-followup-question-pack-spec.md)版本化提供并带逐轮 oracle（语义继承 P1-54）；题组缺失、digest 不符或模板／角色类不足时，`LONG_FOLLOW` 与 `SOAK` 的比例判定记 BLOCKED，本套件不得自撰题目或用独立问题冒充长链。**

## 3. 触发档与样本

样本下限的唯一合同是 Spec D6；本表把它展开为执行计划。所有计划尝试均保留，不设“跑到成功为止”的删除规则。

| 触发 | 场景 | MCP／场景 | Agent／场景／宿主 | 并发与统计边界 |
|---|---|---:|---:|---|
| PR | SIMPLE／FOLLOW／JOIN／DENIAL＋合法对照，R0 及其他 PR 子例 | ≥20 | ≥3；拒绝档只跑合法对照 | 无强制并发；Agent 只判绝对上限与中位数，不输出正式 P95 |
| 每日 | SIMPLE／FILTER／FOLLOW／JOIN／MULTI_DB／DENIAL／WIDE／COLD／CONCURRENT＋`SOAK`＋`LONG_FOLLOW` | ≥100 | ≥20 | 20 路独立档；冷／热分开；`SOAK` ≥1800 秒／50 身份；`LONG_FOLLOW` 链比例 ≥10%；允许同候选同指纹累计至 P99 样本 |
| 出包 | 每日全量＋50 路＋全部负控 | ≥100 | ≥20 | 20／50 路分别判定；`SOAK` 与 `LONG_FOLLOW` 必做；消费已接受基线 |
| 升级 PRE／POST | 与出包相同 | ≥100 | ≥20 | 同实例、身份、快照、配置、客户端与模型；含 `SOAK` 与 `LONG_FOLLOW`；必要时回滚恢复另跑 |
| 优化 A/B | 优化影响的全部场景＋未受影响对照 | ≥100 | ≥20 | 单变量、同测程；预算或样本变化使证据无效 |

20／50 路每个并发档至少执行 3 个独立波次，每个 Agent 每波一条真实问题。每波重新核对不同 Agent 的实际在途峰值；快速完成导致未达到目标并发时，该波只能作诊断，不能冒充并发验收。

## 4. 冷态与缓存控制

- **暖态**：同一代次、同配置和权限下已有明确缓存命中证据；记录命中类型，不把“第二轮”笼统称为暖态。
- **进程冷态**：新启动隔离候选且 Ready 后尚未发生目标目录／权限构建；Ready 探针不得替被测旅程预热目标槽。
- **代次失效**：通过正式配置发布触发目标代次变化，保存变更前后代次与提交回执。
- **OS 页缓存**：只记录观测状态；没有可靠证据时标 unknown，不声称冷盘。
- 每个冷样本必须独立证明起始条件。可以用新的隔离环境或正式失效构造冷态，但不能以重启后“看似恢复”代替功能修复，也不能混用不同冷态类型。

## 5. 并发与角色分组

- 20／50 个不同合成 Agent 各自持有独立 Token 和 MCP 会话；至少两个身份绑定正式 `lucy_admin`，其余均分两个受限角色。
- 受限角色的查询范围部分重叠且各有独占对象；同名业务表在不同连接返回不同已知值，用于发现路由串线和跨角色泄露。
- 同步发压跨度目标≤50ms，但同步点不是实际在途证明。反代入口从收到请求到响应结束／断开计算在途，Lucy 排队、KTX 执行和数据库执行另列。
- 保存各角色计划、发出、到达、完成、超时和重试；最慢／最快角色组 P95 及公平性按 Spec §5.3 判定。

## 6. 延迟与故障负控

- 只在隔离环境使用受控网络延迟代理或测程自身的延迟开关，分别作用于响应头、响应体和指定工具；不得修改 Lucy／KTX 产品代码制造“优化”或“退化”。
- 2× 延迟以同请求对照测程的实际基线计算，记录注入点、倍数、开始／结束和恢复回执。
- 快速错误、丢样本、伪基线、错误预算档、伪造 summary 等属于判定器负控，与真实产品样本分文件保存，不能冒充真实用户跑次。
- 负控结束后关闭代理和开关，核对在途任务终结、容量归还、无残留文件和合法查询恢复。

## 7. 基线与证据

- 正式基线放 `baselines/`，公开原始证据放 `evidence/<runId>/`，叙事跑次放 `runs/`。目录结构由实施 Plan Task 2 建立，当前没有正式基线或跑次。
- 基线键至少包括 `scenarioId／cacheState／concurrencyGroup／questionSetDigest／configDigest／fixtureDigest／environmentFingerprint／clientFingerprint／modelFingerprint`。
- 基线必填真实 `sampleCount／p50Ms／p95Ms／medianMs` 和原始证据 digest；`null`、缺字段、手工补值或无证据值一律 BLOCKED。
- `LATEST.json` 只在具名接受后变更。每次普通跑次生成候选基线，不自动成为接受基线。
- 公开文件仅含合成题 ID、脱敏关联键和数值；客户材料只存在获授权的仓外私有环境，不复制进本套件。

## 8. 观测与计时开销

- 使用单调时钟计算时延，UTC 仅用于跨进程关联；记录宿主机时区和时钟来源。
- 详细观测关／开／开／关交替，各小组使用相同暖态业务样本。相对开销 >20% 且绝对增加 >50ms 时先修测程，不能把该轮作为产品性能结论。
- 阶段缺失写 `not_available`，未覆盖写 `unknown`，父子或重叠 span 不重复累计。模型、目录、Skill、权限、KTX、数据库和最终生成能区分则分列，不能区分则保留未归因。

## 9. 持续压力与长追问规则

### 9.1 身份与会话

- `SOAK` 使用 50 个独立 Lucy Agent 身份与**真实宿主会话**；不得只在 `access.yaml` 造 50 条记录后由同一个直连脚本轮换 Token 冒充。身份、凭据与角色绑定来自[全局规模基线 §1.1 MCP-PERF profile](../../scale-baseline.md)；该 profile 的机器断言未生效时本档 BLOCKED。
- 每个身份在有效窗口内至少完成 1 轮并留有可核对轨迹；身份掉线、中断或长时间无动作单独记账，不静默替换。
- `LONG_FOLLOW` 的长链由 [P1-79 长追题组](../../../../specs/lucy-20261123-long-followup-question-pack-spec.md)提供（独立题组包与独立 `packDigest`）；链在**同一宿主进程与同一宿主会话**内连续执行，`processId／hostSessionId` 全程不变。进程重启、换会话、拆成独立问题或链内轮次缺失／重号，该链无效并单独记账。
- **链实例＝模板×身份×`runId`，每个实例只跑一次**：不同身份各执行一次同一模板合法（50 身份档至少 5 个实例，覆盖 `lucy_admin`、受限角色 A、受限角色 B）；同一实例不得二次执行。`SOAK` 窗口内已执行的长链不再发起第二轮 ≥20 轮追问；`LONG_FOLLOW` 复用同一 `runId` 的链证据（`chainId／packDigest／processId／hostSessionId／turnIndex` 一一对应）。专项或升级 POST 需要独立考察时另起 `runId`，其链不与 `SOAK` 样本混算，链比例按各自场景实例数分别计算。复用仅在同一候选、同一题组 digest、同一客户端／模型／环境指纹下成立。

### 9.2 到达模型

- 使用固定 seed 的**截断正态**思考时间生成计划到达；μ、σ、截断上下界、种子与题档占比**只取自**[规模基线 §1.1](../../scale-baseline.md)（设计值，待委托人具名冻结），本套件不复制数值；证据记录这些参数与实际分布摘要（均值、标准差、分位）。开跑前按这些参数计算每窗口每档与长链身份的期望到达量，不足则 `sample_unreachable`＝BLOCKED。
- 均匀同发、固定 1Hz 或“按上一轮完成后再等固定时长”都**不算**正态到达行为；若前一轮未完成，下一次计划到达仍按分布排入并记录积压与派发延迟，系统变慢不得静默降载。
- 计划到达与终态必须一一对应：未派发、在途未终结、超时与失败各自计数并判失败，不得只报成功样本。

### 9.3 窗口与链级判定

- 有效窗口 ≥1800 秒，建议 12 个 150 秒窗口；准备、预热、恢复与清理时间另列，不计入有效窗口。
- 按 Spec D23 逐窗口×题档（simple／complex）输出分位、正确率与超时率：N≥20 出 P95；N<20 记 `not_estimable` 并改判中位数、无超时、无错误。角色分组与公平性在全有效窗口层面判，不按窗口再切分。相邻窗口比较中位数；首尾段取连续 ⌈窗口数/3⌉ 个窗口合并（12 窗口＝首 4／尾 4）比较 P95；均适用 Spec D8 双阈值。窗末在途轮次至多 120 秒排空，归入发出时所在窗口。
- 长链比例按链实例数计算 `ceil(0.1×N)`，不按轮次计算；50 身份档即至少 5 个链实例。链内任一轮正确性失败即整链 FAIL，链级与逐轮结果分列保存。
- 负控：缩短有效窗口、把到达改为均匀、把链比例降到 10% 以下、把长链拆成独立问题、把同一链实例二次执行，均必须被判定器拒绝；不同身份执行同一模板不得被误拒。

### 9.4 宿主额度、成本与豁免

- **宿主额度**：开跑前登记所选宿主的并发上限与限流额度及其来源（账号文档或实测）；额度不足 50 路时 `SOAK` BLOCKED，不得降身份数（Spec D21⑦）。
- **成本与墙钟估算**：按 Spec D6 样本下限展开的真实模型调用数与总墙钟，登记于此；接每日调度前必须有值（Plan 开工前置 10）。当前**未估算**。
- **豁免记录**：事故修复放行文件放 `waivers/`，格式与有效期见 Spec D22；`waived` 不进入 `baselines/` 与 `evidence/` 的 PASS 统计。当前无豁免记录。

## 10. 执行顺序与长链证据复用

用例级顺序见 [cases.md「执行顺序与触发档映射」](cases.md#执行顺序与触发档映射)。本节固定执行侧的约束：

| 顺序位 | 内容 | 约束 |
|---|---|---|
| 1 | `R0` 环境与数据前置 | seed 三件套 → `npm run uat:scale-baseline` → MCP-PERF profile 断言 → 视图／运行时核验 → 测程自检；任一不过记 BLOCKED |
| 2 | `01`–`06` 主路径、计时、样本、正确性、绝对预算、基线与相对判定 | 相对判定需已接受基线，否则本轮为 `SEED_ONLY` |
| 3 | `07` 冷／热与 20／50 路并发 | 突发档独立成键，不与持续档合并分位 |
| 4 | `08`／`09` 证据复算与负控 | 负控在隔离环境执行，结束后恢复并核验 |
| 5 | `14` `SOAK` 持续压力 | ≥1800 秒有效窗口、12 个 150 秒窗口、50 身份；长链在本窗口内按 ≥10% 比例执行 |
| 6 | `15` `LONG_FOLLOW` 长链核验 | **复用第 5 步同一 `runId` 的链证据**，不重复发起第二轮 ≥20 轮追问；跨 `runId` 不混算 |

- 每次跑次都从 `R0` 开始；不得为了省时跳过 R0 或用上一轮的环境状态开跑。
- `pr` 档不执行第 5／6 步，但也不得据此声称正式 P95 或放行出包。
- `release`／`upgrade` 档必须执行第 5／6 步；`optimization-ab` 档按改动范围选择，是否执行第 5 步由优化 Spec 指明，未指明时按 `nightly` 全量执行。

## 11. 预算真源

所有绝对预算只读 [Spec §5](../../../../specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md#5-首版绝对预算设计值待实测冻结)，本文件不复制第二份数值。首版数值为设计值，baseline-seed 后的冻结必须独立具名审批；禁止 runner 根据本轮失败自动提高预算。

## 12. 隔离栈实测登记（2026-11-26，Task 5 baseline-seed）

| 项 | 实测值 |
|---|---|
| compose 项目 | `lucy-mip-uat`（复用 `deploy/compose/docker-compose.demo.yml`，专用网络／卷 `lucy-mip-uat_lucy-demo-data`；端口 webui 55276／proxy 57981／mysql 54306） |
| 候选镜像 | `project-lucy:demo`（imageID `2c6cc629496a`，构建 2026-11-26 00:25；候选指纹 `git:b4bc7c6ef1c17c3b310a68da0fb89fcfef521e78+dirty`） |
| 存储 | MySQL 8.4 容器卷＋Lucy 数据卷 `lucy-mip-uat_lucy-demo-data`；夹具随卷可重建（seed 幂等） |
| 反代 | 无独立反代；Public MCP 直接暴露 `:57981`（`LUCY_PUBLIC_MCP_URL` 同值） |
| 缓存状态 | 进程暖态（seed 后重启完成、健康通过后再开跑）；冷态样本归 `COLD` 场景另行构造 |
| 身份夹具 | MCP-PERF 50 压测身份（`uat_perf_001..050`：2×`lucy_admin`、24×`uat_perf_role_a`（双连接含 `lucy-ops.ops_calls`）、23×`uat_perf_role_b`、1×`lucy_ops_reader`）；P1-54 题库 compat 专用身份 11 个（`uat_compat_*`，角色合同＝`mcp-compat-config-profile.yaml` fixtureRoles＋辅助角色 `uat_compat_readonly_mysql`） |
| Token 文件 | 仓外 `/Users/zhangxingchen/Projects/.lucy-secrets/mcp-perf-tokens-uat.json` 与 `mcp-compat-tokens-uat.json`（0600；`UAT_MCP_PERF_TOKEN_FILE`／`UAT_COMPAT_TOKEN_FILE`） |
| 规模断言 | 默认档＋`--profile mcp-perf` 全 PASS（2 项 SKIPPED：Hive 未灌，WARN 归 P1-34 口径）；MySQL 夹具 1201 表（非 XL 档） |
| 编排入口 | `scripts/uat/mcp-inquiry-performance-uat.mjs seed --trigger <t>`（lib：`scripts/uat/lib/mcp-inquiry-performance-docker.mjs`）；seed 顺序＝大 Schema→access→MCP-PERF 身份→compat 身份→Wiki／Skill→审计行→WAL checkpoint→两档断言→R0 自检 |
