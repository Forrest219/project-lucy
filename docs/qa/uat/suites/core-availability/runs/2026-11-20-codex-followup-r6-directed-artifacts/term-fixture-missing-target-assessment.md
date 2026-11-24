# TERM11 辅助还原：仅本次已证备份的有限缺失态

只读结论：M授权的new11计划属于SC06 TERM后同卷补偿验证的**夹具撤障**，没有新增产品恢复规则、放宽预算或一般missing-file豁免。尚未审签/运行new11源码或实际结果。未测试/Docker/SQL，当前B持实际锁。

## TERM10 已证和未证

来源：`docker-driver/r6-revision10/term/post-fail-missing-target-assessment.json`。原app确已停止，Running=false、Pid0、ExitCode143、OOMKilled=false、elapsed1.48004375s，原RPC canonical503 SERVICE_DRAINING。原backup实际regular与注入前preimage完全匹配：dev65025/inode771594、mode0644、uid/gid10001、nlink1、size342924、sha256 `6ebb261d1ef67b5a0a93120b106aaf347dc6e7c7125d672338e7094c56589804`。

helper先通过原backup身份校验，再在target lstat遇ENOENT而exit1；该异常先于unlink/replace，不存在已覆盖新文件或已更改WAL的证据。没有保留unlink actor追踪，不能把FIFO消失归因到生产copyFile或控制器中的任何一方。实际FAIL及资源清理原样保留；原卷启动/同身份恢复、最终SQL和预算/有效审计仍未执行，不能补PASS。

## new11 允许的局部状态

先满足：原app已真正停止、原容器/唯一task volume身份与注入时相同、旧app/controller不再运行、无其他该卷writer，exact backup确由本次rename取得且仍匹配原preimage。不是凭同名文件、时间邻近或摘要相似猜归属。

| 观察态 | 允许动作 |
| --- | --- |
| backup精确，target为本次精确FIFO（dev/inode/mode/uid/gid/nlink均匹配） | 直接atomic os.replace(backup,target)，无需先unlink。 |
| backup精确，target经lstat返回ENOENT | 同样只做atomic replace；这是已拥有原件的本次夹具partial-state还原，不是任意缺文件重建。 |
| backup已不存在，target完整匹配原regular preimage | 可沿既有严格already_restored分支，仅记录实际幂等完成。 |
| target为symlink（含dangling）、任何现存regular/dir/其他kind或错FIFO；backup错身份/缺失且target未精确还原 | 拒绝，不覆盖、不猜、不补文件。 |

lstat而非exists判断缺失，避免dangling symlink被当作absent。若ENOENT实际来自父目录已不存在，atomic replace仍会失败；**不得mkdir重构父目录**。源backup与target同task volume，rename保留原inode/字节/mode/uid/gid/nlink；helper不需自行重写内容或chown成“看似相同”的新文件。

## 必须保持的后置证据

- 原关停≤40s/143/非OOM与原503闭包先独立结算；helper阶段不加入产品20/40/45/reload20/60额度，不重启已关停生命周期。
- helper仍同AE0、明确纯还原entrypoint、readonly根文件系统/no network、仅唯一原task卷，有界实际退出与独立cleanup/absence；不是新controller或产品恢复服务。
- replace后regular的完整原identity、backup absent及helper前后WAL/lock清单摘要不变；只变本次注入镜像/FIFO/backup。不删journal/latch/lock，不伪造phase/owner成功。
- 之后原app同volume按既有startup recovery真正处理WAL，另行取证；原Token/session/问题显式恢复及真实SQL/原预算/有效审计全部仍must。新helper成功本身不是SC06补偿完成，也不代替SC03不重启修复。

这只是现合同测试夹具的有限状态接受；旧TERM10 FAIL不能被重签，新11仍须新hash/out/负例/独立复核及M实际调度。没有全功能收口、UAT或上线结论。
