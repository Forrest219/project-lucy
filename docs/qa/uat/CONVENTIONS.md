# UAT 约定

> **唯一测试台 SOT**＝本目录 [`docs/qa/uat/`](README.md)；判定真源 [`INDEX.md`](INDEX.md)。旧 [`docs/uat/`](../../uat/README.md) 仅为历史归档，不是现行 SOT。

日常修复的验收、收口汇报及客户侧证据的适用范围，见 [DEVELOPMENT.md「产品侧修复收口」](../../governance/DEVELOPMENT.md#产品侧修复收口)。

## 第一性原则（强制）

1. **全真模拟构建／执行测试用例。** 交叉验证与对抗性测试默认在本机 Docker demo／compose 中，通过实际运行的产品入口和组件构造并跑通用例，产出可复查的 `runs/` 证据。
2. **禁止用 Code Review／读代码评论冒充 UAT。** 审阅源码、指出「看起来正确」、CR 意见**一律不算**测试台结果，不得写入 INDEX 为 PASS。  
3. **必做用例无法全真执行时记 `BLOCKED`。** 在跑次写明具体阻塞原因。需要改用降级验证时，须向委托人单独申请授权。可选用例前置不满足时，在跑次记 `SKIPPED` 及原因。
4. **对抗性 ≠ 找茬文案。** 对抗指：另造连接 id／宽表／重载时序／端点闸路径，尝试证伪既有 PASS；仍须全真执行。  
5. **WebUI：浏览器＋计时强制（严重）。** 套件／选择器若覆盖 WebUI 用户可见面（页面加载、列表／表单、名册、统计展示、按钮反馈等），除后端／API 断言外，**必须**在真实**前台**浏览器执行并记录即时计时（导航→关键内容可见，或合同 `primaryReady`／等价里程碑），与 API 耗时**分列**。仅 HTTP smoke、脚本压测、vitest 或 CR **不得**主张该 WebUI 面已通过。必做用例缺前台浏览器验证或有效计时时，记 `BLOCKED` 并写明缺口。开发规范同位见 [`docs/governance/DEVELOPMENT.md`](../../governance/DEVELOPMENT.md)「验证策略：浏览器测试约束」。

## 升级验收底线（强制）

> 2026-11-27 委托人明示。适用于一切升级／新功能合入的验收主张；与「第一性原则」「WebUI：浏览器＋计时强制」叠加生效，不替代、不降级。

1. **总底线：任何升级不得造成用户体验降级。** 新版本相对既有基线在用户可感知面（页面可用性、时延、错误率、功能可用性）只升不降；主张收口前须有对照证据，无对照即视为未验证，不得默认「无降级」。
2. **所有新发功能必须通过 UI 验证。** 仅 API、单测或 Code Review 通过**不构成**功能验收；凡有用户可见面（WebUI 页面或 MCP 工具行为）的功能，须有对应真实入口的跑次证据。
3. **WebUI 升级必须经浏览器验证。** 按下节「WebUI：浏览器＋计时强制」执行；纯 API／HTTP smoke 佐证不得替代浏览器跑次。
4. **MCP 升级必须做性能测试。** 凡改动 MCP 面（工具列表、工具行为、代理路径、语义层读路径等）的合入，须挂 `UAT-MIP-*`（P1-78）相应档跑次并对照既有基线；性能档 `NOT RUN` 或暂缓执行期间，相关 MCP 改动不得主张收口。

违反上述任一条时，INDEX 判定不得以 `PASS`／`PASS WITH GAP` 表达「接近收口」；只能按 `FAIL`／`NOT RUN`／`BLOCKED` 如实登记并写明缺口。

**机检（强制）**：`npm run lint:uat-verdict`（脚本 `scripts/lint/uat-verdict-gate.mjs`，CI `spec-and-webui` job 与 pre-push hook 挂载）。规则与 SOT：

- 每个套件的**验收面**（`webui`／`mcp`／`api`）登记在 [`suite-faces.json`](suite-faces.json)；INDEX 新增套件行必须同步登记，registry 孤儿条目同样报错。
- `tier: strict`（0.35 起新套件默认）：上述 R4–R6 违规即门禁 FAIL——PASS 须有真实存在的跑次链接；webui 面 PASS 的跑次须含浏览器证据标记；mcp 面 PASS 须登记 `mip linked`（suite.md 或 INDEX 引用 `UAT-MIP`）或带原因的 `mip exempt`。
- `tier: legacy`（0.30 及以前存量套件）：同规则只告警不拦 CI（grandfather 惯例），但每次运行都打印待整改项；整改补证后翻 `strict`。
- 本机检只验证**证据形态**（链接存在、浏览器标记、MIP 关联），不重算判定结论；「无 UX 降级」的实质对照仍归 `UAT-MIP`（P1-78）等对应套件的跑次。

## 环境档位选型（lean／scale）

本机 demo compose **一栈两档**。选型表与命令以 [`scale-baseline.md` §0](scale-baseline.md#0-环境档位选型leanscale) 为唯一展开；此处只定强制规则：

| 档位 | 入口 | 何时选 |
|---|---|---|
| **lean**（默认） | `npm run demo:upgrade` | 套件未要求全局规模前置：功能烟测、多数 P0 问数、热重载、按钮／复制等 |
| **scale**（全局 UAT 水位） | `npm run demo:upgrade:scale` 或 `uat:scale-baseline:ensure` | 套件／fixtures 写明须过全局规模基线；开跑前 `uat:scale-baseline` 须退出 0 |

- 跑次须写明当次档位（`lean`／`scale`）；主张规模已过却跑在 lean 上 → 该规模用例 `BLOCKED` 或作废。
- lean → scale 可共卷一次 ensure；`--fresh` 回到 lean。不得把 lean 结果回填为「全局规模 PASS」。

## 全局规模基线（强制；scale 档）

1. 全局 UAT 模拟数据规模下限以 [`scale-baseline.md`](scale-baseline.md) 为**唯一 SOT**：500 配置 Agent（每 Agent ≥3 凭据，30 天活跃 ≥100）／**200 正式角色**／2000 表（含 1000 列级宽表）／300 Wiki／100 Skill／审计调用行 30 天 ≥20 万·全历史 ≥100 万／superstore 种子 1000·60·4。**任何维度不得降低**。
2. **开跑前置**：套件跑次涉及上述维度夹具时，先确保处于 **scale** 档，再执行 `npm run uat:scale-baseline`（只读断言，退出码 0＝达标）；未达标维度对应的规模用例记 `BLOCKED`（环境前置不满足），不得降夹具规模开跑，不得用空库／缩量夹具冒充通过。审计行量两项为 WARN 例外（权威判定归 `UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE`）。
3. **计数口径**以 `scale-baseline.md` §1 为准（如 Skill 按 loader 同口径递归 frontmatter 计数，正式角色模板另算）；套件 `fixtures.md` 只引用、不复制数字，防止第二套口径。
4. **提高或新增维度**：先改 `scale-baseline.md` 并在当次跑次注明，保持单一出处。

## WebUI：浏览器＋计时强制

| 要求 | 说明 |
|---|---|
| 何时适用 | cases／suite 选择器、Spec SC 或跑次主张涉及 WebUI 可见行为时（含「页面卡顿／名册就绪／按钮已复制」类） |
| 浏览器 | 真实桌面视口、前台会话；1920×1080 除非套件另定 |
| 计时 | 至少一条用户可感知里程碑时延；与同窗口 API 耗时对照；合同有预算则对预算判定 |
| 不可替代 | API p95、server-timing、CR「无虚拟滚动」读代码、后台标签测量 |
| 与分层选择器 | `*-smoke` 若宣称覆盖 WebUI 面，同样适用；只想验 API 须在选择器名与判定句显式写「API-only」，且**不得**回写「页面／WebUI PASS」 |

纯 MCP／纯 API／无页面选择器不适用本节；仍遵守全真与禁止 CR 冒充。

页面卡顿、首屏或列表性能的跨人复测，使用 [WebUI 性能复测指南](webui-performance-retest.md) 交接场景、计时和证据。各套件的 `cases.md`／`fixtures.md` 继续提供具体步骤和预算。

## 编号

| 前缀 | 含义 |
|---|---|
| `UAT-SUITE-*` | 套件 |
| `UAT-CAV-*` | 轻探针、重任务容量和进程排空；F61／F62／F63分开判定，R-CAV归组合发布取证 |
| `UAT-CONN-RELOAD-*` | 连接热重载用例 |
| `UAT-SCAN-*` | 库内扫表用例 |
| `UAT-ACCESS-MAP-*` | 访问关系图／空桑基用例 |
| `UAT-SANKEY-*` | 访问关系图桑基还原（P1-41；零访问／宽授权／未确认关联／多 Agent 的可控种子数据；含 `UAT-SANKEY-R0`） |
| `UAT-PERF-*` | Roles／Agent 页性能体感用例 |
| `UAT-RACS-*` | 角色权限与 Agent 并发及规模（P1-58／59；设计下限或经校准基线的单维与组合 2×／5×，含冲突、恢复与合法成交） |
| `UAT-PDS-*` | WebUI 页面 DOM/渲染规模横向评估（跨页面；方法学回链 P1-58/59；各页结果回链对应功能套件；含 `UAT-PDS-R0`） |
| `UAT-SNC-*` | 同 Connection 跨 Schema 短名冲突与保存 ack（P1-64；生成避名、最终集合校验、锁内竞态、旧冲突增量修复与纯 MCP 合法成交） |
| `UAT-WUA-*` | Wiki 覆盖上传 YAML 授权采用（P1-65；差异强制显式选择、digest、管理访问逃生、MCP 可读） |
| `UAT-LOOP-*` | 重读路径与存活探针（P1-21 事故看守） |
| `UAT-COPY-*` | 复制按钮假成功看守（P1-40 错题看守：明文 HTTP 下「已复制」但剪贴板未写入） |
| `UAT-SAG-*` | 表级歧义门闩（P0-3；「拦得住」） |
| `UAT-SAG-ESC-*` | 表级歧义纯 MCP 逃生（P0-3；宿主缺席死路／翻绿基线） |
| `UAT-CALIBER-*` | 口径绑定（P0-1） |
| `UAT-ZB-*` | 零绑定 begin 不影响正常问数（P1-60；R0／01–12 全部必做，关键 begin 与 query 分别断言） |
| `UAT-EXPOSURE-*` | 字段暴露（P0-A） |
| `UAT-AV-*` | 答复可核对块（P0-4） |
| `UAT-EMPTY-*` | 空结果下一步（P0-5） |
| `UAT-CATSEM-*` | Catalog 业务语义（P0-2） |
| `UAT-CTX-*` | MCP Wiki／Skill 真读真用＋ACL（P1-30；含 `UAT-CTX-R0-SEED`） |
| `UAT-OPS-CONCEPT-*` | 概念运维 Ops MCP（P1-11／P1-27；含 `UAT-R0-FIX`） |
| `UAT-ROW-*` | 行级隔离场景（P1-28／P1-29） |
| `UAT-SCALE-*` | 大 Schema 接入规模（P1-34；规模下限不得降低） |
| `UAT-SWEEP-*` | 全页面／全 GET 路由事件循环看守（P1-31） |
| `UAT-EQ-*` | 审计与概览读路径等价守卫（P1-32／P1-33；冻结旧实现＋改前金样本） |
| `UAT-TRC-*` | 调用流水 trace 级可追溯与存档（P1-36；span 完整性、同事务、封存导出） |
| `UAT-MCPX-*` | MCP 握手、失败信息、会话恢复与快速失败（P1-37；含主路径回归对照） |
| `UAT-COLD-*` | 慢盘冷页缓存冷启动（P1-39；旧 schema 客户规模审计库；含 `UAT-COLD-R0` 与 0.25.0 对照 `UAT-COLD-01`） |
| `UAT-IRR-*` | 推断问询重建中断后自动恢复（P1-45；前方报告 P0-02） |
| `UAT-RML-*` | readyz 与 MCP 监听就绪一致性（P1-46；前方报告 P0-03） |
| `UAT-OPS-STEP-*` | 运维步骤账（P1-68；Lucy 运维与 IT 运维；进入步骤即落行） |
| `UAT-BESC-*` | 问询预算耗尽与主路径逃生（P1-74；触顶拦得住＋逃得生；第一性原理看守） |
| `UAT-RPB-*` | 满量重建负载下探针预算（P1-47；前方报告 P0-01） |
| `UAT-COMPAT-*` | MCP 升级兼容底线与全真用户旅程（P1-53；含真实 Agent、实例基线与耗时双门禁） |
| `UAT-MIP-*` | MCP 问询端到端性能基准与持续门禁（P1-78；真实 Agent＋MCP 双测程、按场景基线、全分母、持续压力 `SOAK` 与长追问 `LONG_FOLLOW`） |
| `UAT-MCPHA-*` | MCP 数据面执行舱壁与跨 Agent 故障隔离（P1-82；跨 Token／Session、同连接与全局容量、真实释放、内存背压、WebUI 局部 503 与混压恢复） |
| `UAT-PES-*` | 公共首页与静态公开接口隔离（P1-84；混压下 `GET /`／branding／auth 公开入口预算与主路径逃生） |
| `UAT-KSG-*` | Chart 停止宽限与 P1-63 预算对齐（P1-85；渲染负控、`Recreate`、真实 SIGTERM、审计守恒与纯 MCP 恢复） |
| `UAT-MCCC-*` | 敏感元数据工具可见性对齐与拒绝修复引导（P1-88；`tools/list` 隐藏、`sensitive_metadata_forbidden` 修复提示与 `nextTools` 身份过滤、逃生链成交、安全回归） |
| `UAT-ALZ-*` | 资产列表 Zoom（REQ-0120；有界曝光／单 Schema 组／搜索优先／挂载合同；含 `UAT-ALZ-R0`） |
| `UAT-SM-*` | 语义地图只读 Canvas（REQ-0121；岛／连通团／并集边／筛选钻取；含 `UAT-SM-R0`） |
| `UAT-R0` | 环境门禁（各套件共用可引用） |

自动化脚本 ID（`E2E-*`／`VERIFY-*`／`UT-*`）可写在用例「自动化指针」栏，但 UAT 编号保持稳定，便于跨 Agent 引用。

## 判定

| 结果 | 含义 |
|---|---|
| `PASS` | 步骤与期望全部满足；未依赖 `docker restart` 伪装修复 |
| `PASS WITH GAP` | 必做项全部通过；可选项未覆盖，按 [DEVELOPMENT.md「产品侧修复收口」](../../governance/DEVELOPMENT.md#产品侧修复收口) 登记具体缺口 |
| `FAIL` | 任一步期望失败，或靠整容器重启才「生效」 |
| `SKIPPED` | 前置不满足（无凭据／无外部目录）且用例标为可选 |
| `BLOCKED` | 必做用例当前无法全真执行；记录具体原因，待补齐前置条件或取得降级验证授权 |
| `NOT RUN` | 套件／用例已挂测试台，尚未执行跑次；INDEX 可写此态，**不算**通过 |

## fixtures 可写／禁写

**可写：** WebUI URL、容器名、compose 文件、连接 id、库名、表数量、命令、凭据**文件路径**、自动化 npm／bash 入口。  

**禁写：** 密码、token、secret 文件内容、客户生产主机口令。

## 跑次文件名

`runs/YYYY-MM-DD-<agent>-<short>.md`  
例：`runs/2026-11-13-cursor-docker-midstate.md`

## 与 Plan／Spec 关系

- Spec／Plan 定义合同与实现任务。  
- 本 UAT 树定义**反复复现剧本与证据槽**。  
- 功能合同状态以 Spec 头部为准，跑次按 Spec 的验收 ID 记录覆盖情况。产品侧收口与客户侧证据的适用范围以 [DEVELOPMENT.md「产品侧修复收口」](../../governance/DEVELOPMENT.md#产品侧修复收口) 为准。
