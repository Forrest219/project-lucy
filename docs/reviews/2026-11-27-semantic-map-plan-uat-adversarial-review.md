# REQ-0121 Plan／UAT 对抗评审记录

| 元数据 | 内容 |
|---|---|
| 评审对象 | [Plan](../plans/lucy-20261127-semantic-map-canvas-plan.md) v1.0／[`UAT-SUITE-SEMANTIC-MAP`](../qa/uat/suites/semantic-map/suite.md)（cases／fixtures）／[INDEX](../qa/uat/INDEX.md) `UAT-SUITE-SEMANTIC-MAP` 行 |
| 对照基准 | [Spec v1.0 终稿](../specs/lucy-20261127-semantic-map-canvas-spec.md)（SC-01–SC-16、E1–E12）；[`CONVENTIONS.md`](../qa/uat/CONVENTIONS.md)；[`scale-baseline.md`](../qa/uat/scale-baseline.md) §1.2；[设计 v1.2](../design/design-2026-11-27-semantic-map-canvas.md) 与[设计对抗三轮](2026-11-27-semantic-map-canvas-adversarial-review.md)（G1–G8） |
| 评审人 | Kimi Code（只读对抗评审员；主会话落盘并应用补丁） |
| 日期 | 2026-11-27 |
| 角色对齐 | [`2026-11-27-asset-list-zoom-plan-uat-adversarial-review.md`](2026-11-27-asset-list-zoom-plan-uat-adversarial-review.md) |
| 效力 | ≠ 终稿确权翻案；≠ 开发授权；≠ UAT PASS；≠ 可上线。本轮未改任何运行代码、导航或配置；只读核查仓库内文件并产出本记录 |
| 最终结论 | **Approve with nits**（轮次 3 终轮：B1–B7 全 CLOSED、N1–N6 闭合，无新阻断；余 1 项 nit N7＝INDEX 行回填终轮结论一句。轮次 2：Request changes，新阻断 B7＝INDEX 登记缺失。轮次 1：Request changes，6 项阻断。详见下文各轮次） |

## 轮次 1

**结论：Request changes（6 项阻断）。** Plan↔SC↔UAT 主链无孤儿 SC／孤儿用例；套件边界的假绿防线（禁止 CR／vitest 冒充、lean 不得主张规模 PASS、未落地记 BLOCKED）已就位。但 fixtures／cases 存在六处可绕过或不可执行的洞：SC-03 的 overlay-only 前提无跑次前核对、SC-05 缺确定性负对照、SC-13 断言依赖可陈旧的写路径黑名单、Plan 声称的 E1–E12 浏览器覆盖有三项无任何用例步骤、SC-16 用发现接口冒充问数冒烟、SC-09 只测一半。

### 阻断表

