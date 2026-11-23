# MCP 握手与 Agent 名册长尾复现 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 修复与复现计划 / v1.2 |
| 日期 / 功能编号 | 2026-11-23 / P1-75／REQ-030-096 |
| 状态 | S3｜实现进行中（A1／A2 单元＋复审 PASS；A3 判定器 24/24；demo 镜像已含改动）。正式 G1 R0–07／G2 与多页面必做回归尚未封存跑次；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| 授权边界 | 本轮授权覆盖 Spec、UAT 设计及任务批次，含 SC-08 必做多页面回归。运行代码、正式测程开发及候选 UAT 执行以对应开发授权为准。 |
| 验收 | 同一最终候选完成 G1 的 R0／01–06／08 与 G2 的 07，对应 Spec SC-01–08。长时组合取证沿用 P1-13／R-CAV。 |
| 关联 | [Spec](../specs/lucy-20261123-interactive-read-resilience-spec.md) · [UAT](../qa/uat/suites/interactive-read-resilience/suite.md) |

## 目标

在冻结的 Docker 档位验证备注保存同窗的名册首读、四个受影响页面的冷读与恢复，以及 MCP 建连、发现和取得正确查询结果。保留授权与持久事务约束，记录动态指引超线后的问数结果。

## 开工前置

已执行[改前定向诊断](../qa/uat/suites/interactive-read-resilience/runs/2026-11-23-kscc-directed-baseline.md)和[全局规模对照](../qa/uat/suites/interactive-read-resilience/runs/2026-11-23-kscc-global-baseline.md)。首轮复用已知全局反例，按下列条件冻结可比环境。

