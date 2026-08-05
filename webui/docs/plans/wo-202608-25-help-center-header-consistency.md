# Help Center Header Consistency Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Help Center Header Consistency Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/92-help-center-header-consistency-spec.md`（v1.0） |
| 适用范围 | `/help` 页头统一组件化与语义一致性修复 |
| 输出位置 | `webui/docs/plans/wo-202608-25-help-center-header-consistency.md` |

**Goal:** 修复 `/help` 页头一致性问题（组件、重复信息、返回语义）。

**Architecture:** `HelpCenter.tsx` 头部替换为 `PageHeader` + 测试断言同步 + 台账状态更新。

**Tech Stack:** React、Vitest。

## Non-Negotiable Boundaries

- 不改 help handbook API 与 markdown 分段逻辑。
- 不触发浏览器验证。
- 仅修复页头层问题，不扩散到 TOC/正文布局。

## Scope

### Phase 1: Header 组件收敛

- `HelpCenter.tsx` 改为 `PageHeader`。
- 保留来源路径/更新时间 badges。
- breadcrumb 收敛为单项“系统帮助”。

### Phase 2: 返回语义修复

- 动作改为“返回系统概览”，路由 `/overview`。

### Phase 3: 测试与文档

- `help-center.test.tsx` 更新断言（`page-header`、breadcrumb、返回链接）。
- `docs/ui-ux-feedback/pages/help.md`：`UX-HELP-001`～`003` → `Fixed`。
- `docs/ui-ux-feedback/README.md` 维护记录追加本轮修复。
- `webui/docs/README.md`、`webui/docs/plans/README.md` 登记 Spec/Plan。

### Phase 4: Gate

```bash
cd webui
npm test -- src/__tests__/help-center.test.tsx
npm run lint:terminology
npm run build
```
