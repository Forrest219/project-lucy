# WebUI Semantic Layer Maintenance UX Refresh Design

| Metadata | Value |
|---|---|
| Document | WebUI Semantic Layer Maintenance UX Refresh Design |
| Type | Incremental Design |
| Version | v0.1 |
| Date | 2026-07-27 |
| Author | Codex |
| Request | UX refresh for semantic-layer maintenance split across catalog, source editor, and joins |
| Primary builder | Minimax |
| Status | Ready for Minimax implementation |
| Output | `webui/docs/12-semantic-layer-maintenance-ux-refresh.md` |

---

## 1. Decision Summary

This refresh upgrades the already implemented semantic-layer maintenance module. It should keep the current three-submodule IA:

1. Table catalog: `/`
2. Single table editor: `/sources/:conn/:schema/:table`
3. Relationship editor: `/joins/:conn/:schema/:table`

The first pass should be frontend-first. Reuse the existing contracts:

| Need | Existing source |
|---|---|
| table catalog and summary counts | `GET /api/sources` |
| table detail, columns, grain, measures, segments, formal joins | `GET /api/sources/:conn/:schema/:table` |
| dry-run diff and proposed YAML | `PUT /api/sources/:conn/:schema/:table` with `dryRun: true` |
| save table patch and validate | `PUT /api/sources/:conn/:schema/:table` with `dryRun: false` |
| candidate and rejected joins | `GET/PUT /api/joins/candidates` |
| review changed files | `GET /api/diff` |

Do not introduce new backend contracts for M9 unless implementation proves the existing `TableModel` cannot expose DB/AI/Human descriptions separately. Current `AuthoredText` already has `ai` and `human`; field-level DB physical comments are not a separate API field today, so the UI should label available manifest-provided text conservatively instead of inventing unavailable comments.

## 2. Spec Impact Assessment

| Spec | Assessment | Required update |
|---|---|---|
| `webui/docs/04-data-model.md` | Still valid. `descriptions.human` remains the only write target for manual copy; `descriptions.ai` must be preserved. | No change required for M9. Add fields only if DB comments become a real separate model later. |
| `webui/docs/03-api-spec.md` | Existing source and join candidate APIs cover the refresh. | No change unless a later backend pass adds structured physical comments or candidate source metadata. |
| `webui/docs/06-navigation-ia.md` | Still valid for the three semantic-layer routes. | No change required. |
| `webui/docs/10-deployment-connection-ux-refresh.md` and `11-connection-whitelist-test-ux-refresh.md` | Database access pages are now SaaS-grade enough; this spec completes the semantic maintenance workbench. | No rewrite. Treat M9 as the next UX closure. |
| `webui/docs/codex/wo-M4-measures-segments-joins.md` | Candidate joins and overlay rules remain the source constraints. | M9 should reuse those rules and improve the surface. |

## 3. UX Principles

1. The editor must expose where each write lands before the user saves.
2. Human and AI descriptions should collaborate without hiding authorship.
3. Metadata cards must not resize or overlap when table names are long.
4. Candidate joins should be actionable in the table-editing flow, not hidden on a separate page.
5. The right inspector should answer "what changed and is it valid" without repeated status panels.

## 4. Module IA

| Route | Submodule | Primary job |
|---|---|---|
| `/` | 表目录 | Search and open tables that need semantic maintenance. Keep this page stable in M9 except for any route labels needed by tests. |
| `/sources/:conn/:schema/:table` | 单表编辑器 | Edit table description, grain, fields, measures, segments, and review candidate joins in context. This is the main M9 surface. |
| `/joins/:conn/:schema/:table` | 关联关系 | Full relationship management for confirmed/candidate/rejected joins. M9 should keep it as the detailed editor, while surfacing its highest-value candidate actions inside the table editor. |

## 5. Single Table Editor Refresh

### 5.1 Problems To Fix

Current `TableEditor.tsx` is functionally complete but has four UX issues:

- The top metadata grid can visually collide when `qualifiedName` is long.
- Field editing collapses author context into one textarea, so users cannot compare AI suggestions with existing manual text.
- Overlay writes for grain/measures/segments are implicit; engineers have to know ADR-10 to understand where changes land.
- Joins are separated from the table-editing path, so users must switch pages to accept or reject obvious candidates.

### 5.2 Header And Metadata Grid

Keep the page header actions, but replace the current metadata grid with a fixed, stable grid.

Required metadata cells:

