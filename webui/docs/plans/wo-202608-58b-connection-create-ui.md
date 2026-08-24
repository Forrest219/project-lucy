# Connection Create — UI (Phase B)

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Create UI Phase B |
| 文档类型 | Plan / Verification |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-24 |
| 基于材料 | Spec 124；WO-58；Phase A spike（`POST /api/connections`） |
| 输出位置 | `webui/docs/plans/wo-202608-58b-connection-create-ui.md` |
| 状态 | Implemented（Drawer + Overview CTA / 空态；无 handbook 翻转） |

## Scope（本分支）

- `CreateConnectionDrawer`：输入 → dryRun 新建预览 → 确认创建
- `/connections` PageHeader **新建连接** + 空态 CTA
- `/connections/test`、启用表范围空态改为引导「连接概览新建连接」
- 前端 `connectionId` 校验与 API 错误文案映射

## Out of Scope

- Spec 26 / `design-db-connection` / SYSTEM_HANDBOOK FAQ 全文翻转（Phase C）
- WebUI Auth；编辑 / 删除连接；secrets 管理 UI

## Automated checks

```bash
cd webui
npm run lint:terminology
npx vitest run \
  src/__tests__/connection-id.test.ts \
  src/__tests__/create-connection-drawer.test.tsx \
  src/__tests__/connection-overview.test.tsx \
  src/__tests__/connection-test.test.tsx
```
