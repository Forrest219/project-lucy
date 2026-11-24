# P1-47 写片尖峰削峰计划（保持 30 天回看）

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-47 写片尖峰削峰计划 |
| 文档类型 | Plan |
| 版本 | v0.1-draft |
| 撰写日期 | 2026-11-19 |
| 撰写人 | Cursor（Auto） |
| 委托人 | xingchen |
| 基于材料 | [尖峰取证](../../inbox/2026-11-19-rpb-spike-root-cause.md)；[spike-trace 跑次](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-19-cursor-rpb-spike-trace.md)；[默认开着复测](../qa/uat/suites/rebuild-probe-budget/runs/2026-11-19-cursor-rpb-default-on-7d7ee831.md)；[P1-47 Spec](../specs/lucy-20261118-rebuild-probe-budget-spec.md)；[暂停＋根治并行 Plan](lucy-20261118-p147-pause-delivery-and-root-fix-plan.md)；[FDE R07 trace](../../inbox/fde-r07-trace.md) |
| 适用范围 | 默认 `LUCY_INFERRED_MAINTAINER` **开着**时，消除限速台上偶发 livez 秒级单尖峰；**不**缩短 30 天回看；**不**用暂停 PASS 关单 |
| 输出位置 | `docs/plans/lucy-20261119-p147-write-slice-spike-shave-plan.md` |
| 状态 | **v0.3。W0＋W1 已落地；W2 默认多跑 UAT PASS（shave2 3／3）。窗口 DELETE 亦已 off-thread（取证二次尖峰）。W3 解除暂停演练未跑。** ≠ 可上线 |
| 授权边界 | **已授权**：保持 30 天回看；W0＋W1 削峰开发与默认配置 UAT。暂停交付（`off`）并行保留。 |
| 验收 | 见 §5 |

## 1. 目标与非目标

### 目标

- 默认开着时，满量推断＋慢盘限速台上：livez **max ≤1000ms**、**p99 ≤400ms**；readyz p99 ≤1500ms；客户 3s 观察器连续失败 &lt;6。
- 多跑稳定：同镜像默认配置 **≥3／3** 独立冷启动 RPB-01–03 PASS（套件 RPB-09 口径）。
- 保留近 **30 天**问询归并／编号口径；审计视图在补算期间与补完后语义不变（P1-45／P1-50 水位不回退）。

### 非目标

- 不把回看改为 7 天或可配置缩短（已否决作本轮手段）。
- 不靠放宽 Helm `timeoutSeconds`、缩小夹具数据、或 `LUCY_INFERRED_MAINTAINER=off` 关单。
- 不替代客户现网 K8s 发布取证；模拟台 PASS ≠ 可上线。

## 2. 问题摘要（取证结论）

| 项 | 结论 |
|---|---|
| 现象 | 默认开着偶发 livez ~2.7–2.9s 单尖峰（约就绪后 30s）；p99 常仍 ≤400；非 11-17 持续同形 |
| 直接原因 | 主线程 `write_slice` 同步事务偶发 ~3s（例：`size=12 ms=3050`）；同片后 `wal_checkpoint` 仅 ~84ms |
| 已做减负 | 分块 DELETE／allocate、读页预算、`wal_autocheckpoint=25`、sources 预取、片间 PASSIVE、写后让出、slice 3–12 |
| 仍保留风险 | `wal_checkpoint_skip`（F2++）可能放大**另一类** checkpoint 尖峰；本轮 r1 尖峰主因是写片而非 checkpoint |
| 窗口 | **保持 30 天**——缩短窗口减总时长，不消除单片同步 I/O 尖峰根因 |

## 3. 建议手段（按波次）

```mermaid
flowchart LR
  W0[W0 便宜削峰] --> W1[W1 写片离开请求循环]
  W1 --> W2[W2 默认多跑关单]
  W2 --> W3[W3 解除暂停演练]
```

### W0 — 便宜削峰（低侵入，可先做）

| 项 | 内容 | 预期 | 风险 |
|---|---|---|---|
| W0a | **撤销** F2++ `wal_checkpoint_skip`：每写片后始终 PASSIVE（与 [fde-r07-trace](../../inbox/fde-r07-trace.md) §5.4 一致） | 去掉「跳过 → WAL 堆高 → 偶发大 ckpt」路径 | 片间 ckpt 更勤，总补算略慢；应用 trace 确认无回归大 max |
| W0b | 写片上限再收一档（例如 MAX 12→**8** 或 INITIAL 3→**2**），写片耗时 ≥阈值（如 50ms）则下一片强制降 size 并 `pauseAfterStretch` | 降低单事务体积，减轻偶发 3s 概率 | 可能不够；总时长变长 |
| W0c | `LUCY_REBUILD_TRACE=1` 下断言／诊断：单片 `write_slice` ms 写入跑次证据（脚本已可落 `rebuild-trace.log`） | 关单可证明无 ≥1000ms 写片 | 无行为变更 |

**W0 退出：** 默认 RPB 三跑若已稳过门禁 → 可跳过 W1 的重手段；若仍有 ≥1s `write_slice` 或 livez max 越线 → 必须 W1。

### W1 — 主手段：写片（及必要的 checkpoint）离开请求事件循环

对齐 Spec OQ-2 未决部分与 FDE「下一杠杆」：

