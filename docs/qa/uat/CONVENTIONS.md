# UAT 约定

> **唯一测试台 SOT**＝本目录 [`docs/qa/uat/`](README.md)；判定真源 [`INDEX.md`](INDEX.md)。旧 [`docs/uat/`](../../uat/README.md) 仅为历史归档，不是现行 SOT。

## 第一性原则（强制）

1. **全真模拟构建／执行测试用例。** 交叉验证与对抗性测试必须以**真实环境**（现行默认：本机 demo Docker／真实 WebUI／真实 API／真实 supervisor）构造并跑通用例，产出可复查的 `runs/` 证据。  
2. **禁止用 Code Review／读代码评论冒充 UAT。** 审阅源码、指出「看起来正确」、CR 意见**一律不算**测试台结果，不得写入 INDEX 为 PASS。  
3. **做不到全真时必须停表上报。** 若缺凭据、缺外部目录、环境不可达、或无法构造真实步骤——**不得**用 mock／替身／CR 凑绿。须在跑次写 `BLOCKED`／`SKIPPED` 原因，并**向委托人单独申请授权**后，方可改用降级手段（替身单测、书面 GAP 等）。未获独立授权，测试台不得主张该降级路径「已验证」。  
4. **对抗性 ≠ 找茬文案。** 对抗指：另造连接 id／宽表／重载时序／端点闸路径，尝试证伪既有 PASS；仍须全真执行。  
5. **WebUI：浏览器＋计时强制（严重）。** 套件／选择器若覆盖 WebUI 用户可见面（页面加载、列表／表单、名册、统计展示、按钮反馈等），除后端／API 断言外，**必须**在真实**前台**浏览器执行并记录即时计时（导航→关键内容可见，或合同 `primaryReady`／等价里程碑），与 API 耗时**分列**。仅 HTTP smoke、脚本压测、vitest 或 CR **不得**主张该 WebUI 面已通过；缺浏览器或仅后台标签计时 → 跑次最多 `PASS WITH GAP`／`BLOCKED`（写明缺口），INDEX 不得记整套 WebUI PASS。开发规范同位见 [`docs/governance/DEVELOPMENT.md`](../../governance/DEVELOPMENT.md)「验证策略：浏览器测试约束」。

## WebUI：浏览器＋计时强制

| 要求 | 说明 |
|---|---|
| 何时适用 | cases／suite 选择器、Spec SC 或跑次主张涉及 WebUI 可见行为时（含「页面卡顿／名册就绪／按钮已复制」类） |
| 浏览器 | 真实桌面视口、前台会话；1920×1080 除非套件另定 |
| 计时 | 至少一条用户可感知里程碑时延；与同窗口 API 耗时对照；合同有预算则对预算判定 |
| 不可替代 | API p95、server-timing、CR「无虚拟滚动」读代码、后台标签测量 |
| 与分层选择器 | `*-smoke` 若宣称覆盖 WebUI 面，同样适用；只想验 API 须在选择器名与判定句显式写「API-only」，且**不得**回写「页面／WebUI PASS」 |

纯 MCP／纯 API／无页面选择器不适用本节；仍遵守全真与禁止 CR 冒充。

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
| `UAT-R0` | 环境门禁（各套件共用可引用） |

自动化脚本 ID（`E2E-*`／`VERIFY-*`／`UT-*`）可写在用例「自动化指针」栏，但 UAT 编号保持稳定，便于跨 Agent 引用。

## 判定

| 结果 | 含义 |
|---|---|
| `PASS` | 步骤与期望全部满足；未依赖 `docker restart` 伪装修复 |
| `PASS WITH GAP` | 必做项通过；可选 live（如外部目录现场）未跑且已写明 |
| `FAIL` | 任一步期望失败，或靠整容器重启才「生效」 |
| `SKIPPED` | 前置不满足（无凭据／无外部目录）且用例标为可选 |
| `BLOCKED` | 本应全真但当前做不到；已停表，待委托人独立授权降级或补环境 |
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
- 冲突时以 Spec 头部状态与验收 ID 为准，并在跑次里记分叉。
