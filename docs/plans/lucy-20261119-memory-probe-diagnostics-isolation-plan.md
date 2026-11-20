# 存活／就绪探针纯内存响应与诊断隔离 Implementation Plan

**Goal:** 在保留原启动与授权安全边界的前提下，把探针响应与诊断I/O分离。

**Architecture:** 复用P1-21三探针和P1-46监听状态；详细诊断在单在途后台采集器中生成不可变快照，响应只读取内存。诊断新鲜度与服务准入分开，不缓存运行时权限。

**Tech Stack:** TypeScript、Fastify、现有缓存/后台探测、Docker、Vitest；不改KTX。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v0.1-draft |
| 功能编号 | P1-61／REQ-030-082 |
| 状态 | v0.1-draft。终稿已确权；开发授权已获得；2026-11-20授权修复及本机Docker全真复测已完成；CAV-01真实停止／自动恢复局部复测PASS WITH GAP；完整F61矩阵未完成；不入核心分母；≠ 功能合同收口；≠ 整套UAT PASS；≠ 可上线。 |
| 授权边界 | 2026-11-20委托人明示按原合同修复已复现缺口，授权相关运行代码、测试工具及本机隔离Docker全真复测；不改客户环境、不提交、不推送、不发布；完整矩阵不得推定通过 2026-11-20委托人后续批准：本进程已完成修复、回归及取证可作阶段性本地commit；不含push、发布或客户变更，未完成矩阵仍保留GAP。 |
| 验收 | [Spec](../specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md) SC-01–09；[测试台](../qa/uat/suites/core-availability/suite.md) F61 |

## 目标

只补探针请求的I/O接缝与诊断新鲜度，不重做重建worker、冷启动、MCP监听或权限编译；去重依据见 [核对报告](../reviews/2026-11-19-core-availability-gap-assessment.md)。本条可以先于P1-62／63独立实施和收口。

## 开工前置

1. 本稿完成终稿确权，委托人另发具名开发授权；不得继承P1-21／46的旧授权。
2. 冻结候选/对照SHA、镜像digest、dirty、fixture、资源和旧响应金样本。共享工作树已有P1-58／59实现，先核对其diff，禁止覆盖。
3. 明确新增diagnostics字段、30秒诊断滞后、10秒周期/5秒真实截止及两画像↓补偿；不接受仅增加TTL或Promise.race。
4. 继续按单实例单副本；不动KTX、数据库schema、治理配置、Chart或探针超时。新增runner实际实现时先登记测试门禁文档Current Commands／CI Mapping。

## 实施任务（设计任务清单；实施已完成，验收见现值）

### Task 1：冻结响应和依赖调用基线

- Read/Modify范围：`webui/server/index.ts` 的dependencyStatus/三健康路由；`webui/server/admin/mcp-runtime.ts`；`webui/server/runtime/readiness.ts`；`webui/server/ktx-runtime.ts`。
- 拟新增测试：`webui/server/__tests__/memory-probe-diagnostics.test.ts`；先断言全依赖reader计数、兼容字段、启动状态与两端口监听，再记录改前失败。
- 把响应字段、未知值和时间语义形成独立预期，不调用被测collector生成金样本。覆盖当前依赖降级仍Ready的原合同，并冻结 `data.status` 只表示采集时点依赖汇总、不得因 freshness 单独改写的兼容边界。
- 出口：SC-01／02／03可重复的改前证据；禁止只stub最外层dependencyStatus后宣称无I/O。

### Task 2：内存诊断记录与后台采集器

- 拟新增：`webui/server/runtime/diagnostic-snapshot.ts`；必要时仅适配原诊断reader，不重写MCP reload语义。
- 先写fresh/stale/unknown、首次失败立即stale、时钟回拨、失败保留时间及原status语义、代次切换、底层迟退和连续tick单在途测试，再实现原子发布/实际settle释放。
- 完成collector取消与close；真实I/O截止能力不足时提出实现边界修订，不能隐藏仍在跑的采集器。
- 出口：SC-03–06／09；普通单测可用可控时间，测试台只能记真实进程证据。

### Task 3：三路由接线与兼容回归

