# 2026-11-18 Codex 接管补修：慢盘与恢复补充跑次

| 元数据 | 内容 |
| --- | --- |
| 状态 | 补充容器性能与恢复验证通过；正式全量客户验收未完成，不升级为全局发布 PASS |
| 代码 | ff4762c9 基础未提交工作树；镜像 takeover-complete，详见源码标识 |
| 授权 | 委托人授权容器替代，并明确保留 K8s 调度、Service 摘端点及真实网关缺口 |
| 范围 | P1-45 / P1-47 及单表续查、慢启动就绪和滚动窗口补充回归 |

## 结果

- 真实 amd64 容器，4 CPU / 8 GiB 限额，30 MiB/s、300/100 IOPS；维护器默认开启。
- 首次补算前120秒 livez max/p99=304/298ms，readyz p99=309ms；强杀重启前120秒=265/239ms、395ms；全200。
- 完整重启观察期 livez max/p99=265/227ms、readyz p99=372ms；248次连续已鉴权项目请求全200。
- 追加客户3秒/5秒HTTP观察器：就绪48次、存活24次，最大连续失败0；非 kubelet，未覆盖完整启动阶段。
- 20万合成日志背景下中断用户2988/2988、unlinked=0；另6000调用真实SIGKILL由25恢复至6000。
- 113项定向、65项根目录合同通过；全量6478通过/50基线失败，新失败0；类型33基线错误。
- health完整观察期单次4500ms，均200/ok，保留P1尾延迟；真实业务连接未验证。

## 边界

压力卷是此前升级测试卷，不是本轮从干净3a9客户快照重新执行的完整链。恢复结论限中断用户，未等待67用户队列全部结束。客户Hive、字段启用、Agent歧义、真实K8s与网关均未执行；正式套件的全部逐例运行不能由本补充跑次替代。

## 证据

[汇总](evidence/2026-11-18-codex-takeover/acceptance-summary.json)、[恢复进度](evidence/2026-11-18-codex-takeover/verified-K-recovery-progress.json)、[源码](evidence/2026-11-18-codex-takeover/product-source-identity.json)、[回归基线](evidence/2026-11-18-codex-takeover/full-comparison-verified.json)。
