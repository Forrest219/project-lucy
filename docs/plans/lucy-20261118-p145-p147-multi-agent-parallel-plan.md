# P1-45／46／47 多 Agent 并行开发编排

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.1；可执行。** 委托人 2026-11-18「授权定稿」＝三线终稿确权＋开发授权。本 Plan 只编排并行，不另扩授权面 |
| 授权边界 | 各线改动面以各自 Spec／Plan 为准。**禁止**三线互相改对方文件；**禁止** git commit（除非委托人另指令）；**禁止**线上升级／放宽 Helm timeout 关单 |
| 验收 | 各线 vitest 绿＋自检；合入后跑对应 UAT（INDEX 现 NOT RUN） |

## 目标

在文件冲突最小的前提下，用多个 Builder 并行落地 P1-45／46／47。

## 并行拓扑

```
Wave 1（并行）
  Agent-46 ── P1-46 readyz／MCP      文件：index.ts, runtime/readiness.ts (+tests)
  Agent-45 ── P1-45 中断恢复         文件：inferred-turn-maintainer.ts, audit.ts 重建状态／covered (+tests/migration)

Wave 2（串在 45 之后）
  Agent-47 ── P1-47 探针预算分块     文件：audit.ts 前置 DELETE／allocate 分块 (+tests)
```

理由：45 与 47 同改 `rebuildInferredTurnsUnlocked`；46 完全独立可并行。

## 开工前置

- 三 Spec／Plan 已 v0.2 授权。
- 工作树以当前 `lucy-v0.30` HEAD 为准。
- Agent 不得互相 rebase；Wave2 启动前由协调者确认 Wave1 的 audit／maintainer 变更已落盘。

## 各 Agent 合同摘要

### Agent-46（P1-46）

- `markWebuiWarmupComplete` 仅在 `proxy.listen` 成功之后调用（或等价 readiness 门闩）。
- SC：MCP listen 前 readyz≠200；首次 readyz 200 ⇒ initialize 成功。
- 验证：`cd webui && npx vitest run` 相关 readiness／startup 测试；可加最小单测。

### Agent-45（P1-45）

- 新增 `inferred_rebuild_state`；重建开始标 `in_progress`，成功标 `complete`。
- `covered()`：in_progress／缺 complete → false；收口 15min 空转全量（SC-04）。
- 验证：中断／SIGKILL 类 vitest 或复用独立 review 测试合同转绿。

### Agent-47（P1-47，Wave2）

- 前置整窗 DELETE＋全量 allocate 改为有时间预算的短事务块 + `pauseAfterStretch`。
- 不破坏 45 的 in_progress／complete 语义。
- 验证：重建路径单测；满量 UAT 另跑。

## 验收

- 单测：聚焦 vitest 39／39（2026-11-18）。
- 测试台：RML PASS、IRR PASS、RPB FAIL（RPB-01）——见 [INDEX](../qa/uat/INDEX.md)；各线 Spec SC 以各自 Spec 为准。
- 升级放行：见 [升级放行评估](../reviews/2026-11-18-p145-p147-upgrade-readiness-assessment.md)。

## 完成定义

- Wave1 两 Agent 报告实现文件清单与测试结果。
- Wave2 Agent-47 合入后，协调者跑聚焦 vitest；UAT 套件另排。
- 总账／Spec 头部「实现中／已落地」由协调者同句回写。
- **≠ 可上线**。

## 风险

| 风险 | 处理 |
|---|---|
| 45／47 文件冲突 | 强制 Wave2 |
| 45 schema 与既有迁移争用 | 45 独占迁移入口；47 不碰 schema |
| 未授权 commit | Agent 提示禁止 commit |
