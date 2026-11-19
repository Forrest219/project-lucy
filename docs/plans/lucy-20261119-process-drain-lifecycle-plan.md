# 进程关停准入关闭与在途请求排空 Implementation Plan

**Goal:** 在可捕获的整实例关停中先停止新准入，让在途请求有界终结，再清理上游依赖。

**Architecture:** 父entrypoint拥有整实例关停协议，Lucy Web/MCP共用内存准入屏障与在途登记；排空后复用既有supervisor退出与领域恢复。全流程单次、单向、幂等，不引入多副本。

**Tech Stack:** TypeScript、Fastify、Node HTTP/MCP、现有bash entrypoint/supervisor、Docker；本地脚本兼容stock macOS bash3.2，不改KTX。

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施 Plan / v0.1-draft |
| 功能编号 | P1-63／REQ-030-084 |
| 状态 | v0.1-draft。仅文档；终稿未确权；开发未授权；测试台 NOT RUN；不入核心分母；≠ 可上线。 |
| 授权边界 | 仅文档；Spec191旧顺序仍生效。须批准具名修订及开发授权后才可改信号/脚本/超时；本轮不执行关停测试 |
| 验收 | [Spec](../specs/lucy-20261119-process-drain-lifecycle-spec.md) SC-01–09；[测试台](../qa/uat/suites/core-availability/suite.md) F63 |

## 目标

只填全进程准入关闭/在途排空接缝；原启动、reload、supervisor清理、重建恢复继续归原合同。本条不承诺零中断升级或节点故障无损。

## 开工前置

1. 终稿确权和另行开发授权；明确批准Spec191 §4.2.3／4.4的顺序修订，不能以新增Spec默认覆盖旧合同。修订时原Spec及镜像按治理同次更新。
2. 确认内部信号/确认通道、MCP业务RPC计数边界、20秒排空/40秒总预算与外部grace≥45秒；不得新增公开无鉴权关停端点。明确外部TERM/INT到DRAINING确认的交接窗，窗内已受理工作不得漏记。
3. 冻结进程拓扑、PID/退出码、现有reload/清理基线及测试镜像。区分正常TERM与依赖崩溃/SIGKILL，不承诺不可捕获信号完成排空。核对标准Docker demo的Compose stop grace；若仍缺配置，须取得运行配置修改授权后与entrypoint同次补齐≥45秒，不能只改定制测试台。
4. P1-61应先形成内存生命周期可读边界；P1-62若尚未实施，先证明原任务真实settle接法，不能用未落地接口作前置假设。两者的SC不复制成本条SC。

## 实施任务（当前全部未执行）

### Task 1：冻结旧顺序与领域终态

- Read：`scripts/runtime/docker-entrypoint.sh` 的shutdown/wait_for_child_exit/supervise_ktx；`webui/server/index.ts` onClose/startServer；`webui/server/proxy/mcp-proxy.ts` 请求准入/上游转发；`runtime/readiness.ts`。
- 列出父shell、npm/Node、supervisor/KTX PID与信号转发；确认执行层单独reload不得触发整实例drain。
- 对长SSE、已提交丢响应、未提交/部分重建逐项映射已有回执和恢复入口；不创建第二套终态/恢复表。
- 出口：明确Spec191修订diff的设计和SC-03／05／09负例，审阅确认后才可实现。

### Task 2：准入屏障与在途登记

- 拟新增 `webui/server/runtime/process-drain.ts`、`webui/server/__tests__/process-drain.test.ts`。
- 先写入场/信号竞态、重复信号、迟到诊断回写、SSE空闲与RPC不同计数、请求断开或启动后抛错但工作仍在运行的失败测试。
- 把检查SERVING/登记在途做同一同步步骤；Web和MCP共享owner；关闭准入后不能靠重载/采集回调恢复SERVING。health继续保持原诊断语义，不进入业务在途登记。
- 已受理后台工作纳入同一owner；停止新调度后，未启动等待项结算且不执行，保留原dirty/恢复事实，不把HTTP连接关闭当作后台任务终结。
- Modify限 `webui/server/index.ts`、`runtime/readiness.ts`、`proxy/mcp-proxy.ts`；与P1-61重叠需按函数串行整合，不覆盖共享工作树无关改动。
- 出口：SC-01／02／04；等待真实settle而非只等待HTTP close。

