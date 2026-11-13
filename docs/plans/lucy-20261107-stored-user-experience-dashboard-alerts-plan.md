# 存量用户体感仪表盘与主动告警 实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 | 实施计划（Plan） |
| 版本 / 日期 | v0.4-draft / 2026-11-13 |
| 状态 | **v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O6 已闭合（2026-11-13）＝建议包 E；待 R2-F；终稿未确权；冻结落地；未授权实现**。配套 Spec v0.4-draft。本阶段只评审与修订本 Plan，**暂不执行任何实现 Task**。**不是** R2-F，**不是** R4，**不可功能合同收口** |
| 授权边界 | **不授权改代码**。须满足功能清单池 §2.2：R1 形态 → R2 对抗式评审 → R3 开工前开放决策（O1–O6）闭合 → R4 委托人开发授权 |
| 验收 | Spec SC-01a／SC-01b ＋ SC-02–SC-17 逐条有证据；`npm run lint:spec-docs` 退出 0；相关 vitest 全绿；告警入队证明走 outbox 去重且不经账本 health 订阅，也不经 Admin 读取。**不构成发布取证，不表示可上线** |
| 目标分支 / 产品线 | `lucy-v0.30` / `0.30.0` |
| 需求来源 | 清单 P0-7；需求池 REQ-030-026；误报防线 §4.7 G7 |
| Spec | [lucy-20261107-stored-user-experience-dashboard-alerts-spec.md](../specs/lucy-20261107-stored-user-experience-dashboard-alerts-spec.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) 落盘清单与 Plan Mode |

## 1. 目标

把「100 个存量用户每天体感如何、跌破何时通知」从人肉盯后台，落成：

1. `/admin/usage` 数据访问视图上的最小体感仪表盘（per-user 体感分＋三项率＋问询 DAU 人数趋势＋按角色活跃人数）；
2. SMTP outbox 扩展体感事件类（阈值跌破、连续空结果），复用去重与投递；
3. （O4）可选最小反馈入口。

严格复用 Spec 194 `conversation_turns` 真实问询口径；不新造表；不把界面 `visitorCount` 当成 MCP 用户 DAU。

## 2. 开工前置

1. **O1–O6 已闭合（2026-11-13）＝建议包 E**（[决策纸](../reviews/2026-11-13-p0-7-o1-o6-decision-package.md)）；Spec §4 已回写。**仍待 R2-F**；未获 R4 前不得实现对应分支。
2. Spec 获得 **R2-F**（Codex CLI 终审，或委托人明示确权）。过程修订到 v0.4-draft **不等于**终稿。
3. 明确 **R4 开发授权**。D12 已冻结：读取接口不得入队；O4＝延期则反馈入口不建。
4. 术语标准 §4.5 补登记本条 New terms。
5. 基线：`npm run lint:spec-docs` 绿（存量 WARN 除外）；确认不与 Spec 194 分子定义冲突。
6. 索引镜像：`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md` §9、需求池 REQ-030-026、清单池 P0-7，与 Spec 头部「状态」同句。现值＝**v0.4-draft；Cursor 过程对抗已修订（2026-11-13）；O1–O6 已闭合（2026-11-13）＝建议包 E；待 R2-F；终稿未确权；冻结落地；未授权实现**。**不是** R2-F，**不是** R4，**不可功能合同收口**。未授权前不改代码。

> **门禁声明**：本 Plan 现行 **O1–O6 已闭合（建议包 E）；待 R2-F**。**不是 R2-F、不是 R4、不可功能合同收口**，直至 R2-F 完成并另获 R4。

## 3. 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `webui/server/admin/user-experience-kpi.ts`（建议） | 新建 | 首次成功／空结果／拒绝／体感分／问询 DAU／按角色人数纯函数；只读 audit DB |
| `webui/server/admin/daily-question-kpi.ts` | 只读复用或薄封装 | **不改** Spec 194 分子；可导出共享 session 帮助函数若避免复制 |
| `webui/server/admin/governance-observability.ts` | 修改 | overview 挂载 experience 字段；角色 `activeUserCount` |
| `webui/src/pages/admin/GovernanceOverview.tsx`（及测） | 修改 | 数据访问视图卡／表；禁止 vanity 总分；interface 视图不请求 |
| `webui/src/lib/kpiContracts.ts` | 修改 | 登记新 KPI 帮助文案 |
| `webui/server/notifications/outbox.ts` | 修改 | 扩展 `NotificationEventType` |
| `webui/server/notifications/profile.ts` / runtime | 修改 | `experienceAlerts` 开关（O6） |
| `webui/server/notifications/experience-events.ts`（建议） | 新建 | 阈值／连续空判定 → `enqueueNotification`；**不**改 `health-events.ts` 账本订阅职责 |
| `webui/server/notifications/worker.ts` | 修改 | 邮件模板分支覆盖新 eventType |
| `webui/docs/00-product-terminology-standard.md` | 修改 | §4.5 新术语 |
| `webui/server/__tests__/user-experience-kpi*.test.ts` 等 | 新建 | SC-01–SC-15 |
| 反馈相关（仅 O4＝P0-min） | 条件新建 | 最小 API／入口；否则本 Plan 标记 defer，不建文件 |

