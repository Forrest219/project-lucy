# r6 同镜像定向验证：重载与正常语义写入等待

状态：**定向验证完成；P169所选分支局部通过、完整矩阵仍有GAP；P170五项实测及独立验证有效，局部功能合同收口。** r6正式1800秒／12周期的独立严格FAIL另见[正式跑次](2026-11-20-codex-followup-r6-1800.md)，本页不回写或覆盖该结果，不签整套UAT或发布。

候选统一为`sha256:ae0eb26a73d9331f45e4276f9839c442f9c8ada0ff2701366c7c2b099b8f7a4f`，Node22.23.5／KTX0.16.0。运行代码、三份canonical工具与候选上下文保持冻结。下列inbox辅助夹具的修订、独立review和离线反例不冒充真实Docker通过；重负载测试共用一把资源锁。

| 场景 | 实际结果与范围 | 原始证据 |
|---|---|---|
| Supervisor 10秒在途 | SCOPED PASS：原查询4／100先完成，后发布真实重载；PID250→994且配置verified；新RPC精确503，预算／查询审计0，显式原身份恢复单票据／唯一SQL | [完整原始档案](2026-11-20-codex-followup-r6-directed-artifacts/core10-25.tar.gz) · [独立复核](2026-11-20-codex-followup-r6-directed-artifacts/r6-core10-25-independent-review.md) |
| Supervisor 25秒在途 | SCOPED PASS：20.004秒drain失败时原PID／startTicks与receipt不变，inotify无stop请求；25.603秒原查询成功，随后显式恢复才发布重载／新PID1973 | 同上；该次拒绝不从分母删除 |
| 直接CLI：5项 | SCOPED PASS WITH GAP：显式API仍unsupported且零CLI副作用；默认10秒成功stop／start，原daemon确实消失；25秒排空失败及1500ms更紧截止均不stop原进程／查询；无consumer的已声明通道失败不暗退CLI | [v4完整原始档案](2026-11-20-codex-followup-r6-directed-artifacts/direct-cli-v4.tar.gz) · [独立复核](2026-11-20-codex-followup-r6-directed-artifacts/direct-cli-v4-independent-review.md) |
| P170 normal | revision7实际exit0／83.614秒，独立VALID：三个工具串行各一次真实regular-file lease，各有owner／WAL／原RPC wait闭环，原SQL1／0／0、各单预算票据；无phasegap，原Node未变，清理true | [完整原始档案](2026-11-20-codex-followup-r6-directed-artifacts/p170-normal-revision7.tar.gz) |
| P170 deadline | revision7实际exit0／93.115秒，独立VALID：入口固定20秒，前处理已用约3.6秒，实际wait16.389秒后拒绝；writer仍真实持锁，原拒绝SQL0；修复后原身份原问题4／100及新写成功，原拒绝与显式恢复共2票据 | [完整原始档案](2026-11-20-codex-followup-r6-directed-artifacts/p170-deadline-revision7.tar.gz) |
| P170 revoke | revision8实际exit0／83.293秒，独立VALID：DELETE200及双ack，原HTTP403／授权吊销，SQL0；内部raw endOutcome=cancelled保留，依精确operation／owner闭环归因；原Token持续401，合法另一身份2／30与新写成功 | [完整原始档案](2026-11-20-codex-followup-r6-directed-artifacts/p170-revoke-revision8.tar.gz) |
| P170 TERM | revision11实际exit0／111.610秒，独立VALID：原503 SERVICE_DRAINING；真实exit143／非OOM／1.377秒；独立辅助容器只原子恢复精确自有backup、不改WAL，原容器原卷原Token重启恢复4／100；helper及主资源全部清理true | [完整原始档案](2026-11-20-codex-followup-r6-directed-artifacts/p170-term-revision11.tar.gz) |
| P170 failure | revision10实际exit0／82.724秒，独立VALID：实际mirror失败保持WAL与保存真值，writer真实释放后走既有恢复函数与真实semantic_restore锁；原Node原身份4／100及新合法写入成功；原拒绝SQL0、恢复唯一SQL | [完整原始档案](2026-11-20-codex-followup-r6-directed-artifacts/p170-failure-revision10.tar.gz) |

