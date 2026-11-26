# P1-84 公共首页与静态公开接口隔离 · 落地前对抗性评审

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-84 公共首页与静态公开接口隔离 · 落地前对抗性评审 |
| 文档类型 | Review（过程评审记录） |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-24 |
| 撰写人 | Kimi Code |
| 委托人 | xingchen |
| 评审对象 | [Spec v0.1-draft](../specs/lucy-20261124-public-entry-static-isolation-spec.md) · [Plan v0.1-draft](../plans/lucy-20261124-public-entry-static-isolation-plan.md) · [UAT suite v0.1-draft](../qa/uat/suites/public-entry-static/suite.md) · [UAT cases](../qa/uat/suites/public-entry-static/cases.md) |
| 关联登记 | P1-84／REQ-030-105 · `UAT-SUITE-PUBLIC-ENTRY-STATIC` · `GAP-UAT-P1-84` |
| 适用范围 | 终稿确权与开发授权前的 Spec／Plan／UAT 对抗性评审；不改变功能合同、授权和测试台现值 |
| 输出位置 | `docs/reviews/2026-11-24-p1-84-public-entry-static-isolation-adversarial-review.md` |

## 0. 本记录的效力

- 本记录是落地前的内容评审，**不构成终稿确权、开发授权、功能合同收口、UAT 结果或可上线结论**。
- 评审时 Spec／Plan 均为 `S1｜v0.1-draft`，开发未授权；测试台为 `NOT RUN`。本记录不改变这些现值。
- 评审方式包括：合同交叉核对、现有实现核查、既有事故证据复核、静态门禁执行及假绿场景推演。未执行 P1-84 运行 UAT。

## 1. 结论

**BLOCK：退回 Spec、Plan、UAT 同步修订。当前不建议终稿确权，也不建议开发授权。**

核心问题不是实现步骤不足，而是现有合同可以在以下情况下仍然 PASS：原事件循环事故未修、合法登录失败、纯 MCP 全部超时、使用弱压力或幸运样本。

| 门禁 | 评审结论 |
|---|---|
| 文档形态 | **退回**：画像小节不符合必填形态；Plan 浏览器验证措辞自相矛盾 |
| 技术合同 | **退回**：B1–B6 未关闭 |
| 终稿确权 | **不建议**：架构因果链、认证边界和验收分母尚未成立 |
| 开发授权 | **不建议**：应先关闭阻断项并重新评审 |
| 测试台 | 保持 **NOT RUN**；本记录不是跑次证据 |

## 2. 逐项审查意见总表

| 编号 | 审查项 | 结论 | 关闭条件 |
|---|---|---|---|
| B1 | 同进程事件循环隔离机制 | 阻断 | 选定能兑现预算的架构；事件循环饥饿臂成为必做；禁止仅用事后计时冒充截止控制 |
| B2 | 静态读取、Session 读取与认证写入边界 | 阻断 | 分三类合同；合法登录必须真实成交；保留全部认证安全语义 |
| B3 | 纯 MCP＋管理只读主路径 | 阻断 | 两臂同窗成功；有界失败另验，且停压后有界重试成功 |
| B4 | 事故输入与当前候选残余问题 | 阻断 | 补齐原始反例指针；在当前候选复证残余问题，再决定实现 |
| B5 | 改前／最终候选对照逻辑 | 阻断 | 固定旧／新双镜像，或提供可证明等价的最终镜像功能关闭对照臂 |
| B6 | UAT 压力分母与可执行性 | 阻断 | 强制 scale，冻结压力时长和请求序列，定义样本、统计、primaryReady、fixtures 与清理 |
| N1 | 品牌缓存一致性 | 重要 | 规定提交代次、写屏障和失效；覆盖写后首读、删除及外部修改 |
| N2 | 公开入口反向洪水与公平性 | 重要 | 增加公开面→MCP／管理面的反向及双向混压 |
| N3 | SC-07 运行时证据 | 重要 | 用运行时计数或真实进程集成断言证明未触发重工作；CR 仅作补充 |
| N4 | Plan 浏览器验证表述 | 文档退回 | 改为“交互合同豁免；浏览器可用性验证适用” |
| N5 | 受影响画像判定（4 画像） | 文档退回 | 按模板补变更前／后体验和可核对依据；修正 P4 判定及 P1 双臂依据 |

