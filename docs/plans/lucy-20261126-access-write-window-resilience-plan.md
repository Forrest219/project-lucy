# 大目录访问配置写窗口韧性 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 分阶段实施计划 / **v1.0** |
| 日期 / 功能编号 | 2026-11-26／**REQ-0117**（P1，产品线 `0.35.0` 候选，待委托人挑入范围单） |
| 状态 | S4｜v1.0。终稿已确权（委托人 2026-11-26）；开发授权已获得（2026-11-26，含 acl.ts／permission-display.ts／agents.ts 有限扩权）；**实现已落地，UAT 跑次中断于前台浏览器阶段（AWW-08），待验收**；测试台 `UAT-SUITE-ACCESS-WRITE-WINDOW`；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | 终稿已确权（2026-11-26）；开发授权已获得（2026-11-26）；委托人 2026-11-26 两次追加有限扩权（acl.ts 增量重编译；permission-display.ts／agents.ts 展示重建缩面） |
| 验收 | Spec `SC-01`–`SC-10`；计划新建测试台套件 `UAT-SUITE-ACCESS-WRITE-WINDOW` |
| 关联 | [Spec](../specs/lucy-20261126-access-write-window-resilience-spec.md) · [REQ-0117 正文](../backlog/entries/REQ-0117-create-2000-table-roles-webui-503.md) · [错题本](../lessons/2026-11-26-large-catalog-role-write-blocks-display-reads.md) |

## 目标

在大目录（≥2000 启用表）规模下，使治理方经 WebUI/API 创建或编辑角色、Agent 的保存主路径保持可用：先压短写窗时长并守住 Spec 174/195 的 A/B 类展示读语义边界，再把发布窗口对角色/Agent 写（`role_policy_save`/`agent_save`）的重叠写从「忙即 503」改为有界等待（其余 7 类语义写入口维持忙即拒绝；含并发等待上限与同对象 409 冲突语义保留）；单实例边界、权限判定语义与 KTX 依赖边界均不变。

## 开工前置

1. **Spec 终稿确权已于 2026-11-26 取得**（委托人明示「授权你修复，并定稿」；OQ-1～OQ-3 裁定见 Spec「OQ 裁定记录」）；**开发授权尚未取得**，修改运行代码前须由委托人另发开发授权。
2. Task 0（只读夹具、profile 与超时链核实，不改运行代码）：**须先取得委托人对 Task 0 只读测试基建先行的明示确认（参照 P1-78 测试基建授权口径）**，或随整条 Spec 终稿确权＋开发授权一并放行；**方向 1（写窗时长治理）排在方向 2/3 之前**，以 profile 证据决定后续顺序。
3. 核对 Spec「与既有 Spec 的关系」：若 OQ-1 裁定为 B3 或 A，须先在 Spec 登记对 Spec 174 §6 / Spec 195 §6 的修订条款；B1/B2 不修订服务端展示读合同。
4. 核对 `webui/src/lib/displayQueryOptions.ts`（`failureCount < 1`、`DISPLAY_READ_RETRY_BUDGET_MS`、`DISPLAY_READ_JOURNEY_MS`）、`apiClient.ts`（写挂起/跨写守卫）与 `rolesAgentAccessWrite.ts`（保存编排），确认前端防重与后端有界等待的分工落点。
5. 确认已入常青需求池（`REQ-0117`）。

## 任务分解

### Task 0：大目录夹具、基线取证、写路径 profile 与超时链核实（不改运行代码）

- **目标文件**：`evals/` 或 `scripts/` 下新增夹具脚本（造 2000 物理表 → schema manifest 批量写入 → 启用表批量启用 → 创建 2000 表角色）与测量脚本（写窗总时长、**`pending` 子窗口时长**、并发轮询与客户端恢复路径对比、`/api/health` 的 `displayBusy` 与事件循环阻塞快照）。
- **端到端超时链核实**：实测并记录本机 compose / K8s Ingress / Fastify（`requestTimeout` / `connectionTimeout`）/ 浏览器 `fetch` 的真实超时值，作为 `OQ-2` 裁定分母。
- 以修复前基线复现 `SC-01` 两个症状并存档证据（红基准），并输出 catalog 重载、策略运行时重载、展示快照重建各占写窗时长的比例。

### Task 1：写窗时长治理（方向 1，先行）

- **目标文件**：视 Task 0 profile 结论定（候选：`webui/server/catalog-reload.ts`、`webui/server/display-snapshot.ts`、`webui/server/admin/roles.ts`）。
- **硬约束**：禁止通过提前释放或收窄 `policy ack` 写屏障覆盖范围来凑指标；只按 profile 证据压短屏障内工作（按变更作用域缩小重载面、分片让出事件循环等），接入 `REQ-030-099`／`REQ-030-034` 方向的性能基线面。
- 产出写窗总时长与 `pending` 子窗口达标结论，用于最终敲定 OQ-1（B1/B2/B3/A）。

