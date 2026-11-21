# 运维步骤账 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / v1.0 |
| 日期 | 2026-11-20 |
| 功能编号 | P1-68／REQ-030-089 |
| 状态 | v1.0。终稿已确权（委托人2026-11-20明示“授权你修正，并定稿”）；开发授权已获得（委托人2026-11-20明示“授权你拆分多 agent 执行的任务，完成落地和 code review，暂不进行 docker 重建”）；实现已在工作树落地并完成独立代码评审；测试台 NOT RUN（未执行 Docker 重建、真实前台浏览器与 UAT，SC-01–SC-18 尚未取证）；不入核心分母；≠ 功能收口；≠ 可上线。 |
| 授权边界 | 只写、评审、优化并定稿设计与登记。不改运行代码，不执行 UAT，不重建镜像，不改客户现场。开发与跑次须另行授权。 |
| 验收 | Spec SC-01–SC-18 全部通过，且测试台 `UAT-SUITE-OPS-STEP` 必做项 PASS。本 Plan 落盘不等于上述验收已经发生。 |
| 关联 | [Spec](../specs/lucy-20261120-ops-step-journal-spec.md) · [UAT](../qa/uat/suites/ops-step/suite.md) |

## 目标

让 Lucy 运维和 IT 运维用同一个操作号指出冻结操作停在哪一个运维步骤。当前进程先登记 `enter`，标准输出只做有界、非阻塞的一次完整写尝试；写账失败不失败原操作。准备表结构失败在原句之外提供同一操作号。

## 开工前置

- 本 Spec 终稿确权。
- 委托人另发开发授权之后才能改 `webui/src/`、`webui/server/` 与信息架构文档。
- 跑 UAT 前另发执行授权。本机 demo Docker 与前台浏览器可用。
- 设计值（1 秒探针、100 ms 写尝试及 enter 确认、512 字节行、2000 行／1 小时历史、1 MiB 文件队列、8 MiB 文件、当前加一份滚动文件）在首跑前保持为设计值。
- `runtime_reload` 只接入 `lucy_ops_connection_tables` preview→commit 的提交执行链；`enabled_tables_save` 单独接入 `PUT /api/connections/:connId/enabled-tables` 且 `dryRun=false`。两者不得互相冒充，也不得用独立 `/api/admin/mcp-runtime/reload` 或其他未列入路径代替验收。

## 实施顺序

以下顺序供获授权后使用。当前全部不执行。

1. **行格式与单写者内核**
   - 新增 `webui/server/runtime/ops-step-journal.ts`：紧凑 JSON、冻结键顺序、512 字节含换行检查、`op_id` 生成、原因码映射和分通道计数。
   - 当前进程内存读模型先登记；标准输出只做一次有界写尝试，不等待、不重试；错误和短写只计标准输出丢行。短写后当前进程抑制后续步骤行写尝试并逐条计丢行，防止残行拼接；普通日志不受抑制，重启才恢复。
   - 不得对 fd 1 或其 duplicate 设置 `O_NONBLOCK`，不得改变共享 open file description 的阻塞标志：Linux 只用 `/proc/self/fd/1` 重新打开管道取得独立描述符，`/dev/fd` 语义为 dup 的平台（macOS）改走进程自身 stdout，普通文件或终端 stdout 也走 fd 1 以保留追加语义。先在 Linux Docker 验证独立写机制；若只能修改共享标志才能实现，停止该方案并重审 Spec D4。
   - 使用实际写机制连接真实 Linux 管道，由独立监督进程填满且停止排水；证明至多一次写调用且在 100 ms 内返回。不能仅靠注入 error／short 证明非阻塞。比较的是 WebUI 服务实际 PID 的 fd 1 及 duplicate，不是 `docker exec` 检查命令自身的 fd。
   - 父进程文件队列逐条 `await` 追加和滚动，连同正在写的一行最多 1 MiB；满时丢新行并精确计 `fileDroppedCount`，显示 `fileWriteReason=queue_full`，不得转移到无界缓冲。追加前按磁盘校准当前文件大小；当前文件被外部删除或轮转后先重建再写，不允许一次瞬时轮转失败永久停摆。追加失败显示 `io_error`；真实追加恢复后才能恢复 `ok`。
   - 启动写者在历史读取前检查非空当前文件末字节；若非换行，先把旧当前文件轮转为 `.1`，置 `historyResidual=true`，再创建新当前文件。禁止直接接写；残行不伪计当前进程文件丢行，隔离失败则停止该文件后续写尝试。
   - 新增 `webui/server/__tests__/ops-step-journal.test.ts`：511／512／513 字节、合法 JSON、文件残行隔离后新行独立可读、stdout 短写后下一行抑制并计数、写错误、无重试、FIFO、文件真实追加失败、文件消费者阻塞与队列满、格式化失败、fd 标志不变及普通 `console` 对照。

