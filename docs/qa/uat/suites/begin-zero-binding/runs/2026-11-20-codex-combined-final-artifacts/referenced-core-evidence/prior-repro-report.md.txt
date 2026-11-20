# 2026-11-20 Codex — readyz 真实 I/O 阻塞与超时恢复

| 项 | 记录 |
|---|---|
| 归属 / 授权 | P1-61／62／63；委托人本次明示本机 Docker 全真复现，重点第一批、诊断采集超时恢复及第二三批作用评估；[执行 Plan](../../../../../plans/lucy-20261120-readyz-diagnostic-repro-uat-plan.md) |
| 执行时间 | 2026-11-20 12:18:45–12:28:17 CST（有效主对比及补充对照）；证据时间戳为 UTC |
| 判定 | **F61 局部 FAIL**：探针隔离预算通过，但真实停止合同有缺口；**F62 局部 PASS WITH GAP**：只验证真实导出；**F63 局部 FAIL**：已执行的纯 MCP 查询在 TERM 后提前断连；R-CAV NOT RUN |
| 层级 | 本机真实 Docker、OS 文件 I/O、MySQL、HTTP/MCP、TERM；不是 mock collector，不是客户现场验收，不是整套 UAT PASS |
| 产品改动 | 本次未改产品运行代码、客户环境或制品发布；仅增加测试工具、取证和状态登记 |
| 正式证据 | [artifacts](2026-11-20-codex-readyz-diagnostic-repro-artifacts/)；原始过程日志在仓库 `inbox/uat-readyz-20261120/`，不是唯一证据 |

## 1. 客户证据怎样进入复现

输入为客户外部 WIP 基线 README v0.3、FDE 图片 `3571 2.JPG` 和委托人“硬件配置 ok”的确认。基线记录 6208ea57／KTX 0.16.0、Kubernetes、约12个活跃 Agent、30日约2.9万业务调用，依赖包含 SelectDB、Kerberos HMS 和 MySQL。FDE 的 readyz incoming 多、未见相应完成记录，支持检查“请求等待内部异步读取”的假设；不能凭此认定某一请求连续挂起两小时，也不能认定 Pod 重启、OOM 或客户 PVC 故障。

本次使用源码已确认会读的 `.ktx-ui/ktx-reload.state.json` 构造真实 OS 等待；不声称客户文件是 FIFO。没有获得客户实际镜像 digest、PVC、资源 limits、探针和事件日志，因此只复现**相同等待机制**，客户根因仍待只读现场证据。客户文档、凭据和业务原文未复制进 Git。

## 2. 冻结环境与差异

| 项 | 实际值 |
|---|---|
| 基线源码 | `6208ea5727bdb72b19333c574e8fbe047871f846` |
| 候选源码 | `6b8deec4d4750fe5f35f3510192e968844a5c0e1`，包含三批实现；不包含共享工作树未提交运行改动 |
| 基线镜像 ID | `sha256:67277edc48974592234f1d92dd0be5b23b260ba15132eaef9c6343b48735f776` |
| 候选镜像 ID | `sha256:be39241e6770af0b331a841cd78e4153e7254291f3ea229ce2b18ba11d4ed8eb` |
| 依赖层 | 本机固定镜像 `sha256:c1cd67a0df3dffd33b7c9d0c3914ca4a759bb5a6e4e8af3f9fe6b8c66323a218`；Node v22.23.5／KTX 0.16.0 |
| 构造方式 | git archive 的 `webui/server`、`scripts/runtime`、`webui/config` 替换依赖镜像内对应目录；BUILD_REVISION 显式记录源 SHA 和 dirty；[构建配方](2026-11-20-codex-readyz-diagnostic-repro-artifacts/Dockerfile.lab) |
| 实际运行 | linux/arm64；每个 Lucy 单实例2 CPU、2GiB；原生具名数据卷、独立 MySQL 8.4 容器与网络；宿主仅随机127.0.0.1端口；标准 tini→entrypoint→Lucy/KTX 启动，无入口替换 |
| 数据 / oracle | 自产4行 MySQL，独立 SQL 核对 count=4、sum=100；普通测试身份合法，真实管理员 Cookie 访问 `/api/project`；纯 MCP 不带 WebUI Cookie |
| 安全配置 | 仅隔离测试使用 `LUCY_WEBUI_TEST_PROFILE=1`／非 Secure 本机 Cookie；不关闭鉴权，不复制客户 Token；私有文件0700目录／0600文件，结束清除 |