| # | 级别 | 位置 | 问题 | 最小补丁意图 |
|---|---|---|---|---|
| B1 | 阻断 | fixtures「必做夹具」overlay 行；cases `UAT-SM-03` | SC-03 的全部判别力来自「Manifest 中 `superstore_orders` 无 joins」这一前提。今日前提为真（已核实 `semantic-layer/demo-mysql/_schema/dataforai.yaml` 该表节点无 joins 段，overlay `superstore_orders.yaml:45-53` 有 2 条 formal），但 fixtures 只写「Manifest 同表节点**可**无 joins」的弱措辞，未要求跑次前对**运行实例**核对前提。未来重扫／换夹具使 Manifest 带上 joins 后，只读 Manifest 的缺陷实现照样出边，`UAT-SM-03` 空转假绿 | fixtures 加核对行：跑次前经运行实例（API 或容器内文件）确认 `superstore_orders` Manifest 节点无 joins；前提不成立则 SM-03 记 BLOCKED 并换表／重建夹具，不得照跑 |
| B2 | 阻断 | cases `UAT-SM-04` | SC-05 的合同是「仅被引用、自身未声明 join 的表**不算**孤立」，但用例只「抽查一条命中表」——命中表入出度皆 0 只能证明真孤立被捞对，不能证明被引用表没被误捞。若实现按出度-only 误判，抽查未必抽中反例，靠抽样运气放行 | SM-04 增加确定性负对照断言：demo 中 `superstore_returns`／`superstore_people`（无 overlay、Manifest 无 joins、仅被 orders 的 overlay join 指向，已核实）**不得**出现在孤立筛选命中中 |
| B3 | 阻断 | fixtures「写 API 监听清单」；cases `UAT-SM-09` | SC-13 必做用例的断言机制是一份「**示例，实现后按实际路径更新**」的黑名单。清单陈旧即漏判——实现期新增的任何写端点不在清单上即逃逸，必做用例的只读合同被架空。仓库现行写路径今天已存在（`PUT /api/sources/:conn/:schema/:table`、`POST /api/semantic-assets/validate|export|reindex`、`POST …/import`、publish 等），不必等实现 | 改默认拒绝：本页触发的任何非 GET/HEAD 请求（白名单限既有会话／静态资源／心跳）即 FAIL；黑名单仅作调试辅助，且现在就把上述已知写路径列入 |
| B4 | 阻断 | Plan「浏览器验证」节 vs cases 全集 | Plan 声称浏览器验证覆盖状态 **E1–E12**，但 cases 中 E2（加载占位）、E8（单岛失败／部分可见）、E12（0 条筛选引导改条件）**无任何步骤**；E7 五类筛选只练「孤立」一类。按现状跑完必做用例也无法支撑 Plan 的 E1–E12 声称——Plan↔UAT 断链 | 二选一或组合：(a) SM-01 增加载占位观察子步骤（E2）；SM-04 增无命中关键字子步骤（E12）；SM-07 注入项增「单岛失败」选项（E8）；(b) Plan 改口为「UAT 覆盖 E1／E3–E7／E9–E11；E2／E8／E12 由实现期交互评审核对」，不得保留无证据的全集声称 |
| B5 | 阻断 | cases `UAT-SM-10` | SC-16 原文是「MCP **问数**主路径」，用例只跑 `lucy_catalog`（元数据发现）。catalog 列表成功证明不了问数成交——SC-16 唯一证据路径与合同对象不符 | SM-10 增加一次真实 `lucy_query`（demo-mysql superstore 源，只读）冒烟，或至少 `lucy_read_source`＋`lucy_query` 各一；`lucy_catalog` 可保留作发现面佐证 |
| B6 | 阻断 | cases `UAT-SM-06` | SC-09 有两半：「汇总数标作用域」与「**禁止**把全量未完成表述为概览待补语义」。用例只断言前半。UI 同时满足「有作用域标签」且把全量未完成数叫作「待补语义」时仍 PASS | SM-06 期望增文案断言：全量口径数字不得与概览「待补语义」措辞混用（概览该指标仅统计 enabled，见 `docs/SYSTEM_HANDBOOK.md` 与 Spec §2.4） |

### nit 表

| # | 级别 | 位置 | 问题 |
|---|---|---|---|
| N1 | nit | fixtures `UAT-SM-11` | 造数只写「隔离卷」，未指明落点（repo `semantic-layer/demo-mysql/_schema/dataforai.yaml` 是否进容器卷／入口何时拷贝）、生效等待（快照代次推进）与还原步骤；「无隔离卷 → SKIPPED」使 SC-04 唯一 UI 证据路径可永久缺席。建议写明具体路径与还原纪律，或给出隔离 project 起法 |
| N2 | nit | fixtures `UAT-SM-12` | 降级前提「单连接环境 → SKIPPED」与事实不符：默认 demo 种子**两个**连接（`demo-mysql`＋`lucy-ops`，见 `scripts/runtime/docker-entrypoint.test.mjs:106`、`scripts/smoke/p0-demo-docker-smoke.mjs:277`、`semantic-layer/lucy-ops/_schema/main.yaml`）。跨连接夹具可在现有双连接上以临时 overlay 限定名构造；SKIPPED 理由应改为「第二连接不可用」 |
| N3 | nit | Plan 风险表「与访问关系图混淆 → UAT 文案抽查」 | 该缓解在 cases 无落点（空头支票）。建议 SM-04 文案摘录扩到禁用混称抽查：本页不得出现「拓扑图／ER 图／知识图谱／访问关系图」称谓（Spec Terminology Compliance 禁令） |
| N4 | nit | Plan Task 4 | 无 Task 验收行显式挂 SC-16（仅靠 Plan 总验收 blanket 与 Task 4 跑 UAT 隐含覆盖）。建议 Task 4 验收行补「SC-16／UAT-SM-10」 |
| N5 | nit | cases `UAT-SM-07` 前置「可注入」；fixtures 同条 | 「强制 stale／pending」未指明机制。浏览器侧阻断投影 API 可行（Playwright route 拦截／devtools），stale／pending 需服务器侧手段。建议写明首选注入工具与判定位置（网络面板可见投影请求失败／降级组件出现） |