2. **诊断父子进程接入**
   - 在 `webui/server/runtime/diagnostic-collector.ts` 由父进程生成 `op_id`，通过 `DiagnosticCollectorInput` 传入子进程。
   - `diagnostic-collector-worker.ts` 只发结构化 IPC 步骤事件；保持 `stdio` 标准输出隔离，不由子进程直接写账。
   - 每支发送 `enter` 后等待匹配 `op_id+step` 的父进程确认，再执行读取。父进程在内存登记和标准输出写尝试完成后确认，写失败也确认；不等待文件落盘。`leave`／`fail` 不要求确认。
   - 在 `webui/server/admin/mcp-runtime.ts` 的五支实际读取接入步骤事件，保留既有 `Promise.all` 独立支并行；只有整组成功后才进入 `read_reload_state` 并传该批 digest，不得仅等 digest 或改成无条件并行。各独立支并行等待自己的确认，文件队列不得包住读取本体。
   - IPC 断开沿用既有诊断 abort／deadline；子进程异常退出或 abort 时，父进程对所有未终结分支补 `fail=aborted`，不得重复补已有终态的分支。
   - 保留 `diagnostic-snapshot.ts` 的既有 5000 ms deadline 与等到 child close 才释放 permit 的语义。生产成功夹具仅托住 2000 ms；10000 ms 生产夹具必须验原 deadline 中止。管理台 120 秒和 1 小时观察使用显式独立生命周期的真实采集器，不发布生产快照、不放宽生产时限。
   - 新增 `webui/server/__tests__/diagnostic-collector-ops-step.test.ts`：操作号传播、两支并行、延迟确认前本体不得开始、stdout 失败仍确认、确认不等待文件、整组依赖、IPC 断开／abort／close 竞态、迟到终态去重、未进入分支不补行及父进程单写者。全部终态断言按已 enter 分支逐项精确计数。

