# Run — 2026-11-15 — cursor-row-policy-first — UAT-SUITE-ROW-POLICY

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-ROW-POLICY` |
| 总账 | P1-28／REQ-030-049（核心分母）；P1-29／REQ-030-050（取值缺口，不入核心分母） |
| Agent | Cursor |
| 环境 | 本机 demo。容器 `compose-lucy-1`。compose project `compose`。WebUI `http://127.0.0.1:55176`。MCP `http://127.0.0.1:57881/mcp` |
| Health | 关／开 proven 的重建之后均为 `ok`。`lucyVersion=0.30.0`。`gitSha=f954913557cd97563352177fd0ecffff79dbfbf5`。`gitDirty=true`。`bundledKtxVersion=0.16.0`。`ktxRuntime.status=ready` |
| 开跑前 proven | 未设置 |
| 凭据 | WebUI：`/Users/forrest/Desktop/lucywebui logi.txt` 不在，改用 `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`。桌面问数 Bearer `/Users/forrest/Desktop/lucy token.txt` 对本次 MCP 返回 HTTP 401，对照改用套件内无个人约束的 Agent。口令与 Token 明文不写入本跑次 |
| 自造数据 | 连接 `demo-mysql`。表 A `uat_row_policy_pl`，表 B `uat_row_policy_expense`。行级列 `company`。取值 `NORTH`／`EAST`／`SOUTH`。表 A 金额 100／200／300，表 B 金额 10／20／40。语义 source 与表同名。Role `uat-row-policy-role`（`permission_model_version: 2`，两表 `row_access: all`）。个人范围只写在 Agent constraints |
| 人员映射 | `u01`–`u04` 两表 `NORTH`；`u05`–`u08` 两表 `EAST`；`u09`–`u11` 两表 `SOUTH`；`u12` 表 A `NORTH`、表 B `SOUTH`。另有无约束对照 `uat-row-policy-ctl`，以及 ROW-07 的 `uat-row-policy-bad` |
| 总判定 | **FAIL**。必做没有全部达到期望。≠ 可上线，≠ 核心升级完成，≠ 功能合同收口 |

查询形状（除各条写明的例外）：`connectionId=demo-mysql`，`source` 为单表，`measures=[<source>.amount_sum]`，`dimensions=[{field:"<source>.company"}]`，`limit=20`，无 joins，filters 不含行级列。

## UAT-R0 — PASS

`compose-lucy-1` healthy。端口 `55176→5174`、`57881→7879`。开跑前 `printenv LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` 未设置。即将使用的 Role 只点名两张自造表，`tables` 不含 `*`。`u01` 的有效授权后来核对为 2 个 source、5 个工具，响应里没有 `"*"`。

为了能写入 Role，把 6 份 2026-11-14 遗留的语义恢复日志标成 `restored`（`rj_04dc17df`、`rj_07d4a82c`、`rj_37e9d906`、`rj_7080be3a`、`rj_78ab640f`、`rj_e6f8cc14`）。它们都指向 `semantic-layer/demo-mysql/_exposure/superstore_orders.yaml`，活文件对不上日志里的新旧摘要，启动恢复会把未终结日志重新打成 `recovery_required` 并挡住后续写入。本次没有改那份暴露文件。

## UAT-ROW-01 — PASS

Gate-Off 使用 `docker-compose.ac-p1-by01-proven-off.yml`，同一 project `compose`，`--force-recreate --no-deps lucy`。重建后 `printenv` 为 `false`。`u01` 对表 A 的 `lucy_query`：HTTP 200，`isError=true`，原因码就是 `row_policy_upstream_unproven`。响应没有事实行，分组为空。

## UAT-ROW-02 — BLOCKED

Gate-On 使用 `docker-compose.row-policy-uat-proven-on.yml`，同一 project。重建后 `printenv` 为 `true`，`gitSha` 仍是 `f954913557cd97563352177fd0ecffff79dbfbf5`。

12 人的 `lucy_explain_query` 和 `lucy_query` 都是 `source_ambiguity_gate`。detail 为 `need_begin_or_confirm`。`candidates` 为空，repair 写「未找到通过可用性检查的来源」。没有公司分组，`finalRowsNonTrue` 没有取到。套件要求先完成来源确认再继续；确认入口要求 person 与 `x-lucy-host-attestation`，这次没有走完。因此不能把隔离判成 PASS，也不能把这个门闩记成行权限拒绝码错误。

## UAT-ROW-03 — BLOCKED

表 B 上 `u01`、`u05`、`u12` 以及无约束对照都是同一个 `source_ambiguity_gate`。没有分组，不能核对 `u12` 的跨表范围。

## UAT-ROW-04 — PASS

proven 仍为 `true`。`u01` 在一次 `lucy_query` 里同时给出两张表的 `amount_sum`，没有 joins 键。原因码就是 `row_policy_query_shape_forbidden`。响应没有事实行。

## UAT-ROW-05 — BLOCKED

三条都发了。向量 1（`forced_filters`）和向量 2（源限定名 `uat_row_policy_pl.company eq SOUTH`）停在 `source_ambiguity_gate`，没有到达「剥掉载体」和「0 行成功」的断言。向量 3（带齐 `field`／`op`／`value` 再加 `or`）的原因码是 `row_policy_query_shape_forbidden`，这一条符合现行合同。三条没有齐，本条不记 PASS。

## UAT-ROW-06 — PASS

`u01` 对表 A 调用 `lucy_read_source` 与 `lucy_freshness`，参数都写了 `connectionId=demo-mysql` 和 `sourceName=uat_row_policy_pl`。两次文本都是 `Access denied: row_policy_requires_wrapped_tool`。没有样本行。

## UAT-ROW-07 — FAIL

另建 `uat-row-policy-bad`。字面量 `NO_SUCH_COMPANY`。Admin 先 `dryRun: true` 再 `dryRun: false` 保存 constraints。创建、预览、保存都是 HTTP 200，`ok=true`，没有错误码。没有看到一条独立的「该取值在库中不存在」警告；脚本里出现过该字面量，只因为请求体被原样带在响应里。通过线没有达到。这是现行实现的预期失败，归 `GAP-UAT-P1-28-VALUE`／P1-29。不改期望。本轮没有为它开实现 Spec，也没有开发授权。

## UAT-ROW-08 — PASS

登记修复时补做，不是停表当时已经完成。结果已复核：

- 14 个 `uat-row-policy-*` Agent 与 Role `uat-row-policy-role` 删除均为 HTTP 200
- `demo-mysql` 的 `enabled_tables` 回到 `superstore_orders`／`superstore_returns`／`superstore_people`
- 两张 MySQL 表已删除；作者目录和项目镜像里的 source yaml 已删除；schema manifest 不再含 `uat_row_policy_`
- 用不带 proven overlay 的 `docker-compose.demo.yml`、project `compose`、`--force-recreate --no-deps lucy` 重建。容器 healthy。`printenv` 为未设置。`ktx.yaml` 中 `uat_row_policy` 计数为 0

## UAT-ROW-OBS — SKIPPED

没有做 Wiki 或 join 观察。

## 复跑

按 [cases.md](../cases.md) 与 [fixtures.md](../fixtures.md) 从头再跑。开跑前确认 proven 未设置，并且没有 `uat-row-policy-` 与 `uat_row_policy_` 残留。ROW-02 若再遇到 `source_ambiguity_gate`，先完成来源确认再记隔离结果；确认后仍被拦住才记 FAIL。
