# Role Admin List Clarity Follow-up Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role Admin List Clarity Follow-up Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/76-role-admin-list-clarity-followup-spec.md`（v1.1）；浏览器核查 `http://127.0.0.1:55176/admin/roles`；Spec 59 / M57 既有实现；2026-08-04 上线前反对意见 |
| 适用范围 | 指导 `/admin/roles` 待修复 KPI 口径、Header/状态条降噪、Role 主语术语、卡片字段标签、复制表意、配置时间元数据的实施与验收 |
| 输出位置 | `webui/docs/plans/wo-202608-08-role-admin-list-clarity-followup.md` |

**Goal:** 落地 Spec 76 v1.1：修正「待修复」KPI 与默认列表脱节；`使用中`/`未引用`/`待修复` 统一按 `source==="yaml"`；删除 Header 模板句与默认状态条；卡片字段标签与「基于此新建」；`configUpdatedAt` 复用 `readAccessYaml` 单次 mtime；MetricCard 可点击且可访问。

**Architecture:** 以前端 `RoleList.tsx` 为主；后端扩展 `AccessFile` 透出 mtime，list API 附加 `configUpdatedAt`。不改 `access.yaml` schema、不改 ACL runtime、不改 copy/dryRun 路径。

**Tech Stack:** React、TypeScript、Fastify admin roles API、Vitest/Testing Library。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿 |
| v1.1 | 卡住：in-use/unused yaml 口径；参考模板 invalid 可见性验收；configUpdatedAt 单次 mtime；MetricCard a11y；Asia/Shanghai formatter |
| v1.1.1 | 审阅 follow-up：needs-repair 空态区分搜索未命中；删除未使用 `roleSourceLabel`；明确 detail 的 `configUpdatedAt` 为可接受兼容增强 |

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中执行本工单，按 Phase 顺序实施并逐步验证。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/59-role-admin-ops-ux-clarification-spec.md`
- `docs/76-role-admin-list-clarity-followup-spec.md`（**v1.1**）
- `src/pages/admin/RoleList.tsx`
- `src/pages/admin/RoleDetail.tsx`
- `src/lib/types.ts`
- `server/admin/roles.ts`
- `server/admin/access-config.ts`
- `src/__tests__/role-list.test.tsx`
- `src/__tests__/role-detail.test.tsx`
- `server/__tests__/admin-roles.test.ts`

## Non-Negotiable Boundaries

- 不删除参考模板机制；不改变 `POST /api/admin/roles/:roleId/copy` 与 dryRun-first 行为。
- 不改变 Lucy MCP Proxy runtime ACL。
- 不改 `access.yaml` schema（不写 per-role `createdAt` / `updatedAt` / `enabled`）。
- 不得把 `invalid` 渲染为 `已停用` / `禁用`。
- KPI「待修复」**不得**计入 `source === "template"` 的 invalid。
- **`使用中` / `未引用` 的 KPI 与筛选同理强制 `source === "yaml"`**，不得只看 `usageCount` 把模板算进去。
- 不得使用「已启用」作为无 lifecycle 字段时的 Role 状态主标签。
- `configUpdatedAt` **必须**复用 `readAccessYaml` 已有单次 `stat`；禁止在 role 循环内 `fs.stat`。
- MetricCard 可点击必须用 `button`（或等价）+ 键盘可达 + `aria-label` / pressed-or-current；禁止裸 `div onClick`。
- 专业术语、role id、tool name、`access.yaml`、`role_resolution_failed:*` 保留 `notranslate` / `translate="no"`。
- 不做移动窄屏专项验证。
- 本轮验收以 Vitest + `lint:terminology` + `build` 为准；不强制浏览器复核。

## Scope

### Phase 1: Baseline Source Review

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "参考模板仅用于低频|role-status-strip|正在服务 Agent|未被 Agent 使用|needsRepairCount|inUseCount|summarizeRoles|复制" \
  src/pages/admin/RoleList.tsx src/__tests__/role-list.test.tsx
rg -n "buildRoleSummary|configUpdatedAt|mtime|stat|readAccessYaml|AccessFile" server/admin/roles.ts server/admin/access-config.ts
rg -n "正在服务 Agent|未被 Agent 使用|In Use Role|Unused Role" docs/00-product-terminology-standard.md
```

预期：定位 Spec 76 要改的文案、KPI 聚合、状态条与复制按钮；确认 `readAccessYaml` 已有单次 `stat`；确认术语标准是否仍登记旧主术语。

### Phase 2: Update Test Contracts First

修改 `src/__tests__/role-list.test.tsx`（必要时 `role-detail.test.tsx`），覆盖 Spec 76 §9：