### 对抗反例摘要

1. **前提真空型假绿（B1）**：今天 overlay-only 前提为真，但无跑次前核对门禁；一旦 Manifest 重扫带上 joins，`UAT-SM-03` 对「只读 Manifest」缺陷失去判别力，页面正常、结论相反。
2. **抽样运气型假绿（B2）**：出度-only 的孤立误判实现，在「抽查一条命中表」下可能永远抽不到 `superstore_returns`／`superstore_people` 而放行；确定性负对照可杀。
3. **黑名单陈旧型假绿（B3）**：实现期新增写端点不在 fixtures 示例清单上，`UAT-SM-09` 监听不到即 PASS；默认拒绝才可证只读。
4. **声称全集、步骤缺席（B4）**：Plan 写 E1–E12，cases 无 E2／E8／E12；跑次全绿也支撑不了 Plan 的浏览器验证声称。
5. **对象替换型证据（B5）**：`lucy_catalog` 成功 ≠ 问数主路径可用；SC-16 的证据必须落在 `lucy_query` 成交上。
6. **半合同型假绿（B6）**：作用域标签与「待补语义」混称可同屏共存，SM-06 只查其一。

### 已核实防线（非发现，防复审重复开打）

- 套件边界已禁 CR／vitest 冒充 WebUI PASS、禁未落地记 PASS（应记 BLOCKED）；cases 头部与 SM-02 步骤级「禁止 vitest/jsdom 冒充」双保险 ✓。
- 规模纪律：`UAT-SM-13` lean 不得记 PASS、须 scale 档且 `uat:scale-baseline` 退出 0（或 `customer-stability` profile）；命令与 profile 均存在（`package.json:97,106,116-117`；`scale-baseline.md` §1.2）✓。
- 反 0 边真空：SM-07 必做且注入路径（浏览器侧阻断）在 lean 可执行；`display-snapshot` 合同真实存在（`webui/server/display-snapshot.ts`）✓。
- INDEX 行＝NOT RUN 且注明「开发未授权、实现未落地」；`runs/` 为空，一致 ✓。
- fixture 核心事实今日为真：overlay formal joins → returns／people（`superstore_orders.yaml:45-53`）；Manifest 同表节点无 joins（`_schema/dataforai.yaml`）；设计对抗 R1 实测全库 `joinCount=0` 旁证 ✓。
- `/semantic-map` 与现有路由无冲突（`webui/src` 无命中）；Plan 明示未确认 IA 前不改 `navigation.ts` ✓。
- 术语使用一致（语义地图／Schema 岛／连通团／孤立表区），Plan／UAT 未见禁用混称 ✓。
- G1 现网抽样在 Plan Task 0 登记为并行取证、不挡编码但挡「已验证」措辞，与设计对抗 G1 处置一致 ✓。

### 核查取证（可复核）

