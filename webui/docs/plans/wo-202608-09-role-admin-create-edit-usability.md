# Role Admin Create / Edit Usability Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role Admin Create / Edit Usability Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/77-role-admin-create-edit-usability-spec.md`（v1.1）；浏览器核查 `/admin/roles/new`、`/admin/roles`；Spec 15 §5.3；与 Spec 76 并行边界；交付质量交叉评估反对意见 |
| 适用范围 | 指导 Role 新建/编辑页中文化与选择器化（Wave A）、列表能力筛选（Wave B）的分段实施与验收 |
| 输出位置 | `webui/docs/plans/wo-202608-09-role-admin-create-edit-usability.md` |

**Goal:** 落地 Spec 77 v1.1：Wave A 先交付新建/编辑可用性（标题去重、中文标签、选择器主路径 + 受控手输回退）；Wave B 再交付列表能力筛选与必填 `sourceNames: []`。不改 `access.yaml` schema，不改 ACL runtime，不抢做 Spec 76。

**Architecture:** 以前端 `RoleDetail.tsx` / `RoleList.tsx` 为主。连接与 Schema 主源 `GET /api/connections`（含 `schemas`）；`GET /api/connections/:id/tables` 仅作表候选扁平列表兜底；工具候选 `GET /api/admin/mcp-tools`。Wave B 扩展 list `sourceNames`，复用既有 preview，禁止 N+1。

**Tech Stack:** React、TypeScript、Fastify admin roles API、Vitest/Testing Library。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿 |
| v1.1 | 纳入交叉评估：Schema 主源、受控手输回退、sourceNames 失败语义、统一引用 Spec 76、术语全局同步、Wave A/B 分段验收 |

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中执行本工单。**先完成 Wave A 并单独验收，再做 Wave B。** 按 Phase 顺序实施并逐步验证。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/15-role-admin-spec.md`（§5.3）
- `docs/59-role-admin-ops-ux-clarification-spec.md`
- `docs/76-role-admin-list-clarity-followup-spec.md`（边界：不抢做 KPI/状态条/`configUpdatedAt`；交叉引用只称 Spec 76）
- `docs/77-role-admin-create-edit-usability-spec.md`（**v1.1**）
- `src/pages/admin/RoleDetail.tsx`
- `src/pages/admin/RoleList.tsx`
- `src/lib/types.ts`
- `server/admin/roles.ts`
- `server/admin/mcp-tools.ts`
- `server/index.ts`（`/api/connections`、`/api/connections/:connId/tables`）
- `src/__tests__/role-detail.test.tsx`
- `src/__tests__/role-list.test.tsx`
- `server/__tests__/admin-roles.test.ts`

## Non-Negotiable Boundaries

- 不改 `access.yaml` schema（无 `displayName` / 流水号 / per-role 时间字段）。
- 不把默认 role id 改成无业务含义流水号；`roleId` 规则仍 `^[A-Za-z0-9_-]{1,64}$`。
- 不改变 dryRun-first、template 只读、copy API 语义、Lucy MCP Proxy ACL。
- 不抢做 Spec 76 范围（待修复 KPI、Header 模板句、状态条、badge「使用中」、`基于此新建`、`configUpdatedAt`）。若 Spec 76 已合入，Wave B 能力筛选文案与其状态下拉对齐；若未合入，能力筛选独立落地。交叉引用统一写 **Spec 76**，不以工单号作为边界主称。
- **Schema 主源**必须是 `GET /api/connections` → `connection.schemas`；**禁止**用 `/api/connections/:connId/tables` 反推 Schema 列表（该接口只返回扁平 `schema.table`）。
- 连接 / 工具 / 指定表名：选择器为**主路径**；候选 API 失败或空时必须有**受控手输回退** + 清晰提示；不得因候选不可达而无法填表；也不得把 textarea 手录作为唯一路径。
- `prefix` 路径本身是文本输入（高级），不要求多选。
- 全局 `globalDenied` 工具不可选。
- Wave B：`sourceNames` 必须始终为 `string[]`（失败为 `[]`）；按表筛选时空数组不命中；禁止为筛选增加与 role 数成正比的额外远程解析。
- Wave A / Wave B **分段验收**，不得要求一次 PR 同时通过两边才算合入（允许同 PR 分 commit，但验收门禁分开）。
- §4 术语必须写入 `docs/00-product-terminology-standard.md`（Wave A 至少身份/权限字段；Wave B 含能力筛选）。
- 专业术语、role id、connection id、tool name、table/source name、`access.yaml` 保留 `notranslate` / `translate="no"`。
- 不做移动窄屏专项验证；本轮不强制浏览器复核。

## Scope

### Phase 0: Terminology Sync（Wave A 开工前或同批）

更新 `docs/00-product-terminology-standard.md`，登记 Spec 77 §4：

- 角色标识、说明、允许的连接、允许的 MCP 工具、可访问的表范围、指定表名、按前缀匹配、按能力筛选

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "角色标识|指定表名|按前缀匹配|允许的连接|可访问的表范围|按能力筛选" docs/00-product-terminology-standard.md
```

Expected：上述主术语均有表行。

---

## Wave A — 新建 / 编辑可用性

