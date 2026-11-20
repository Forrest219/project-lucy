# 运维步骤账 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / v0.1-draft |
| 日期 | 2026-11-20 |
| 功能编号 | P1-68／REQ-030-089 |
| 状态 | v0.1-draft。委托人2026-11-20授权登记与 Spec／Plan／UAT 设计；终稿未确权；开发未授权；测试台 NOT RUN；不入核心分母；≠ 功能收口；≠ 可上线。 |
| 授权边界 | 只写、评审并优化设计与登记。不改运行代码，不执行 UAT，不重建镜像，不改客户现场。开发与跑次须另行授权。 |
| 验收 | Spec SC-01–SC-17 全部通过，且测试台 `UAT-SUITE-OPS-STEP` 必做项 PASS。本 Plan 落盘不等于上述验收已经发生。 |
| 关联 | [Spec](../specs/lucy-20261120-ops-step-journal-spec.md) · [UAT](../qa/uat/suites/ops-step/suite.md) |

## 目标

让 Lucy 运维和 IT 运维用同一个操作号指出冻结操作停在哪一个运维步骤。当前进程先登记 `enter`，标准输出只做有界、非阻塞的一次完整写尝试；写账失败不失败原操作。准备表结构失败在原句之外提供同一操作号。

## 开工前置

- 本 Spec 终稿确权。
- 委托人另发开发授权之后才能改 `webui/src/`、`webui/server/` 与信息架构文档。
- 跑 UAT 前另发执行授权。本机 demo Docker 与前台浏览器可用。
- 设计值（1 秒、512 字节、2000 行／1 小时、8 MiB、当前加一份滚动文件）在首跑前保持为设计值。
- 首版 `runtime_reload` 只接入 `lucy_ops_connection_tables` preview→commit 的提交执行链；不得把独立 `/api/admin/mcp-runtime/reload` 或其他保存路径当作同一验收对象。

## 实施顺序

以下顺序供获授权后使用。当前全部不执行。

1. **行格式与单写者内核**
   - 新增 `webui/server/runtime/ops-step-journal.ts`：紧凑 JSON、冻结键顺序、512 字节含换行检查、`op_id` 生成、原因码映射和分通道计数。
   - 当前进程内存读模型先登记；标准输出用非阻塞描述符一次写，不等待、不重试；错误和短写只计标准输出丢行。
   - 父进程文件队列逐条 `await` 追加和滚动，队列内部捕获每条失败；不得让异步拒绝越过队列，也不得让文件写阻塞业务本体。
   - 新增 `webui/server/__tests__/ops-step-journal.test.ts`：511／512／513 字节、合法 JSON、残行、写错误、短写、无重试、FIFO、文件失败及格式化失败。

2. **诊断父子进程接入**
   - 在 `webui/server/runtime/diagnostic-collector.ts` 由父进程生成 `op_id`，通过 `DiagnosticCollectorInput` 传入子进程。
   - `diagnostic-collector-worker.ts` 只发结构化 IPC 步骤事件；保持 `stdio` 标准输出隔离，不由子进程直接写账。
   - 在 `webui/server/admin/mcp-runtime.ts` 的五支实际读取接入步骤事件，保留 `Promise.all` 并行；文件队列不得包住读取本体。
   - 子进程异常退出或 abort 时，父进程对所有未终结分支补 `fail=aborted`；不得重复补已有 `leave`／`fail` 的分支。
   - 新增 `webui/server/__tests__/diagnostic-collector-ops-step.test.ts`：操作号传播、两支并行、事件顺序、abort 归集和单写者。

3. **重载、读字段与同步段**
   - 只在 `webui/server/ops/ops-ktx-batch.ts` 的 `executeGroup` 提交执行链接入 `write_config`、`catalog_reload`、`policy_commit`；前一步成功才进入下一步。
   - 在 `webui/server/index.ts` 的 `POST /api/connections/:connId/schema-structure` 为每次请求生成一个操作号，在 `webui/server/schema-structure.ts` 接入 `list_tables`、`read_columns` 和已登记同步段。
   - 同步段沿用宿主 `op`／`op_id`，只使用 Spec 登记的 `sync_yaml_parse`、`sync_row_parse`、`sync_policy_compile`；独立挡板才使用 `op=sync_section`。
   - 错误响应 `detail.opsStepId` 保持与原错误码、原句并存；批量部分失败的 HTTP 200 在 `data.opsStepId` 返回本次请求操作号。`webui/src/lib/prepareSchemaStructure.ts` 按请求边界保留单批及批量失败的操作号，在既有错误详情中展示。
   - 新增 `webui/server/__tests__/schema-structure-ops-step.test.ts` 和 `webui/src/__tests__/prepare-schema-ops-step.test.ts`：精确原因码映射、无 SQL／表名／哨兵、批量操作号不混用及原句兼容。