- 通读：Spec v1.0、Plan v1.0、suite／cases／fixtures、INDEX 行、CONVENTIONS、设计 v1.2、设计对抗 R1–R3、REQ-0121 条目。
- 实证：`semantic-layer/demo-mysql/superstore_orders.yaml`、`semantic-layer/demo-mysql/_schema/dataforai.yaml`、`semantic-layer/lucy-ops/`（含 `_schema/main.yaml`）、`package.json` scripts、`webui/server/semantic-identity.ts` 存在性、`webui/src` 路由 grep、demo 双连接种子证据（`scripts/runtime/docker-entrypoint.test.mjs:106`、`scripts/smoke/p0-demo-docker-smoke.mjs:277`）、写路径现状 grep（`webui/server` PUT/POST 路由）。
- 未执行任何写操作、脚本运行或接口调用；未改运行代码、导航与配置。

### 必须修订（主会话应用补丁用）

1. fixtures：加 SM-03 前提核对行（B1）；写 API 清单改默认拒绝＋列入现行已知写路径（B3）；SM-11 补具体造数／生效／还原路径（N1）；SM-12 降级理由改「第二连接不可用」并指向 `lucy-ops`（N2）。
2. cases：SM-04 加 returns／people 负对照断言（B2）与禁用混称文案抽查（N3）；SM-06 加「待补语义」措辞禁令断言（B6）；SM-10 加真实 `lucy_query` 冒烟（B5）；按 B4 选项补 E2／E8／E12 子步骤。
3. Plan：「浏览器验证」节按 B4 选定方案改口或补步骤映射；Task 4 验收行补 SC-16（N4）。
4. suite：必做表要点列随 cases 改动同步（SM-04／SM-06／SM-10 要点句）。
5. 流程项：Plan／suite 头部「经 Kimi Code 对抗后定稿」句在 R1 结论为 Request changes 期间不成立；INDEX 行「待 Kimi Plan／UAT 对抗定稿句回填」保持，待补丁落地并复审通过后按实际最终轮次结论回填。

## 后续轮次

轮次 2 复审依据＝补丁落地后的 cases／fixtures／suite／Plan 文本；逐条核对 B1–B6 闭合与 N1–N5 处置，并抽查新措辞未引入新假绿路径。

---

评审方=Kimi Code；轮次=R1；日期=2026-11-27；≠开发授权

## 轮次 2

**结论：Request changes（1 项新阻断 B7）。** R1 六项阻断全部闭合、五项 nit 处置足够；补丁新措辞抽查未见新假绿路径，仅一记口径 nit（N6）。但 SOT 勾连复核发现 [`INDEX.md`](../qa/uat/INDEX.md) **并无** `UAT-SUITE-SEMANTIC-MAP` 行——套件未登记测试台，而 Plan／suite／Spec 及本评审 R1 均声称该行存在。B7 为单行登记补丁，落地后 R3 仅作定点确认，无须全量复审。

### 阻断复核（B1–B6）

| # | 判定 | 补丁落点核对 |
|---|---|---|
| B1 | **CLOSED** | fixtures 增「SM-03 跑前前提」行（fixtures.md:18）：运行实例（容器内文件或只读 API）核对 `superstore_orders` Manifest 节点无 joins，不成立 → BLOCKED＋换表／重建夹具，明禁照跑；cases SM-03 step 0（cases.md:10）同步，证据列含「前提核对摘录」；suite 要点列（suite.md:23）同步 |
| B2 | **CLOSED** | cases SM-04 step 2（cases.md:11）：具名断言 `superstore_returns`／`superstore_people` **不在**孤立筛命中——确定性负对照，原抽样降为 step 3 辅助；fixtures 负对照表行（fixtures.md:19）钉住两表「无自身 formal 出边、仅被 orders 引用」属性；suite.md:24 同步 |
| B3 | **CLOSED** | fixtures 写请求断言节（fixtures.md:33-35）改**默认拒绝**＋只读白名单，已知写路径（`PUT /api/sources/...`、`semantic-assets` validate／export／reindex／import、publish／batch、joins 写路径）列入且注明「辅助对照，非穷尽豁免」；cases SM-09（cases.md:16）默认拒绝断言；suite.md:29 同步。黑名单陈旧不再能架空只读合同 |
| B4 | **CLOSED** | 按 R1 选项 (a)+(b) 组合落地：Plan 浏览器验证节（plan:62）改口为「必做覆盖 E1、E3–E7、E9–E11」＋ E2→SM-01 占位子步骤、E8→SM-07 单岛失败选项、E12→SM-04 无命中关键字子步骤；cases 三处子步骤均在（cases.md:8 加载占位 E2、:11 空态引导 E12、:14 单岛失败汇总不完整 E8）。E1–E12 全集声称现步步有着落 |
| B5 | **CLOSED** | cases SM-10 step 3（cases.md:17）：真实 `lucy_query`（demo-mysql／superstore 只读度量，如订单计数类），期望写明「**lucy_query 成交**（问数主路径冒烟）」；`lucy_catalog` 保留作发现面佐证；suite.md:30 与 Plan Task 4（plan:55）同步 |
| B6 | **CLOSED** | cases SM-06 期望（cases.md:13）增「全量口径数字**不得**与概览『待补语义』措辞混用」；suite.md:26 同步。半合同补齐 |

