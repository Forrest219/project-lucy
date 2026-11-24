# r4 普通查询 semantic_recovery_required 只读诊断

日期：2026-11-20。生产源码保持冻结；未运行 Docker、SQL 或负载。原 calibration-r4-contract FAIL 保留。

## 结论

这是正常 Manifest 写入和普通 MCP 查询重叠时暴露的可用性缺口。不是夹具故意写错 recovery 状态，也不是 P1-69 reload owner 迟退票。此次错误满足既有恢复失败关闭规则，不能豁免成 SC-03 expected 503；本轮组合验收仍失败。问题在恢复安全合同与正常维护期可用性衔接，需要先证明细分阶段，再选择最窄修复。

整份 Manifest 是实际原子替换目标，包含固定查询源；只改另一张表的短名，并不意味着物理写集只覆盖那一张表。删除 connectionId hint 既违反现有明确回归，也不能证明整个 Manifest 的读取安全。

## 原始时间线（UTC）

| 事实 | 时间 | 证据 |
|---|---|---|
| mcp-11 发起，agent11 / independent-question-11 / 固定 SOURCE | 09:52:03.429793 | events.jsonl:747；同一请求 queryArguments |
| cycle-1 开始正常变更 | 09:52:08.424644 | events.jsonl:816 |
| Manifest upload 服务端受理 | 09:52:09.801 | final-container-log.json:603，req-7r |
| mcp-11 返回 HTTP200、tool isError、semantic_recovery_required | 09:52:10.784450 | events.jsonl:854、candidate/soak-query-11.json |
| 上传 record.createdAt（源码位于 mirror 返回后） | 09:52:12.406 | candidate/cycle-1-upload.json |
| 静态 reloadCatalog 开始／结束 | 09:52:12.406 / 12.552 | 上传回执 reload.startedAt / finishedAt |
| upload 正常完成，uploaded=true | 09:52:15.994 | final-container-log.json:653；events.jsonl:920 |
| cycle-1 自动执行层 reload owner acquire | 09:52:22.580 | final-container-log.json:713 |
| 同 owner release，activeRpcCount=0 | 09:52:35.322 | final-container-log.json:813 |

普通 mcp-10 和 mcp-12 均成功；mcp-11 返回的错误明确来自恢复门禁，不是未知 upstream 错误。辅助裁剪证据见同目录 `r4-semantic-recovery-diagnosis.json`。

**证据边界：** 没有此次 journal ID、实际 rename / mirror 分段时间戳。因此不能签定具体哪一个 await 占用 1.62 秒。mcp-11 拒绝早于 mirror 后创建的 record 时间，也早于静态 reload 开始；尤其不能声称此次失败已被证明发生在 mirror 完成后的冗余阻断段。正常事务进入 write_in_progress 的源码与最终正常成功回执支持上述因果判断，但不替代缺失的逐阶段见证。

## 合同与源码

- L25-11 `lucy-20261020-v2p5-semantic-batch-operations-spec.md` §7.2：正式目标写入前登记 WAL；全部 promote 后进入文件已保存／索引终态待确认，不能提前 completed；未恢复、部分写入或结果不确定时涉及读取必须关闭。
- `semantic-recovery-journal.ts:109`：files_saved 表示 every target was written，索引／终态仍未证明；`:497` 推进 phase，不关闭 journal。
- 同文件 `:840`：recovery_required 与 write_in_progress 阻断，files_saved / activation_pending 不因索引未确认永久阻断。
- `catalog-assets.ts:1063`：正常上传也创建 open/write_in_progress journal，身份为 connection/schema，目标为整个 `_schema/uat.yaml`。
- 同文件 `:1100` 附近 atomic rename，随后完整 mirror；只有 mirror.failed=0 才继续。`:1141` 开始静态 reloadCatalog，appendRecord 后才 `:1156` markFilesSaved，之后 closeContentBatch 才结终态。
- `mcp-proxy.ts:6989`：查询在取得执行 slot、转发 KTX 之前进行恢复读取门禁。本请求的特定中文消息与 `semanticRecoveryReadBlock` 命中已命名资产的分支完全一致。
- `semantic-batch-recovery.test.ts` D3 明确覆盖普通 in-progress journal 阻断、不同明确资产可读、connection-only 阻断及含点 connectionId 的保守判定。不能靠删 hint 凑绿。
- P1-69 显式没有把 Manifest 上传改成执行层重启；SC-03 只允许精确 owner 闭包内的 HTTP503 EXECUTION_RUNTIME_RELOADING 与完备同身份恢复证据。本请求早于 owner，且错误码与协议都不符。
- 额外注意：现有代理 questionBudget.consumePersisted 位于恢复门禁之前（`:5557` 对 `:6989`）。本次预算事实由 B 独立审计；本报告未查数据库，不声称它等同 SC-03 的零预算拒绝。

## 最窄候选 A：修正 files_saved 推进位置

**现有 Spec 已有依据，不新增放行语义。** 应在全部实际目标 atomic rename、必要 mirror 与实际 digest 核验后、昂贵静态目录重载与审计前推进 files_saved，保持 journal open、release/activation 未确认。批量发布 `semantic-assets.ts:3875` 也在索引前推进该阶段。

先红反例：真实临时目录上传，在真实写入和 mirror 完成后以 deferred 卡住 reloadCatalog；此时 journal 应 files_saved/open，受影响读取通过恢复门禁，release 仍不能 published/confirmed。当前代码会留 write_in_progress，应先红。再绿只移动阶段，不跳过任何写入、镜像、摘要或终态条件。

必须保留负例：rename/mirror/digest 未完成或失败仍关闭；mark 持久化失败仍关闭；reloadCatalog/appendRecord/终态审计失败不返回假成功，保持原内容事实与 unconfirmed；在 files_saved 边界重启不回滚已完整写入内容；故障 journal / 无法读取日志仍明确关闭。`syncContentToProjectRoot` 是通用 best-effort upsert，其 failed=0 不是独立密码学摘要证明，若以该点作为推进边界应核对实际目标与镜像预期 digest。

**局限：** 此修复只消除写完后的过度阻断。现有真实失败发生于静态 reload 之前，故不能凭该修复断言本次 FAIL 已解决，更不能保证正常 rename/mirror 期间不再遇到合法拒绝。正常写入本身仍应保持失败关闭。

## 候选 B：真实活跃事务的有界准入等待

若定向证据证明普通查询确实命中真实 rename/mirror 期间，则需另行明确合同：只对可证明仍活跃的本进程写事务短等待，等待中不执行数据业务、不自动重放；重新读取 WAL 后才走正常门禁。残留、未知 owner、recovery_required、不可读及等待截止继续原失败关闭；TERM/权限收紧优先；不得让 reload drain 与本查询形成自等环。

这不是现行 P1-69 的实现修补：该 Spec 只规定 reload 屏障立即拒绝；L25-11 也没有给查询维护等待预算。需要 M 在现行合同增补等待范围、截止、预算计费时点与同身份补偿并确权后才实施。可以用本次约 1.62 秒的阶段差作为设计输入，不能把一次观测当通用等待上界。优先先做 A 的分段反例与真实原场景复验，再决定是否需要 B；不扩大错误豁免。
