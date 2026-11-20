# 重任务跨模块容量控制与许可生命周期 Implementation Plan

**Goal:** 在保留各模块合同的前提下，给三类重任务建立可核对的总容量和许可生命周期。

**Architecture:** 在已登记重任务入口增加薄协调层，保留模块队列、事务和恢复；前台普通请求不进入重任务队列。超时返回与实际停止分开，许可按底层终结释放。

**Tech Stack:** TypeScript、现有ProbeScheduler/重建worker/审计及发现路由、Docker、Vitest；不改KTX或schema。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v0.1-draft |
| 功能编号 | P1-62／REQ-030-083 |
| 状态 | v0.1-draft。终稿已确权（委托人 2026-11-20 明示本提示词确权）；开发授权已获得；实现已落地（本机单元与组件测试通过）；本机 Docker 局部 UAT PASS WITH GAP（仅真实导出入口；完整 F62 未完成）；不入核心分母；≠ 功能合同收口；≠ UAT PASS；≠ 可上线。 |
| 授权边界 | 委托人授权按本 Plan Task 1–3 实施运行代码与 Vitest／API 文档；不恢复 D7 延期、不改已有问数限流；Task 4 的本次局部执行已于 2026-11-20 获授权，完整矩阵不视为已验；禁止提交／推送／发布／客户升级 2026-11-20委托人后续批准：本进程已完成修复、回归及取证可作阶段性本地commit；不含push、发布或客户变更，未完成矩阵仍保留GAP。 |
| 验收 | [Spec](../specs/lucy-20261119-heavy-work-capacity-control-spec.md) SC-01–10；[测试台](../qa/uat/suites/core-availability/suite.md) F62 |

## 目标

只填三类重任务跨类别并行的总容量差集。已有Spec174／190局部队列、P1-47worker、P1-34批次算法、MCP预算均为复用前提；模块算法退化仍归原合同，不能用限流抹掉。

## 开工前置

1. 终稿确权、另行开发授权；先确认默认2运行/16等待/同身份同类4等待/5秒等待及前台绕过集合。
2. 完成真实入口与取消/提交/输出结束接缝清单，精确到函数。无法明确真实settle边界的类别先回评审，不交付仅有空调度器的“完成”。
3. 冻结模块有效基线、夹具、镜像和资源；有意的429独立计数，不计性能成功。P1-58／59共享工作树实现保留。
4. 不新增持久表、不改变副本或KTX；D7正式完整导出仍延期，仅检查许可接缝，不改其业务实现或结论。

## 实施任务（实现已落地；局部实测见本次跑次）

### Task 1：调用图和负控基线

- Read：`webui/server/background-probes.ts`、`live-table-queue.ts`、`admin/inferred-turn-maintainer.ts`、`proxy/audit-rebuild-write.ts`、`admin/audit.ts`、`index.ts`中的批量发现入口。
- 明确重建用户执行、导出构建至输出关闭、批量发现内部缩批三条调用图；逐个记录现有本地permit、deadline、AbortSignal、原合同已有的领域回执与实际执行终态。分别标出事务安全停止点和子进程、DB连接、输出句柄真实关闭点，禁止用前者冒充后者；启动后抛错但工作已受理的适配器也必须能返回真实settle句柄。
- 拟新增 `webui/server/__tests__/heavy-work-capacity.test.ts`；先用独立计数器记录真实操作启动/终结，不调用调度器自身计数作唯一oracle。
- 出口：SC-01／03／10改前负控和接线清单；若原系统已有等价总控制，应删掉重复方案、改为补验收而非再次实现。

### Task 2：有界协调器

- 拟新增 `webui/server/runtime/heavy-work-capacity.ts`；先测试2/16/4边界、跨类别轮转、全队列拒绝、短于5秒的原deadline、等待取消与重复释放，再实现最小状态机。
- 执行许可同时满足总/类别约束后一次性保留；无持许可等待次级锁的环路；内部重试继承同一许可。
- 暴露固定类别指标与等待原因，不导出Token/用户高基数标签；release以底层执行真实终结且资源全部关闭为准，事务安全停止点只写原领域终态/恢复事实。
- 授权后拟命令：`cd webui && npx vitest run server/__tests__/heavy-work-capacity.test.ts server/__tests__/background-probes.test.ts`；预期边界/负控均通过。新增文件已在后续实现中落地，现值见头部状态。
- 出口：SC-01–04／09。

