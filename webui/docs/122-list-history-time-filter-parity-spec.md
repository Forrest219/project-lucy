# List History Time Filter Parity Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | List History Time Filter Parity Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 用户批准改善方案（对照 `/publish/history` Spec 113 v1.1）：配置审计完全对齐；访问日志补可见「时间」+ `since` 整点（保留默认 7 天）；其余页面不改 |
| 适用范围 | `/admin/config-audit` 时间筛选与发布记录同构；`/admin/audit` 筛选栏时间组可见标签与整点起点 |
| 输出位置 | `webui/docs/122-list-history-time-filter-parity-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 122 |
| 关联工单 | `webui/docs/plans/wo-202608-56-list-history-time-filter-parity.md` |
| 关联页面 | `/admin/config-audit`；`/admin/audit` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-config-audit.md`（`UX-ADMIN-CONFIG-AUDIT-009`）；`docs/ui-ux-feedback/pages/admin-audit.md`（`UX-ADMIN-AUDIT-026`） |
| 上游 Spec | Spec 113 v1.1（发布记录时间筛选样板）；Spec 96（配置审计筛选）；Spec 89 / 106（访问日志统计窗与筛选） |
| 状态 | Implemented |
| 日期 | 2026-08-07 |
| 范围 | 配置审计：可见「时间」+ 近 24 小时 + 默认整点；访问日志：可见「时间」+ `since` 整点；不改默认 7 天 / 顶栏统计窗 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

## 1. 背景

`/publish/history`（Spec 113 v1.1）已具备：

1. 筛选栏可见标签「时间」；
2. 快捷窗口：全部时间 / 近 24 小时 / 近 7 天 / 近 30 天；
3. 首访无时间参数时默认 `window=24h`，`since` 为整点。

全站排查后：

| 页面 | 结论 |
|---|---|
| `/admin/config-audit` | 同构控件，缺标签 / 24h / 默认 → **完全对齐** |
| `/admin/audit` | 有起止 + 顶栏 24h/7d 统计窗；缺可见「时间」；`since` 非整点；默认 7 天按 Spec 89 保留 → **部分对齐** |
| `/admin/usage`、`/eval/monitor`、表单 `type="date"` 等 | 非列表日期范围筛选 → **本轮不改** |

## 2. 目标

### 2.1 `/admin/config-audit`（完全对齐）

1. 时间组前可见标签「时间」。
2. 快捷窗口增加「近 24 小时」；选项顺序与发布记录一致。
3. 首访无 `window`/`since`/`until` 时 `replace` 写入 `window=24h` 与整点 `since`；用户选「全部时间」后不自动回填。
4. 快捷窗写入的 `since` 一律整点（分钟/秒归零）。

### 2.2 `/admin/audit`（部分对齐）

1. 共享筛选栏起止控件前增加可见标签「时间」。
2. 由统计窗推导的默认 `since`（及切换 24h/7d 后重算）改为整点。
3. **保留**顶栏「统计窗口」分段与默认 `range=7d`（不改为 24h；不新增发布记录式快捷窗）。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 访问日志默认改为 24h | Spec 89 默认 7 天；本轮用户批准的是 B1 |
| 访问日志筛选栏增加全部/24h/7d/30d 快捷窗 | 与顶栏统计窗职责重叠；需单独决策 |
| `/admin/usage`、`/eval/monitor` KPI/趋势窗 | 形态不同 |
| Case / Token 等表单日期字段 | 非列表筛选 |
| 本轮浏览器验证 | 用户约束：结束后只做 code review |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

| 场景 | 采用 | 禁止 |
|---|---|---|
| 可见筛选组标签 | **时间** | 无标签仅靠 aria-label；「时间范围」作筛选组名（过宽） |
| 快捷窗口 | **近 24 小时** / **近 7 天** / **近 30 天** / **全部时间** | `24h` / `7d` 作唯一可见文案（配置审计快捷窗） |
| 访问日志顶栏 | **24 小时** / **7 天**（既有 segmented，本轮不改文案） | 与筛选快捷窗混用同一控件 |

Protected：既有 `Agent`、路径、ID → `notranslate`。

## 5. Design System Compliance

- 配置审计：维持 `pl-admin-filterbar`；时间组与发布记录同序：`[时间] [快捷窗] [since] — [until] …`。
- 访问日志：维持共享筛选栏；在 Agent 输入与起止之间或起止前放置「时间」标签（起止组紧邻标签）。
- 标签样式对齐发布记录：`text-sm text-fg-muted self-center whitespace-nowrap`。

## 6. URL / 行为契约

### 6.1 配置审计

| 控件 | Query | 说明 |
|---|---|---|
| 时间（可见标签） | — | 覆盖快捷窗 + 起止 |
| 时间窗口 | `window=24h\|7d\|30d` | 设整点 since；清 until |
| 开始/结束 | `since` / `until` | ISO；自定义时删 window |

默认：无时间参数 → `window=24h` + 整点 `since`（`replace`）。

### 6.2 访问日志

| 控件 | Query / 状态 | 说明 |
|---|---|---|
| 统计窗口（Header） | `range=24h\|7d`（默认 `7d`） | 不变 |
| 时间（可见标签） | — | 筛选栏起止组前 |
| 开始/结束 | 本地 `since`/`until`（datetime-local） | `since` 随 range 重算时取整点 |

## 7. 交叉修订

- **Spec 96 §5.4**：快捷窗口改为「全部 / 近 24 小时 / 近 7 天 / 近 30 天」；补默认与可见「时间」；指向本 Spec。
- **Spec 113**：作为列表历史时间筛选样板；本 Spec 为跨页 parity。
- **Spec 89 / 106**：默认 `7d` 与顶栏统计窗不变；筛选栏补标签与整点。

## 8. 验收标准

1. `/admin/config-audit`：可见「时间」；默认近 24 小时且 since 整点；可选全部时间。
2. `/admin/audit`：筛选栏可见「时间」；切换/默认 since 为整点；顶栏默认仍为 7 天。
3. Vitest + `lint:terminology` 通过。
4. 台账 `UX-ADMIN-CONFIG-AUDIT-009`、`UX-ADMIN-AUDIT-026` → `Fixed`（本轮不做浏览器验证）。

## 9. 测试要求

- `admin-config-audit.test.tsx`：时间标签、默认 24h、整点 since。
- `admin-audit-turns.test.tsx`（或既有 audit 测试）：时间标签；since 整点（可对 `Date.now` 固定时钟）。