- Modify：`webui/server/index.ts`；授权后同步 `webui/docs/03-api-spec.md` 新字段；不改前端页面。
- 先验证采集正在进行/超时/异常时请求不等待，再让三路由只读内存记录；保留livez形状、readyz warming_up、data旧字段与免登录边界。
- 在同一真进程里收紧/吊销权限，证明响应诊断快照不参与授权；诊断慢/陈旧期间及合法恢复后，分别以真实HTTP和不带WebUI Cookie的纯MCP完成 `initialize`→`tools/list`→合法轻量数据查询并核对结果，被吊销身份仍拒绝。
- 授权后拟运行：`cd webui && npx vitest run server/__tests__/memory-probe-diagnostics.test.ts server/__tests__/mcp-runtime-status.test.ts`；预期各断言通过。相关测试已实现，本次执行结果见修复跑次。
- 出口：SC-01–07／09；P1-21／46既有相关测试按实际测试文件定位后回归，不重复创建同合同。

### Task 4：独立Docker模块验收与登记

- 获测试执行授权后才构造F61真实慢诊断/失败/恢复；120秒采样，记录全样本而非只记录成功均值。
- 拟runner入口为 `scripts/uat/core-availability.mts` 的F61选择器，由共享suite维护；完整入口尚未创建；本次局部runner为readyz-diagnostic-repro.py。
- 写runs/INDEX、SC对应证据、实现CR与全部状态镜像；只记F61结论，不把共享R-CAV或客户升级判PASS。
- 出口：SC-08及全部SC证据；系统组合由候选负责人另按P1-13／52／53跟进。

## 浏览器验证

不适用：本条不改变用户可见 WebUI 表面，默认不做浏览器或移动窄屏测试。若实现引入新交互，先回Spec补合同，不隐式扩大本授权。

## 验收

- 文档：全部状态镜像同句、三台指针完整、形态/术语/IA门禁通过；不主张行为通过。
- 实施后：SC-01–09逐条有证据；真实进程局部慢采集120秒、请求内I/O为0、探针p99≤100ms/max≤500ms；首次失败立即stale且原status语义不变，诊断慢/陈旧及恢复后纯MCP合法查询真实成交；功能本身失败不能由旧UAT PASS覆盖。
- 组合/现场：不在本条出口；保留原P1-39／47预算，不能以新轻探针预算改写重负载合同。

## 完成定义

目标缺口修复及本机局部复测已完成，完整F61矩阵仍未完成；以头部现值及具名跑次为准，不主张功能合同收口或可上线。

## 风险

| 风险 | 约束 |
|---|---|
| 缓存让诊断滞后 | 明确采集时间/陈旧状态/恢复更新，SC-03／04 |
| 超时后后台仍跑 | 实际settle前持许可；取消不能只停止等待 |
| 内存探针掩盖主进程死锁 | 继续由同一主事件循环响应livez，不另起永远健康的服务 |
| 诊断缓存误用于授权 | 运行时拒绝/权限收紧回归，SC-07 |

## 落盘清单

17项共用自查见 [共享测试设计](../qa/uat/suites/core-availability/suite.md)「文档落盘检查」。本次修复与局部执行已授权，命令已登记，无新增CI；不提交共享工作树。

## 2026-11-20 首轮仅复现（历史）

[首轮跑次](../qa/uat/suites/core-availability/runs/2026-11-20-codex-readyz-diagnostic-repro.md)当时仅获复现授权，保留局部FAIL，不回改历史。后续委托人已明示授权按原Spec／Plan修复并本机Docker复测；当前授权及状态见头部。

## 已授权缺口修复与本次结果

诊断目录／文件I/O在独立Node子进程执行，主进程传已有探测、KTX缓存和执行观测证据；策略与授权仍归主进程。已有KTX CLI刷新不在短命读者中重复运行。10秒周期／5秒截止不变，abort／close终止私有进程组，等真实close再释放单在途；旧代／迟到结果不发布。未确认退出不假释放，保留stale。

仅给readFile加Signal不能停止每个底层OS请求，依据[Node22文档](https://nodejs.org/download/release/latest-jod/docs/api/fs.html)。本次用真实FIFO验证可终止执行边界，不外推不可中断内核I/O或任意PVC故障必可自愈。

先补真实FIFO取消／恢复／close回归，再在同一冻结候选做120秒探针采样与两轮路径恢复；恢复时不释放旧FIFO、不重启。

[修复跑次](../qa/uat/suites/core-availability/runs/2026-11-20-codex-readyz-diagnostic-repair.md)记录最终镜像、真实I/O／DB／TERM证据、PASS WITH GAP与完整矩阵剩余项。没有客户变更、提交、推送或发布；本次浏览器不适用。