4. **管理读模型与只读页面**
   - 新增 `webui/server/admin/ops-steps.ts`：启动时读取历史尾部，当前行只读内存；历史孤立 `enter` 显示“上次进程未完成”，不进入当前进行中。
   - 实现 2000 行／1 小时截断、分通道写健康和未登录既有结果；不得从文件把当前行重复合并一次。
   - 新增 `webui/src/pages/admin/OpsSteps.tsx`，在 `webui/src/app/App.tsx` 注册 `/admin/ops-steps`，沿用既有管理导航。
   - 同次更新 `webui/docs/06-navigation-ia.md`：将「运维步骤」登记在「运行状态」组，放在「使用概况」之后，并补面包屑「运行状态 / 运维步骤」；既有项相对顺序不变。
   - 新增 `webui/server/__tests__/ops-steps-read-model.test.ts` 与 `webui/src/__tests__/ops-steps-page.test.tsx`：当前／历史分区、重启孤立 enter、三类丢行、截断和 E1–E9 状态。

5. **默认关闭的测试挡板**
   - 仅当 `LUCY_OPS_STEP_UAT=1` 注册 `/api/admin/ops-step-uat/*`；关闭时路由必须为 404。
   - 挡板提供 fixtures 声明的真实诊断触发、同步段托住、一次性标准输出错误／短写、管理读延迟／失败、后台诊断暂停和步骤账重置。
   - 所有挡板仍调用真实读取、真实写者和真实页面；不得返回预制步骤行代替业务路径。
   - 新增 `webui/server/__tests__/ops-step-uat-guard.test.ts`：关闭态 404、开启态鉴权、一次性故障恢复及重置不影响业务配置和审计账。

6. **自动回归与真实跑次**
   - 先跑上述定向测试，再跑 `npm --prefix webui run typecheck` 和 `npm --prefix webui test`；另跑根目录 `npm run lint:terminology`、`npm run lint:ia-boundary`、`npm run lint:spec-docs`。
   - 用真实进程自动化覆盖 8 MiB 滚动、两份文件上限、2000 行与 1 小时边界、重启历史以及写故障，不得只靠缩小设计值的替身测试宣称能力通过。
   - 按测试台 R0、01–08 全真取证。浏览器证据写入 `docs/reviews/` 或 `docs/ui-ux-feedback/`，并回填本文件「浏览器验证」的证据路径。
   - `/admin/ops-steps` 记录导航到列表可见与列表 API 耗时；准备表结构另记录导航到错误详情可见与对应读字段 API 耗时，二者不得混用。

## 不做

- 不改探针的通过／失败条件，不缩短或放宽现有超时。
- 不改准备表结构的既有失败句，不改表级歧义的裁决。
- 不把运维步骤写入调用流水、阶段记录或审计库。
- 不接入独立 `/api/admin/mcp-runtime/reload` 和其他配置保存链路，不用它们冒充 SC-05。
- 不接外部日志采集，不做堆栈采样，不新增事件循环阈值触发行。
- 不支持多实例、多副本共享写者或跨副本文件锁。

## 风险

- 非阻塞标准输出可能因背压丢行；这是显式降级，必须计 `stdoutDroppedCount`，不得为追求完整而重试并占住事件循环。
- 非完整写可能留下残行；历史读取必须跳过残行，不能把后续 JSON 拼接成假有效行。
- 诊断五支改为各自打点后仍须保持并行。把读取本体放进文件队列会串行化采集，并掩盖同时卡住的另一支。
- 父子进程若都写文件，会产生滚动竞争和重复行；只能由父进程统一写账。
- 文件副本放在内容根。磁盘满时只计文件丢行，标准输出和内存读模型继续。
- 历史文件里的孤立 `enter` 若被当成当前进行中，会在重启后制造假卡死；必须按进程代次分区。
- 挡板若在环境变量关闭时仍可调用，会变成现场可卡住或重置步骤账的入口；R0 和负向回归都必须覆盖关闭态。
- 运维操作自身可能正常写调用流水，且既有阶段可能与步骤账英文名相同。SC-12 只检查步骤账 `op_id` 和明确的生产者标识未混入，不能要求整次操作零审计或仅凭同名阶段判失败。

## 验收

- 获授权并实施后：SC-01–SC-17 均有自动化或测试台证据，证据等级逐条标明。
- SC-11 的运维步骤页浏览器时间与接口耗时分列；SC-17 的准备表结构错误详情也必须有真实前台浏览器证据和分列计时。
- 未获执行授权时，测试台保持 NOT RUN。不得用阅读本 Plan、单元测试或静态门禁代替 UAT 跑次。

## 完成定义

- 必做 UAT 为 PASS，Spec 按仓库规则另行收口。
- 收口不表示可上线，也不表示 2026-11-20 那类卡死已经被修复。本条只保证卡住时能指出步骤名，且写账降级有诚实计数。

## 浏览器验证

- 路由：新路由：/admin/ops-steps
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9
- 证据：未执行