这是实验源码层镜像，**不是历史客户镜像或整版重建的相同 digest**。其他依赖和前端资产复用固定层；原生 arm64、4行 MySQL、单实例直连不等于客户 amd64、HMS/Kerberos、数据规模、PVC、Ingress 或资源基线。候选对比不能把所有版本差异都归于第一批单一补丁；故障定位结合具体路由和采集调用链。

身份、关键代码哈希和夹具指纹见 [source-manifest](2026-11-20-codex-readyz-diagnostic-repro-artifacts/source-manifest.json)、[runtime-identity](2026-11-20-codex-readyz-diagnostic-repro-artifacts/runtime-identity.json) 与两个 artifact。共享的 fixture helper 在其他任务中有修改，本跑次未修改它；主对比记录 helper 哈希 `c73fa824…`，恢复补充记录 `92dd7ba7…`，不能把它们说成同一测试工具版本。产品实验镜像始终固定；各组独立 oracle、请求结果和进程证据保存。本次 runner 后续固化为一次读取 helper 源码再计算哈希并加载，避免今后执行期间读取到另一版指纹。

## 3. 故障构造与旧版对照

1. 等待实际服务完成启动及后台诊断 fresh；先做真实 HTTP 与 MCP 读取。
2. 仅在测试数据卷中备份诊断 reload state，将原路径替换成0600 FIFO；真实 Python 进程持有读写端，不写入也不关闭，真实 `fs.readFile` 等待 EOF。
3. 记录 inode、Node `/proc/<pid>/task/<tid>/wchan=pipe_read`。不在产品代码添加 sleep，不替换 collector、权限、成功 JSON 或 DB 返回。
4. 分别执行两种恢复：先只恢复路径为普通文件而保持旧 FIFO 句柄，再真正写入并关闭旧 FIFO，令原读取终结。

旧版结果：readyz 4秒客户端截止仍未返回，livez 返回200／3.743ms；Node pid359／tid370处于 `pipe_read`，目标 FIFO inode584067。释放实际读取后 readyz 返回200／29.661ms。[请求与线程证据](2026-11-20-codex-readyz-diagnostic-repro-artifacts/baseline-requests.json)、[释放后](2026-11-20-codex-readyz-diagnostic-repro-artifacts/baseline-recovered.json)。客户端超时不等于服务端 Promise 结束。

这证明“旧探针等待诊断文件 I/O 时，即使主事件循环活着也可能不返回”。若部署探针因此摘除唯一后端，就可能表现为网页不可用；本次未启动 K8s／Ingress，不将其记成已经复现网关503。

## 4. 第一批：隔离有效，超时真实停止有缺口

[全部240个原始探针样本](2026-11-20-codex-readyz-diagnostic-repro-artifacts/probe-samples.json)；容器内单调时钟计时、120秒各1Hz，nearest-rank p99，无删除慢样本。两探针同 tick 并行发出；没有执行 SC-01 的所有 reader 独立计数。

| 路由 | 样本数 | 非200 | p99 | max | SC-08 |
|---|---:|---:|---:|---:|---|
| livez | 120 | 0 | 64.811ms | 90.961ms | PASS |
| readyz | 120 | 0 | 66.177ms | 72.796ms | PASS |

