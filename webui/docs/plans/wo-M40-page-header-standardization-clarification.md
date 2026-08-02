# WO-M40 PageHeader Standardization — Clarification Questions

> 移交 coder 前必答；每条都有默认建议（详见 SPEC §10）。

## Q1. `title` 为 ReactNode 时是否启用同名抑制？

**默认建议**：否；只对 `typeof title === "string"` 启用同名抑制。`Audit.tsx` heatmap 子分支的 title 是字符串、`breadcrumbs` 末项是字符串 `"数据热力"`，与 title 不同仍会渲染。但其它场景（如 `NewToken.tsx`）的 `title` 含有 `<span>`，与 `breadcrumbs` 字符串末项同名时无法靠 `===` 判断；不做抑制避免误判。

## Q2. `title` 是 string 时是否加 `truncate`？

**默认建议**：部分同意。string title 时 PageHeader 内部可对 `<h1>` 容器加 `truncate` + `title` 属性兜底。但**不强制对整个 H1 都 truncate**——ReactNode title（含动态对象名 / 表名 / Agent id）不动，由调用方把动态对象名片段单独 truncate（`className="truncate"`），避免长表名 / Agent id 直接被截损害页面主标题可读性。

## Q3. `backAction` 是否提供默认实现？

**默认建议**：否。`backAction` 仅接受 `ReactNode`；调用方按需传 `<Link>` / `<button>`。原因：
- 测试更纯（不受 react-router 上下文影响）
- 多入口场景（同一组件用在 Modal、Drawer 子页时）可自由控制

## Q4. Onboarding badges ≤ 4 后信息完整性

**默认建议**：保留全部 5 条信息，但分成"标题栏 badges（≤4）"+"下方 meta 行（活跃 Token + 上次更新时间）"两组。`活跃 Token` 下沉到 `pl-page-intro` 旁；其余 4 个徽章保留在右侧。**PR 必须附 `/overview` 改后截图**，由 designer / architect 复核 meta 行配色，避免与右侧 badges 视觉竞争。

## Q5. `pl-page-header-actions--stacked` 是否需要重命名？

**默认建议**：不重命名；保留 modifier。理由：
- 减少 diff 范围
- modifier 仅 Onboarding 一处使用，影响面可控

## Q6. Audit heatmap 子分支是否走 `backAction`？

**默认建议**：否；保留多级 breadcrumbs `["访问治理", "访问日志", "数据热力"]`。理由：tab 切换是页面内视图，物理路由不变；提供返回按钮会让用户误以为跳页。

## Q7. WikiEditor 是否需要 `backAction`？

**默认建议**：否。`/wiki` 是**一级路由例外**，因为它本身就是工作台 / 编辑器（不是详情页），breadcrumbs 提供"我在哪篇 Wiki"的层级上下文比返回按钮更有价值。

## Q8. 是否同步更新 `docs/webui-feature-map.md`？

**默认建议**：不更新。本规格是组件级 polish，不影响任何 feature map 字段（页面是否存在、能力清单、路由路径都未变）。

## Q9. `WikiEditor` 与 `TableEditor` 的 `badges` 是否需要保留？

**默认建议**：保留；未超过 ≤ 4 上限。`WikiEditor` 2 个（mode + status）、`TableEditor` 1-2 个。

## Q10. `TableEditor.tsx` 的 title truncate 策略

**默认建议**：保留 ReactNode 形态；不加 `truncate`；不靠 `title` 属性兜底（避免 table 名过长截断后无悬停值）。可在表格名上加 `truncate` 单独控制（既有实现）。**注意**：原 SPEC 此处笔误为 `TitleEditor`，实际文件是 `TableEditor.tsx`。

## Q11. 既有 `__tests__/app-shell.test.tsx` 中 snapshot

**默认建议**：保留现有测试用例 `<PageHeader title="连接概览" breadcrumbs={["数据接入"]} />`（按新规则 `breadcrumbs` 长度 1 但与 title 不同，仍会渲染面包屑）。snapshot 整体重生成以反映新版网格结构（移除占位 cell）；新增断言覆盖：
- `backAction` 存在时 `<nav aria-label="面包屑">` 不渲染
- `breadcrumbs=["X"]` 且 `title="X"` 时面包屑不渲染
- `backAction` + `breadcrumbs` 同时存在时只渲染 `backAction`

## Q12. `PageHeader` 是否接受 `className` prop？

**默认建议**：暂不接受；先保持组件契约克制。如确需样式覆盖，新加 `className?: string` 与 `data-testid` 一起保留向后兼容。

## Q13. Catalog.tsx title 是否本次改为"表目录"？

**默认建议**：改。`"语义维护工作台"` 是已弃用别名，与 `webui/docs/00-product-terminology-standard.md` 冲突；本工单顺手收尾，避免遗留。改动范围：仅 `Catalog.tsx` PageHeader `title` 字段，**不触及路由（`/` 不变）、侧栏 IA、能力清单**。

## Q14. 视觉验收的 Catalog 路径

**默认建议**：用 `/`。当前 `App.tsx` 路由定义 `<Route path="/" element={<Catalog />} />`，没有 `/semantic` 路由。视觉验证必须按实际路由走，避免验收失败。

## Q15. H1 字号最终定多少？

**默认建议**：`text-[16px] font-semibold leading-6`。理由：
- 17px 偏重，与正文 13px 拉开足够层级，但 16px 在中文后台里更克制
- 16px 配合分隔线 + `border-b` 已能与 `pl-panel-title`（16px 同字号）靠页面顶部间距建立层级
- 不允许低于 16px（避免与 section heading 混淆）

## Q16. 详情页 actions 里的"返回"按钮迁移到 backAction 后如何处理？

**默认建议**：删除原 actions 里的"返回"按钮。避免同一页面同时出现两个返回入口（视觉冗余 + 用户认知冲突）。如原 actions 仍含其它操作（如保存、复制 id、删除），保留非返回部分。具体清点：

| 页面 | actions 原内容 | 调整 |
|---|---|---|
| `RunDetail.tsx` | 可能含"返回运行历史" + 其它 | 删除"返回"，其它保留 |
| `CaseEditor.tsx` | 可能含"返回" + 保存 | 删除"返回"，保留保存 |
| `RoleDetail.tsx` | 可能含"返回" + 保存/删除 | 删除"返回"，其它保留 |
| `AgentDetail.tsx` | 可能含"返回" + 复制 id / 启用停用 | 删除"返回"，其它保留 |
| `NewToken.tsx`（3 处） | 可能含"完成" / "重新生成" | 检查是否有"返回"按钮，如有则删除 |