### Phase A1: Baseline Source Review

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "新建正式 Role|Role ID|Connections|Table Selectors|添加 selector|names|prefix|connectionsText|toolsText" \
  src/pages/admin/RoleDetail.tsx src/__tests__/role-detail.test.tsx
rg -n "schemas|tables" server/index.ts src/lib/types.ts
```

确认：`/tables` 为扁平 `schema.table`；`ConnectionInfo.schemas` 可用。

### Phase A2: Test Contracts First（Wave A only）

修改 `src/__tests__/role-detail.test.tsx`：

1. Header：无「新建正式 Role」叠句。
2. 标签：`角色标识`、`说明`、`允许的连接`、`允许的 MCP 工具`、`可访问的表范围`。
3. Schema 选项来自 mock connection.schemas，不依赖从 `/tables` 解析 schema 列表。
4. 勾选连接/工具后 payload 正确；deny 工具不可选。
5. 「指定表名」/「按前缀匹配」中文；「+ 添加表范围」。
6. Mock 连接或 mcp-tools 失败：受控手输回退 UI 可见且仍可组装 body。

运行（实现前可失败）：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/role-detail.test.tsx
```

### Phase A3: RoleDetail — copy + identity

1. create description → Spec 77 §7.1。
2. `角色标识` + hint；`说明`。
3. （可选）说明填空时建议 slug；不覆盖已输入标识。

### Phase A4: RoleDetail — connection & MCP pickers + fallback

1. `useQuery`：`/api/connections`、`/api/admin/mcp-tools`。
2. 多选主路径；deny 禁用。
3. API error / empty → 提示 + 手输回退。
4. body 仍为 `connections[]` / `tools[]`。

### Phase A5: RoleDetail — table range editor

1. 区块/按钮/空态中文化。
2. Schema 下拉 = 所选连接的 `schemas`；手输回退。
3. 表候选 = `/tables` 扁平列表按 `schema.` 过滤；失败则手输 `names`。
4. 「按前缀匹配」文本 + hint。
5. 禁止把 `/tables` 当 Schema 主源。

### Phase A6: Wave A Verification Gate

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/role-detail.test.tsx
npm run lint:terminology
npm run build
git diff --check
```

**Wave A DoD：** Spec 77 §9.1 全部勾选。此时可合入；**不要求**列表能力筛选已完成。

---

## Wave B — 列表能力筛选

### Phase B1: Test Contracts（Wave B）

修改 `src/__tests__/role-list.test.tsx` + `server/__tests__/admin-roles.test.ts`：

1. list 每条含 `sourceNames: string[]`（可 `[]`）。
2. 按连接 / 工具 / 表过滤；`sourceNames: []` 不命中按表。
3. 搜索命中 tool / connection / 表名。
4. 与状态筛选 AND。

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/role-list.test.tsx server/__tests__/admin-roles.test.ts
```

### Phase B2: API — required `sourceNames`

修改 `server/admin/roles.ts` + `src/lib/types.ts`：

```ts
sourceNames: string[]; // required; [] on resolve failure / zero sources
```

- 复用 list 已有 preview 结果；**禁止**额外 N+1 远程调用。
- 键始终存在，不用 `undefined` 表示失败。

### Phase B3: RoleList — capability filters + search

1. 按连接 / MCP 工具 / 表控件 + testid / aria-label。
2. 状态 AND 能力；同维 OR。
3. 搜索含 `sourceNames`；placeholder 对齐 Spec。
4. 空结果提示区分能力条件；可提示不可解析表的 Role 不出现在按表结果中。

### Phase B4: Wave B Verification Gate

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/role-detail.test.tsx src/__tests__/role-list.test.tsx server/__tests__/admin-roles.test.ts
npm run lint:terminology
npm run build
git diff --check
```

**Wave B DoD：** Spec 77 §9.2 全部勾选；Wave A 回归仍绿。

### Phase B5: Code Review Checklist

- [ ] Schema 主源为 `connections.schemas`；`/tables` 仅表候选。
- [ ] 选择器主路径 + 受控手输回退齐全；deny 工具不可选。
- [ ] 新建页无「新建正式 Role」叠句；主标签中文化。
- [ ] `sourceNames` 必填数组；按表筛选空数组不误命中；无 N+1。
- [ ] 术语已进 `00-product-terminology-standard.md`。
- [ ] 未改 ACL / access.yaml schema / Spec 76 专属项。
- [ ] 文档交叉引用称 Spec 76，不混用工单号作边界主称。
- [ ] 翻译防御完整。

## Acceptance Criteria

- Wave A：Spec 77 §9.1；Wave B：Spec 77 §9.2。
- 两波均可独立验收；全量完成后两边测试 + `lint:terminology` + `build` 通过。
- diff 不包含与本工单无关的格式化或重构。

## Out of Scope

- `displayName` / 流水号 schema。
- Spec 76 KPI / 状态条 / `configUpdatedAt` /「基于此新建」（除非仅为避免断言冲突的最小对齐）。
- 权限预览 Tab 大改。
- 按表筛选匹配 raw 未解析 `names`/`prefix`。
- 浏览器验证与移动窄屏。
- 能力筛选 URL 持久化。