首次样本诊断仍fresh，约10秒后的采样观察到stale（后台 tick 加5秒截止，不能把注入时刻当采集开始时刻）。持续挂起后 `observedAt` 一直为 `2026-11-20T04:19:33.184Z`，age持续增长；没有用请求时刻伪造新鲜。故障前、挂起中、真实恢复后的 HTTP 读取与纯 MCP `initialize`→`tools/list`→`lucy_query` 均成功，独立 oracle 4／100 一致。此部分只覆盖 SC-07 的合法路径，未执行吊销身份分支。

恢复分开判定：

| 操作 | 结果 | 含义 |
|---|---|---|
| 5秒诊断截止 | 对外stale，原线程持续 `pipe_read`，单在途仍占用 | 超时返回策略不等于真实停止 |
| 只恢复路径 | 普通文件inode546061，但原Node tid339仍 `pipe_read`；35次观察fresh=0 | 原读取持有旧inode，路径恢复不等于旧I/O已经恢复；**单凭此项不判SC-04失败** |
| 释放旧FIFO的实际I/O | 第7次（约6秒后）观察fresh，新observedAt=`2026-11-20T04:22:22.722Z`；无需重启 | 底层确实终结后，下一周期能够恢复，迟到旧结果未直接冒充fresh |

**缺陷 CAV-01（P1-61 §2.5／SC-05，P1）：** `collectDependencyDiagnostics(_signal)` 未消费 AbortSignal，`readMcpRuntimeStatus` 的真实文件读取没有对应取消或执行隔离上界；5秒只标stale。实际读取持续超过120秒且人工恢复路径后仍挂起，采集单在途不会释放，后续tick不能启动新采集。持有许可而不隐形超发符合原设计，但并未完成“每个I/O可取消或有真实执行上界”的合同，**F61局部判FAIL，不能宣称超时自愈已完成**。close幂等、代次竞态、请求内全部reader计数和完整旧字段金样本本次未执行。

下一步应在原P1-61内补足真实取消／可终止执行边界、挂起原因及持续时长可观察性，并回归超时、迟到、恢复和close；不能只加Promise.race或放开single-flight制造后台堆积。本次不实施修复。

## 5. 第二批：用于限制放大，不解除诊断等待

三次补充均走真实 `/api/admin/audit/turns/export?hours=24`，每次12请求／6线程；不是模拟协调器。诊断挂起首轮11个200、1个429，max72.828ms；无故障对照12个200，max95.062ms；挂起重复12个200，max89.559ms。429只记录状态，没有验证完整机器码／Retry-After，不能算完整饱和合同通过。小数据导出并不保证每轮都饱和。

挂起窗口导出完成后诊断仍stale。可见导出入口可用且曾出现容量拒绝，但跨三类任务总running／waiting、80次提交、公平性、撤权、断连后的真实资源许可终结均未覆盖。因此只登记**局部PASS WITH GAP**，F62完整矩阵未完成。

作用判断：第二批能限制重建、导出、发现同时执行时的资源竞争与故障放大，对重负载诱发的503有帮助；它不控制这次诊断readFile，也不能用导出成功推定诊断已恢复。客户是否由重任务争用触发仍没有证据。

## 6. 第三批：独立排空缺陷，诊断正常也会失败

把同一测试表暂改为同名真实MySQL视图，聚合时只对第一行执行 `SLEEP(10)`，保持4／100数据语义；发出真实纯MCP查询，独立查询 `information_schema.PROCESSLIST` 观察 `User sleep` 后才发送容器TERM。不是在回包前sleep，不靠固定延迟猜查询已启动。

| 场景 | 真实DB工作已开始 | TERM→观察到容器退出 | 查询 | 结果 |
|---|---|---:|---|---|
| 诊断挂起首轮 | 是 | 0.685s | connection closed，无结果 | FAIL |
| 诊断正常对照 | 是 | 1.634s | connection closed，无结果 | FAIL |
| 诊断挂起重复 | 是 | 1.005s | connection closed，无结果 | FAIL |
| 无在途查询的正常TERM | 不适用 | 1.094s | 无查询 | 仅退出 smoke 通过 |

