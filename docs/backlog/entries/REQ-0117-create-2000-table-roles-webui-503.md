# REQ-0117：大目录下创建 2000+ 表角色时 WebUI 报 503（已复现，待立项）

| 元数据 | 内容 |
|---|---|
| 文档类型 | 常青需求池单条正文（一需一档）。**不是**功能 Spec，**不构成**开发授权 |
| 稳定 ID | `REQ-0117` |
| 类型 | `需求`（缺陷排查 / 修复） |
| 优先级 | `P1`（可变属性：`P0`／`P1`／`P2`） |
| 阶段 | `S2`（开立 Spec 后以 Spec 头部「阶段」格为唯一事实源） |
| 授权边界 | **入池 ≠ 立项 ≠ 终稿确权 ≠ 开发授权**。进入开发前须按 `DEVELOPMENT.md` 完成：需求澄清 → 独立 Spec → 配对 Plan → 终稿确权 → 委托人另发开发授权 |

## 来源与背景

- 提出日期 / 来源：2026-11-26 / 用户口头反馈；同日于本机 compose demo 复现并指认根因
- 现象或痛点：在 WebUI 创建一个关联 2000+ 张表的角色（表单入口）时，页面数据请求返回 `503`。
- 复现结论（2026-11-26，demo 栈，2000 张已启用表）：
  - 创建请求本身始终 `200`（耗时 5–12s）；`503` 出现在**同窗的并发读取**与**重叠写入**上，共两处出口：
    - `503 DISPLAY_SNAPSHOT_BUSY`（B 类可重试，`reason=write_pending`）：`GET /api/admin/roles` 在写窗口内读预算耗尽（`webui/server/display-snapshot.ts`）；`/api/health` 的 `displayBusy.recent` 记录到 `name=role-list`、`reason=write_pending`。
    - `503 PUBLISH_COORDINATOR_BUSY`（零等待拒绝）：重叠的角色写 0.08s 内被 `webui/server/publish-coordinator.ts` 直接拒绝。
  - 规模归因：写成本随**启用表目录规模**放大（catalog/策略/快照重载），2000 表目录下小角色创建也要 ~5–10s；角色关联 2000 表本身只额外增加 ~1.5–2s。小目录基线（5 张启用表）创建 3.4s，零 503。
- 错题本：[docs/lessons/2026-11-26-large-catalog-role-write-blocks-display-reads.md](../lessons/2026-11-26-large-catalog-role-write-blocks-display-reads.md)

## 期望方向（非实现承诺）

- 大目录规模下保证「创建/编辑角色」主路径可用：写路径有界化（分片、异步/有界等待或明确进度反馈），不因目录规模把写屏障拉长到读预算之外。
- 重叠写不再立即 503：发布协调器对同窗写给有界等待或明确的重试语义。
- 读取面在长写窗口内保持可用（延续 A 类 200 `grace`/`stale`/`pending`、B 类 `write_pending` 503 的既有合同并保障恢复可达性），并把大目录写耗时纳入性能基线（P1-79/P1-89 现行面）。

## 非目标与边界

- 仅作已复现缺陷入池登记，尚未立项或修改运行代码；修复须另走 Spec → Plan → 终稿确权 → 开发授权。

## 在途记录

- 2026-11-27（AWW-08 浏览器阶段 UAT 发现，委托人同日明示授权修复）：`RoleDetail` 在 409 版本冲突／503 写窗繁忙错误分支渲染 `AccessWriteRecoveryPanel` 时未关闭权限审阅抽屉，Radix modal 遮罩＋背景 aria-hidden 使用户看不到「配置已变化／有变更正在保存」提示与三方比对／重试入口。修复：两个恢复面板分支进入时 `setReview(null)`（草稿保留，`finishSave` 路径不受影响），抽屉确认按钮补 `data-testid="role-review-confirm"`，`role-detail.test.tsx` 补冲突分支关抽屉断言。同轮修 UAT 跑器（非产品缺陷）：E4 按文案「确认保存」定位在 pending 文案切「保存中…」后失配改走 testid；详情首屏 30s 超时贴线放宽至 60s 并补在途写收敛等待；E4 重叠写断言对齐 Spec E4/E10「成交或可重试提示」双分支（夹具规模写窗超 15s 等待上限时诚实 503 为合规分支）。证据：`runs/2026-11-27-claude-aww-final.md`、`runs/2026-11-27-kimi-aww-closure.md`。
- 2026-11-27（环境教训）：`stack up` 重建容器后必须按规程同步 `fixture.mjs clean && up` 完整重播（含 manifest 上传）；否则出现「物理表/文件在但新角色 selector 解析 0 source」的半状态（存量 v2 物理名角色不受影响），并会以 `PREVIEW_INPUT_CHANGED` 409 形式污染冲突类用例。复位后阶段 1/2 复测待跑（委托人指示本轮止步于代码修正）。

## 关联

- 常青需求池：[docs/backlog/README.md](../README.md)
- 配对 Spec / Plan：[Spec](../../specs/lucy-20261126-access-write-window-resilience-spec.md) · [Plan](../../plans/lucy-20261126-access-write-window-resilience-plan.md)（S2｜v1.0，终稿已确权 2026-11-26；OQ-1～OQ-3 已裁定；未获开发授权）
- 错题本：[docs/lessons/2026-11-26-large-catalog-role-write-blocks-display-reads.md](../lessons/2026-11-26-large-catalog-role-write-blocks-display-reads.md)