**并发修改边界（勿多 agent 同改）：**

- `governance-observability.ts` / `GovernanceOverview.tsx`：本条主角；他条勿并行大改同一文件。
- `outbox.ts` event 联合类型：短 diff；与账本告警可串行。
- `daily-question-kpi.ts`：优先只读复用；若必须抽共享函数，与 Spec 194 维护者对齐后单点改。

## 4. 任务分解

### 变更记录（Plan）

| 版本 | 说明 |
|---|---|
| v0.3-draft | 与 Spec v0.3 对齐；建议包 E；冻结落地 |
| v0.4-draft（O 闭合） | **R3（2026-11-13）**：委托人会话批准整包采纳建议包 E；开工前置 §2 与 Spec §4 同句。**待 R2-F**；未授权实现。**不构成 R2-F／R4** |

### S0：决策闭合与夹具

- O1–O6 已闭合（建议包 E，2026-11-13）；决策纸已签署。准备空库／单用户成功／空结果／拒绝／跨日 DAU／角色二人同角色夹具。空库夹具断言 `no_data`，禁止数值 0。
- O4＝延期：反馈入口不建文件。
- **验证**：Spec §4 O 行状态为已闭合；**仍待 R2-F／R4 方可实现**。

### S1：纯函数聚合

- 实现 experience KPI 纯函数；复用 Spec 194 人口与探针排除。
- O1 未闭合时分数函数只返回不可用。
- **验证**：SC-01a／SC-01b、SC-02–SC-09。SC-06 在 O1 闭合前只覆盖不可用。

### S2：Admin API 挂载

- overview／角色字段接线；契约无 vanity 总分字段。
- **验证**：API 测；SC-07、SC-09。

### S3：数据访问 UI

- 分列卡＋ per-user 列；问询 DAU 趋势；帮助文案禁混 visitorCount。
- **验证**：SC-10；既有 governance 前端测回归。

### S4：SMTP 事件类与 experience-events

- 扩展类型、profile 开关、判定入队、worker 文案；health-events 保持账本-only。
- 读取接口零入队。O2／O3 未闭合时 tick 不入队。
- **验证**：SC-11–SC-15、SC-17。

### S5：反馈入口（条件）

- 仅 O4＝P0-min：最小入口＋写入路径；否则跳过并文档标明 defer。
- **验证**：若做，补 SC-F1（另修订 Spec 编号）；若不做，清单池有延期句。

### S6：术语与门禁文档

- 术语标准；Spec／Plan 状态行；清单池 P0-7、需求池 REQ-030-026 同句回写。
- **验证**：SC-16；`lint:spec-docs`。

### S7：对抗式评审与收口准备

- 独立评审；阻断项清零后才可申请开发授权后的合并。
- **验证**：评审记录落 `docs/reviews/` 或 `inbox/` 并回链 Spec。

## 5. 验收

- Spec SC-01a／SC-01b ＋ SC-02–SC-17 逐条有证据（单测／契约测）。
- `npm run lint:spec-docs` 退出码 0；相关 vitest 全绿。
- 体感告警：**只**经 outbox；账本 `health-events` 订阅路径无 experience 判定。
- 文档与 UI 无「考核／排行榜／平台总分／用 visitorCount 当业务 DAU」表述。
- **不构成发布取证，不表示可上线**。

## 6. 完成定义

- SC-01a／SC-01b ＋ SC-02–SC-17 均有自动化证据。
- O4 若 defer，延期句已写入 Spec／清单池，不得假装已交付反馈入口。
- 未授权前无运行代码合入；授权后合入须附实现笔记。
- **不宣称可上线**；不宣称「0.30 核心升级完成」（尚缺其他 P0）。

## 7. 风险

| 风险 | 缓解 |
|---|---|
| O1–O3 未定导致实现空转 | 阻塞 S1 合入 |
| 与 Spec 194 分子漂移 | D2；单测夹具共享 194 条件 |
| 告警与账本通道耦死 | D7：独立 experience-events |
| UI 误用 interface visitorCount | SC-10；文案审查 |
| 反馈范围膨胀 | O4 defer 闸门 |
| 多 agent 改同一 overview 文件 | §3 并发边界 |

## 8. 建议实施序（产品线）

本条为清单 **Batch S6／P0-7**。产品线建议在 P0-4（可核对）之后实现（误报计划 W6），但**本阶段只评审 Spec／Plan**。不得插队实现挤占 P0-1…P0-6 评审带宽；不得把 P2 辅线抬过本条评审。

## 9. 回滚

授权实现后若需回滚：

1. 关闭 `notifications.experienceAlerts` → 立即停入队。
2. 回退 experience API 字段与 UI 区块；保留 Spec 194 路径不动。
3. outbox 中已排队 experience 行按既有 TTL／dead 保留策略消化；不删账本。
4. 不回滚 `audit_ledger_*` 行为。