### Task 3：父子通信和有界退出

- Modify：`scripts/runtime/docker-entrypoint.sh`；拟新增对应测试 `scripts/runtime/process-drain.test.mjs`，复用 `scripts/runtime/docker-entrypoint.test.mjs`。
- 先写反例：TERM后先杀KTX导致10秒在途查询中断、重复EXIT重复杀进程、超时后孤儿残留、grace不足。
- 实现先通知/确认Lucy DRAINING、20秒排空，再原supervisor清理；取消通知与剩余状态记录包含在20秒内，不另加无界等待。内部通信不承载凭据，不暴露公网。
- 更新原Spec191具名段落及API合同；`SERVICE_DRAINING` 不带固定Retry-After，提示服务恢复后显式重试。自定义stop超时冲突必须显式校验。
- 获运行配置修改授权后，Modify `deploy/compose/docker-compose.demo.yml`，为标准Docker demo显式配置 `stop_grace_period: 45s`（或更长且经预算校验的值），并用Compose渲染结果核对；其他部署文件不在本稿默认扩改。
- 授权后拟运行：`node --test scripts/runtime/process-drain.test.mjs scripts/runtime/docker-entrypoint.test.mjs` 与 `cd webui && npx vitest run server/__tests__/process-drain.test.ts`；预期退出/竞态/兼容断言通过。新增文件当前不存在。
- 出口：SC-03／05–07／09；既有退出码/supervisor异常路径不能回退。

### Task 4：真实信号局部验收及恢复

- 获执行授权后在隔离Docker对真实进程发送TERM；用真实测试数据库延迟构造在途请求，不能仅在应用回包前sleep冒充依赖还可用。
- 三轮正常排空与超时兜底，≥100轮准入竞态；每轮核对信号确认、受理时间、KTX存活、任务执行次数/回执与退出顺序。
- 重启后用已鉴权HTTP完成原合法主任务，并用无WebUI Cookie的纯MCP完成 `initialize`→`tools/list`→合法轻量数据查询且核对结果；有原回执的未知写结果先查旧回执，不自动重放，不为无回执模块新造job API。
- F63只验证本生命周期；实际反代传播/升级窗口归R-CAV与P1-52，真实Agent题库归P1-53／54。共享runner本轮不创建。

## 浏览器验证

不适用：本条不改变用户可见 WebUI 表面，无新页面/按钮/关停入口；使用真实进程/API/MCP验收，不做浏览器或移动窄屏测试。

## 验收

- 文档：旧合同冲突明确、通信/预算未决点可审阅、状态镜像与三台完整；不宣称已关停无损。
- 实施后：SC-01–09全覆盖，重点是屏障后的新请求未受理、交接窗已受理工作不漏记、旧请求依赖仍在、超时不伪成功、标准Docker demo grace达标，以及恢复后HTTP/纯MCP原主任务真实成交。
- stop/grace不足或现场不可访问不拿mock冒充UAT PASS；客户节点/入口证据属于交付层，不能倒挂本机功能收口。

## 完成定义

本轮是设计草案与登记完成；未来开发须批准Spec191修订和本合同、取得具名授权后才开始。F63通过只证明有界排空，不证明单副本升级零中断或可上线。

## 风险

| 风险 | 约束 |
|---|---|
| 改信号顺序破坏旧supervisor合同 | 具名修订、原异常退出回归、父owner单次清理 |
| 长SSE导致永不结束 | 业务RPC计数，不等待空闲连接 |
| 取消后有隐形工作/未知写结果 | 真正终态或原回执；不自动重放 |
| 总grace不足 | 明确20/40/45秒草案与自定义超时冲突，保留有界兜底 |

## 落盘清单

17项共用自查见 [suite](../qa/uat/suites/core-availability/suite.md)；本轮未改entrypoint、KTX、运行配置或交付形态。
