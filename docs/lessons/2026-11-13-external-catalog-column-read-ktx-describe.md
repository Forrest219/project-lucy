# 错题：外部目录能列表却读不出字段（`ktx sql` 禁止 `DESC`，替身比真实 KTX 宽松）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| 标签 | `contract-stack` `gate-gap` `ux-regression` `sev-high` |
| 环境 | 客户／测试现场 SelectDB 外部目录 `hive-1`（Schema `dim`）；KTX 0.16.0；本机 demo 容器复现 KTX 校验 |
| 相关 | [`lucy-20261113-external-catalog-column-read-spec.md`](../specs/lucy-20261113-external-catalog-column-read-spec.md)（P1-20）；[`lucy-20261111-catalog-scan-read-path-spec.md`](../specs/lucy-20261111-catalog-scan-read-path-spec.md)（P1-16，原 SC-10）；提交 `175c5945`、`e1c4d36e`、`97fe7ee8` |
| 状态 | `mitigated`（2026-11-13 功能合同收口，修复 `97fe7ee8`；客户 SelectDB live 未验，故未写 `closed`） |

## 1. 症状与影响

- 「准备表结构」侧边栏：`hive-1`＋Schema `dim` 能列出 43 张表；勾选 `dim_bidding_block_ad_id_2025` 后提示「表「…」没有读到字段。」，而表侧确认有字段。
- 外部目录（Hive 类）的准备表结构实际不可用：能看见表，建不出 Manifest。主路径受阻，客户可感知。

## 2. 复现要点

在 KTX 0.16.0 容器内，用其自带的 `validate_read_only_sql_response` 校验：

- `DESC \`hive\`.\`dim\`.\`t\``、`DESCRIBE …` → `SQL contains read/write operation: Describe`
- `SHOW COLUMNS FROM \`hive\`.\`dim\`.\`t\``、`SHOW TABLES FROM …` → `Invalid expression`
- `SELECT 1` → 通过

`mysql`／`starrocks`／`doris` 三个方言结果一致。

## 3. 根因

- **KTX：** `ktx_daemon/sql_analysis.py` 只放行根节点为 `Select`／`Union` 的语句，`Describe`、`Show` 在禁止列表。所以 `ktx sql` 里的 `DESC` 到不了 SelectDB。
- **合同：** P1-16 发现 `SHOW` 进不了 `ktx sql`，把列库／列表改成直连；同时把字段读法写成「`DESC` 仍走 `ktx sql`」（SC-10）。同一条 KTX 规则只在 `SHOW` 上被认出来。
- **现场事实被误读：** 合同里的「`DESC hive.dim.dim_app_pid_info` 返回字段」是直接在 SelectDB 上执行的结果，不是经过 `ktx sql`，却被当成了 `ktx sql` 可用的证据。
- **历史：** 2026-11-10 `e1c4d36e` 曾经 KTX 做 `SHOW COLUMNS`／`DESCRIBE` 回退，同样进不了 `ktx sql`；列名后来改直连，字段没改。

## 4. 为何漏检

- **替身比真实依赖宽松：** 模拟测试的 `ktx()` 对 `DESC` 直接返回字段，只拦 `SHOW` 和 `information_schema`。SC-10 因此一直是绿的。
- **验收只验了一半动作：** 按「能列表」收口，没有端到端走「选一张表 → 读字段」。
- **失败文案不分因：** 被 KTX 拒绝、权限不足、超时、表不存在，都落到同一句「没有读到字段」；现场服务端日志又取不到，无法一眼定位。
- **通道迁移没有成套：** 列名通道已换，字段通道留在旧的，两条通道的约束没有放在一起核对。

## 5. 举一反三

1. **「现场事实」必须写明在哪个通道验证的。** 在 SelectDB 上直接成功，不等于经 `ktx sql` 成功；换通道就要重新取证。
2. **测试替身以真实依赖的拒绝形态为准。** 依赖有只读校验、语法限制等拒绝规则时，替身必须复现，并留一条断言把该形态固定下来，防止以后又被交回去。
3. **迁移读通道时，按同一个用户动作整条验收。** 列表与字段是同一个页面上的相邻两步，不能只验其中一步。
4. **笼统的失败文案必须配日志。** 至少让「语句被拒」「无权限」「超时」「表不存在」在服务端日志里能分开，用户文案可以保持简短。
5. **探针回退只用于「换一条语句可能成功」的失败。** 超时、权限、表不存在、连接失败应立即返回，不要为回退白耗时限。
6. Agent／评审：改外部目录（`catalog.database`）读路径、或放宽／收紧 `ktx sql` 的语句类型之前，先读本条与 P1-20 Spec 的 §1.2。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 字段探针改直连（`DESC`→`SHOW COLUMNS`→`DESCRIBE`） | 完成 | `97fe7ee8`；Spec EC-01–EC-13 |
| 测试替身对齐真实 KTX 拒绝形态 | 完成 | EC-11 |
| 失败探针日志 | 完成 | EC-13 |
| 客户 SelectDB live 复测 `hive-1`／`dim` | 未开 | 归测试台；无 live 时保持 GAP，不得写成 EXT PASS |
| 读取 Hive 字段注释 | 未开 | `DESC` 不含注释；见 Spec Follow-up Needed。登记 ≠ 授权开工 |
| 整库勾选数百表的逐表连接耗时 | 未开 | 另立条目 |

## 7. 证据指针

- KTX 校验源码：容器内 `ktx_daemon/sql_analysis.py`（`_READ_ONLY_ROOT_TYPES`、`_READ_WRITE_NODE_TYPES`，约 63–84、290 行）。
- 修复前读路径：`webui/server/schema-structure.ts` 旧 `readCatalogTableColumns`（仅 `runSql`＋`DESC`）。
- 旧替身：提交 `a8991690` 前的 `webui/server/__tests__/doris-external-catalog.simulation.test.ts` 中 `ktx()`。
- 修复：`webui/server/catalog-show.ts`（白名单）、`webui/server/schema-structure.ts`（按序探针＋回退规则）。