1. Mock / fixture：1 个 formal valid in-use role + 若干 template invalid → KPI「待修复」断言为 `0`（不是 template invalid 数）。
2. Header description 不含「参考模板仅用于低频创建辅助」。
3. `queryByTestId("role-status-strip")` 为 `null`（或确认默认不再渲染该条）。
4. 可见主标签为 `使用中` / `未引用`；不再出现作为主标签的 `正在服务 Agent` / `未被 Agent 使用`。
5. **yaml 口径：** fixture 含 `source=template && usageCount>0` 时，KPI「使用中」与筛选「使用中」**不含**该模板；「未引用」筛选亦不含模板。
6. 正式 Role 卡片含 `描述`、`数据范围`、`允许的 MCP 工具`、`引用 Agent`、`配置最近写入`（或 Spec 最终标签）。
7. 动作链接文案为 `基于此新建`，`queryByRole("link", { name: /^复制$/ })` 为 `null`。
8. `invalid` 仍不得出现 `已停用` / `禁用`。
9. **模板 invalid 可见性：** 选择「参考模板」后，invalid 模板仍渲染 `待修复` badge + 中文诊断（含「参考模板」弱说明）+ 技术详情。
10. **MetricCard a11y：** `getByRole("button", { name: /筛选：使用中|使用中/ })`（或约定的 aria-label）可点击切换筛选；当前项有 `aria-pressed="true"` 或等价 `aria-current`。

修改 `server/__tests__/admin-roles.test.ts`：

1. `GET /api/admin/roles` 的 yaml role 含 ISO `configUpdatedAt`。
2. template role 的 `configUpdatedAt` 为 `null` 或缺省。
3. （推荐）spy `fs.stat` / `stat`：单次 list 请求对 `access.yaml` 的 stat 次数不随 role 数线性增长（应仍为 `readAccessYaml` 的常数次）。

运行（预期实现前失败）：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/role-list.test.tsx server/__tests__/admin-roles.test.ts
```

### Phase 3: API — `configUpdatedAt`（单次 mtime）

修改 `server/admin/access-config.ts` + `server/admin/roles.ts`：

1. 扩展 `AccessFile`，例如增加 `mtimeMs: number`（或直接 `configUpdatedAt: string`），在既有 `readAccessYaml` 的 `stat` 结果上赋值；**不要**在 roles list 循环里再 `stat`。
2. list handler：`const { config, raw, version, mtimeMs } = await readAccessYaml(...)`；`const configUpdatedAt = new Date(mtimeMs).toISOString()`。
3. `buildRoleSummary` / list map：对 `source === "yaml"` 附加同一 `configUpdatedAt`；对 template 设 `null`。
4. 更新 `src/lib/types.ts` 的 `Role`：

```ts
configUpdatedAt?: string | null;
```

5. 不引入 per-role createdAt；不从 `version` 字符串反解 mtime。
6. **Detail 兼容增强（非列表页主验收）：** `GET /api/admin/roles/:roleId` 可同步返回同一 `configUpdatedAt`（yaml 为 ISO，template 为 `null`）。这是加法字段，不改变既有 detail 契约；调用方忽略即可。本轮不强制 detail UI 消费该字段。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/admin-roles.test.ts
```

### Phase 4: Summary Helpers + Metrics + Filters（含 yaml 口径与 a11y）

修改 `src/pages/admin/RoleList.tsx`：

1. `summarizeRoles`：
   - `needsRepairCount` = `source === "yaml" && invalid`
   - `inUseCount` = `source === "yaml" && usageCount > 0`（**必须改**；现状只看 `usageCount` 会把模板算进去）
   - `unusedFormalCount` = `source === "yaml" && !invalid && usageCount === 0`（保持/确认）
   - 保留 `templateCount` 供提示，**不**再用于默认状态条
2. MetricCard 文案：
   - `正在服务 Agent` → `使用中`
   - `未被 Agent 使用` → `未引用`
   - `待修复` hint → `正式 Role 权限解析失败`
3. `FILTER_OPTIONS` 同步：`使用中` / `未引用`；过滤逻辑与 KPI 对齐：
   - `in-use`：`source === "yaml" && usageCount > 0`
   - `needs-repair`：`source === "yaml" && invalid`
   - `unused`：`source === "yaml" && !invalid && usageCount === 0`
   - `templates`：`source === "template"`（**含 invalid，保证诊断可见**）
   - `formal`：`source === "yaml"`
4. MetricCard 可点击（a11y 强制）：
   - 根节点改为 `<button type="button">`（或 button 包裹现有内容）
   - `aria-label={`筛选：${label}`}`
   - `aria-pressed={sourceFilter === mappedFilter}`
   - `onClick` → `setSourceFilter(mappedFilter)`
   - 保留 `data-testid={`role-metric-${label}`}`
   - **禁止**仅 `div onClick`
