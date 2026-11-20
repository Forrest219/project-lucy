# B9 TERM 后夹具撤障：只读合同核对

结论：按M给定范围，先核原容器真实关停，再用独立有界helper只撤回本次FIFO注入、恢复原镜像文件，随后原app同卷启动并验证原身份补偿，属于**现SC06 TERM恢复验收的测试夹具还原**。它不改生产恢复规则、不延长20/40/45或reload20/60、不新增部署支持。未改运行代码，未运行测试/Docker/SQL。

## 原FAIL与现合同

`docker-driver/r6-revision8/term/post-fail-control-assessment.json` 已证真实wait→TERM→end(term)、原RPC canonical503 SERVICE_DRAINING、writer failed及inFlight0。旧driver在原app已退出后继续exec restore/facts而失败；精确哪个exec失败未留argv/rc，不能猜。原stop状态/143/非OOM/≤40、原卷恢复、最终SQL及预算/审计未验，旧FAIL不得回写PASS。

Spec「决策二」禁止TERM后重开当前实例SERVING、不取消真实writer来伪退票；SC06要求原预算、真实终态和补偿。现测试应保持原app真实TERM及退出后证据，再显式启动原task容器/原volume测试恢复；这是新启动，不是旧生命周期重新SERVING。该TERM场景允许原卷重启，不能拿它代SC03“故障结清后无需重启Lucy”的独立恢复证明。

## B8 缺少的备份归属依据

revision8/semantic-control.py:55–71 实际先确认原mirror regular/no-symlink、backup不存在，再os.replace(MIRROR,BACKUP)，随后创建本task FIFO。rename保留原文件inode、字节、mode/uid/gid；但现state只保存FIFO inode/sourceRegular，未保存原文件/backup摘要及完整身份。故不能仅凭固定backup文件名或exists就允许新helper移动它。

新9在注入当时应保存安全事实，不输出YAML/凭据：

- 本task ID、实际owned volume身份、exact mirror/source/backup路径；原regular/no-symlink preimage的SHA256、size、Linux dev/inode、mode、uid/gid（可另记nlink作为拒绝未知别名的防御）。
- rename后backup的同组事实与preimage逐项匹配；证明它确实来自本次原mirror，而非既有同名文件。原backup已存在即拒绝安装。
- 注入FIFO自己的Linux dev/inode、mode、uid/gid、type；helper恢复前必须匹配该确切FIFO，不按路径猜归属。

宿主不重解释Linux dev_t；字段由容器内stat/lstat/fstat获取。同卷helper只接受本次已保存expected事实，不能在恢复时重新取当前值充当原始expected。

## 最小执行边界（待新revision实际证明）

1. 原app内仍可用时仅执行已批准的FIFO release，使真实writer失败/settle；不再要求退出中的app继续提供restore/facts exec服务。
2. 等真实docker stop完成，记录原stopSignal、实际state exit143/nonOOM、关停≤40秒、原503/owner/TERM闭包；该关停计时在helper之前结算，不把后置还原时间混成产品延长预算。
3. 独立helper使用同AE0、覆盖entrypoint为纯还原程序、只读根文件系统、network none、仅本task唯一原volume以RW挂载。执行/cleanup有原定有界时间、唯一名称及真实退出/资源absence。helper不启动Lucy/KTX、无supervisor、不是常驻新controller。
4. helper先用lstat/严格身份及digest核原backup与本次FIFO；只删除确切自有FIFO并rename原backup回原mirror，核恢复后regular、原inode/hash/size/mode/uid/gid及backup absent。拒绝symlink、错inode/hash/owner/mode、缺backup、未知regular目标，不能覆盖生产正常写入。
5. 容器停止可能触发原controller finally已完成还原：仅在backup absent且target完整匹配原preimage时记录already_restored；不能将“backup不在”单独作为成功。没有证据就FAIL，不能重新构造一个看似相同的新文件补证明。
6. 不改WAL/journal/release/budget/audit/lock/latch；helper前后相关WAL字节摘要/清单保持，只有夹具mirror/FIFO/backup变更。随后原app同volume startup沿既有production recovery流程处理WAL，变化另行取证，不把helper称恢复函数替代品。
7. 再验证原Token/session/问题显式恢复、原预算/有效审计闭包和真实SQL次数；未运行或缺证仍FAIL/GAP。补偿不能新发Token、换卷seed、删WAL或重放原SQL。旧B8原始FAIL完整保留，新9独立out/hash/命令/结果。

以上是窄夹具计划的合同边界，不是新9已通过。待B新源码/负例与A/M复核及M另授实际窗口；当前没有P170收口或UAT结论。
