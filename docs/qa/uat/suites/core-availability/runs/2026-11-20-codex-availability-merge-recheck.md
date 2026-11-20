# 0.30合入候选：既有可用性修复复测

| 项目 | 内容 |
|---|---|
| 日期／执行人 | 2026-11-20／Codex |
| 授权 | 委托人要求本次修复先合入0.30、跑现有验证；后续Plan放下次开发。不push、不发布、不改客户环境 |
| 判定 | **局部PASS WITH GAP**：现有诊断实际停止／两轮自动恢复、三轮真实MCP查询TERM及原卷恢复通过；不是整套F61／F62／F63或R-CAV PASS |
| 整合源码 | d978f4df50224ce3e462a11d1f52636a28725b34；含f98deeb9修复、18b63d01预算／短名修复及0.30已有6cf930f8／5b61d06e；后续取证提交不改运行代码 |
| 镜像 | project-lucy:uat-v030-availability-20261120；sha256:8baa62dc30b8774f7ec443558a12bf72e1f40adb08d83a640036d93288230189；linux/arm64 |
| 运行时 | Node22.23.5／KTX0.16.0；应用2CPU／2GiB，独立MySQL、网络及原生卷 |
| 制品边界 | 全部已提交后端源码由整合提交归档；WebUI静态资源取固定c1cd依赖镜像，不签前端／整包制品／客户镜像结论。实际10文件hash与源码匹配 |
| 证据 | [核验汇总](2026-11-20-codex-availability-merge-recheck-artifacts/verification.json) · [镜像与hash](2026-11-20-codex-availability-merge-recheck-artifacts/image-identity.json) · [原始Docker记录](2026-11-20-codex-availability-merge-recheck-artifacts/docker-evidence.tar.gz) · [附件hash](2026-11-20-codex-availability-merge-recheck-artifacts/artifact-files.sha256) |

## 本次实际结果

| 项目 | 结果 |
|---|---|
| 44项定向Vitest | 6文件44／44通过，含原有真实SQLite写争用、内存探针、FIFO实际取消、MCP在途与容量组件 |
| entrypoint／PID Node测试 | 32／32通过 |
| 全库TypeScript | 0错误 |
| 真实诊断FIFO持续120秒 | livez／readyz各120样本、全200；p99分别38.554／27.966ms，最大95.402／96.043ms，满足原轻档100／500ms预算 |
| 实际执行上界 | 观察到16个诊断工作进程，其中14个实际阻塞；最大同时1个，最长可见生存4.828秒；独立0.25秒采样，不把离散观察外推任意内核故障硬保证 |
| 两轮路径恢复 | 不重启、不释放旧FIFO句柄即自动fresh；首轮9.229秒，第二轮也成功；前中后HTTP／纯MCP实际4／100查询通过 |
| 正常条件TERM | 已观测MySQL User sleep后发信号，10秒查询结果4／100完成；约10.867秒退出0，原卷原容器重启恢复 |
| 诊断故障TERM第1轮 | 同样实际查询完成；约10.880秒退出0，原卷恢复 |
| 诊断故障TERM第2轮 | 同样实际查询完成；约10.875秒退出0，原卷恢复 |
| DRAINING准入 | 三轮确认ack后均为livez200／readyz503／health200，新MCP503；没有以客户端先断开代替底层工作完成 |
| 清理 | 四个具名夹具的容器／网络／卷／私有临时凭据均清理，回执全部true；实验镜像保留 |

使用既有 `scripts/uat/readyz-diagnostic-repro.py` 的verify-repair及assess-only选择器：后者正常1轮、诊断故障2轮。旧parser要求baseline-image参数，选择器实际不执行baseline；本轮未新增改前运行或把同镜像参数当新对照。所有采集来自最终镜像，不从旧候选拼接PASS。120秒测试不是新1883表长跑。

## 合入与分期

先在隔离分支合并f98deeb9，解决5处文档冲突时只替换本进程行并保留0.30已提交内容；其后又整合验证期间新增的5b61d06e，重新冻结d978f4df并重跑上述检查。未复制共享工作区角色／Agent等在途实现到候选。0.30快进仅在分支、索引和工作文件前置核对后进行；未推送或发布。

[后续Plan](../../../../../plans/lucy-20261120-core-availability-followup-plan.md)已明确下次开发。本次只复跑现有修复，不实施新的热点减负、热重载保护、测试工具重构或约1h满量组合任务；已有预算回归也不代签该Plan完整出口。

## 门禁与保留缺口

Spec／术语／IA／三台账勾连检查通过。整合快照的全仓Spec文档门禁仍有另一份page-dom-scale Plan的5处原有索引／元数据／结构问题，与[阶段基线对照](../../../../../reviews/2026-11-20-core-availability-checkpoint-review.md)相同；本进程相关文档无新增违规，未增加豁免或带入该任务在途状态。原始日志／补丁按hash保留，源码及本次新文档空白另核验。

[1883表约1h补验的FAIL](2026-11-20-codex-fde-1883-soak.md)保留：它未含后续预算修复，本次也未重跑1883表满量，因此不能宣称其5次预算503已在等规模场景消失。主线程热点／同步等待、热重载中断的新整改、1883表I/O恢复与全量审计闭包、F62三类别、F63其余生命周期和完整R-CAV仍按各自GAP管理。客户入口503根因未由本次本机复测确证。

原始Docker包内121份文件逐份核验hash。只有本次已明确子场景通过，不改变各功能Spec未完整收口／不可上线的现值，不代签客户更新或完整0.30验收。
