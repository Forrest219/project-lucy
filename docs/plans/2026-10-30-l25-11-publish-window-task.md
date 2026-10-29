# L25-11 收口 Task：发布窗口、读取准入、导出基线

日期：2026-10-30。授权：继续落地 L25-11 的既有冻结合同，不改 V01–V22 的「未执行」状态，不重建 Docker，不实现 L25-16 的 W-B。

合同仍以 [语义资产批量维护 Spec](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md) §7.2、§5、D3、D4、D7 为准。2026-10-27 独立审阅的产品语义不撤销。本 Task 只补现码里仍和合同不一致的三处。

## 1. 发布锁盖住终态

`publishSemanticAssets` 的后台索引在 `reindexImpl` 返回时就释放发布锁，终态摘要核验、终结审计、`published` 和恢复日志完成都在锁外。手动索引的历史记录写在 `withPublishCoordinator` 之外。

收口：成功、索引失败、摘要失败和未预期异常都先落可恢复状态，再释放锁。手动索引的历史记录留在同一窗口内。

## 2. 未决恢复关闭受影响读取

`isRecoveryRequired` 只认 `recoveryRequired`。普通 `write_in_progress` 日志不拦发布和手动索引。Lucy 的 `lucy_query` / `lucy_read_source` / `lucy_explain_query` 不看恢复日志。

收口：

- `recovery_required` 与仍处于 `write_in_progress` 的日志关闭发布、手动索引，并关闭对得上的读取和查询。
- 日志读失败按关闭处理，不得当成「没有未决恢复」。
- `files_saved` / `activation_pending` 表示文件已核验、生效未确认。它们不永久关闭下一次发布，也不关闭读取。在途发布仍由第 1 条的锁挡住其他写入口。
- 读请求对不上具体资产，或日志条目无法命名时，本次读取关闭。

## 3. 导出基线按服务端记录核对

服务端导出记录此前不保存 role、共享身份、基线和选择集。核验用上传包自报的 role 决定要不要做只读字节检查，也没有要求条目全集与服务端记录相等。

收口：记录 role、共享身份、路径、target/base/baseline digest、selected、dependencies。摘要不一致时按服务端记录逐项核对；角色被改、条目被删、共享身份被改，整包拒绝。缺这些字段的旧记录要求重新导出。

## 不做

- 不把批量校验端点改成可发布计划（那是 L25-16 的 G30 消费约束）。
- 不回填 V01–V22，不跑客户 linux/amd64，不重建 Docker。
- 不改升级建议书的共享版本号。
