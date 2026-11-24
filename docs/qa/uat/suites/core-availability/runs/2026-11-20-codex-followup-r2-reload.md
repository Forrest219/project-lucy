# 热重载候选2：真实短在途、排空截止与同身份恢复

| 项目 | 内容 |
|---|---|
| 日期／执行 | 2026-11-20／Codex，多agent任务CA-06局部实测 |
| 授权 | 委托人批准执行CA-00–09；仅本机隔离Docker与自有合成MySQL，不commit／push／发布／改客户环境 |
| 判定 | **SCOPED PASS WITH GAP**；只证明本跑次的SC-01／03／04核心路径，不是完整F69、F61／62／63、R-CAV或功能合同收口 |
| 源码 | 7dded5478a05e256aa23d33567b49beb3820ec3b加本轮dirty差异；[候选完整身份](2026-11-20-codex-followup-r2-reload-artifacts/candidate-manifest.json)，1245个镜像内文件hash与冻结源码一致 |
| 镜像 | sha256:4a9f7c36845d827ce27b6ba9128b5f743b1b9142b53b7a8d4c80b5082fef1ea9；linux/arm64；Node22.23.5／KTX0.16.0 |
| 环境 | 单实例应用2CPU／2GiB、独立MySQL／网络／原生卷；WebUI静态资源继承依赖镜像，本跑次不签前端制品结论 |
| 合同 | [P1-69／REQ-030-090](../../../../../specs/lucy-20261120-runtime-reload-drain-spec.md)；[核心工程Plan](../../../../../plans/lucy-20261120-core-availability-followup-plan.md) |
| 证据 | [summary](2026-11-20-codex-followup-r2-reload-artifacts/summary.json) · [原始事件／回执／驱动快照](2026-11-20-codex-followup-r2-reload-artifacts/raw-evidence.tar.gz) · [附件hash](2026-11-20-codex-followup-r2-reload-artifacts/files.sha256) |

## 实际结果

| 场景 | 真实约束 | 合法路径与副作用证明 |
|---|---|---|
| 10秒短查询＋手动重载 | MySQL PROCESSLIST确证User sleep已受理，再启动实际reload；owner的activeRpcCount=1；新请求明确503 EXECUTION_RUNTIME_RELOADING，requestId／deadlineAt／rejectedAt绑定实际owner | 旧查询4／100完成且SQL实际只执行一次；随后真实KTX PID切换。拒绝请求预算前后均无记录、无执行审计；同Token、同session恢复后预算calls／attempts=1，只有一条实际成功query审计 |
| 25秒长查询＋排空失败 | 实际已受理且20秒排空截止时仍在运行；reload失败，不发布破坏性request，不替换KTX PID／startTicks；内核inotify没有本次request创建／改写 | 原查询依旧完成4／100；之后沿原owner入口显式reload成功，同Token新请求恢复4／100。无业务自动重放；原查询和恢复查询实际SQL总数为2 |
| 清理 | 所有操作均限本任务具名容器／网络／卷／私有夹具 | 原始清理回执全部true，未操作compose demo资源 |

MySQL通用查询日志独立计数与MCP预算／审计同时核对，不能只凭HTTP200或owner自报。相同问题恢复是测试驱动显式发起，不是产品自动重放。

## 历史与未覆盖项

候选1首轮因MySQL8.4原生JSON将BLOB日志编码为base64，判定器把一条SQL误计为零并触发清理；原FAIL保留。修正为明确UTF-8转换并兼容旧原包解码，6项判定器回归通过；本候选2从头重跑，不拼接旧PASS。首次清理导致的慢查询连接关闭不能倒推为产品截断。

本次没有覆盖完整的客户端断连／持久响应终态矩阵、100轮准入竞争、授权收紧两身份、三阶段TERM、直接CLI全矩阵、启动／存储／digest故障以及1883表小时组合。相应组件／真实shell先红后绿在开发证据单列，不能冒充本跑次UAT通过；后续新增真实跑次独立登记。功能合同收口与整套UAT、上线分别判定。
