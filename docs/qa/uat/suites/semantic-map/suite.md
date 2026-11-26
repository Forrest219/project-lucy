# UAT-SUITE-SEMANTIC-MAP — 语义地图（只读 Canvas）

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-SEMANTIC-MAP` |
| 总账／需求 | **REQ-0121**（P1；不入核心分母） |
| 授权 | Spec 终稿确权 2026-11-27；**开发未授权**——本套件为设计与登记；正式跑次须开发落地后再授权执行；Plan／UAT 经 Kimi Code 对抗定稿见 [评审](../../../../reviews/2026-11-27-semantic-map-plan-uat-adversarial-review.md) |
| 修复合同 | [Spec](../../../../specs/lucy-20261127-semantic-map-canvas-spec.md)／[Plan](../../../../plans/lucy-20261127-semantic-map-canvas-plan.md) SC-01–SC-16 |
| 目标 | 在本机 demo Docker **真实前台浏览器**验证语义地图只读拓扑、并集边、筛选／降级／钻取；禁止以 API／vitest／CR 冒充 WebUI PASS |
| 范围 | WebUI：`/semantic-map`（及深链）；只读投影 API；钻取至既有 `/catalog/:conn/:schema/:table` |
| 档位 | **lean**（默认必做）。规模／节点预算压力项见可选用例，须 **scale** 或 `customer-stability` 前置，不得在 lean 主张规模 PASS |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/)（尚无；INDEX＝**NOT RUN**） |

## 必做

| ID | 对应 Spec | 要点 |
|---|---|---|
| `UAT-SM-R0` | 环境 | demo healthy；管理员登录；视口 1920×1080；记录 WebUI／MCP 端口 |
| `UAT-SM-01` | SC-01／SC-15／E2 | 选 `demo-mysql` 后岛总览可见；加载占位可感知；前台计时与 API 分列 |
| `UAT-SM-02` | SC-02／SC-15 | 进入含表 Schema 岛：见连通团与／或孤立区；非默认全表散点 |
| `UAT-SM-03` | SC-03 | 跑前核对 Manifest 无 joins；`superstore_orders` overlay formal 边在地图可见 |
| `UAT-SM-04` | SC-05／SC-12／E12 | returns／people 不得命中孤立筛；无命中引导；禁「无任何依赖」与禁用混称 |
| `UAT-SM-05` | SC-08／SC-15 | 打开工作台＋合成 YAML joins 旁注 |
| `UAT-SM-06` | SC-09 | 作用域标签；禁止与概览「待补语义」混称 |
| `UAT-SM-07` | SC-10／E8 | 投影失败／单岛失败／陈旧：诚实态；禁止假空 0 边 |
| `UAT-SM-08` | SC-08 | 深链或互链可定位侧栏 |
| `UAT-SM-09` | SC-13 | 默认拒绝非 GET／HEAD 写请求；无写盘控件 |
| `UAT-SM-10` | SC-15／SC-16 | 前台计时纪律；Catalog＋`lucy_catalog`＋**`lucy_query` 问数冒烟** |

## 可选／规模

| ID | 对应 Spec | 要点 |
|---|---|---|
| `UAT-SM-11` | SC-04 | 夹具制造 Manifest／overlay `on` 冲突：并列冲突标注可见 |
| `UAT-SM-12` | SC-06／SC-07 | 跨连接引用角标或未判定字样（需多连接夹具） |
| `UAT-SM-13` | SC-11／SC-14 | scale／customer-stability：筛选不突破 150 表点散点；总览可交互计时 |

**规模证据规则**：SM-13 须 scale 档且 `uat:scale-baseline` 退出 0（或 customer-stability profile）；lean 记 `SKIPPED`／`BLOCKED` 并写明原因，不得记 PASS。

## 边界

- **禁止**用读代码／vitest alone 把 INDEX 写成 PASS。
- **禁止**未开发落地时记 PASS；应记 **BLOCKED（实现未授权／未落地）**。
- 不测画布编辑、访问关系图、主导航挂载（IA 未确认）。
- 降级验证授权规则以 [`CONVENTIONS.md`](../../CONVENTIONS.md) 为准。
