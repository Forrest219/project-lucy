# 存活／就绪探针纯内存响应与诊断隔离 Implementation Plan

**Goal:** 在保留原启动与授权安全边界的前提下，把探针响应与诊断I/O分离。

**Architecture:** 复用P1-21三探针和P1-46监听状态；详细诊断在单在途后台采集器中生成不可变快照，响应只读取内存。诊断新鲜度与服务准入分开，不缓存运行时权限。

**Tech Stack:** TypeScript、Fastify、现有缓存/后台探测、Docker、Vitest；不改KTX。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v0.1-draft |
| 功能编号 | P1-61／REQ-030-082 |
| 状态 | v0.1-draft。终稿已确权（委托人 2026-11-20 明示本提示词确权）；开发授权已获得；实现完成（本机 Vitest／Node 单元与组件测试通过）；测试台 NOT RUN；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| 授权边界 | 委托人授权按本 Plan Task 1–3 实施运行代码与 Vitest／API 文档；Task 4（真实 Docker F61／runner）仍须另行测试执行授权；禁止提交／推送／发布／客户升级 |
| 验收 | [Spec](../specs/lucy-20261119-memory-probe-diagnostics-isolation-spec.md) SC-01–09；[测试台](../qa/uat/suites/core-availability/suite.md) F61 |

## 目标

只补探针请求的I/O接缝与诊断新鲜度，不重做重建worker、冷启动、MCP监听或权限编译；去重依据见 [核对报告](../reviews/2026-11-19-core-availability-gap-assessment.md)。本条可以先于P1-62／63独立实施和收口。

## 开工前置

1. 本稿完成终稿确权，委托人另发具名开发授权；不得继承P1-21／46的旧授权。
2. 冻结候选/对照SHA、镜像digest、dirty、fixture、资源和旧响应金样本。共享工作树已有P1-58／59实现，先核对其diff，禁止覆盖。
3. 明确新增diagnostics字段、30秒诊断滞后、10秒周期/5秒真实截止及两画像↓补偿；不接受仅增加TTL或Promise.race。
4. 继续按单实例单副本；不动KTX、数据库schema、治理配置、Chart或探针超时。新增runner实际实现时先登记测试门禁文档Current Commands／CI Mapping。

## 实施任务（当前全部未执行）

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
- 授权后拟运行：`cd webui && npx vitest run server/__tests__/memory-probe-diagnostics.test.ts server/__tests__/mcp-runtime-status.test.ts`；预期各断言通过。新增测试当前不存在，命令不是已交付能力。
- 出口：SC-01–07／09；P1-21／46既有相关测试按实际测试文件定位后回归，不重复创建同合同。

### Task 4：独立Docker模块验收与登记

- 获测试执行授权后才构造F61真实慢诊断/失败/恢复；120秒采样，记录全样本而非只记录成功均值。
- 拟runner入口为 `scripts/uat/core-availability.mts` 的F61选择器，由共享suite维护；本轮不创建、不执行，不增加npm命令。
- 写runs/INDEX、SC对应证据、实现CR与全部状态镜像；只记F61结论，不把共享R-CAV或客户升级判PASS。
- 出口：SC-08及全部SC证据；系统组合由候选负责人另按P1-13／52／53跟进。

## 浏览器验证

不适用：本条不改变用户可见 WebUI 表面，默认不做浏览器或移动窄屏测试。若实现引入新交互，先回Spec补合同，不隐式扩大本授权。

## 验收

- 文档：全部状态镜像同句、三台指针完整、形态/术语/IA门禁通过；不主张行为通过。
- 实施后：SC-01–09逐条有证据；真实进程局部慢采集120秒、请求内I/O为0、探针p99≤100ms/max≤500ms；首次失败立即stale且原status语义不变，诊断慢/陈旧及恢复后纯MCP合法查询真实成交；功能本身失败不能由旧UAT PASS覆盖。
- 组合/现场：不在本条出口；保留原P1-39／47预算，不能以新轻探针预算改写重负载合同。

## 完成定义

本轮完成是草案、去重、Spec／Plan、测试设计和登记完成；终稿未确权、开发未授权。未来功能收口须全部SC、实现审阅及状态镜像完成，F61证据不代表零503或可上线。

## 风险

| 风险 | 约束 |
|---|---|
| 缓存让诊断滞后 | 明确采集时间/陈旧状态/恢复更新，SC-03／04 |
| 超时后后台仍跑 | 实际settle前持许可；取消不能只停止等待 |
| 内存探针掩盖主进程死锁 | 继续由同一主事件循环响应livez，不另起永远健康的服务 |
| 诊断缓存误用于授权 | 运行时拒绝/权限收紧回归，SC-07 |

## 落盘清单

17项共用自查见 [共享测试设计](../qa/uat/suites/core-availability/suite.md)「文档落盘检查」。本文不授权实施、不新增实际命令或CI；不提交共享工作树的无关实现。
