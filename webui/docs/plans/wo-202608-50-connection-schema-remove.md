# Connection Schema Remove Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Schema Remove Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/117-connection-schema-remove-spec.md`（v1.0）；用户批准改善方案 |
| 适用范围 | Spec 117：removeSchema API、RemoveSchemaDrawer、Overview 入口、术语与台账 |
| 输出位置 | `webui/docs/plans/wo-202608-50-connection-schema-remove.md` |

**Goal:** `/connections` 可「移除 Schema」：必清 `schemas` + 前缀 `enabled_tables`；dryRun 影响面；可选删 Manifest/overlay；Wiki 只告警。

**Architecture:** 对称 `addSchema` → `removeSchema`（YAML Document 就地补丁 + `safeRemove`）→ `POST .../schemas/remove` → `RemoveSchemaDrawer`；Wiki 影响用 `listWiki` 扫 `sl_refs` 前缀。

**Tech Stack:** Fastify、yaml Document、fs-safe、React Query、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿 |

---

## Non-Negotiable Boundaries

- 不写物理库；不 DROP Schema/表。
- 不默删 Wiki；可选删文件默认关。
- 写入只经 `writeKtxYaml` / `safeRemove`。
- 本轮不做浏览器验证；结束后只做 code review。

## Scope

### Phase 1 — Server

- `server/project.ts`：`SchemaNotFoundError`；`removeSchema()`；schemas 移除 + enabled_tables prune；impact 收集。
- Manifest 表名解析（轻量读 `_schema/<schema>.yaml` 的 `tables` keys）；overlay 路径并集。
- Wiki：`listWiki` → `sl_refs` 匹配 `<connId>/<schema>/` 前缀。
- `server/model.ts` + `src/lib/types.ts`：Preview / Result 类型。
- `server/index.ts`：`POST /api/connections/:connId/schemas/remove`。
- 测试：`project.remove-schema.test.ts`、`api.remove-schema.test.ts`（可镜像 add-schema）。

### Phase 2 — UI

- `RemoveSchemaDrawer.tsx`：打开即 dryRun；勾选可选删除；确认写入；成功引导同步。
- `ConnectionOverview.tsx`：行操作「移除 Schema」；挂载抽屉。
- CSS：如需 `pl-row-action-link--danger`。
- 测试：`remove-schema-drawer.test.tsx`；`connection-overview.test.tsx` 断言入口存在。

### Phase 3 — Docs / 术语 / 台账

- `00-product-terminology-standard.md` §4.1 登记 Remove Schema 等。
- `docs/design-schema-onboarding.md`：交叉引用 Spec 117。
- `03-api-spec.md` 补 endpoint。
- `webui/docs/README.md`、`plans/README.md` 索引。
- `docs/ui-ux-feedback/pages/connections.md`：`UX-CONNECTIONS-034` → Fixed。
- `docs/ui-ux-feedback/README.md`：最近维护 + 跨页面主题 `connection schema remove lifecycle`。

### Phase 4 — Gate

```bash
cd webui
npm test -- --run \
  server/__tests__/project.remove-schema.test.ts \
  server/__tests__/api.remove-schema.test.ts \
  src/__tests__/remove-schema-drawer.test.tsx \
  src/__tests__/connection-overview.test.tsx
npm run lint:terminology
npm run build
```

可选：`review-agent` / Bugbot 对 diff。

## 验证要点

- prune 后 `readConnections` 不再合并出该 Schema。
- 默认不删文件；勾选后 `safeRemove` 生效。
- Wiki 文件保留；impact.wikiRefCount 正确。
- 术语无「删除数据库 / 删库 / 架构 / 模式」。