### Task 3：三入口接线与安全/结果等价

- Modify白名单：`webui/server/admin/inferred-turn-maintainer.ts`、`webui/server/admin/audit.ts`、`webui/server/index.ts`与上一任务新模块；实际额外适配点先补本Plan再授权。
- 重建采用单一pump票据，满时保留原dirty事实；导出许可直到生成/流关闭；发现的缩批重试不重新排队获取许可。取得许可前不做昂贵预处理。
- 用两个真实身份测试等待期间吊销、换代、取消、已提交丢响应；已提交事实不被后续撤权改写，只通过原合同已有回执核查，不为无回执模块补job API。普通鉴权/MCP不接入本协调器，原Spec174/190队列独立；饱和窗内用不带WebUI Cookie的纯MCP完成 `initialize`→`tools/list`→合法轻量数据查询并核对结果。
- 复用既有错误信封加WORKLOAD_CAPACITY_BUSY与Retry-After；API合同授权后更新 `webui/docs/03-api-spec.md`，不新增页面。
- 出口：SC-05–08／10。若实际错误呈现需前端新交互，先修订豁免和元素合同再开发。

### Task 4：真实进程F62与后续组合

- 执行授权后在隔离Docker跑F62：真实三入口≥80提交、两个身份、迟退任务、取消及恢复；采集实际启动/结束序列与客户端结果双oracle。
- 不在客户现网压测，不用sleep替身冒充真实业务执行；本条纯算法单测可用替身，但UAT降级须独立授权。
- 共用拟runner `scripts/uat/core-availability.mts` F62，该完整入口尚未创建；本次局部使用 readyz-diagnostic-repro.py。实现时先登记Current Commands／CI Mapping。
- 本模块容量与语义证据回F62；混合重建/导出/发现加正常MCP的系统预算回R-CAV/P1-13，不作SC额外前置。

## 浏览器验证

不适用：本条不改变用户可见 WebUI 表面，复用现有通用错误/手动重试；不做浏览器和移动窄屏测试。若需新增交互，先回Spec补合同。

## 验收

- 文档：范围三类、接线/许可/反例/补偿和三台登记可审阅，无运行验证主张。
- 授权实施后：SC-01–10全覆盖，尤其“返回超时但工作未停”“事务安全点已到但资源未关”“拒绝后恢复可成交”及饱和窗内纯MCP合法查询成交；原模块金样本及独立配额通过。
- 重建/导出/发现的功能故障只打回被证伪合同；不得用本条新429替代旧失败码，或用低吞吐规避公平性与正确性检查。

## 完成定义

实现已落地；本次仅真实导出入口实测，收口仍需三类真实接线及全部SC证据。可用性组合结论仍消费既有发布取证，不声称提高任意负载下的系统容量。

## 风险

| 风险 | 约束 |
|---|---|
| 等待增加、用户体验下降 | 有界等待、准确429/Retry-After、释放后同入口成功 |
| 双队列死锁、超时后超发 | 原子预留、唯一获取顺序、真实settle持许可 |
| 排队绕过权限换代 | 执行/发布前沿用原授权屏障复核 |
| 把调度当算法优化 | 原模块性能和等价守卫仍生效；不以改默认值追样本 |

## 落盘清单

17项共用自查见 [suite](../qa/uat/suites/core-availability/suite.md)；本次具名局部runner已实现并执行；本次未改产品运行行为。

## 2026-11-20 本机局部复现

[具名跑次](../qa/uat/suites/core-availability/runs/2026-11-20-codex-readyz-diagnostic-repro.md)记录冻结候选、真实故障、逐项判定及剩余缺口；[执行 Plan](../plans/lucy-20261120-readyz-diagnostic-repro-uat-plan.md)限定本次授权。保留原SC和门槛，本次不修改产品运行代码，不改客户环境。