各轮退出码143；不是以143单独判FAIL，而是**已实际执行的10秒查询在20秒排空预算内被提前中断**。日志为 drain begin→ack received→lucy settled exit→stopping supervisor；没有等到该查询tool.end。三轮均没有OOM，未用SIGKILL凑通过。

**缺陷 CAV-02（P1-63 SC-03，优先修复）：** 冻结候选的 Web `onRequest` 接入 `tryAdmitBusinessWork`，MCP Proxy未接入同一协调器的真实工作登记／settle。关停协调器可能看到0在途而直接退出，随后停止KTX，纯MCP查询被截断。该源码解释与DB/连接/退出证据相符；不是“diagnostics卡住导致所有进程无法退出”。原第三批建议P2顺序不在本次擅自改写，但已证伪的查询排空承诺必须修复后才可收口。

恢复验证：无故障对照及挂起重复都在移除**测试构造**、还原合成表后，启动**同一容器／同一原卷**，不重新seed；HTTP鉴权读取及无Cookie纯MCP全链路再次成功，4／100正确。恢复后可用不能抵消提前断连的FAIL。完整F63的100轮竞态、三次完整排空通过、>20秒、SSE、未知写回执等未覆盖。

作用判断：第三批解决重启/升级时在途请求被切断，并不消除稳态诊断I/O挂起，也不保证单副本关停窗零503。当前实现尚不能作为可靠排空保障。

## 7. 执行入口、判定与清理

实际主命令（首次fixture触发文件权限失败已修正后重跑）：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 scripts/uat/readyz-diagnostic-repro.py \
  --baseline-image project-lucy:uat-readyz-baseline-20261120 \
  --candidate-image project-lucy:uat-readyz-candidate-20261120 \
  --out inbox/uat-readyz-20261120/run-2 --seconds 120
```

补充分别使用 `--assess-only`、`--assess-only --no-fault`，每次独立out。测试脚本导入现有fixture helper；源码镜像构建需先按冻结SHA归档三个目录并使用上面的Dockerfile，不使用当前dirty运行代码。命令登记于Current Commands／CI Mapping，无CI job。脚本可执行完并保存失败结果，**进程返回0不代替合同判定**；旧补充版本没有将查询失败映射非零，最新runner已按该失败返回1。

无效跑次run-1：旧版阻塞已触发，但fixture控制文件权限使释放失败，不能记完整通过；只修测试控制文件使用root，不改产品读取权限。无效跑次身份/哈希保留于原始证据清单。

所有本次 `lucy-readyz-*` app/db/network/volume和私有凭据均按各轮cleanup记录删除；未重启既有demo、未删其他任务卷、未全局prune或改builder。专用实验镜像保留供复查。其他任务并发运行容器属于宿主噪声边界，不作为安静独占宿主性能认证。

本次优先顺序：先补第一批真实停止／恢复缺口并保留探针隔离，再修第三批MCP真实工作登记；第二批继续完成原容量矩阵。三者均复用原Spec，不重复立项；客户具体挂起位置仍待只读回传，暂不更改客户环境。

## 8. 文档与工具核对

`lint:spec-docs`、`lint:spec`、术语、IA、e2e勾连、diff-check、runner语法及help均通过；三条现值与全部既有镜像同句，局部证据链接可解析。既有无关在途Plan的5条形态WARN、eval配对及角色迁移WARN不由本次代改。[核对记录](2026-11-20-codex-readyz-diagnostic-repro-artifacts/validation.json)与[证据哈希](2026-11-20-codex-readyz-diagnostic-repro-artifacts/evidence-manifest.json)保留；这些文档门禁不抵消上述真实UAT失败。

已登记[错题与漏检规则](../../../../../lessons/2026-11-20-readyz-timeout-and-mcp-drain-gap.md)，未新增重复功能条目或扩大运行修复授权。
