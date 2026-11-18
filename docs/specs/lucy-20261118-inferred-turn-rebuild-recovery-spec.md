# 推断问询重建中断后自动恢复 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.2** |
| 日期 / 目标版本 | 2026-11-18／产品线 `0.30.0` |
| 功能编号 / 优先级 | **P1-45**／REQ-030-066／**P1**（事故修复；前方报告分级为 **P0-02**）。**不入 0.30 核心分母** |
| 台账号 | 无。挂现行 `0.30` 执行总账，不占用 v0.25 登记册 |
| 状态 | **v0.2＋P1-50 水位注记。终稿已确权、开发已授权（委托人 2026-11-18「授权定稿」；OQ-1＝`inferred_rebuild_state`）。代码已实现；测试台 UAT-SUITE-INFERRED-REBUILD-RECOVERY＝**PASS**（[2026-11-18-cursor-irr](../qa/uat/suites/inferred-turn-rebuild-recovery/runs/2026-11-18-cursor-irr-p145-p147.md)）。P1-50／FDE R01：完成水位改为与读快照同一 `ceilingId`（见 §3.1 注）。不入核心分母。≠ 可上线** |
| 决策来源 | 委托人 2026-11-18 要求按仓库规范为前方升级测试报告三则 P0 分别制定 Spec 与 UAT |
| 需求来源 | 前方报告《Lucy 升级与稳定性测试报告》LUCY-TR-20261118-01 v1.2（委托人 Obsidian Inbox）§4.1 P0-02；证据 E05／E06／E17 |
| 实施主体 | WebUI 服务端：`webui/server/proxy/audit.ts`（`rebuildInferredTurnsUnlocked`）、`webui/server/admin/inferred-turn-maintainer.ts`（`covered`／`scanFull`）。不改 Helm、不改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | 延续 [P1-38](lucy-20261117-inferred-turn-rebuild-yield-spec.md)（切片写入）与 [P1-39](lucy-20261117-cold-start-audit-scan-spec.md)（覆盖判定用 `updated_at`）。**本条专门补「中断后恢复」合同**；P1-39 的 OQ-1「不新增表」在本条可被委托人改裁（见 OQ-1）。伴生收口报告中的重复补算（前方 P1-01） |
| 实施计划 | [`docs/plans/lucy-20261118-inferred-turn-rebuild-recovery-plan.md`](../plans/lucy-20261118-inferred-turn-rebuild-recovery-plan.md) |
| 测试台 | [`UAT-SUITE-INFERRED-REBUILD-RECOVERY`](../qa/uat/suites/inferred-turn-rebuild-recovery/suite.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.2＋P1-50 注 | 2026-11-18 FDE R01／P1-50：完成水位改为读快照 `ceilingId`（十进制字符串），`covered()` 按 id 比较；重建中插入且 `id>ceiling` 的行不得被 ts 水位误判已覆盖。不另开 Spec 升版出口 |
| v0.2 | 2026-11-18 委托人「授权定稿」：终稿确权＋开发授权；OQ-1＝允许 `inferred_rebuild_state`；进入多 agent 并行实现。同日 Wave1 Agent-45 落地：表＋in_progress/complete watermark＋`covered()`；vitest 20/20；UAT 未跑 |
| v0.1-draft | 初稿。依据前方报告 P0-02 硬复现事实起草。终稿未确权；开发未授权 |

## 闭口层级

- 层级：功能合同
- 本条承诺：重建一旦开始删除旧结果，在完整成功提交完成标记之前，该用户一律视为未覆盖；进程中断或事务边界失败后，仅靠重启即可自动补全到与原始 `access_log` 一致的推断结果集；合法用户的管理员登录与 MCP 握手不因补算恢复而永久不可用。
- 本条出口：SC-01–SC-08。
- 不在本条出口：客户现场 K8s／网关验收、探针超时预算（归 P1-47）、readyz／MCP 启动竞态（归 P1-46）、问询编号规则变更、移动窄屏。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None（内部状态名不进用户可见文案）。

## 交互合同豁免

- 原因：本条只改审计库重建与覆盖判定，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`/api/livez`／`/api/readyz`／`/api/health` 路径与响应字段含义；Chart 探针参数

## 1. 问题陈述

### 1.1 已核实机制

1. `rebuildInferredTurnsUnlocked` 先在一个同步事务中删除该用户回看窗口内旧推断结果与链接，再分片插入新结果（`audit.ts` 约 2816–2845 行）。
2. 中断可落在「已删 + 只写一部分」：库中仍有部分 `inferred_turns`，且带较新的 `updated_at`。
3. `inferred-turn-maintainer` 的 `covered()` 仅比较「最近一条 turn 的 `updated_at` − 15 分钟 ≥ 窗口内最新 `access_log.ts`」。部分写入也会被判覆盖，于是启动扫描不安排补算。

### 1.2 前方硬复现

| 实验 | 结果 |
|---|---|
| 受控异常 | 80 条调用，提交 8 条推断后中断；`restartRebuilt=[]` |
| 真实 SIGKILL | 6000 条调用；持久化 20 条；`restartScheduledRebuild=[]` |
| 客户额度容器 | 第 2 用户应 2,986 条，中断后 610；同卷新进程就绪后 90 秒仍为 610 |

原始 `access_log` 仍保留；本条不主张原始调用丢失。

## 2. 目标与非目标

**目标**

1. 引入可持久的「重建进行中／完整完成」判定（水位或等价标记）。
2. 只有完整重建成功后才能发布覆盖状态。
3. 任意提交边界中断后，重启扫描必须重新 `touch` 该用户并补全。

**非目标**

- 不在本条改客户 Helm 超时。
- 不要求零中断滚动升级。
- 不把 vitest 通过写成 UAT PASS。

## 3. 方案倾向（待裁定）

| 选项 | 内容 | 备注 |
|---|---|---|
| A | 重建开始写 `in_progress`；全部切片成功后写 `complete`；`covered()` 见 incomplete 一律 false | **倾向**。持久化介质见 OQ-1 |
| B | Staging／新 epoch 写完再原子切换；失败保留旧结果可读 | 语义更干净，改动面更大 |

## 3.1 核心流程（伪代码）

```text
rebuild(user):
  mark persistent state = in_progress(user, epoch)   # 必须先于 DELETE 提交
  DELETE old inferred turns in window
  for each write slice:
    INSERT slice
    if crash: exit with in_progress still set
  mark persistent state = complete(user, epoch)

covered(user, newest_access_id):
  if state is missing or in_progress: return false
  if state.complete and watermark_id >= newest_access_id: return true
  return false   # 不得仅凭 inferred_turns.updated_at 判覆盖；不得用 MAX(ts) 代替 id 上界

scanFull / catchUp:
  for each user with access_log in window:
    if not covered(user): touch(user)
runPass: rebuild each dirty user
```

**P1-50／FDE R01 注（2026-11-18）：** 读页冻结 `ceilingId = MAX(id)`；`inferred_rebuild_state.watermark` 必须持久化**同一** `ceilingId`（十进制字符串），不得写 `MAX(ts)`。重建期间插入且 `id > ceilingId` 但 `ts ≤ 旧 ts 水位` 的行无推断关联时，`covered()` 必须为 false，由轮询／补算再处理。历史 ISO ts 水位视为不可比 → 未覆盖（一次安全补算）。本注不改 SC-01（`in_progress` 仍未覆盖）。

## 4. 验收（SC）

| ID | 合同 |
|---|---|
| SC-01 | 重建开始后、完成标记提交前，`covered(user)` 为 false |
| SC-02 | 删除事务已提交、首片未写完即中断 → 重启后该用户进入 dirty 并被调度 |
| SC-03 | 中间写入片提交后中断 → 同上；最终条数与完整重建一致 |
| SC-04 | 完整成功后，无新增 `access_log` 时，重启扫描不得因 15 分钟余量单独触发全量重建（收口前方 P1-01） |
| SC-05 | 有新增调用时，仅该用户进入增量／窗口重建，且完成后结果完整 |
| SC-06 | 中断恢复过程中 `/api/readyz` 最终可转 200；进程不因恢复逻辑崩溃 |
| SC-07 | 恢复后管理员登录与 MCP `initialize`／`tools/list` 可用（主路径） |
| SC-08 | 对应 UAT 必做项全真 PASS；不以 Code Review 代替 |

## 5. 开放项

| ID | 问题 | 默认倾向 |
|---|---|---|
| OQ-1 | 持久状态用新表／加列，还是在 P1-39「不新增表」约束下用文件／既有列约定？ | **已决（2026-11-18 授权定稿）**：允许轻量 `inferred_rebuild_state` 表；本次开发授权含该 schema |
| OQ-2 | 中断后 UI 是否短暂展示「重建中」？ | 本条默认不改 UI |
| OQ-3 | 与 P1-47 前置删除分片的交付顺序 | 本条先于或并行；不得互相冒充关单 |

## 6. 授权边界

- **终稿已确权、开发已授权（委托人 2026-11-18「授权定稿」）。**
- 实现范围见配对 Plan；含 `inferred_rebuild_state` schema；禁止未另授权的线上升级。
