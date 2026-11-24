# P170 五定向真实 case：独立最终复核与出口范围

**独立结论：五个选定真实分支 INDEPENDENT SCOPED VALID。** 这支持登记其限定验收事实；不是把所有 SC／完整 UAT／可发布判为 PASS。正式 SC-08 原独立 strict FAIL/VALID 保持，不用本条替它补 PASS，也不新增发布旅程作为本条出口前置。

实际调用 `actual-invocation-1.json`：Apple stock Python3.9，verifier source `1135260fc004302f198b6d1286824a8f1dccaba6e3947d011450506f62a2c5ed`，PID23504，exit0，0.138秒，执行前后源码相同。只使用标准库，未 import producer oracle；没有新 Docker、产品测试或运行代码变化。资格窗执行完已立即返 M。

| 实际输入 | 原请求成功/失败 | 预算独立实查 | 实际 MySQL | 全库审计行数 |
|---|---:|---|---|---:|
| revision7 normal | 3/0 | 三工具各 calls=attempts1/current0 | serial各自1/0/0 | 4 |
| revision7 deadline | 1/1 | 同a/同session拒绝+显式恢复 calls=attempts2/current0 | 原拒绝0、恢复1 | 5 |
| revision8 revoke | 1/1 | a原拒绝1；b合法2/30恢复1；各current0 | 原拒绝0、b恢复1 | 5 |
| revision10 failure | 1/1 | 同a/同session原失败+显式恢复2/current0 | 原拒绝0、恢复1 | 5 |
| revision11 term | 1/1 | 同Token/原session重启前拒绝+后恢复2/current0 | 原503拒绝0、恢复1 | 5 |

合计11个实际原请求，7成功／4失败，失败始终留在分母。TERM恢复calls2是原受理票据与用户显式重试分别计次，不是重复consume；不套用P1-69入口拒绝零预算的独立合同。

每份实际封闭 SQLite backup 的 gzip尺寸/hash 与解码尺寸/hash 全先验真，之后才在隔离0600临时文件上以 `mode=ro&immutable=1` 只读打开。五份解码临时目录全部finally删除，无SQLite旁写sidecar。全24行（各库4/5/5/5/5）非空用户均唯一有效同用户turn关联，missing/duplicate/wrongUser/orphanRaw/orphanTurn均0，每用户complete与MAX(id)水位一致。逐RPC匹配原user/session/tool/requestId、唯一稳定tokenprefix及响应outcome，成功query SQL=原compiled且query_operation=select；metadata/explain SQL及operation为空，原失败没有业务SQL执行字段。

scope由raw dispatched/terminal身份与数据库实际唯一稳定prefix推导，不从producer verdict取值。只取`summary.originalBudgetAtWait`这一直接当时SQL snapshot数值行作pre-retry观察，逐字对started/round/window/origin保持；未读取或使用summary.independentBudgetAudit。normal没有pre snapshot，独立证据限定为calls1/attempt1、round/window0、origin=started、started落首个原请求真实区间；不编造额外历史采样。没有读取Token原文或已删除private，身份承诺仅原HTTP operation、脚本静态who、实际角色结果与审计稳定prefix链。

实际SQL来自原general_log全row，normal按before/after multiset各自取增量；只接受本fixture明确metadata白名单或原成功compiled的whole SQL／固定单层KTXwrapper，未知Query/Execute一律unsupported失败，未借producer classifier签SQL0。补充小JSON时间核验 `raw-sql-temporal-binding.json`：五条实际业务SQL各在唯一原成功RPC区间内，负例均在显式recovery RPC5而非被拒RPC2。没有以总并发1条替各工具归因。

## SC-01–07：实际支撑与剩余边界

| 合同 | 此轮实际已证事实 | 不能由这五case单独推出的范围 |
|---|---|---|
| SC-01 | 三工具分别真实regular-file lease→Node sourcefd/__break_lease→owner/WAL绑定等待→files_saved→原RPC成功；query4/100/SQL1，授权read_source元数据/SQL0，explain plan_only/executed:false/SQL0；各单票据有效审计 | 控制延迟是显式资格化，不是自然性能；两gate覆盖需与已保留真实HTTP／组件先红绿一起引用 |
| SC-02 | 入口+20s固定资格；实际20s reader超时但writer仍held，故障结清后同Token/session显式4/100；budget起点/代次未重置 | ABS剩余、elapsed剩余、budget-off、settled/最后合法票/socket句柄这些已组件定向覆盖的分支，不冒充五case都做过Docker实测 |
| SC-03 | 真实mirror故障失败关闭；原磁盘锁释放后显式运维修复原journal，原Node上合法MCP与新写恢复；失败／恢复回执及独立审计均保留 | orphan/旧格式/损坏/不可读/mark失败等需挂原组件反例；没有新增公共修复API或“自动恢复”承诺 |
| SC-04 | actual正常阶段日志files_saved在reader醒来之前，真实new bytes/mirror hash一致；不能由stage称confirmed | deferred reload/append/mark/后续终态失败与重启不回滚结论应挂原8case真实目录/WAL先红绿，不能把此轮normal补成所有失败分支实际DockerPASS |
| SC-05 | 真实DELETE200双ack与原请求精确403 authorization_revoked；内部cancelled raw保留、规范响应归因另列；修复后旧Token仍401、合法b当前NORTH2/30成交 | 等待中行约束/source-map/config代次变更的其它组合不是此轮actual；引用已有当前权限／fresh-catalog真实HTTP反例，不声称全组合已跑 |
| SC-06 | 真实TERM原503、term-end、writerfailed，外TERM143/nonOOM/1.377s；停机后仅恢复本task注入fixture，原卷/原Token/session恢复；单票据最后current0 | actual客户端断连、真实120秒截止及publish→reload相互等待其它组合要按已有组件HTTP、P1-69实际10/25证据分别描述，不混同本五case；原20/40/45、reload20/60不扩大 |
| SC-07 | 每次固定原owner/journal/ingress/RPC，真实唯一stage终态；原scope round/window/started保持，恢复不串身份 | 绑定前失败／旧owner迟到／第二owner／新WAL／代次不匹配的并发交错主要是已保留组件反例，不能以本次单owneractual替代；不新增无限矩阵 |

组件证据和真实Docker证据可以共同挂合同；上列是证据类型／覆盖差集，不能将“不是每个组合都Docker跑过”改写为新增产品合同或新发布旅程。最终状态镜像由 M 按已批准Plan及完整证据登记；本独立报告不改共享Spec/SOT/INDEX。

## 历史与明确非结论

旧7 revoke FAIL、旧8及10 TERM FAIL各自原因与未执行后段仍保留，新增工具只使用freshout证据；没有追补。TERM11 helper仅在实停原app后，同AE0/no-network/readonly-root挂原taskvolume，exactbackup→missingtarget原子恢复，原inode/hash/metadata验证且WAL前后不变；不能推定谁移除了FIFO，也不是产品恢复接口。main4/helper最新absence/private/hostops的真实清理结论分别保留。

SC-08正式r6自然30min原生产者PASS WITH GAP与独立strict FAIL/VALID（audit-progress214超时与两漏采）仍独立登记，最终审计闭合不抹掉进度采集GAP。prospective stdin工具71/71资格包尚未合入canonical，不能追签旧正式run。完整F61/F62/F63/R-CAV、客户交付或上线就绪均不由此报告签结。