五项生产者保留SCOPED PASS WITH GAP的范围标签，不扩大为完整系统矩阵。非作者[独立验证报告](2026-11-20-codex-followup-r6-directed-artifacts/independent-final-sql/outlet-review.md)、[实际命令及退出码](2026-11-20-codex-followup-r6-directed-artifacts/independent-final-sql/actual-invocation-1.json)与[完整重算](2026-11-20-codex-followup-r6-directed-artifacts/independent-final-sql/attempt-1/result.json)均已归档：验证器SHA1135260f…实际exit0，五项INDEPENDENT SCOPED VALID。11个实际RPC（含4次恢复／合法身份补偿）＝7成功＋4失败，失败留在分母；五份封闭备份先验压缩／解码双hash与尺寸，再用只读immutable SQLite重算24条审计，全量无孤儿／重复／错属／水位缺口。实际业务SQL按唯一RPC时间绑定，不把恢复SQL归给被拒绝原请求；预算normal各1，deadline／failure／TERM原拒绝＋显式恢复各2，revoke两身份各1，current均0。临时解码全删除。

## 原失败及夹具修正

- [直接CLI v2实际FAIL](2026-11-20-codex-followup-r6-directed-artifacts/direct-cli-v2-fail.tar.gz)：自动保存已HTTP404结束，未进入reload。新v3仅把合成JSON seed转换为同值、同类型、同权限的正常block YAML，并用既有纯patch函数作不写盘前置验证；没有放宽原8秒观察或产品20／60秒预算。
- [直接CLI v3实际FAIL](2026-11-20-codex-followup-r6-directed-artifacts/direct-cli-v3-fail.tar.gz)：旧查询成功，停止后socket已消失，但native stop未在10秒内返回，保存503。未捕获该次旧daemon的终态，不能追认它是僵尸。独立纯拓扑探针证实Node作PID1可能留下孤儿僵尸；v4仅为测试容器补正常`--init`与安全进程事实。v4实测旧daemon消失，不证明所有stop故障或新客户部署支持。探针原wrapper因大小写误标清理并退出1，原记录和真实rm／inspect不存在的纠正附录分开保留。
- [P170旧normal实际FAIL](2026-11-20-codex-followup-r6-directed-artifacts/p170-normal-revision2-fail.tar.gz)：实际查询、预算和有效审计正确；旧checker把生产小写`select`误判为大写`SELECT`。三工具均未捕获实际wait，保留三个阶段GAP，不能修枚举后转PASS。后续revision3–7仅修辅助资格判据／控制，旧真实失败不回写；未执行的版本不伪造Docker结果。
- [P170 revoke revision7 FAIL](2026-11-20-codex-followup-r6-directed-artifacts/p170-revoke-revision7-fail.tar.gz)：原规范403正确，辅助checker错误要求内部事件一对一映射授权原因，后置恢复／审计未执行。revision8仅以精确原operation、吊销提交与双ack、规范403及原owner闭环修正判据；原raw cancelled不改，泛化取消不豁免。
- [P170 TERM revision8 FAIL](2026-11-20-codex-followup-r6-directed-artifacts/p170-term-revision8-fail.tar.gz)：原503及term事件真实，但试图在已停止容器exec恢复夹具，后置未完成；[revision10 FAIL](2026-11-20-codex-followup-r6-directed-artifacts/p170-term-revision10-fail.tar.gz)保留目标ENOENT导致精确恢复前拒绝。revision11仅允许精确自有backup对missing目标原子恢复，未猜测谁删除FIFO；不先unlink、不改WAL、不清latch。旧失败不回填后置成功。

normal的regular-file lease仅延迟本任务真实mirror打开写，SIGIO／精确lease holder PID＋Linux设备与inode／活进程／真实worker和WAL均须绑定；原RPC实际wait后手动解除，自动／迟到解除仍记GAP。控制不得回写旧mirror、修改目标权限、伪造WAL或清原进程latch。三工具串行各只发一次，逐一核独立真实SQL1／0／0、原预算与有效审计。此为定向正确性控制，不作为自然性能正例。

## 限定结论

直接CLI的1500ms失败不代签默认60秒精确失效；任意stop挂住／启动失败／kernel I/O、全部响应阶段、权限组合及完整F69／F61／F62／F63／R-CAV仍按各自合同和测试台逐条判定。P170本条SC-01–07以组件、真实目录／HTTP和本页Docker共同完成，见[功能出口复核](../../../../../reviews/2026-11-20-semantic-read-write-settle-closure-review.md)，不要求范围外整库发布旅程；SC-08组合严格FAIL独立保留。远端CI未执行。真实受控函数修复不新增公开修复API、客户交付形态或自动清latch能力。功能合同、局部UAT、完整组合、WebUI、发布和客户结论分别登记。