### nit 处置复核（N1–N5）

| # | 判定 | 核对 |
|---|---|---|
| N1 | 足够 | fixtures.md:27 指明落点（`semantic-layer/<conn>/_schema/<schema>.yaml` 与 `<source>.yaml`）、生效等待（快照代次推进后再开地图）、还原纪律（跑次末还原＋reindex／刷新）；「清理」节（:39-40）兜底不得污染默认 demo 卷 |
| N2 | 足够 | fixtures.md:28 指明默认 demo 已有 `demo-mysql`＋`lucy-ops` 双连接、临时 overlay 限定名构造路径；SKIPPED 理由改「**第二连接不可用**」并明禁「单连接环境」旧措辞 |
| N3 | 足够 | cases SM-04 step 5＋期望（cases.md:11）禁「拓扑图／ER 图／知识图谱／访问关系图」混称；Plan 风险表（plan:82）缓解落点改挂 UAT-SM-04 禁用混称文案摘录——空头支票闭合 |
| N4 | 足够 | Plan Task 4（plan:55）验收行显式含 **SC-16／UAT-SM-10** `lucy_query` 冒烟 |
| N5 | 足够 | fixtures.md:26 写明首选注入（Playwright／DevTools 对投影 GET route.abort 或 503）、单岛失败机制（隔离卷临时损坏该 `_schema` 文件后刷新、跑后还原）、stale／pending 按 `display-snapshot` 合同触发（判定：降级组件文案出现）；cases SM-07 step 1 引用一致 |

### 新措辞抽查（防新假绿）

- SM-03 前提不成立路径为 BLOCKED 而非 PASS，且证据列要求前提核对摘录——前提真空型假绿已封。
- SM-04 否定面（具名负对照）与肯定面（真孤立入出度 0）均有着落，抽样仅剩辅助——抽样运气型假绿已封。
- SM-09 白名单限只读（静态／会话探活／auth status），已知写路径清单定位为「辅助对照」而非豁免——实现期新增写端点仍被默认拒绝捕获。
- SM-07「无法注入 → BLOCKED」、SM-12 降级理由更正、SM-13 lean 不得 PASS 均原样保留，未引入新逃逸口。
- 既有防线未回退：禁止 vitest／CR 冒充、runs/ 仍为空、套件边界与规模证据规则未动。

### 新发现

