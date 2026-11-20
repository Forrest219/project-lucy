# 2026-11-20 Codex — 诊断真实停止及 MCP TERM 排空修复复测

| 项 | 记录 |
|---|---|
| 归属 | P1-61／REQ-030-082 的 CAV-01；P1-63／REQ-030-084 的 CAV-02；复用原 Spec／Plan，无新增功能 |
| 授权 | 委托人明示修复第一批真实取消／执行上界、第三批MCP在途登记，再本机Docker全真复测；不改客户环境、不提交、不推送、不发布 |
| 当前判定 | **目标缺口修复并局部复测 PASS WITH GAP**；F61／F63完整矩阵未完成，R-CAV NOT RUN；前次FAIL保留，≠ 功能合同收口，≠ 整套UAT PASS，≠ 可上线 |
| 前次反例 | [首轮复现](2026-11-20-codex-readyz-diagnostic-repro.md)：诊断超时后真实读取不退出；三轮10秒查询TERM后约0.7–1.6秒被截断 |
| 正式证据 | [artifacts](2026-11-20-codex-readyz-diagnostic-repair-artifacts/)；完整过程日志 `inbox/readyz-repair-20261120/` 不作唯一证据 |
| 最终有效跑次 | `diagnostic-v2`、`drain-control-v2`、`drain-fault-v2-1`、`drain-fault-v2-2`；2026-11-20 12:50:30–12:54:25 CST，原始时间戳UTC |

## 1. 修复和边界

**CAV-01：** 诊断文件／目录读取放入独立Node子进程。主进程传现有内存探测、KTX缓存和执行观测证据，保留原策略与诊断字段语义；已有KTX CLI刷新仍由原有缓存服务负责，不在每个短命读者中重复探测。5秒截止触发进程组终止，收到真实close才让采集Promise结束并释放单在途；close也取消当前采集。旧代、迟到和超时结果仍不得发布。没有用Promise.race或放宽探针超时伪装底层已停。