5. 删除默认 `role-status-strip` JSX。
6. 可选：`sourceFilter !== "formal"` 时显示一行 `当前筛选：{label}（{filtered.length}）`；当 `needs-repair` 且 `filtered.length === 0` 时可弱提示「没有正式 Role 待修复」。
7. 确认「参考模板」筛选路径下 invalid 模板仍走 `RoleCard` 的 warning / §8 诊断渲染（Phase 5）。

### Phase 5: Header + Card Structure + Copy Label + Time Formatter

修改 `RoleList.tsx`：

1. PageHeader description 改为：
   `管理 Agent 可访问的数据源和 MCP 工具边界。正式 Role 写入 access.yaml。`
   （去掉参考模板从句；保留 `Agent` / `MCP` / `access.yaml` 翻译防御。）
2. `roleStatusBadges`：
   - source yaml → 短标签 `正式`（或全页统一的 `正式 Role`，与 Spec 76 选定一致）
   - in-use → `使用中`（替换 `正在服务 Agent`）；**仅 yaml + usageCount>0 时展示**（badge 侧也不要给模板贴「使用中」除非产品另有要求；默认模板不贴使用中）
   - invalid → `待修复`
   - template → `参考模板`
3. `RoleCard` 字段化：
   - `描述：{description}`（无则省略）
   - `数据范围：{sourceCount} 个 source · {connections} 个 connection`
   - `允许的 MCP 工具：{n} 个` + chips
   - `引用 Agent：{usageCount} 个` + users
   - yaml：`配置最近写入：{formatConfigUpdatedAt(configUpdatedAt)}`
   - template：`内置参考模板`
4. 新增局部 formatter（可放 `RoleList.tsx` 顶部或 `src/lib/` 小函数）：

```ts
function formatConfigUpdatedAt(iso: string): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(iso));
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}
```

   对齐 `ConnectionOverview` 的 `Asia/Shanghai` 模式；**禁止**裸 `toLocaleString()` 依赖浏览器本地时区。
5. 列表复制链接文案：`基于此新建`；`aria-label={`基于 ${role.id} 新建 Role`}`；`title` 说明基于当前 Role 创建新的正式 Role。
6. 模板 invalid 诊断：在现有中文诊断下追加 Spec 76 §8 的弱说明句（仅 template）。

### Phase 6: Terminology Standard Sync

若 `docs/00-product-terminology-standard.md` 仍将「正在服务 Agent / 未被 Agent 使用」登记为 Role 主术语，按 Spec 76 §4 更新为「使用中 / 未引用」，并保留禁止「已启用（无 enabled 字段）」约束。

同步检查：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "正在服务 Agent|未被 Agent 使用" src/ docs/00-product-terminology-standard.md src/__tests__/
```

将用户可见文案与断言一并替换；Agent 详情里若仅作补充说明可保留「被 Agent 引用」类 hint，但不得作为 `/admin/roles` 主标签。

### Phase 7: Regression Verification

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/role-list.test.tsx src/__tests__/role-detail.test.tsx server/__tests__/admin-roles.test.ts
npm run lint:terminology
npm run build
git diff --check
```

Expected：全部通过。重点人工扫一眼测试名/断言是否覆盖：yaml-only in-use、templates 筛选下 invalid 诊断、MetricCard button a11y、configUpdatedAt 单次 mtime。

### Phase 8: Code Review Checklist

- [ ] KPI「待修复」在仅有 template invalid 时为 0。
- [ ] KPI/筛选「使用中」「未引用」强制 `source === "yaml"`，模板 usage 不计入。
- [ ] 「参考模板」筛选下 invalid 模板仍有 badge + 诊断（无认知断层）。
- [ ] 默认页无 Header 模板句、无状态条复读。
- [ ] 无主标签「正在服务 Agent / 未被 Agent 使用 / 复制」。
- [ ] 卡片字段标签齐全；`基于此新建` 路由仍为 `?mode=copy`。
- [ ] `configUpdatedAt` 来自 `AccessFile` 单次 mtime，无 per-role `stat`；UI 用 `Asia/Shanghai` formatter。
- [ ] MetricCard 为 `button` + `aria-label` + pressed/current，键盘可达。
- [ ] 未改 ACL / access.yaml schema / template 机制。

## Acceptance Criteria

- Spec 76 §10（v1.1）全部勾选条件满足。
- 相关测试与 `lint:terminology`、`build` 通过。
- diff 不包含与本工单无关的格式化或重构。

## Out of Scope

- per-role `createdAt` / `updatedAt` schema。
- Role lifecycle / `enabled` 字段。
- 模板详情页大改（除断言冲突的最小同步）。
- 浏览器验证（可另排；本工单不阻塞）。
- 移动窄屏。