| Cell | Value | Behavior |
|---|---|---|
| 完整表名 | `source.model.qualifiedName` or `${schema}.${table}` | Single-line truncate with `title` tooltip and copy button beside it. |
| 字段数 | `source.model.columns.length` | Fixed cell. |
| 关联数 | `source.model.joins?.length ?? 0` | Fixed cell. |
| 行粒度 | `source.model.grain?.join(", ") || "无"` | Single-line truncate with overlay badge. |

Implementation rules:

- Use CSS grid tracks similar to `grid-template-columns: minmax(0, 2fr) repeat(3, minmax(96px, 1fr))`.
- The full table name cell must have `min-width: 0`; its value must use truncation.
- Put the copy button next to the truncated value. It copies the full qualified name and shows a toast.
- Do not render the long value as a flex item without `min-width: 0`; that is the overlap bug.

### 5.3 Field Card Upgrade

Replace the bare field textarea list with per-field cards.

Each field card should render:

| Element | Source | Notes |
|---|---|---|
| Field name | `column.name` | Primary text. |
| Metadata badges | `column.pk`, `column.type`, `column.nullable` | Show `[PK]`, `[string]`, `[time]`, `[Not Null]`, `[nullable]` as applicable. |
| DB physical comment | Existing available physical/manual source if present | M9 must not invent a DB comment. If no separate field exists, show `暂无物理注释` or omit this row. |
| AI suggested description | `column.descriptions.ai` | Read-only, truncated to 2-3 lines with full text available through `title` or expanded body. |
| Human description | `column.descriptions.human` in editable textarea | Empty when human is absent. Do not prefill from AI during initial render. |
| Adopt AI button | `column.descriptions.ai` | Enabled when AI exists. Primary behavior is to copy AI text into the Human textarea for that column. |

Important distinction:

- Display fallback can still prefer human over AI in summaries.
- Editing must keep `human` and `ai` separate. `formFromSource` should initialize column human text from `column.descriptions.human ?? ""`, not from `authoredText(column.descriptions)`.
- `patchFromForm` should keep sending only `{ name, description }`; server write rules already map that to `descriptions.human`.

Button behavior:

| State | Label | Enabled |
|---|---|---|
| Human empty and AI present | `采纳 AI 描述` | yes |
| Human non-empty and AI present | `覆盖为 AI 描述` or secondary `采纳 AI 描述` | yes, but should require an intentional click only; no confirmation modal needed. |
| No AI | `无 AI 建议` | disabled or hidden |

Search should match field name, type, AI description, and Human description.

### 5.4 Overlay Badges For Grain, Measures, Segments

Add an `Overlay` badge beside the headings for:

- 行粒度 / Grain
- Measures / 指标
- Segments / 分群

Tooltip copy:

```text
修改将写入独立 overlay 文件：semantic-layer/<conn>/<table>.yaml
```

For `mysql-aliyun / dataforai / superstore_orders`, the tooltip should resolve to:

```text
semantic-layer/mysql-aliyun/superstore_orders.yaml
```

Rules:

- Overlay badges are informational; they do not change save behavior.
- Do not put `Overlay` beside field descriptions or formal joins unless the backend write path actually uses overlay for that specific edit.
- Table-level row grain cell in the metadata grid may also show the badge because grain is overlay-backed.

### 5.5 Candidate Joins Banner In Table Editor

Add a candidate joins banner near the top of the table editor, above the active section content. It can also appear inside the Joins section, but it must be visible without requiring navigation to `/joins`.

Candidate source:

- Read persisted sidecar candidates from `GET /api/joins/candidates`.
- Reuse or extract the current `JoinEditor.tsx` `suggestedJoins(source)` logic so the table editor and join editor do not drift.
- Exclude candidates already confirmed in `source.model.joins`.
- Exclude rejected sidecar candidates from the prominent "found N" count, but allow a compact rejected state if useful.

Banner content:

```text
发现 N 个智能推断的候选关联关系
rows (superstore_orders.row_id = rows.row_id) [多对一]
推断依据: 字段名匹配
[确认写入语义层] [保留为候选] [标记不采用]
```

Actions:

| Action | API behavior | Result |
|---|---|---|
| 确认写入语义层 | `PUT /api/sources/:conn/:schema/:table` with `dryRun:false`, patching `joins` with `source:"formal"` | Invalidate source and candidates, toast success, send user to `/review` or keep in editor if the implementation can refresh validation inline. |
| 保留为候选 | `PUT /api/joins/candidates` with `confidence:"candidate"` | Sidecar updated, toast success, banner remains as candidate. |
| 标记不采用 | `PUT /api/joins/candidates` with `confidence:"rejected"` | Sidecar updated, item leaves prominent banner. |

M9 should prefer staying on `/sources/...` after candidate or rejected actions. For confirmed writes, following the existing `JoinEditor` behavior and navigating to `/review` is acceptable.

### 5.6 Right Inspector Refresh

The right inspector should keep the three tabs:

- Diff
- YAML
- Validate

Optimize status placement:

- Move status badges into the tab header row or immediately below it.
- Use badges for `completion`, `dry-run files`, and `unknown YAML keys`.
- Remove the repeated "保存与校验" card body as the primary status surface.
- The Validate tab should focus on validation output and save consequences, not duplicate general state.

Status examples:

| Badge | Source |
|---|---|
| `partial` / `done` / `validation_failed` | `source.completion` |
| `Dry-run 1` | `preview?.files.length ?? 0` |
| `Unknown 0` | `source.model.unknownKeys?.length ?? 0` |
| `Preview error` | `previewError` |
| `Save error` | `saveError` |

### 5.7 Save Shortcut

Support `Cmd+S` on macOS and `Ctrl+S` on Windows/Linux while focus is inside the table editor surface.

Behavior:

1. Prevent browser save.
2. Run the same dry-run preview used by the debounce path.
3. Switch the right inspector to `Diff`.
4. Show a toast such as `已更新 Dry-run 预览`.

Do not persist on shortcut in M9. The requested shortcut is for DryRun and inspector refresh, not save-to-disk.

Implementation note:

- Extract `runPreview(patch)` from the debounced effect so the shortcut and debounce share the same logic.
- Register the key handler on the editor root or form. Avoid a global listener unless cleanup is explicit.

## 6. Relationship Editor Refresh

M9 does not need to replace `JoinEditor.tsx`. It should keep the detailed page and make these small alignment updates if touched:

- Extract `RELATIONSHIP_LABELS` and `suggestedJoins` into a shared module such as `webui/src/pages/semantic/join-utils.ts`.
- Keep candidate/rejected writes in `.ktx-ui/join-candidates.json`; do not write candidate/rejected joins into semantic-layer YAML.
- Keep confirmed joins as `source:"formal"` before writing table patch.
- If the table editor gains the embedded banner, the Joins section in `TableEditor` should link to the full editor for advanced cleanup.

## 7. Visual Requirements

Use existing app primitives and CSS conventions:

- Reuse `pl-panel`, `pl-section-heading`, `pl-status-badge`, `pl-btn`, `pl-input`, `pl-textarea`, `pl-inspector`.
- Add small, specific classes for field cards and overlay badges instead of broad redesign.
- Cards should keep `rounded-md` or smaller radius, matching the rest of WebUI.
- Avoid nested panels inside field cards. Field cards can be bordered rows/cards because they are repeated items.
- Make all fixed-format cells stable with `min-width: 0`, truncation, and predictable grid tracks.

## 8. Acceptance Criteria

- Long table names do not overlap metadata cards at desktop or narrow viewport widths.
- Full table name can be copied, and the visible value truncates cleanly.
- Field cards show type/PK/nullability badges.
- Field editing initializes Human text only from `descriptions.human`; AI suggestion remains separately visible.
- `采纳 AI 描述` copies AI into the Human textarea and dry-run patch writes `descriptions.human`.
- Grain, Measures, and Segments headings expose `Overlay` badge with resolved overlay path tooltip.
- Candidate joins are visible and actionable inside `/sources/:conn/:schema/:table`.
- Rejected candidates leave the prominent recommendation banner and persist in sidecar.
- Right inspector status is consolidated into badges instead of a redundant save/validate card.
- `Cmd+S` / `Ctrl+S` runs dry-run and updates the Diff tab without saving to disk.
- Existing `npm test` remains green, with new tests covering field adoption, overlay badges, candidate banner actions, and save shortcut.

## 9. Non-Goals

- Do not redesign the whole app shell.
- Do not add a new backend endpoint unless absolutely necessary.
- Do not change semantic-layer write rules.
- Do not write candidate or rejected joins into formal YAML.
- Do not add role/visibility write support for existing physical columns.
- Do not modify `semantic-layer/*.yaml` as part of this UX refresh.