| # | 级别 | 位置 | 问题 | 最小补丁意图 |
|---|---|---|---|---|
| B7 | 阻断 | [`INDEX.md`](../qa/uat/INDEX.md)（缺行） vs plan:9／plan:23／suite.md:14 | INDEX 无 `UAT-SUITE-SEMANTIC-MAP` 行（全 docs grep 仅评审／Plan／Spec／suite 自引用命中；INDEX 工作树与 HEAD 一致，最近提交为 ae204187 REQ-0119）。但 plan:23 开工前置 4 声称「测试台**已登记**」、plan:9 与 suite.md:14 声称「INDEX＝**NOT RUN**」、R1「已核实防线」亦记该行存在、R1 必须修订 5 要求该行「保持」待回填——登记缺失使上述陈述失实：套件未挂上测试台 SOT，后续跑次无 SOT 锚点，且逃逸 `lint:e2e-ledger` 三台勾连兜底。疑似今日 REQ-0119／0120 INDEX 提交 churn 丢失未提交行（假设，未取证；无论成因，现值即失实） | INDEX 增 `UAT-SUITE-SEMANTIC-MAP` 行，对照 REQ-0120 行（INDEX.md:12）模式：**NOT RUN**；Spec 终稿已确权；Plan／UAT 对抗当前结论（R2 Request changes，B7 闭合后回填终轮）；**开发未授权**、实现未落地；正式跑次须开发授权后执行；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。同批刷新 suite.md:7「对抗进行中」与 plan:89 Changelog「对抗后定稿」为实际终轮措辞（plan:9 状态行「定稿句以终轮结论为准」已合规，不动） |
| N6 | nit | fixtures.md:33 vs cases.md:16 | fixtures 默认拒绝措辞「本页**用户操作**触发的请求」窄于 cases「任何本页触发请求」——页面自动触发（非用户操作）的非 GET／HEAD 请求在 fixtures 口径下可争辩逃逸。cases 为执行口径且已默认拒绝，故不阻断；建议 fixtures 对齐「本页触发」 | — |

### 必须修订（主会话应用补丁用）

1. INDEX.md 增 `UAT-SUITE-SEMANTIC-MAP` 行（B7 最小补丁，内容见上表）；同批刷新 suite.md:7 授权行与 plan:89 Changelog 的对抗定稿措辞。
2. 可选：fixtures.md:33「用户操作触发」→「本页触发」（N6）。
3. B7 落地后 R3 仅定点确认 INDEX 行存在且措辞合规，无须全量复审。

### 核查取证（可复核）

- 通读补丁后 Plan v1.0／cases／fixtures／suite，对照 R1 阻断表、nit 表、必须修订 1–5 逐条核对。
- 实证：`UAT-SUITE-SEMANTIC-MAP` 全 docs grep（INDEX.md 无命中）；`git diff HEAD -- docs/qa/uat/INDEX.md` 为空、`git log` 最近为 ae204187（REQ-0119）；`semantic-layer/demo-mysql/superstore_orders.yaml` overlay 2 条 formal joins（→ returns／people）仍在；`_schema/dataforai.yaml` 该表节点为 table／columns 结构；`runs/` 为空。
- 本轮未改任何运行代码、导航、配置与 INDEX；仅向本文件追加「轮次 2」节并更新元数据「最终结论」行。

---

评审方=Kimi Code；轮次=R2；日期=2026-11-27；≠开发授权

## 轮次 3

**结论：Approve with nits（无新阻断；余 1 项 nit N7）。** 定点确认：B7 闭合——[`INDEX.md`](../qa/uat/INDEX.md):11 已登记 `UAT-SUITE-SEMANTIC-MAP` 行且措辞合规；N6 闭合——fixtures「本页触发」口径已对齐 cases。B1–B6 回退抽查全部维持 CLOSED。本轮新增措辞（INDEX 行、fixtures 默认拒绝括注）未引入新假绿路径。唯一遗留：INDEX 行「对抗终轮结论回填位」占位待回填实际终轮结论（N7，建议句见下）。本轮为终轮，无须后续复审。

### 定点确认 1：INDEX 登记（B7 → CLOSED）