3. **两条保存链、读字段与同步段挡板**
   - 在 `webui/server/ops/ops-ktx-batch.ts` 的 `executeGroup` 接入 `runtime_reload`：取得既有写锁后、锁内 `readFile` 前进入 `write_config`，覆盖基线复算、YAML 补丁和原子写；锁等待不在步骤内。随后依次接 `catalog_reload`、`policy_commit`，前一步失败不进入后续。
   - 多连接 `catalog_reload` 保持逐连接循环，每次循环分别写配对行；行内不加连接 ID。单连接 UAT 只证明顺序，另用双连接真实进程自动化证明循环没有漏记。
   - 在 `webui/server/index.ts` 的 `PUT /api/connections/:connId/enabled-tables` 接入独立 `enabled_tables_save`：确认 `dryRun=false` 后、`patchConnectionEnabledTablesYaml` 前进入 `write_config`，再依次覆盖 `catalog_reload`、`policy_commit`、`execution_reload`（`settleExecutionRuntime`）和 `execution_ack`。
   - 现值共享补丁计算早于 dry-run 返回、写锁晚于补丁；在补丁前条件登记，dry-run 不写账。写锁和 display barrier 继续覆盖原写入到生效链全段，不能把它们缩到 `write_config` 包装器内后提前释放。
   - 启用表 Catalog／Policy 的 `fail` 写入后仍走既有 catch 和后续步骤，不得因为套用 `runStep` 而改成失败中断；`execution_reload` 抛出时不得进入 `execution_ack`。
   - `runStep` 必须 await 本体并按 Spec §3.1.1 分类原返回值。单独覆盖 Catalog／Policy ack=false、executionRuntimeAck=false、读取 status／rejections／deferred；不把正常返回当作一律成功，也不为步骤分类新增业务异常。
   - 在 `POST /api/connections/:connId/schema-structure` 为每次请求生成一个操作号，在 `webui/server/schema-structure.ts` 接入 `list_tables`、`read_columns`。不得写入已撤回的 `sync_yaml_parse`、`sync_row_parse`、`sync_policy_compile` 等无代码依据名称。
   - 生产同步段不在首版登记；只有独立挡板使用 `op=sync_section`、`step=uat_sync_section`。
   - 错误响应 `detail.opsStepId` 保持与原错误码、原句并存；批量部分失败的 HTTP 200 在 `data.opsStepId` 返回本次请求操作号。`webui/src/lib/prepareSchemaStructure.ts` 的单表 catch 与最终汇总重建 ApiError 时按 Spec §3.5 保存 detail.opsStepRefs，保留既有 data.partial；在 `SchemaStructurePrep.tsx` 与 `onboarding/Step2UploadManifest.tsx` 两个既有错误区域显示操作号，不得只保留 err.message。
   - API 单表原句与客户端“有 1 张表没有读到字段……”汇总原句分开冻结。51 表正常拆 50＋1，末批错误从 detail 取号；另用 52 表的 50＋2 验两次 HTTP 200。deferred 的自适应重试仍保留，不承诺所有输入只发两次请求。
   - 新增 `webui/server/__tests__/ops-ktx-batch-ops-step.test.ts`、`enabled-tables-ops-step.test.ts`、`schema-structure-ops-step.test.ts` 和 `webui/src/__tests__/prepare-schema-ops-step.test.ts`：写入起点、双连接第二轮未终结配对、异步无提前终态、两条链抛错与返回值失败、精确原因码、无 SQL／表名／哨兵、51／52 表关联和两个入口原句兼容。

4. **管理读模型与只读页面**
   - 新增 `webui/server/admin/ops-steps.ts`：启动时读取历史尾部，当前行只读内存；历史孤立 `enter` 显示“上次进程未完成”，不进入当前进行中。
   - `history` 实现 2000 行／1 小时截断，先按完整可读文件尾部配对再裁剪，且以步骤实例为单位整体保留，不拆开同一实例的 `enter` 与终态；独立 `inFlight` 不受该限额淘汰。不得从文件把当前行重复合并一次。按步骤实例及出现次序分区，同一操作的一支结束不能关闭另一支；历史孤立 enter 的时长为未知。残行隔离后显示 `historyResidual`，残行不与新行拼接。
   - 新增 `webui/src/pages/admin/OpsSteps.tsx`，在 `webui/src/app/App.tsx` 注册 `/admin/ops-steps`，沿用既有管理导航。
   - 同次更新 `webui/docs/06-navigation-ia.md`：将「运维步骤」登记在「运行状态」组，放在「使用概况」之后，并补面包屑「运行状态 / 运维步骤」；既有项相对顺序不变。
   - 新增 `webui/server/__tests__/ops-steps-read-model.test.ts` 与 `webui/src/__tests__/ops-steps-page.test.tsx`：混合终态分区、重复步骤、重启孤立 enter、三类丢行、两类历史裁剪后进行中仍在、截断起始行、步骤时长和 E1–E9 状态。

5. **默认关闭的测试挡板**
   - 仅当 `LUCY_OPS_STEP_UAT=1` 注册 `/api/admin/ops-step-uat/*`；关闭时路由必须为 404。
   - 挡板提供 fixtures 声明的生产／独立生命周期真实诊断触发、同步段托住、一次性标准输出错误／短写、管理读延迟／失败（带一次性 token）、后台诊断暂停和步骤账重置。独立生命周期要求后台诊断已暂停且无在途采集，否则 409；有测试清理时限，不写生产快照、不改变生产调度。暂停后台诊断时等待在途采集结束再返回。空态取证前暂停后台诊断、等既有采集与文件队列空闲再 reset。
   - 所有挡板仍调用真实读取、真实写者和真实页面；不得返回预制步骤行代替业务路径。
   - 新增 `webui/server/__tests__/ops-step-uat-guard.test.ts`：关闭态 404、开启态鉴权、一次性故障恢复及重置不影响业务配置和审计账。

