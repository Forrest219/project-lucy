# Role Admin List and Detail IA Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role Admin List and Detail IA Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/89-role-admin-list-and-detail-ia-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 89 与 UI/UX 台账 `UX-ADMIN-AGENTS-027`～`030` |
| 输出位置 | `webui/docs/plans/wo-202608-21-role-admin-list-and-detail-ia.md` |

**Goal:** `/admin/roles` 静态 KPI + 描述对齐访问治理；Role 详情 Tab 拆分基本信息 / 权限配置 / 生效边界；新建隐藏空 Tab。

**Architecture:** `RoleList.tsx` KPI + PageHeader；`RoleDetail.tsx` Tab 过滤与内容拆分；测试与台账同步。

**Tech Stack:** React、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

---

## Non-Negotiable Boundaries

- 不改 Role Admin API。
- KPI 不得可点击筛选；不得对「解析异常」使用 `pl-metric-card--danger`。
- 新建 / 复制不得渲染「使用情况」「生效边界」Tab。
- 不做浏览器验证；结束后只做 code review。

## Scope

### Phase 1: RoleList

- PageHeader description 改写。
- `MetricCard` 改为静态 `div`（对齐 `AgentList`）。
- KPI：`Role 总数` / `使用中` / `未引用` / `解析异常` + testId。
- `needsRepairCount > 0` 时 inline notice。
- 移除 KPI `tone` / `filter` / `aria-pressed`。

### Phase 2: RoleDetail

- Tab 类型：`identity` | `permissions` | `effective` | `usage` | `diff`。
- `visibleTabs(mode)` 按 Spec §5.3 过滤。
- 拆分原 `config`：identity 与 permissions 两块。
- 原 `permissions` 预览 → `effective`（生效边界）。
- 更新 create/edit 描述文案；dirty bar 条件 `(identity|permissions) && dirty`。
- patch 成功后 `setActiveTab("identity")`。

### Phase 3: 文档与台账

- `06-navigation-ia.md` 角色权限说明行。
- `webui/docs/README.md` 索引 Spec 89 + Plan。
- `docs/ui-ux-feedback/pages/admin-agents.md`：`UX-ADMIN-AGENTS-027`～`030` → `Fixed`。
- `docs/ui-ux-feedback/README.md` 维护记录 + 跨页面主题 `role-detail tab IA`。

### Phase 4: Tests

- `role-list.test.tsx`：静态 KPI、解析异常 testId、移除 metric button 测试。
- `role-detail.test.tsx`：Tab 名称、create 权限字段在「权限配置」、生效边界测试。

### Phase 5: Gate

```bash
cd webui
npm test -- src/__tests__/role-list.test.tsx src/__tests__/role-detail.test.tsx
npm run lint:terminology
npm run build
```