- 行存在：INDEX.md:11，Suite／总账 REQ-0121／套件路径／必做环境（本机 demo Docker **lean**＋真实前台浏览器 1920×1080 `/semantic-map`；规模项可选 scale／customer-stability）／最近跑次「尚无」／结果列齐备。
- 措辞合规：结果列＝**NOT RUN**；「Spec v1.0 终稿已确权；Plan／UAT 已登记；Plan／UAT 对抗终轮结论回填位；**开发未授权**、实现未落地；正式跑次须开发授权后执行。≠ 功能合同收口；≠ UAT PASS；≠ 可上线」——与 REQ-0120 行（INDEX.md:13）模式一致；无 PASS／收口／上线越界声称。
- 勾连陈述转真：plan:23 开工前置 4「测试台已登记」、suite.md:14「INDEX＝NOT RUN」、plan:9 状态行现均与 INDEX 现值一致；`lint:e2e-ledger` 三台勾连锚点恢复。
- 同批刷新核对：suite.md:7 授权行已去「对抗进行中」、改「经 Kimi Code 对抗定稿见评审」（本轮落笔后成立）；plan:89 Changelog 改「对抗（R1–R3）定稿句以评审终轮为准」，不再是无条件定稿声称；plan:9 状态行按 R2 结论未动，仍合规。

### 定点确认 2：B1–B6 无回退（维持 CLOSED）

| # | 判定 | 本轮抽查落点 |
|---|---|---|
| B1 | CLOSED（维持） | fixtures.md:18 跑前前提行（不成立 → BLOCKED、明禁照跑）；cases.md:10 step 0＋证据列「前提核对摘录」；suite.md:23 |
| B2 | CLOSED（维持） | cases.md:11 step 2 具名负对照（returns／people 不在命中）；fixtures.md:19；suite.md:24 |
| B3 | CLOSED（维持） | fixtures.md:33–35 默认拒绝＋白名单＋已知写路径「辅助对照，非穷尽豁免」；cases.md:16；suite.md:29 |
| B4 | CLOSED（维持） | cases.md:8（E2 占位）、:11 step 4（E12 空态引导）、:14（E8 单岛失败）；plan:62 改口节原样（必做 E1、E3–E7、E9–E11＋三项映射） |
| B5 | CLOSED（维持） | cases.md:17 step 3 真实 `lucy_query` 成交；suite.md:30；plan:55 Task 4 验收行 |
| B6 | CLOSED（维持） | cases.md:13 期望「不得与概览『待补语义』措辞混用」；suite.md:26 |

### 定点确认 3：N6 闭合

fixtures.md:33 改「本页触发的请求（**含非用户手势的自动请求**）」，与 cases.md:16「任何本页触发请求」同宽——页面自动触发的非 GET／HEAD 请求逃逸口封闭。**N6 CLOSED**。N1–N5 处置相关行原样，无回退迹象。

### 新措辞抽查（防新假绿）

- INDEX 行三「≠」与「开发未授权／实现未落地／跑次须授权后执行」齐备，未开 PASS 或收口逃逸口。
- fixtures 默认拒绝括注为扩宽口径（用户操作触发 → 本页触发含自动请求），方向收紧非放松。
- suite.md:7「定稿见评审」以本记录为锚；本评审终轮结论即定稿依据，不构成独立声称。

### 新发现

| # | 级别 | 位置 | 问题 | 最小补丁意图 |
|---|---|---|---|---|
| N7 | nit | INDEX.md:11 结果列 | 「Plan／UAT 对抗终轮结论回填位」为占位措辞；R3 已终轮，应回填实际结论 | 回填建议句（替换「Plan／UAT 对抗终轮结论回填位；」分句，其余不动）：「Plan／UAT 对抗 **Approve with nits**（2026-11-27，R3 终轮；B1–B7 全 CLOSED）；」 |

### 核查取证（可复核）

- 通读：INDEX.md:11、suite.md／cases.md／fixtures.md 全文、plan:9／23／55／62／82／89，对照 R2 阻断表与必须修订 1–3 逐条核对。
- 实证：`UAT-SUITE-SEMANTIC-MAP` 在 INDEX.md 命中（:11）；B1–B6 各落点行原样在位（行号见上表）；fixtures.md:33 与 cases.md:16 口径比对一致；`runs/` 仍为空，与 NOT RUN 现值一致。
- 本轮仅向本文件追加「轮次 3」节并更新元数据「最终结论」行；未改 INDEX、cases、fixtures、suite、Plan 及任何运行代码、导航、配置。

---

评审方=Kimi Code；轮次=R3；日期=2026-11-27；≠开发授权