[Node22文档](https://nodejs.org/download/release/latest-jod/docs/api/fs.html)说明readFile取消并不停止每个底层OS请求，因此只给readFile传Signal不足以覆盖此前FIFO反例。该修复提供可终止执行边界；极端不可中断内核I/O不在本次实测事实内，未确认退出仍须持许可并保留stale，不能外推任意PVC故障必可自愈。

**CAV-02：** MCP在首个异步准入前同步检查并登记，与Web共用协调器；处理Promise、已接受的上游请求／流和异步响应门禁终态完成后才注销。客户端close不单独注销；空闲GET／SSE不占业务在途，DRAINING拒绝新请求。原鉴权、撤权、预算取消与审计规则保留；不把TCP结束误说成远程数据库事务已提交。

**同轮发现并修复 CAV-02 的启动接缝：** 仅接好MCP登记的中间候选仍在TERM后0.691秒截断查询。真实ack中的Node PID与父entrypoint等待的npm启动器PID不同；启动器先退出，被误认为Lucy已排空。改为 `node --import tsx server/index.ts` 直接启动并记录实际服务PID，保持原drain-first顺序。新增真实Node/tsx PID与延后退出回归，不只检查源码中的信号顺序。

## 2. 最终候选身份与实验差异

| 项 | 值 |
|---|---|
| 固定代码基线 | `6b8deec4d4750fe5f35f3510192e968844a5c0e1` |
| 本次改动 | 基线上仅叠加9个授权运行文件；[逐文件哈希](2026-11-20-codex-readyz-diagnostic-repair-artifacts/source-manifest.json)；不复制共享工作树其他未提交运行改动 |
| 镜像标签 | `project-lucy:uat-readyz-repaired-20261120-v2` |
| 镜像ID | `sha256:333e6dc986e92dc32a1697b3035f197877cbf82fd5bcca2de47d0be9d5a7f893` |
| 实际平台 | linux/arm64；Node v22.23.5／KTX0.16.0；每实例2CPU／2GiB、独立具名卷与MySQL8.4、随机127.0.0.1端口 |
| 版本标识 | 6b8deec4＋dirty；dirty由实验源码覆盖产生，不声称是完整HEAD／发布构建 |
| 夹具 | 4行真实合成MySQL，独立SQL oracle count=4、sum=100；真实管理员Cookie和不带WebUI Cookie的普通MCP身份；私有凭据不进Git |
| 工具 | 同一runner，helper源码在import时一次读入并哈希；各summary保存哈希；完整指纹见各artifact |

镜像沿用前次固定依赖层，只替换冻结源码，属于实验镜像，不是客户镜像同digest或正式出包。客户环境基线和FDE输入沿用前次外部WIP，没有复制客户凭据／数据。本次未搭建SelectDB、Kerberos HMS、客户Ingress／PVC；不声明客户实际根因已经确认或已修复。

本机Vitest在共享工作树执行，相关9个运行文件与Docker冻结版本逐文件核对一致；其他模块有其他任务改动，不把本机单测描述成整版冻结候选全量验收。Docker结论只归以上精确镜像。

## 3. 第一批：真实超时回收与路径恢复

先fresh并完成合法HTTP及纯MCP查询，再在实际reload state路径放置FIFO，持有旧读写端且不给EOF。记录真实Node线程 `pipe_read`，持续故障120秒；独立观察器每0.25秒记录 `/proc` 中诊断工作进程和线程，不替换collector或业务响应。

| 指标 | 最终候选实测 | 判定 |
|---|---:|---|
| livez | 120/120为200；p99 19.837ms，max85.807ms | SC-08预算通过 |
| readyz | 120/120为200；p99 6.607ms，max84.918ms | SC-08预算通过 |
| 采集实际并发 | max=1 | 无采集器叠加 |
| 工作进程 | 观察到14个，其中12个有真实阻塞线程 | 持续故障下多轮真实终止／重试 |
| 最长观测存活 | 4.790秒；0.25秒采样，有采样误差 | 与5秒截止及真实close回收一致，不宣称精确物理上界为4.790秒 |
| 故障中元数据 | stale；原observedAt不前移 | 不造新鲜或假成功 |
| 仅恢复普通路径 | 不释放旧FIFO，9.168秒后自动fresh | 原挂起读取已终结，新周期可恢复；无需重启 |
| 第二轮 | 同进程再次超时，再仅恢复路径，自动fresh | 恢复可重复；非一次性人工释放凑通过 |
| 合法主路径 | 故障前／中／后HTTP读取及纯MCP握手、工具列表、真实查询均成功，4／100正确 | 已执行合法分支通过 |

[原始240探针样本](2026-11-20-codex-readyz-diagnostic-repair-artifacts/diagnostic-v2/blocked-window-samples.json)、[全部工作进程观测](2026-11-20-codex-readyz-diagnostic-repair-artifacts/diagnostic-v2/worker-observations.json)、[路径恢复](2026-11-20-codex-readyz-diagnostic-repair-artifacts/diagnostic-v2/path-only-recovery.json)保留。故障先确认真实reader后才开始预算采样；没有删慢样本。前次同条件只恢复路径35秒仍stale的反例不改写。

目标CAV-01已通过局部反例复测；不把SC-08和这些恢复项推定为F61所有SC全覆盖。

## 4. 第三批：查询结果完成后才退出

同前次用真实MySQL视图聚合时对第一行执行SLEEP(10)，保持4／100语义。独立PROCESSLIST确认User sleep后才TERM，使用默认20秒排空／40秒总退出预算，不在回包前sleep冒充依赖工作。

测试直接发送TERM，不使用 `docker stop` 的外部grace／强杀计时；因此这里只验真实信号下的排空与退出，不声称完整部署grace组合已经通过。标准Compose的45秒配置由原有Node/bash回归核对，其他预算组合仍属剩余矩阵。

| 最终候选场景 | 查询HTTP／独立oracle | TERM→观察退出 | 确认后探针／新RPC | 同容器同卷恢复 |
|---|---|---:|---|---|
| 诊断正常 | 200；4／100 | 10.889秒 | livez200、readyz503、health200、新MCP503 | 成功 |
| 诊断挂起第1轮 | 200；4／100 | 10.936秒 | 同上 | 成功 |
| 诊断挂起第2轮 | 200；4／100 | 10.788秒 | 同上 | 成功 |

三轮都实际返回原查询结果后才退出，未OOM，退出码143沿原entrypoint外部TERM约定。诊断故障档仍能排空，说明诊断隔离没有阻塞业务终态。每轮同一容器／原卷重启，不重新seed；原合法HTTP和不带Cookie纯MCP握手／查询恢复，4／100正确。

故障第1轮有Docker时间戳的顺序证据（从stdout/stderr合并后按源时间排序，不能按拼接行序判断）：

```text
04:52:26.425  entrypoint drain begin pid=290
04:52:26.427  coordinator DRAINING pid=290 inFlight=1
04:52:26.627  drain ack received
04:52:36.269  KTX sl_query tool.end outcome=ok
04:52:36.288  coordinator settled inFlight=0
04:52:36.503  Lucy退出，随后停止supervisor/KTX
```

[带时标的顺序证据](2026-11-20-codex-readyz-diagnostic-repair-artifacts/drain-fault-v2-1/slow-query-drain-log.selected.txt)与每轮confirmed-drain-probes、实际查询响应、退出状态及恢复查询保留。正常对照的旧日志未加Docker时标，其stdout/stderr不能直接按拼接顺序解释，耗时／响应／状态判定仍独立有效；两轮故障档均使用带时标日志。

目标CAV-02（MCP登记＋实际服务PID等待）局部复测通过。空闲SSE、>20秒、100轮原子屏障竞争、未知写回执等仍未全跑，不记完整F63 PASS。

## 5. 回归、已知失败与未覆盖项

| 检查 | 结果／边界 |
|---|---|
| 相关Vitest | 5文件31项PASS：真实诊断进程、内存探针、排空协调器、MCP runtime、MCP实际入口；含客户端断开但上游仍运行分支 |
| 授权／会话回归 | 2文件27项PASS；真实本机HTTP与临时身份，不等于Docker完整撤权矩阵 |
| entrypoint／PID | 32项Node/bash回归PASS，含实际启动PID等于被等待PID、延后退出、旧清理／种子／权限约束 |
| TypeScript | 最终 `tsc --noEmit --incremental false -p tsconfig.json` 0诊断 |
| 文档／链接 | Spec／术语／IA／三台链接及本次范围diff-check通过；本次5份Spec／Plan零形态违规。全库 `lint:spec-docs` FAIL：另一已跟踪 `lucy-20261120-page-dom-scale-assessment-plan.md` 的5项索引／形态问题；全库diff-check另有其他任务 `admin/agents.ts` 的行尾空白，不代改其他任务文档或代码 |
| 扩大smoke | 19 PASS／8 FAIL；冻结未修复6b8deec4同样19 PASS／相同8 FAIL，均为begin隐藏后旧预期，未在本次改断言或运行代码抹绿 |
| 中间候选 | 诊断首轮通过；仅MCP登记而仍用npm启动器时查询仍提前断连，FAIL保留于intermediate，不冒充最终通过 |
| 初始受限执行 | 沙箱回环EPERM、tsx IPC限制和不完整基线归档为工具前置失败；补权限／补原归档后重新执行，不记产品反例通过 |

客户端断开回归关闭的是该单测中的独立预算取消策略，以验证“上游句柄仍活着”时不会早退；它不宣称证明取消上游连接后的远程SQL状态。原预算取消及超时合同不变，不能以组件替身冒充Docker／数据库终态。

完整F61仍缺本轮真实权限收紧／吊销、代次竞态、全字段金样本和所有reader独立计数；组件覆盖不替代完整UAT。完整F63仍缺100轮信号竞争、长SSE／>20秒／未知写结果及全部异常预算组合。F62只沿用小数据导出旁证，三类别容量矩阵未完成；R-CAV NOT RUN。未改这些合同或门槛。

状态回写曾误替换4份文档，已从原文恢复并逐项核对：原SC矩阵和核心流程完整保留，元数据各一份，所有既有现值镜像同句。运行代码和实测证据未受影响；未降低验收标准来取得通过。

## 6. 执行与清理

最终候选命令：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/uat/readyz-diagnostic-repro.py \
  --baseline-image project-lucy:uat-readyz-candidate-20261120 \
  --candidate-image project-lucy:uat-readyz-repaired-20261120-v2 \
  --out inbox/readyz-repair-20261120/diagnostic-v2 --verify-repair --seconds 120
```

TERM使用同入口 `--assess-only`，正常对照额外 `--no-fault`，每轮独立out；这里只将执行结果按局部PASS WITH GAP登记。新模式已登记Current Commands／CI Mapping，无新增CI job。

所有本次具名容器／网络／数据卷和私有凭据都由各轮cleanup核验删除；没有重启既有demo，没有全局prune或修改其他任务资源。专用实验镜像保留复查。未修改客户环境，未提交、推送或发布；本机修复不等于客户问题已解决。

## 7. FDE最新回传补充（3577.PNG／3578.PNG）

来源为委托人提供的两张FDE诊断说明截图；不复制图片或客户配置进仓库。它们不是新增原始日志、请求栈或K8s事件，以下现场事实均按FDE回传归属，不冒称本机测量。

截图指向6208ea57；本次修复仅在本机候选验证，未部署客户环境。因此这不是“已修复候选在客户侧再次失效”的证据。

- FDE称6208ea57升级后曾正常就绪、页面和问数可用，运行一段时间后readyz不再返回；单副本失去可用Service后端，随后网关持续503。该描述支持“运行期Ready失效”，不能据此断言Pod／容器又崩溃或发生重启。Readiness失败与容器重启不同，参照[Kubernetes探针语义](https://kubernetes.io/docs/concepts/workloads/pods/probes/)。
- FDE称最近30分钟有31个仍在进行的请求、2小时无完成；其解释与旧版readyz等待readMcpRuntimeStatus且无请求级截止、以及本机FIFO反例一致。但这不是某单请求连续挂起2小时或某个具体文件读取已定位的证据；仍需请求ID配对／线程栈／同窗指标。
- 新增规模线索：现场做过短名修改、保存1883张启用表，并触发配置重载。该操作当时还能返回Lucy结果，只能证明当时服务活着；不能单靠时间先后证明它是之后挂起的直接原因。
- 两图同时保留“文件读取不返回”和“同步计算占住事件循环”两种可能。第一批的可终止诊断I/O隔离直接覆盖前一机制；如果主进程被其他同步配置／审计计算占住，纯内存探针仍可能来不及调度，不能宣称本次修复已覆盖所有503。

据此补充验证差集：至少1883张启用表的合成配置，真实短名修改／保存／配置重载与审计维护同窗运行，观察启动成功后的持续运行及复发；分别记录livez、readyz、普通HTTP／纯MCP、事件循环延迟和诊断工作进程终态。规模不以4行查询夹具替代，观察时长需覆盖FDE给出的实际首次失效间隔；当前尚未取得该间隔，不凭空认定120秒足够。此场景仍NOT RUN，不改既有跑次或完整矩阵判定。

第二批可抑制重任务竞争和故障放大，但不保证消除每个模块内部同步计算；第三批处理重启／停止时的请求排空，不消除稳态readyz挂起。该差集复用原Spec和R-CAV／既有性能条目，待确定具体阻塞源后归属，不重复立项、不自动扩大运行修复范围。
