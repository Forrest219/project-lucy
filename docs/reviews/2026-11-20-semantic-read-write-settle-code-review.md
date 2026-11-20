# P1-70 正常语义写入读取等待：最终代码终审

日期：2026-11-20。范围：[P1-70／REQ-030-091 Spec](../specs/lucy-20261120-semantic-read-write-settle-spec.md)及其[实施 Plan](../plans/lucy-20261120-semantic-read-write-settle-plan.md)的四个运行文件、必要定向测试和本轮验证工具修复。

**最终结论：APPROVED。** Codex CLI 0.165.0 第二轮只读代码终审确认：限定现行 diff 内无剩余 P1／P2 正确性、安全或回归问题。G3 于 2026-11-20 11:06:11 UTC 登记为 `APPROVED FOR FROZEN CANDIDATE VERIFICATION`。本结论允许进入冻结候选验证，**不表示完整实际 Docker 验证、整套 UAT PASS、WebUI／浏览器 PASS、可上线或客户交付完成**。

## 原发现与闭环

原 `REQUEST CHANGES` 保留，未用最终结论覆盖历史：

| 来源 | 具体问题 | 最终闭环 |
| --- | --- | --- |
| 非作者独立代码复核 | owner 已结束的旧 WAL 快照漏原等待截止；异步重新核验期间 TERM 被降级；预算关闭时等待后断连仍可能发业务请求 | 阻断快照权威重读前后检查原资格截止；结果与异常出口统一核对现行授权屏障／TERM；实际请求体写出前检查真实取消、TERM及原预算。真实负例与修复后回归保留，三项 CLOSED。 |
| 第一轮 Codex CLI | post-wait 重新核验复用写入前的 60 秒目录缓存 | 仅该路径直接读取当前语义目录；真实 Manifest 新增第二个可读同名字段的原请求应拒绝 `ambiguous_field`，业务 SQL 为 0，原预算与审计各一次；共享普通请求 TTL 未改。独立只读复核 CLOSED。 |
| 第一轮 Codex CLI | 父进程／管道结束掩盖同 PGID 孙进程存活，远程工具可能误记 complete | 真实 fork、忽略 TERM且标准流重定向的反例先红；host／container 共享终止及进程组消失验证，原调用超时与独立 2 秒清理 grace 不变；未知终态不报 complete，不杀无关会话。隔离新副本通过后精确合回。 |

独立复核还确认首次 WAL 可见前的真实 holder／project／journal 绑定、首次落盘失败的实际 failed settle、目标与必要镜像摘要和 `files_saved/open` 持久化顺序，以及后续 reload／历史／终态失败保留保存真值、重启恢复不误回滚。SC04 测试作者未编写上述产品实现；产品复核按非作者执行。

## 已有验证与冻结身份

G3 记录整合回归 **28 文件 360/360 PASS，typecheck exit 0**；工具离线检查为 core 57、helper 11、independent 45。定向组件／真实 HTTP 证据分别覆盖三个工具各自的查询、授权源元数据与 `plan_only/执行诊断` oracle，单次预算与有效审计，以及截止、授权变窄、TERM、真实已知客户端断连和阶段恢复。代码终审与本报告编写均未重新启动测试、构建或 Docker 负载。

冻结关键源码 SHA256：

| 文件 | SHA256 |
| --- | --- |
| `webui/server/publish-coordinator.ts` | `c81c2f4de4e34ac1ea37d3fc35820cee306455b73f6f597979fda7dc6ba0ffe5` |
| `webui/server/semantic-recovery-journal.ts` | `a5863c17e66c614e62b20bafa9d6fef405f5aa719d4bbe062a5f85007f748993` |
| `webui/server/catalog-assets.ts` | `65d323faa40f25d369e595531e8c7f172860bd533a8e358ffe6f19ebedd08df0` |
| `webui/server/proxy/mcp-proxy.ts` | `281b430efaeb7e518b4e1ac5c82add323baf59de9c170505e3620812cbe2c353` |
| `scripts/uat/core-availability-1883-soak.py` | `38a37d780aabb62d047e19484d9da97651fa233f5708bbcb04262733ac9095b4` |
| `scripts/uat/verify-begin-zero-binding.py` | `291e09aa6cc9789f3e77dcd4dac2761deb293d525befded16ccb271d6be84d96` |

候选 r6 镜像为 `sha256:ae0eb26a73d9331f45e4276f9839c442f9c8ada0ff2701366c7c2b099b8f7a4f`；G3 记录实际镜像 1247 个文件校验、0 不匹配。此身份仅绑定该冻结候选，不转移到其他源码组合或后续构建。

工程原始依据暂存 `inbox/core-availability-followup/20261120-execution/`：`07-checks/G3-p170.json`、`final-cli-review-p170-result.md`（原 REQUEST CHANGES）、`final-cli-review-p170-r2-result.md`（最终 APPROVED，SHA256 `94d93df96605d8185aefbd039a80521c6b52d864a0435ca984765164ab54d78a`）；独立复核与精确身份见 `10-semantic-read-delta/independent-proxy-review-r2*`、`independent-cache-review-r3*`，进程组修复见 `01-tools/owned-group-termination-fix/`。本报告固化上述终审结论与身份，过程日志不代替正式跑次证据。

## 验收边界

实际 Docker 场景仍待完整验证；同一候选正式 **1800 秒／150 秒周期／至少 12 轮**及后置恢复、审计取证和清理未完成前，不预写通过。组件与整合回归、代码 APPROVED、真实局部结果各有独立范围；旧候选 FAIL 不改写，缺证据仍保留 FAIL／GAP。功能合同收口、整套 UAT 与发布结论均须按各自门禁另行裁定。本报告不修改 Spec 状态、三台账镜像或其他文档。

以上“仍待验证”为G3时点的历史边界。后续真实五项及独立SQL已完成、局部功能合同收口，正式30分钟组合独立严格FAIL保留，见[功能出口复核](2026-11-20-semantic-read-write-settle-closure-review.md)。原CLI输出、原REQUEST CHANGES及组件／HTTP原始日志现已持久归档于[review-and-local-checks.tar.gz](../qa/uat/suites/core-availability/runs/2026-11-20-codex-followup-r6-directed-artifacts/review-and-local-checks.tar.gz)，不再仅依赖临时inbox。