6. **自动回归与真实跑次**
   - 先跑上述定向测试，再跑 `npm --prefix webui run typecheck` 和 `npm --prefix webui test`；另跑根目录 `npm run lint:terminology`、`npm run lint:ia-boundary`、`npm run lint:spec-docs`。
   - 用真实进程自动化累计写入超过 16 MiB、至少两次 8 MiB 轮转验证两份文件上限；另覆盖文件部分写入→崩溃→残行隔离→新行可读、2000 行与 1 小时裁剪后仍进行中的步骤、重启历史、生产 5 秒中止、IPC 竞态、延迟确认、双连接循环、两条保存链写入起点及返回值失败、真实管道背压、文件消费者阻塞和真实追加失败，不得只靠缩小设计值或 mock 宣称能力通过。1 小时用例记录真实墙钟起止，可与其他用例并行等待，不使用假时钟。
   - 审计证据按五种 op 分行，起止水位前使用既有 GET /api/admin/audit/status 确认 pendingWrites=0、failedWrites 未增，防止响应后的延迟审计漏出窗口；span 用 access_log_id 关联父调用，不能取 MAX(TEXT span_id)。先核真实列、access_trace_span.stage 及 attrs_json；精确禁止 stage=ops_step_journal，正常同名 stage 不误判。成功问数按当次 RPC／trace 对应新增调用流水及阶段记录，不能只看全局行数增加。
   - 按测试台 R0、01–08 全真取证。浏览器证据写入 `docs/reviews/` 或 `docs/ui-ux-feedback/`，并回填本文件「浏览器验证」的证据路径。
   - `/admin/ops-steps` 记录导航到列表可见与列表 API 耗时；准备表结构另记录导航到错误详情可见与对应读字段 API 耗时，二者不得混用。
   - 启用表保存另记录点击保存到反馈可见的用户耗时，与同次真实 PUT 耗时分列；不得用管理列表或准备表结构的计时代替。

## 不做

- 不改探针的通过／失败条件，不缩短或放宽现有超时。
- 不改准备表结构的既有失败句，不改表级歧义的裁决。
- 不把运维步骤写入调用流水、阶段记录或审计库。
- 不接入独立 `/api/admin/mcp-runtime/reload` 和未列入 Spec §3.1 的配置保存链路，不用它们冒充 SC-05 或 SC-18。
- 不接外部日志采集，不做堆栈采样，不新增事件循环阈值触发行，不登记未经代码核实的生产同步段名。
- 不支持多实例、多副本共享写者或跨副本文件锁。

## 风险

- 非阻塞标准输出可能因背压丢行；这是显式降级，必须计 `stdoutDroppedCount`，不得为追求完整而重试并占住事件循环。
- 注入 error／short 不证明管道满时不阻塞；若实际背压验证不能满足 100 ms，停止该方案并重审 D4，不得静默降级为阻塞写。
- 对 fd 1 或 duplicate 设置 `O_NONBLOCK` 会污染共享 stdout 的其他日志；实现前后必须比较标志并用普通 `console`／访问日志做对照，不能以步骤账自身通过代替该检查。
- 非完整写可能留下残行；stdout 短写后须抑制后续步骤行并计数，文件重启后须先隔离残行再写新行。只让读取端跳过会静默丢掉下一条完整 JSON，不能作为完整恢复方案。
- 诊断五支改为各自打点后仍须保持并行。把读取本体放进文件队列会串行化采集，并掩盖同时卡住的另一支；IPC enter 必须等待父进程确认，但确认不得等待文件落盘。
- 父子进程若都写文件，会产生滚动竞争和重复行；只能由父进程统一写账。
- 文件副本放在内容根。磁盘满时只计文件丢行，标准输出和内存读模型继续。
- 只 chmod 目录不能阻止已存在可写文件的追加；须以服务 UID 验明真实追加失败。队列满须按固定字节上限丢新行，避免慢盘把日志变成无界内存积压。
- 历史文件里的孤立 `enter` 若被当成当前进行中，会在重启后制造假卡死；必须按进程代次分区。
- 挡板若在环境变量关闭时仍可调用，会变成现场可卡住或重置步骤账的入口；R0 和负向回归都必须覆盖关闭态。
- 运维操作自身可能正常写调用流水，且既有阶段可能与步骤账英文名相同。SC-12 只检查步骤账 `op_id` 和明确的生产者标识未混入，不能要求整次操作零审计或仅凭同名阶段判失败。