1. 首轮同构 Docker 反例和分段对照可以独立执行。现场规模对照在日志齐备后执行。按 [Spec 的阶段安排](../specs/lucy-20261123-interactive-read-resilience-spec.md#4-阶段安排)核对握手断开与重试、原始名册请求完整路径和 `busy` 原因、同实例探针与资源记录。现场无法取得的材料按缺口留痕。
2. 历史症状复核使用 `322438a23b3d47ce6f2e17ac782d7385ae7438c1` 和 KTX `0.16.0`。正式 A/B 冻结候选的共同基线提交，B 仅叠加本次改动，固定 KTX、容器平台和数据差集。记录 `/api/health` 的构建 SHA／`gitDirty`、Lucy／数据库实际镜像 ID 和测程 hash。带额外观测的镜像单独登记，参考 [核心可用性预检](../qa/uat/suites/core-availability/retest.md#准备候选)。
3. 冻结唯一 Compose 项目、Lucy／数据库／环回反代、独立网络和原生卷。端口只绑定环回，测试账号和凭据使用本轮私有目录。核对共享 demo、既有容器和端口，选择独占负载窗口。G1／G2 都使用 Lucy 2 CPU／2 GiB，P1-66 的 2 CPU／4 GiB 诊断档及 FUP-03／R-CAV 重档单列。

从冻结工作副本运行兼容性预检。两个镜像变量须由执行者先解析为本次实际镜像 ID。此命令只检查条件，实际起容器前还需核对本轮项目、网络、端口和证据目录。

```bash
lucy_baseline_sha='322438a23b3d47ce6f2e17ac782d7385ae7438c1'
python3 scripts/uat/core-availability-uat.py preflight \
  --image "${LUCY_REPRO_IMAGE_ID:?}" --git-sha "$lucy_baseline_sha" \
  --mysql-image "${LUCY_REPRO_MYSQL_IMAGE_ID:?}"
```

## 夹具与对照

遵循 [UAT 夹具](../qa/uat/suites/interactive-read-resilience/fixtures.md)。G1 和四档目录对照均使用只绑定正式 `lucy_admin` 的测试 Agent，逐连接核对 Source 集合和独立 SQL 结果。受限身份覆盖撤权和隔离。G2 保留全局规模，加入八连接的偏斜目录与大 Manifest。现场已知的 18 个名册 Agent、约 2,643 条已启用表记录、7 个解析 Skill 及约 4.9 MiB 完整响应仅作为合成对照的线索。旧完整接口下载、[P1-66 BAL-K1](../qa/uat/suites/agent-roster-summary/runs/2026-11-20-codex-p166-docker.md#正式-bal-k1-首轮) 冷读及事故归因分别留证。

| 组 | 保持不变 | 只改变的条件 | 用途 |
|---|---|---|---|
| B0 | 版本、资源、客户端、账号和查询结果核对值 | 小夹具的两条合法入口和三类探针 | 校验计时、权限、响应内容及请求关联 |
| M1 | 真实 KTX、可查范围和既定结果、Skill 档、并发；字节对照固定目录文件数、连接分布和 Overlay | 每轮只改变 Manifest 字节数分布、目录文件数或连接分布之一。字节档按 [UAT 夹具](../qa/uat/suites/interactive-read-resilience/fixtures.md#现场字节采样对照)核验 | 判断目录遍历、文件读取和 YAML 解析对 `catalog_resolve` 的贡献。同夹具测独立 `lucy_catalog` |
| M1 交叉对照 | 同一正式 `lucy_admin` 身份、相同 Source 总数、24 份 Manifest、Overlay、Skill、查询校验值和资源 | 四档对照 2／8 个可扫描连接与小／大 Manifest。固定文件体积档看连接布局，固定布局看文件体积 | 估计各自影响和共同放大。参照 [UAT 四档夹具](../qa/uat/suites/interactive-read-resilience/fixtures.md#多连接与大-manifest-交叉对照) |
| M2 | 目录、账号权限、资源和并发；字节对照固定已解析和可见 Skill 数 | 每轮只改变 Skill 正文字节数或候选文件数量之一，分别计扫描读取、解析、授权过滤和上下文快照 | 判断 `skills_load` 的耗时来源，校验可见 Skill 集合 |
| M3 | M1／M2 选定的同一夹具、资源、身份轮转 | 新会话并发或真实配置变更，每轮择一 | 判断等待叠加、客户端截止与迟到完成。先发 1 次，再做 2 个重叠会话，20 并发留到握手合同采样 |
| W1 | G1、实际 Agent 页、独立治理会话和相同观察动作 | 预热、首次构建／失效首读、真实备注保存、受控长备注提交、实际撤权或核验失败 | 以首响应及本轮名册为准，核对写中旧视图与保存确认后的新版本。完整名册、详情及统计单独取证 |
| C1 | 相同目录形状、角色、会话数、到达节奏、资源与入口 | 同窗比较无写入、纯备注保存、授权保存及无关对象编辑。正式 `lucy_admin` 与两个受限角色共至少 50 个 Agent，分别跑 50 路握手和 50 路真实问数，同一 WebUI 账号经独立会话维护与观察名册 | 按 [UAT-READ-RES-07](../qa/uat/suites/interactive-read-resilience/cases.md#uat-read-res-07--多角色问数与同账号并发维护必做同窗运维场景) 核对两批次各自的在途峰值、查询与写入的交叠、查询结果、名册首响应、保存冲突与恢复。按角色和窗口分别记录。 |

## 首轮执行顺序

1. **测程和改前证据。** 实现确定性采集及判定，跑 R0 和已知正常／错误控制。校准请求关联、前台计时、协议和独立 SQL 核对值，验证详细观测的开关开销。正式角色补做 A 侧回执。原跑次继续作诊断反例。
2. **名册已提交视图。** 先锁定事务分类、读中版本和失效规则，测持久化、运行态确认、审计终态和回执。再迁出可由捕获事实计算的展示。先跑长提交、撤权和 RACS 局部事务控制，再以自然前台负载复验。
3. **MCP 最小改动。** 先测拆出描述增强对正常指引一致性和热并发的影响，再加入已预载基础指引、1 秒动态截止和 20 个真实工作容量。分别校验正常、超线、断开、外部变更及纯 MCP 发现和问数。若原握手预算或完整旅程未过，保留失败并回到设计复核。
4. **同候选复验。** 同一最终候选完成 G1 的 R0／01–06／08 与 G2 的 07。08 将现场多页面异常落实为可控无写冷读和局部共享故障用例。原 P1-66／FUP-03 重档诊断、现场规模对照及 P1-13／R-CAV 组合另行登记。

## 并行任务批次

协调 Agent 从同一冻结提交为每个任务分配独立工作区及写入范围。并行 Agent 先在共同基线上跑自己负责的反例，再实现与回归。交接提交或补丁、文件清单、测试命令／退出码、首失败原始证据和待合流项。阶段内新增共享文件由协调 Agent 指定唯一负责人。隔离 Docker 的负载窗口及真实前台焦点由测试负责人串行分配，避免并跑污染时延。

| 批次 | 可并行任务 | 启动条件 | 合流条件 |
|---|---|---|---|
| **A · P1-75 修复** | A1 名册；A2 MCP；A3 测程 | P1-75 获开发授权，共同基线和测程字段已冻结。A1／A2 可在 A3 开发测程的同时在各自工作区实现。 | A1–A3 本地测试完成后由协调 Agent 合流。A3 在共同改前基线和合流候选上执行 G1／G2，完成 SC-01–08。含四页回归在内的必做项全部通过后封存候选 A 的提交、镜像摘要、夹具及可复算回执。 |
| **B · P1-77 质量优化** | B1 双指引；B2 宿主判定与对照测程 | 候选 A 已封存，且 P1-77 获开发授权。 | 按 [P1-77 实施 Plan](lucy-20261123-default-business-context-adoption-plan.md#并行任务与合流) 在独立候选 B 合流，跑 PERF 和 MIX。任一必做失败或缺证，默认继续使用 A。 |

### A1 名册事务和已提交视图

- **写入范围** · `webui/server/admin/agents.ts`、`webui/server/display-snapshot.ts`、`webui/server/__tests__/admin-agents.test.ts`、`webui/server/__tests__/display-snapshot.test.ts`、`webui/server/__tests__/agent-roster-summary.test.ts`。其他写屏障文件若经取证确需改动，协调 Agent 先登记归属。
- **执行** · 用纯备注、混合 PATCH、真正撤权建立改前反例。实现基于发布资格、真实语义差异和现授权输入的可读视图；在保存确认前原子发布已核验视图；从已捕获事实生成回执和可移出屏障的投影。
- **测试** · 从仓库根目录执行 `npm --prefix webui test -- server/__tests__/admin-agents.test.ts server/__tests__/display-snapshot.test.ts server/__tests__/agent-roster-summary.test.ts`。覆盖写中旧备注、写后首读新备注、不可核验时拒绝和限时恢复、并发冲突、持久化／运行态确认／审计失败、幂等和统计一致性。合流后执行前台用例 04／05，页面与 API 分开计时。

### A2 MCP 指引与目录

- **写入范围** · `webui/server/proxy/mcp-proxy.ts`、`webui/server/proxy/acl.ts`、`webui/server/proxy/source-descriptions.ts`、`webui/server/proxy/audit-trace-span.ts`、`webui/config/data-qa-instructions.md` 及下列代理、索引单测。公共指引以配置文档中的静态核心规则为事实源，完整和预载基础指引均使用。候选 A 保留原业务问询引导、角色范围、问询上报和预算逃生，P1-77 的新规则在 B1 加入。
- **执行** · 先对照并分段计时，拆出握手不消费的目录描述增强，独立 `lucy_catalog` 保留原输出。再实现从 ingress 起算的 1 秒截止、20 个工作容量、授权／会话复核和一次回包；各降级分支用预载文本。
- **测试** · `npm --prefix webui test -- server/__tests__/mcp-proxy-ux-resilience.test.ts server/__tests__/mcp-proxy-instructions.test.ts server/__tests__/mcp-proxy-data-qa-instructions.test.ts server/__tests__/mcp-proxy-upstream-failure.test.ts server/__tests__/mcp-proxy-upstream-session.test.ts server/__tests__/mcp-proxy-trace-span.test.ts server/__tests__/source-descriptions-index-cache.test.ts`。断言完整指引内容、独立目录等价、时间截止、容量满、迟到／断开、真实底层结束才释放、撤权不出旧指引及本地协议回退。合流后用 01–03 检查实际 MCP 响应与真实宿主自然问询。

### A3 隔离测程与合流验收

- **写入范围** · `scripts/uat/interactive-read-resilience.mjs`、`scripts/uat/interactive-read-resilience.test.mjs`（计划新增）；复用 P1-37 的 MCP 测程、P1-66 前台采集和核心可用性探针。只由协调 Agent 在核实判定后登记测试台。
- **执行** · 封存 R0 输入和回执字段，关联浏览器、反代、MCP、实际写屏障和探针。08 增加按页面、端点、作用域、尝试号和故障解除事件关联的回执。先做受控回执试验，再在改前与合流候选上串行占用 Docker 和前台窗口。
- **测试** · `node --test scripts/uat/interactive-read-resilience.test.mjs`。保留既有负控，新增 08 的旧页标题／假空态、浏览器先取消后收到 200、健康 200 同窗业务 503、故障外依赖异常及恢复超线负控，缺作用域或故障交叠记缺证。正式跑同一候选 R0／01–08。08 如失败，根据受影响端点和实际耗时交回协调 Agent，按归属复审修复后复验。

## 验收步骤

1. **校准。** 用 B0 确认实际前台摘要 URL 和浏览器时钟，走纯 MCP 到正确查询。每次验收前封存 [固定分母与计时矩阵](../qa/uat/suites/interactive-read-resilience/cases.md#冻结的分母与计时)、主动故障注入范围与原始回执格式。
2. **握手和首次问数。** 按 02／03 分开微基准、正式变更、全链及受控组。服务端阶段、反代、响应头／体及客户端期限分别关联。同一请求迟到的 200 与客户端失败各保留。M1、M2、M3 用于单变量归因，独立 `lucy_catalog` 有自己的计时和完整结果。
3. **名册和写入事务。** 按 04／05 取真实网络、页面 `primaryReady`、分离的统计就绪、实际屏障／核验事件和写入回执。前台 C 专测写中，A／B 测保存后刷新及草稿恢复。真实失败与核验延迟用具名控制组执行，清除故障后同实例继续合法读取或保存。
4. **探针与同窗。** 按 06／07 的固定窗口与到达率运行，并报反代在途、Lucy 入场以及数据源实际执行。保留漏发、首失败、迟到、授权窗允许的精确拒绝和恢复。R-CAV 长时组合按[既有入口](../qa/uat/suites/core-availability/retest.md#执行)另行评审。
5. **独立复算。** 从 A/B 脱敏逐次回执核对分母守恒、首失败、实际交叠、身份和查询结果，对照 UAT 选择器登记。只有单变量和阶段证据支持时才提高归因强度；保留未命中与缺证，产品侧判定使用该合同受测范围。
6. **四页回归。** 依 [08](../qa/uat/suites/interactive-read-resilience/cases.md#uat-read-res-08) 在 G1 同候选逐页轮换前台。验无写冷读、按作用域核验变慢和 Sources 构建等待变慢，保留每个区域实际状态、浏览器中止、恢复和同窗 MCP 回执。

现成的 [握手压测脚本](../../scripts/uat/mcp-ux-resilience-wide.mjs)和 [Agent 页前台探针](../../scripts/uat/agent-roster-summary-browser.mjs)可以复用，但都需先对接独立实验实例。旧 [宽目录沙箱脚本](../../scripts/uat/uat-wide-sandbox.mjs)会按名称寻找共享 `demo-db`，并使用固定库名。旧前台探针绑定 P1-66 的端口、私密登录文件和历史输出。交接前先核对实际参数，把必要的仿真和采集衔接留在本次 `inbox/` 目录。握手旧脚本只汇总 `initialize` 耗时，单次截止、原始失败以及握手到查询的链路由本次确定性采集补齐。无法提供这些回执时按 UAT 约定登记相应 `BLOCKED`。

## 浏览器验证

不适用：交互合同元素清单。Agent 名册性能验证须用真实前台桌面浏览器，记录导航到名册就绪，并分列页面、摘要 API、完整名册对照及探针耗时。

采样时独立核对 Chrome 的前台可见和焦点。用 [WebUI 性能复测指南](../qa/uat/webui-performance-retest.md)核对本轮请求、代次和期望行的渲染结果。可由宿主机有头 Chrome 采集或由其他具备真实前台控制的执行者交接结果。CLI 文本输出或 HTTP 采样仅能填写 API 证据。

## CLI 执行分工

2026-11-23 本机已通过版本查询确认 `kscc` **1.3.8**、`kimi` **2.7.2**。Docker 与 Compose 命令及 Chrome 安装也已确认。模型服务登录、授权后的 Docker daemon 访问、实验端口、前台焦点和本轮夹具仍需执行时预检。

| 执行者 | 链路证据与推荐分工 | 交接前置 |
|---|---|---|
| **KSCC CLI，首选主执行** | [已有 KSCC 正式 Docker 跑次](../qa/uat/suites/core-availability/runs/2026-11-22-kscc-cav-formal.md#证据复算)使用 `role-entry.sh` 派发与状态检查，Codex 能从原始数据独立重算。复用这一交接方式运行镜像核对、夹具准备、MCP 确定性测程、探针、归档与定向清理 | 按 [KSCC 调用参考](../agent-pipeline.md#kscc-调用参考)预检登录。由主控事先冻结本轮入口、超时、阶段及输出目录。CLI 只获本轮入口所需的工具和权限。宿主 Chrome 前台采集作独立交接项 |
| **Kimi Code CLI，真实宿主客户端对照** | [既有兼容跑次](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-p153-certify-candidate.md)使用 2.7.2 完成真实 Agent 旅程。推荐同一 Docker 实例用 Kimi 新进程执行一条合法查询，核对 `stream-json`、结果核对值和服务端握手时序。可辅助做脱敏证据复核 | 按 [仓库 Kimi 适配器](../../scripts/e2e/adapters/kimi-code.mjs)使用任务专用目录与本地实验 MCP。凭据用适配器的环境变量引用。初轮单并发，模型调用时延独立记账。若用 Kimi 替代 KSCC 主跑，先证明其在指定环境能执行同一冻结入口、接管状态并取得 Docker 回执 |
| **主控或独立复核者** | 冻结夹具和命令，控制真实前台浏览器，复算逐次结果。检查名称、权限、实际端口、镜像、清理证据以及是否使用了真实产品入口 | 两个 CLI 串行复用同一已验证的实验现场。复核只读取脱敏产物。模型最终答复用于说明，判定由原始回执、可重算口径和实际查询结果支持 |

授权后，固定单次 `inbox/p1-75-docker-<时间>` 作为交接目录，放入短任务单、冻结命令、输出路径和清理清单。可按既有 KSCC 跑次组织入口为 `start`、`status` 和 `closeout`，启动回执需含时间、实际监控对象和工件目录，收尾回执需含真实退出码和清理结果。既有全局规模跑次已留下入口与原始回执。已有机器测程由入口顺序调用，空闲或断线时优先读取现有状态，避免另起重叠跑次。只有当前登记的隔离实验资源进入清理范围。

## 完成定义

定稿完成后以 Spec 头部状态作为文档现值。后续功能验收须用同一候选完成 R0／01–08 的全部必做断言，取得实现审查与真实前台、纯 MCP、写入事务、探针跑次证据。按 [跑次约定](../qa/uat/suites/interactive-read-resilience/runs/README.md) 留存镜像、夹具、逐次事件、实际交叠、阶段和证据哈希，INDEX 按实际结果登记。改前分别报告「自然复现」「仅控制组复现」「未复现」「证据不足」。必做项缺证或失败，功能合同仍待收口。

## 风险

- 客户端、响应写出和审计落盘的时间可能不同。按请求关联和阶段起止重算，保留原始失败。
- 合成夹具可能低估多目录 I/O、权限宽度或后台工作。对照已知现场特征，记录未命中的条件。
- 局部检查和长时组合各自登记，保留历史失败记录和现行预算。
- 浏览器焦点丢失、测程挂起、模型登录失败或缺少逐次回执时，保存已有证据和退出原因。用具名的下一轮继续并保留失败轮次。
