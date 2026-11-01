# Hive 问数（执行侧）—— 功能合同收口记录

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01（Asia/Shanghai） |
| Spec | [`docs/specs/lucy-20261030-hive-query-execution-spec.md`](../specs/lucy-20261030-hive-query-execution-spec.md)（收口后 **v0.4**） |
| Plan | [`docs/plans/lucy-20261030-hive-query-execution-plan.md`](../plans/lucy-20261030-hive-query-execution-plan.md) |
| 台账号 | L25-10（执行波；v0.25 登记册） |
| 层级 | **功能合同** |
| 结论 | **HQ-01–HQ-18 全部关闭（HQ-16／HQ-18 按合成夹具维）。** 本条收口**不表示可上线**——数据库支持状态保持 `planned`，客户环境、镜像、交付均不在本条出口 |
| 授权 | PM 2026-11-01 批准「B 档 + 形态搭车」批次 |

---

## 一、出口矩阵结果（逐条 HQ → 用例）

**证据等级：本地自动化（vitest，合成夹具）**。无 CI job 证据，无客户 HS2 证据，无客户环境证据。

| SC | 结果 | 证据落点（`webui/server/__tests__/hq-hive-execution.test.ts` → 用例名） |
|---|---|---|
| HQ-01 | 通过 | 「HQ-01 partition profile」 |
| HQ-02 | 通过 | 「HQ-02 unknown refuses before JDBC」（另被组用例「HQ-02..HQ-10 partition gate」覆盖） |
| HQ-03 | 通过 | 「HQ-03 missing partition predicate → hive_partition_predicate_required; JDBC=0」 |
| HQ-04 | 通过 | 「HQ-04 LIMIT alone is not a partition bound」 |
| HQ-05 | 通过 | 「HQ-05 row-policy-like non-partition predicate alone still rejects」 |
| HQ-06 | 通过 | 「HQ-06 bounded equality passes gate and executes on synthetic fixture」 |
| HQ-07 | 通过 | 「HQ-07 bounded prefix (only p1) passes」 |
| HQ-08 | 通过 | 「HQ-08 skip-level (only p2) rejects」 |
| HQ-09 | 通过 | 「HQ-09 window PARTITION BY does not satisfy table partition bound」 |
| HQ-10 | 通过 | 「HQ-10 unpartitioned table does not require partition predicates」 |
| HQ-11 | 通过 | 「HQ-11 explain never invokes JDBC」（另被组用例「HQ-11..HQ-18 MCP / worker / audit」覆盖） |
| HQ-12 | 通过 | 「HQ-12 proxy hook never forwards Hive to KTX (context missing → fail closed)」 |
| HQ-13 | 通过 | 「HQ-13 compile credential isolation remains a compile-bridge contract (smoke)」 |
| HQ-14 | 通过 | 「HQ-14 multi-statement / non-readonly rejected by gate parse」 |
| HQ-15 | 通过 | 「HQ-15 decimal / bigint stay strings (no JS number coercion)」 |
| HQ-16 | 通过（**合成维**） | 「HQ-16 cancel observation on synthetic worker」——取消后 `failure.reason = hive_jdbc_canceled`、`terminalState = canceled` |
| HQ-17 | 通过 | 「HQ-17 audit distinction: gate denial has no JDBC success attempt」 |
| HQ-18 | 通过（**合成维**） | 「HQ-18 synthetic partition oracle matches independent expectation」——**独立手写 oracle** `["100.50", "200.25"]`，全表 4 行、单分区 2 行；oracle 不由被测编译器生成 |

**实测（2026-11-01 复跑）**：`hq-hive-execution.test.ts` **1 文件 / 22 条全绿**（18 条 HQ 专项 ＋ 4 条组用例）。

## 二、为什么 HQ-16／HQ-18 只算「合成维」

Spec §7 的出口定义把这两条单独标注为合成维度，用例实现与之一致：

- **HQ-16**：对**合成 worker** 调 `worker.cancel()` 后再执行，断言失败码 `hive_jdbc_canceled` 与终态 `canceled`。真实 worker 取消、跨进程取消、失败关闭的完整组合不在本条。
- **HQ-18**：在**合成分区数据**上比对**独立手写的期望值**（`100.50 + 200.25`），并断言全表 4 行／单分区 2 行。oracle 由人写定，不经被测编译器生成，因此能真正打假分区裁剪。

这两条**没有**覆盖真实集群的分区裁剪行为。按 `DEVELOPMENT.md:80`，真实集群 oracle 归 `HIV25`／发布取证层，**不得**把 HQ 通过写成客户交付通过。

## 三、残余

1. **客户匹配 HS2／认证／TLS／JRE 全组合未验证**——不在本条出口，归 `HIV25`。
2. **管理台 Drawer／分区画像 UI 未做**——已从本条出口拆出（§9 Follow-up Needed），另开变更。
3. **数据库支持状态保持 `planned`**——本条收口**不构成**支持矩阵晋级。

## 四、不在本次收口里

- **镜像构建、部署、客户交付、客户环境验证**——本条收口**不表示可上线**。
- **整库旅程、Agent 路径、带 Token 的多轮串联、系统级断连／worker 崩溃、跨模块故障演练、离线 amd64、升级／备份恢复**——归 `HIV25`／`LIFECYCLE`（发布取证层，该层目前**没有承载本轮已收口功能的已执行 Spec**（形态搭车后有 2 份交付／构建契约类声明了该层，但均未执行），见 [`2026-11-01-spec-closure-inventory.md`](2026-11-01-spec-closure-inventory.md) §五）。
- **编译侧 Spec 已收口出口（V01／V02／V06）**——本条复用，不重开。

## 五、复现命令

```bash
cd /Users/forrest/GitHub/project-lucy/webui
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v "minimax" | tr '\n' ':')
env PATH="$CLEAN_PATH" npx vitest run --maxWorkers=1 server/__tests__/hq-hive-execution.test.ts
```

> 必须用干净 PATH：本机 `/Users/forrest/.minimax/shims/rm` 是 `mavis-trash` 垫片，非交互子进程里 `rm -rf` 会挂死不返回。