## 验收

- 获授权并实施后：SC-01–SC-18 均有自动化或测试台证据，证据等级逐条标明。
- SC-11 的运维步骤页浏览器时间与接口耗时分列；SC-17 的准备表结构错误详情也必须有真实前台浏览器证据和分列计时。
- 未获执行授权时，测试台保持 NOT RUN。不得用阅读本 Plan、单元测试或静态门禁代替 UAT 跑次。

## 完成定义

- 必做 UAT 为 PASS，Spec 按仓库规则另行收口。
- 收口不表示可上线，也不表示 2026-11-20 那类卡死已经被修复。本条只保证卡住时能指出步骤名，且写账降级有诚实计数。

## 实施与评审记录（2026-11-20）

本轮按委托人授权拆分多 Agent 并行实施，产物只落在工作树，未重建 Docker、未执行 UAT、未提交。

| 模块 | 落点 |
|---|---|
| 共享写账内核 | `webui/server/runtime/ops-step-journal.ts`（行格式、非阻塞 stdout、1 MiB 队列、8 MiB 两文件轮转、残行隔离、按实例裁剪、分通道计数） |
| 诊断父子接入 | `webui/server/runtime/diagnostic-collector.ts`、`diagnostic-collector-worker.ts`、`webui/server/runtime/diagnostic-snapshot.ts`、`webui/server/admin/mcp-runtime.ts` |
| 两条保存链与读字段 | `webui/server/ops/ops-ktx-batch.ts`、`webui/server/index.ts`、`webui/server/schema-structure.ts` |
| 读字段前端关联 | `webui/src/lib/prepareSchemaStructure.ts`、`webui/src/components/SchemaStructurePrep.tsx`、`webui/src/components/onboarding/Step2UploadManifest.tsx` |
| 管理读接口与页面 | `webui/server/admin/ops-steps.ts`、`webui/server/admin/ops-step-uat.ts`、`webui/src/pages/admin/OpsSteps.tsx`、`webui/src/app/*`、`webui/docs/06-navigation-ia.md` |

独立代码评审（两轮）发现并已修复：stdout 另开描述符在普通文件形态下覆盖既有日志、轮转失败后文件通道永久失效、历史裁剪拆开实例、读模型同一实例返回两行、非表级读失败丢操作号、Catalog 读失败被误记为 `leave`、后台暂停不等待在途采集、`isolated` 与生产采集可并发、管理页自推状态覆盖服务端 `state`、读故障未绑定到具体请求、挡板 `sync-section` 的 202 可能被阻塞吞掉。

已验证（本机，未重建 Docker）：`npm --prefix webui run typecheck` 通过；本条新增与相关回归 12 个测试文件 77 项通过；`lint:spec-docs`、`lint:terminology`、`lint:ia-boundary`、`lint:e2e-ledger` 通过。

未验证（属 UAT 与真实环境证据，不在本轮主张内）：真实 Linux 管道背压与 fd 标志对照、真实 8 MiB／16 MiB 轮转、真实 UID 追加失败、真实崩溃残行、真实墙钟 1 小时裁剪、真实前台浏览器与两个准备入口取证、`/api/admin/ops-steps` 的真实鉴权与筛选取证。

## 浏览器验证

- 路由：/admin/ops-steps
- 视口：1920×1080
- 状态：E1、E2、E3、E4、E5、E6、E7、E8、E9
- 证据：未执行