## 3. 阻断项详述

### B1. 同进程“快路径”无法证明能解决事件循环饥饿

**证据**

- Spec 记录事件循环 p99≈3175ms、max≈3502ms，同时给出 branding 1 秒等预算：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:61`、`:105`。
- `onIncomingHttp()` 只有在事件循环获得调度后才能执行；同步长任务占用线程时，不存在可抢占的公开请求优先路径。
- `assert elapsed(start) within budget` 是工作完成后的检查，不能让已超时请求变快：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:139`。
- 伪代码要求其他 handler 不变，OQ-2 又排除 worker：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:146`、`:164`。
- Plan 只安排公开 handler 快路径，没有重工作切分、让出或移出主线程任务：`docs/plans/lucy-20261124-public-entry-static-isolation-plan.md:54`。

**对抗性反例**

构造真实同步 YAML 解析、SQLite 或序列化长任务，公开请求连 `onRequest` 都无法进入。实现者却可以改用较弱的异步排队臂，使“至少一种真实混压臂”通过，而未覆盖原事故。

**必须修订**

1. 将 OQ-2 提升为架构决策，而非实现细节。
2. 若坚持同进程，把重工作切分、让出或移出主线程纳入范围和 SC，给出同步切片上限与公平调度合同；只改公开 handler 不够。
3. 若不改重工作，则需独立执行域承接公共入口，并与 P1-82 B1 对齐。
4. 若两者都不做，应删除“事件循环饥饿下仍满足预算”的承诺，收窄为异步排队／缓存优化。
5. 事件循环饥饿臂必须成为必做；响应预算以客户端发送→首字节／完整响应为准，不能只测 handler 内耗时。

### B2. 登录被错误套入“只读小状态”模型，且合法登录失败也能 PASS

**证据**

- 公共入口同时包含静态资源、Session 状态读取和登录写入：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:73`。
- 统一伪代码却使用 `readCommittedSmallState(req)`：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:148`。
- 现有登录包含限流、scrypt 校验、Session 持久化签发及持久审计：`webui/server/auth/routes.ts:139`、`:171`、`:177`；`webui/server/auth/password.ts:24`。
- `/api/auth/status` 返回当前 Session 的管理员信息，不能共享缓存：`webui/server/auth/routes.ts:64`。
- 公开 API 白名单判断发生在 Session 解析之后：`webui/server/auth/guard.ts:116`。简单提前短路会改变撤权、认证状态、DRAINING 和 `no-store` 语义。
- UAT 接受合法凭据返回“既有失败码”：`docs/qa/uat/suites/public-entry-static/cases.md:76`。

**对抗性反例**

合法登录在压力下返回 503、429，或开放模式下返回 400，均可能被记为通过；共享缓存 `/api/auth/status` 还可能把某一身份的 `me` 返回给另一身份。

**必须修订**

1. 拆成静态只读、Session 感知读取、认证写入三类合同。
2. 健康认证存储＋合法凭据的本地登录必须成功签发 Session，并继续完成一次受保护读取；失败语义另设负向用例。
3. 明确保留 CSRF、scrypt 成本、限流、撤权、审计屏障、Cookie 和 `Cache-Control: no-store`。
4. 禁止共享缓存 `/api/auth/*` 响应。
5. 补齐双身份、过期／吊销 Session、跨站请求、OIDC／bootstrap 条件分支及 DRAINING 测试。

### B3. “双臂主路径”被降成“任一臂有界失败”

**证据**

- Spec 总承诺与 Plan 要求 MCP **与**管理主路径双臂：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:29`；`docs/plans/lucy-20261124-public-entry-static-isolation-plan.md:73`。
- SC-06 和 UAT 改成 MCP **或**管理只读，成交**或有界失败**：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:175`；`docs/qa/uat/suites/public-entry-static/cases.md:105`。
- 主路径可用性要求同时覆盖约束生效和合法用户成交：`docs/governance/DEVELOPMENT.md:32`。

**对抗性反例**

纯 MCP 全部 30 秒超时、管理 API 快速返回 503，或管理页全挂而 MCP 只返回容量拒绝，都可能 PASS，但用户无法完成原任务。

**必须修订**

1. 同一混压窗内，纯 MCP 返回独立 SQL 可核对的成功结果，已登录管理只读也返回正确内容；两者都必做。
2. 容量拒绝、降级和有界失败单独验“约束生效”，不得冒充主任务成交。
3. 停压后必须有界重试成功，证明拒绝路径确实有逃生。

### B4. 事故输入缺少可追溯原始证据，当前候选残余问题未证明

**证据**

- Spec 写有“10 秒 0 bytes、livez 服务端 0.1ms、事件循环 3175／3502ms”，但没有对应跑次或原始样本指针：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:13`。
- 可定位的 P1-75 `f5e4b14d` 压力跑次只登记 livez、readyz、project 等探测：`docs/qa/uat/suites/interactive-read-resilience/runs/2026-11-24-codex-f5e4b14d-pressure.md:32`。
- 本次解析 `inbox/p175-pressure-f5e4b14d/t2-probes.jsonl` 的 5400 行，路径只有 `/api/livez`、`/api/readyz`、`/api/project`，没有 `/` 和 `/api/branding`。
- 该跑次 livez 客户端 p99 约 1.2 秒、max 约 2.37 秒：`inbox/p175-pressure-f5e4b14d/t2-metrics.json:19`。这与“服务端处理 0.1ms”可以是不同指标，但不能混作同一可用性证据。

**必须修订**

1. 补上可复核的原始反例；否则将“已核实”降为待验证假设。
2. 先在当前含 P1-75／P1-82 改动的候选上确认残余问题，再决定实现机制。
3. 将当前候选诊断移到 OQ-1／OQ-2 裁定之前；若当前候选已不失败，先重新评估是否需要新增快路径。
4. `livez` 绿且入口死的判别条件必须在同一客户端时间窗成立，不能只记录“livez 可仍为 200”。

### B5. “最终镜像跑改前失败”存在执行逻辑矛盾

**证据**

- Spec 要求同一最终候选完成 R0／01–06：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:30`。
- Plan 要求同一最终镜像执行：`docs/plans/lucy-20261124-public-entry-static-isolation-plan.md:69`。
- R0／01 又要求改前候选必须越线或失败：`docs/qa/uat/suites/public-entry-static/cases.md:16`、`:33`。

**必须修订**

明确采用以下一种设计：

- 固定旧镜像与最终镜像双臂，使用同一夹具、资源和请求序列；或
- 最终镜像提供测试专用的功能关闭对照臂，并证明该臂确实走旧路径。

不能同时写“最终镜像”与“改前必须失败”而不提供控制机制。

### B6. UAT 分母未冻结，可选择弱环境、弱压力和幸运样本

**证据与缺口**

- 只要求“记录 lean／scale”，没有强制 scale：`docs/qa/uat/suites/public-entry-static/cases.md:20`。
- 任意一种混压臂即可：`docs/qa/uat/suites/public-entry-static/cases.md:23`。
- 首页只要求一次冷开，登录也只要求一次；branding／status 仅各 10 次：`docs/qa/uat/suites/public-entry-static/cases.md:47`、`:62`、`:76`。
- 没有固定压力持续时长、开放到达模型、P95／P99／max、超时样本处理或停压恢复要求。
- “文档可用”没有定义登录表单可见、可操作及必需 JS／CSS 全部成功，HTML 先返回也可能被误判首屏成功。
- 套件目录没有 `fixtures.md`、具体 runner、端口、种子、凭据文件路径和清理步骤，尚不是可重复执行的 UAT 包。

**必须修订**

1. 强制 scale 档，冻结真实事件循环臂、压力时长和请求序列。
2. 采用开放到达并保留所有首响应、超时和慢样本；报告 P50／P95／P99／max、错误数和完整分母。
3. 可沿用原事故 15 分钟、每接口 1 Hz／900 样本作为基线，或由委托人另行裁定等效分母；不得事后缩量。
4. 浏览器必须定义真实 `primaryReady`：登录表单可见且可操作，首屏必需 JS／CSS 和 Logo 请求完成，不能只解析 HTML。
5. 增加可执行 `fixtures.md`、runner、环境标识、凭据文件路径、证据脱敏和清理步骤。
6. 增加停压后同 PID 恢复观察；手工重启不得冒充恢复。

## 4. 其他重要缺口

### N1. 品牌缓存一致性未设计

当前 branding 每次读取配置和 Logo：`webui/server/branding.ts:141`、`:413`。Spec 126 要求上传、修改和恢复默认后立即生效：`webui/docs/126-customer-branding-logo-config-spec.md:140`。

新增缓存必须规定提交代次、写中屏障、删除和外部修改失效，并增加写后首读 UAT；不得把旧 Logo 或旧文案作为“已提交小状态”长期返回。

### N2. 只测“数据面压垮公开面”，未测反向 DoS

公开快路径若获得优先级，未登录首页、branding 或登录洪水可能反向饿死 MCP／管理面。必须增加公开入口洪水×合法 MCP／管理读的反向及双向混压，并规定公平性和有界容量；不得以保护公开面为名形成新的拒绝服务放大器。

### N3. SC-07 不能用 Code Review 证明运行时未触发重工作

当前写法为“实现审查确认”：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:176`。UAT 约定禁止用 Code Review 冒充 UAT：`docs/qa/uat/CONVENTIONS.md:7`。

应改为运行时计数、钩子轨迹或真实进程集成断言，证明公开快路径没有触发 MCP、全量展示构建或重审计扫描；CR 只能补充。

### N4. Plan 浏览器验证措辞自相矛盾

`docs/plans/lucy-20261124-public-entry-static-isolation-plan.md:79` 先写“不适用”，随后又要求真实浏览器。应改为“交互合同豁免；浏览器可用性验证适用”，避免执行者跳过强制浏览器与即时计时。

### N5. 受影响画像小节不合规

当前只有判定和 SC：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:48`，缺少治理模板要求的“变更前体验／变更后体验”列：`docs/governance/user-personas.md:174`。

- P1 的 `↑` 必须以 B3 修正后的纯 MCP＋入口双臂成交证据为依据。
- P4 判 `＝` 却写“叙事更诚实”，需统一为可观察的持平或增强。
- 子面方向不一致时按最差口径写复合判定，不得用总体提升掩盖局部退化。

## 5. 肯定项（修订时保留）

- 范围明确限定 Docker 单实例，不把本条包装为多副本或进程级 HA。
- 明确不修改 KTX、不改导航 IA、不扩大 `isPublicApi` 白名单。
- 已识别真实前台浏览器计时与 API 耗时分列的必要性。
- 已挂接总账、Spec、Plan、UAT INDEX 与 e2e-ledger；测试台保持 `NOT RUN`，没有提前主张通过。
- 对 P1-75／P1-81／P1-82 的相邻职责有初步划分，后续应在这些边界内解决根因，而非重复建合同。

## 6. 建议的修订与复审顺序

1. **诊断 Gate**：固定当前候选和原始证据，区分同步事件循环阻塞、异步排队、认证存储瓶颈。
2. **架构决策**：决定修改重工作调度，还是引入独立执行域；明确与 P1-82 B1 的边界和代价。
3. **重写合同**：拆分静态／Session／认证写入，恢复 MCP＋管理双臂成功标准。
4. **补齐可执行 UAT**：冻结改前／改后候选、scale 夹具、压力分母、浏览器 `primaryReady`、安全负例和恢复路径。
5. **逐条核销**：按 B1–B6、N1–N5 建立修订对照，独立复审确认关闭后再申请终稿确权。
6. 终稿确权后，开发授权仍按下一阶段单独取得；本记录不替代任何一项授权。

## 7. 本次静态检查与证据边界

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run lint:spec-docs` | PASS | 602 文件；另有 2 个非 P1-84 未跟踪文件警告，不代表本评审内容通过 |
| `npm run lint:e2e-ledger` | PASS | 只证明勾连存在，不证明 UAT 已执行或可执行 |
| `npm run lint:ia-boundary` | PASS | 本条无导航 IA 变更 |
| `npm run lint:terminology` | PASS | 1197 文件 |
| `npm run lint:spec` | **FAIL** | `webui/docs/03-api-spec.md` 缺 8 个 ops-step 路由登记；输出未涉及 P1-84 新路径，不得宣称全仓静态门禁全绿 |

- 未执行 P1-84 UAT，未新增跑次，未改 INDEX 的 `NOT RUN`。
- 仅新增本评审记录；未改 Spec、Plan、UAT、总账、运行代码或配置。

---

## 8. 追加：v0.3-draft 复审（第二轮）

| 项 | 内容 |
|---|---|
| 复审对象 | Spec／Plan／UAT **v0.3-draft**，含新增 `fixtures.md` 与诊断 Gate |
| 复审方式 | 按首轮 B1–B6／N1–N5 逐项核销；复核诊断报告、跨文档镜像和静态门禁 |
| 复审效力 | 过程评审；不构成终稿确权、开发授权或 UAT 结果 |
| 复审结论 | **BLOCK：仍不建议确权，不建议进入产品开发** |

### 8.1 第二轮结论

修订有实质进展：历史数字已降级为待复证假设，诊断 Gate 证明了同步事件循环阻塞，OQ-2 已选 A，三类入口、合法登录必成、双镜像对照、scale 和运行时证据均已写入。

但当前仍有四项实质阻断：**B1／B2／B3／B6 仅部分关闭**。因此不能把“已选架构方向”当作“设计已冻结”，也不能进入产品开发后再补这些合同。

| 首轮项 | 第二轮状态 | 复核结论 |
|---|---|---|
| B1 同进程事件循环机制 | **部分关闭，仍阻断** | 已选 A 且事件循环臂必做；仍缺生产热点范围、同步切片上限、让出／off-thread 控制流及公平性合同 |
| B2 三类入口与认证安全 | **部分关闭，仍阻断** | 三类合同和合法登录必成已写；CSRF／撤权／限流／审计失败／DRAINING 等安全负例仍非必做 |
| B3 主路径逃生 | **部分关闭，仍阻断** | 至少一臂必须成功、另一臂拒绝后恢复已写；另一臂“超时／无限挂起而非有界拒绝”仍可漏过 |
| B4 事故证据与当前残余 | **关闭** | 历史数字已降级；Gate 已证明当前候选在同步臂下越线。历史“探针绿入口死”继续作为待复证假设，不再冒充事实 |
| B5 改前／改后对照 | **关闭** | 双镜像或 feature-off／on 对照已明确；Plan Task 4 的基线 R0／01、最终 02–08 分工正确 |
| B6 UAT 分母与可执行性 | **部分关闭，仍阻断** | scale、3 分钟、1 Hz、统计和 fixtures 已补；仍有提前停止、单样本、MCP 臂不一致及无实际 runner 命令等缺口 |
| N1 品牌缓存 | **部分关闭** | 写后首读／删除已覆盖；外部修改在合同中必需，却在 UAT 中“若可模拟”可选 |
| N2 反向洪水 | **明确延期，不单独阻断本期** | OQ-6 已登记为可选／后续；不得据此宣称双向隔离已验 |
| N3 运行时证据 | **基本关闭** | 已改为运行时计数；须删除或穷尽定义“白名单辅助”例外 |
| N4 浏览器验证措辞 | **部分关闭** | 已明确浏览器仍适用，但句首仍写“不适用”，应消除歧义 |
| N5 受影响画像 | **关闭** | 已补变更前／后体验、依据与补偿列；P4 判定已统一 |
| N6 登记镜像与开放项 | **新增文档缺口** | 两处 README 仍为 v0.2；e2e 缺口关闭条件仍为 R0／01–06；OQ-1／OQ-7 仍写“裁定前默认” |

### 8.2 B1 残余：选项 A 只有方向，没有可实现的调度合同

**当前进展**

- 选项 A 已裁定，且 Spec 正确承认只改公开 handler 不够：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:113`。
- 诊断 Gate 使用 `Atomics.wait` 同步臂证明入口与 livez 同滞：`inbox/p184-diag-20261124/REPORT.md:46`。

**残余问题**

1. 核心伪代码只写“事件循环须已对重工作切片／让出”，没有描述如何切片、何时让出、不可切片 CPU 工作如何 off-thread，以及如何证明单个同步片段没有越界：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:180`。
2. 没有冻结生产热点清单、最大同步片段或等价可测上限，也没有重工作在持续公开请求下的最低进度／公平性合同。
3. Plan Task 2 仍只有“重工作切片／让出”一条泛化步骤：`docs/plans/lucy-20261124-public-entry-static-isolation-plan.md:39`。这会与 P1-75／P1-82 正在修改的重工作路径重叠，不能仅靠“文件／路径分隔”消解。
4. Gate 的测试专用 `sync-section` 可用于机制鉴别，但正式 UAT 不能只修改或绕开该注入器来取得 PASS；必须有冻结的生产重工作臂，或证明注入器实现未随修复改变且仍能代表原生产热点。

**关闭条件**

- 在 Spec 核心流程补重工作控制流：切片／off-thread 选择、每片实际耗时观测、让出点、异常与取消、最低进度。
- 冻结本期生产热点和文件边界；给出最大同步片段或等价可机检指标，不能只保留端到端响应预算。
- Plan Task 2 拆成可执行任务，并列出与 P1-75／P1-82 的合流顺序。
- 正式 UAT 冻结故障注入器，并增加至少一条真实生产重工作臂；禁止把修复测试钩子本身当产品修复。

### 8.3 B2 残余：安全语义写成“保留”，但没有必做反例

双 Session 交错和合法登录成功已覆盖，但 UAT-PES-04 的错密码仍只是“可另附记录”：`docs/qa/uat/suites/public-entry-static/cases.md:79`。以下高风险分支没有成为必做验收：

- 过期／吊销 Session、认证状态不可用和 `no-store`；
- 跨站请求 403、限流 429、错误密码 401 且不签发 Session；
- 审计／Session 存储失败时不发 Cookie、不释放未提交内容；
- DRAINING 下各 A／B／C 路径的允许／拒绝矩阵；
- 非目标受保护 API 不得因新分类器或钩子顺序被公开。

**关闭条件：** 在 Spec 增逐路径安全矩阵，在 UAT 或 Plan 中列出必须执行的既有认证回归文件／命令及新增负例。只写“安全语义保留”不足以证明快路径没有绕过前置钩子。

### 8.4 B3 残余：另一臂无限挂起仍可能 PASS

当前规则是“至少一臂成功；另一臂若有界拒绝，停压后重试成功”：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:214`。UAT-PES-06b 又仅在另一臂“为有界拒绝”时执行：`docs/qa/uat/suites/public-entry-static/cases.md:122`。

**假绿反例：** 管理只读成功，纯 MCP 持续 0-byte／客户端超时；因为另一臂不是“有界拒绝”，06b 不执行，06 又因管理臂成功而通过。反向组合同样成立。

**关闭条件：** 另一臂必须二选一：

1. 同窗成功成交；或
2. 在预算内返回有界、可重试拒绝，并在停压后同 PID 重试成功。

另一臂出现超时、0-byte、无限挂起或非有界错误，无论首臂是否成功，都必须 FAIL。06b 应在“另一臂未成功”时触发，先证明其有界拒绝，再验恢复。

### 8.5 B6 残余：压力与样本仍可选择性缩小

1. R0 写“持续 ≥3 min **或至对照臂入口越线**”，可在首次失败后提前停止：`docs/qa/uat/suites/public-entry-static/cases.md:22`。基线故障证明与最终候选完整压力窗应分开；最终臂不得提前停止。
2. 首页和登录仍无独立样本数，单次幸运空窗即可通过；需冻结前台浏览器与登录的样本下限，并保留失败样本。
3. Spec 将 MCP 臂标为必做：`docs/specs/lucy-20261124-public-entry-static-isolation-spec.md:138`；R0 却将 MCP／展示臂写为可选叠加：`docs/qa/uat/suites/public-entry-static/cases.md:28`。须统一，并证明真实 MCP 在途压力而非只发一条合法查询。
4. `fixtures.md` 已补环境要求，但仍无实际 runner 入口、命令、参数和判定脚本；Plan 也没有 runner 建设任务。当前仍是测试清单，不是可重复执行包。
5. 报告 P50／P95／P99／max 已要求，但须明确预算作用在每个样本、哪个分位或哪些组合，避免用平均分位掩盖 max／超时。

### 8.6 非阻断修订与登记同步

- **N1：** UAT-PES-08 的“若可模拟外部改文件”与 Spec 的外部修改失效承诺不一致：`docs/qa/uat/suites/public-entry-static/cases.md:149`。若保留该承诺，外部修改必须必做并给失效时限；若不实现外部新鲜性，应禁止启用相应缓存或收窄承诺。
- **N3：** SC-07 的“白名单辅助”例外没有清单：`docs/plans/lucy-20261124-public-entry-static-isolation-plan.md:46`。三类重工作应直接为 0；确有辅助例外须逐一枚举并另验。
- **N4：** Plan 浏览器验证仍以“不适用”开头：`docs/plans/lucy-20261124-public-entry-static-isolation-plan.md:56`。改成“交互合同豁免；浏览器可用性验证适用”。
- **Suite 节奏：** `docs/qa/uat/suites/public-entry-static/suite.md:40` 的“最终臂 R0／01–08”应与 Plan Task 4 统一为“配对跑次含基线 R0／01＋最终 02–08”，避免重新引入 B5 歧义。
- **索引镜像：** `docs/README.md:47` 与 `docs/plans/README.md:8` 仍为 v0.2／Gate 未裁定，与 Spec v0.3 不符。
- **缺口关闭条件：** `docs/governance/e2e-ledger.md:128` 仍为 R0／01–06，未覆盖 06b／07／08，应随 SC-01–08 更新。
- **开放项冻结：** OQ-1／OQ-7 仍标“裁定前默认”。申请终稿确权时应明确这些默认值是否正式冻结；不能一边称终稿，一边保留预算与分母待裁。

### 8.7 第二轮门禁与最终意见

本轮执行结果：

- `npm run lint:spec-docs`：PASS（602 文件）。
- `npm run lint:e2e-ledger`：PASS（只证明勾连，不证明上述内容正确）。
- `npm run lint:ia-boundary`：PASS。
- `npm run lint:terminology`：PASS（1200 文件）。
- `npm run lint:spec`：PASS；保留既有 `paired_quiz` 与 `permission_model_version` 警告。

**最终意见：**

1. **当前不可建议终稿确权。** B1／B2／B3／B6 仍有实质残余，OQ-1／OQ-7 也需正式冻结。
2. **当前不可建议开发授权。** 进入开发后再决定切片算法、安全矩阵和验收分母，会把合同设计风险留到实现阶段。
3. 修订后再做一次聚焦复审；若上述残余关闭，可由 Codex CLI 终审或委托人明示确权。确权与开发授权仍是两个独立门禁。
4. 本轮未执行正式 UAT，测试台继续保持 **NOT RUN**；未改 Spec／Plan／UAT／总账／运行代码，仅追加本复审记录。