| 项 | 内容 | 预期 |
|---|---|---|
| W1a | 重建专用写连接（与请求路径 `getDb()` 分离），`rebuildInferredTurnsUnlocked` 走该连接 | 请求路径 livez／readyz 不与写锁长事务绑死 |
| W1b | **`write_slice` 事务**在独立线程／worker 执行（或等价：写连接上的工作不阻塞 Fastify 事件循环）；主线程只调度与让出 | **直接对准取证根因** |
| W1c | `wal_checkpoint(PASSIVE)` 同时下沉到非请求线程（若 W1b 后 ckpt 仍在主线程暴露尖峰） | 防止次级尖峰 |
| W1d | 保留 P1-45 `inferred_rebuild_state`、P1-50 id 水位、`busy_timeout`／短事务；单测覆盖「无 skip」「写连接≠请求单例」 | 语义不回退 |

**不做（本轮除非 W1 后仍 FAIL）：** 默认引入通用只读 worker 改造全审计读路径；改 Chart 探针；改 30 天常量。

### W2 — 验证与关单

| 项 | 内容 |
|---|---|
| W2a | 默认配置（无 `off`）RPB-01／02／03；**RPB-09：≥3 次独立冷启动全绿** |
| W2b | COLD-02／03／04 回归（默认开着） |
| W2c | 暂停路径抽测 RPB-05（确认 `off` 仍可用作交付安全带） |
| W2d | 回写 Spec 头部状态、总账 P1-47、INDEX、e2e-ledger **同句**；OQ-2 收口为「写连接／写片 off-thread 已做」 |

### W3 — 与暂停交付汇合（沿用父 Plan B4／B5）

默认关单后：模拟解除暂停补回（RPB-08）→ 客户低峰清 `env.LUCY_INFERRED_MAINTAINER`。  
在此之前客户验收可继续 **values 置 `off`**。

## 4. 文件与改动面（实施时）

| 区域 | 预期 |
|---|---|
| `webui/server/proxy/audit.ts` | 写片循环、去掉 skip、slice 上限、trace；调用写连接／worker API |
| 新建（若 W1） | 例：`audit-rebuild-write.ts`、`audit-wal-checkpoint-worker.mjs`（名称实施时按仓库惯例） |
| `webui/server/__tests__/rebuild-probe-budget-wal.test.ts` 等 | 更新：期望无 `wal_checkpoint_skip`；写连接分离；必要时写片 off-thread 契约 |
| `scripts/uat/rebuild-probe-budget.mjs` | 已支持落 `container.log`／`rebuild-trace.log`；关单跑次须带齐证据 |
| Spec | P1-47 升版：OQ-2 收口；changelog 写明 **不改 30 天** |

## 5. 验收

- **功能合同：** 默认配置下 SC-01–SC-07；SC-08–10 暂停合同保持。
- **测试台：** `UAT-SUITE-REBUILD-PROBE-BUDGET` 默认 **PASS** 且 RPB-09 多跑全绿；尖峰取证口径下无 `write_slice` ≥1000ms（限速台）。
- **产品约束：** `INFERRED_TURN_REBUILD_LOOKBACK_HOURS` 仍为 **720**；文档／对客口径不写「已改为 7 天」。
- **明确不等于：** 客户现网 PASS、可上线、可取消暂停安全带（直至 W3）。

## 6. 需要委托人确认的决策点

| # | 决策 | 建议 |
|---|---|---|
| D1 | 是否按 **W0→（不足则）W1** 开工 | **是**。W0 一天内可验证；不达标立即 W1，避免在 slice 参数上无限拧 |
| D2 | W1 是否授权 **写片 off-thread／专用写连接**（关闭 OQ-2 剩余） | **是**。取证已证明尖峰在 `write_slice`，仅 ckpt 下沉不够 |
| D3 | 30 天回看 | **冻结不变**（本 Plan 硬约束） |
| D4 | 客户侧在 W2 完成前 | 继续推荐 **`LUCY_INFERRED_MAINTAINER=off`** 作升级安全带 |

## 7. 风险

| 风险 | 处理 |
|---|---|
| W0 不够、浪费轮次 | D1：W0 后立刻看有无 ≥1s 写片；有则停参拧、上 W1 |
| 双连接 `SQLITE_BUSY` | 短事务＋`busy_timeout`；RPB／IRR 回归 |
| 利旧盘比限速台更差 | 模拟关单后仍保留 off 安全带直至现场观察期；不宣称现网已验 |
| 与并行改 `audit.ts` 冲突 | 单写者；合入前 rebase |

## 8. 对客一句话（可转发）

> 我们保持近 30 天审计问询口径不变，通过把重建写片从影响入口的路径上削峰／挪走，消除偶发卡顿；在默认开着的测试台连续达标前，升级仍可用暂停开关保证问数稳定。

## 开工前置（形态补记，2026-11-19）

> 只补文档形态，不改本 Plan 的任何裁决与授权。

- 授权边界以头部「授权边界」行为准：保持 30 天回看；W0＋W1 削峰开发与默认配置 UAT；暂停交付（`off`）并行保留。
- §6 的 D1／D2 须确认（或有书面等价授权），见下方「完成定义」首项。
- 父 Plan：[暂停交付与根治并行](lucy-20261118-p147-pause-delivery-and-root-fix-plan.md)。

## 完成定义

- [ ] §6 D1／D2 确认（或书面等价授权）
- [ ] W0 落地并出带 trace 的默认多跑证据
- [ ] 若需要：W1 落地＋单测
- [ ] W2 默认 RPB-09 PASS；Spec／总账／INDEX 同句
- [ ] W3 按父 Plan 与暂停交付汇合

≠ 可上线。