### Task 2：发布窗口有界等待（方向 2）

- **目标文件**：`webui/server/publish-coordinator.ts`、`webui/server/admin/access-roles-agent-concurrent-edit.ts` 及对应单测。
- 实现伪代码语义：仅对 `kind ∈ {"role_policy_save", "agent_save"}` 启用有界等待与进程内并发等待上限 `maxWaiters`（其余 7 类语义入口与 `acquirePublishCoordinatorLock` 直调方保持现状不排队），底层原语保持抛 `PublishCoordinatorBusyError`（携带 `retryAfterSeconds`），路由层统一映射 503。
- 同对象/同版本前置冲突保留既有 409 语义（`SC-04`），前端经 `rolesAgentAccessWrite.ts` 既有「对象已被修改」映射，不静默覆盖。

### Task 3：读恢复可达性与前端防重（方向 3，按 OQ-1 裁定实施）

- **目标文件**：`webui/src/lib/displayQueryOptions.ts`、`webui/src/lib/apiClient.ts`（或按 OQ-1=B3/A 增改 `webui/server/display-snapshot.ts`）、`webui/src/pages/admin/RoleList.tsx`、`RoleDetail.tsx`（提交态防重）。
- 按 OQ-1 裁定（B1/B2/B3/A）落地读侧恢复策略，并用真实客户端恢复路径（含 `(1 + maxWaiters)×` 重叠写窗口）验证 `SC-05`/`SC-06`。
- 单用户重复点击由保存按钮提交态拦截（`E5`/`E10`/`E17`），后端有界等待只面向多标签/多管理员重叠。

### Task 4：浏览器验证与测试台登记

- 新建 `docs/qa/uat/suites/access-write-window/`（套件合同＋run 模板）并登记进 `docs/qa/uat/INDEX.md`。
- 在隔离 demo 栈执行前台浏览器验证（元素清单 `E1`–`E18`，即时计时，与 API 耗时分列）与纯 MCP 回归核对（`SC-09`）。

## 浏览器验证

- 路由：/admin/roles、/admin/roles/:roleId、/admin/agents
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9、E10、E11、E12、E13、E14、E15、E16、E17、E18
- 证据：docs/reviews/2026-11-26-req0117-browser-evidence.md

## 验收

- Spec `SC-01`–`SC-10` 全部有自动化测试、大目录夹具跑次与前台浏览器证据；浏览器验证须真实前台执行并记录即时计时（进入保存到列表/详情呈现新状态的前端耗时），并与 API 写窗耗时分列；计划现状 S4：Task 0–3 证据与单测已落地，Task 4 前台浏览器两阶段待续跑。
- `npm run lint:spec-docs`、`npm run lint:terminology`、`npm run typecheck` 全绿；新增命令（若夹具引入）按 [测试门禁文档](../governance/test-layers-and-release-gates.md) 登记。

## 完成定义

Spec 终稿确权（OQ-1～OQ-3 裁定）→ 开发授权 → Task 0 夹具与 profile 红基准 → Task 1 写窗时长治理（达标结论回填 OQ-1）→ Task 2 有界等待 → Task 3 读恢复预算与防重 → Task 4 前台浏览器验证与 UAT 套件执行（`PASS`／`PASS WITH GAP`）→ 委托人验收与功能合同收口。

## 风险

| 风险 | 缓解 |
|---|---|
| 有界等待拉长请求占用：等待上限过长使并发写请求堆积，或上限＋实测写窗超过网关/浏览器超时，把可识别的 `PUBLISH_COORDINATOR_BUSY` 恶化成无提示 504/断连 | 等待上限 10–15s 且可配置（OQ-2 已裁定，Task 0 超时链核实后定值）；`maxWaiters` 已裁定 `=1`，超出立即 503＋`Retry-After`；按 OQ-2 裁定核对「上限＋实测写窗 ≤ Task 0 核实的端到端超时分母」 |
| 等待后版本冲突被误处理成覆盖 | 取得锁后仍走既有 fresh 读＋`baseObjectVersion`/`previewToken` 校验；同对象冲突必须落到既有 409 语义（`SC-04`），前端映射「对象已被修改」且编辑内容不丢失 |
| OQ-1 若最终选 A 引入「刚创建成功却在列表看不到」的反向错觉，绕过客户端跨写守卫 | A 仅在写窗压不到安全阈值时经补裁启用；stale 视图须带明确滞后标注＋写结算后强制失效重读（`SC-06`）；加载/滞后/错误/冲突文案互斥（交互合同状态维度） |
| 写窗时长优化动到 catalog/策略重载，波及发布与权限生效时序 | 只按 Task 0 profile 证据动手；每次改动跑既有发布/权限回归与 `SC-06`/`SC-07`；不做无据重构 |
| 夹具造 2000 表拖慢本机 demo、污染共享环境 | 夹具自包含（独立 schema＋可回滚清理），在隔离 compose 栈执行；不写入共享 demo 的常驻状态 |
