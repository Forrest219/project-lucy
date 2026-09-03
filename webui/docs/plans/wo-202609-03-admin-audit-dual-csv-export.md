# Admin Audit Dual CSV Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give `/admin/audit` two explicit CSV exports: question-level「导出问询记录」and call-level「导出调用流水」, with matching Help guidance.

**Architecture:** Keep the existing call export endpoint `/api/admin/audit/export` stable. Extract the turn-list assembly into a shared server helper and add `/api/admin/audit/turns/export` so list and export share the same filters and enrichment. Update the Audit page header to expose both export granularities while preserving the audit evidence pack action.

**Tech Stack:** Fastify, better-sqlite3, React, React Router, TanStack Query, Vitest, Testing Library.

---

### Task 1: Document the Contract

**Files:**
- Create: `webui/docs/140-admin-audit-dual-csv-export-spec.md`
- Create: `webui/docs/plans/wo-202609-03-admin-audit-dual-csv-export.md`
- Modify: `webui/docs/README.md`
- Modify: `webui/docs/00-product-terminology-standard.md`

**Step 1: Add the spec**

Write the dual-export spec with goals, non-goals, terminology compliance, core pseudocode, API contract, UI/Help behavior, acceptance criteria, and no-Docker/no-browser verification scope.

**Step 2: Add the implementation plan**

Save this plan under `webui/docs/plans/`.

**Step 3: Register docs**

Add Spec 140 to `webui/docs/README.md`. Add `Turn Inquiry CSV Export` to the terminology standard under §4.7.

**Step 4: Verify docs are discoverable**

Run:

```bash
rg -n "140-admin-audit-dual-csv-export|导出问询记录|Turn Inquiry CSV Export" webui/docs docs/SYSTEM_HANDBOOK.md
```

Expected: spec, plan, README, and terminology hits.

### Task 2: Add Server Export Support

**Files:**
- Modify: `webui/server/admin/audit.ts`
- Test: `webui/server/__tests__/admin-audit.test.ts`

**Step 1: Write the failing API test**

Add a test that creates one reported turn with a linked `lucy_query` row whose values include formula-like text, then calls:

```bash
GET /api/admin/audit/turns/export?user=turn-export-user&source=reported&bom=1
```

Expected:

- Status 200.
- `Content-Type` is CSV.
- `Content-Disposition` filename matches `audit-turns-YYYYMMDD.csv`.
- CSV starts with BOM.
- Header contains `问询 ID,来源,Agent`.
- Body contains `用户原始问询`, linked tool/table metrics, and formula-escaped question text.
- Body does not include unrelated users.

**Step 2: Extract shared turn query helper**

Move the body of `GET /api/admin/audit/turns` into a helper that accepts `TurnFilterQuery` plus `{ limit?: number; offset?: number; paginate: boolean }`. Return entries, total, source summary, and reference latency.

**Step 3: Add CSV renderer**

Implement `renderTurnCsv(entries: TurnEntry[])`, reusing `csvCell` for all text-like fields. Use Chinese headers from Spec 140 §6.2.

**Step 4: Add endpoint**

Add:

```text
GET /api/admin/audit/turns/export
```

It should use the shared helper with `paginate: false`, return UTF-8 CSV, honor `bom=1|true`, and set `Cache-Control: private, no-store`.

**Step 5: Run server test**

Run:

```bash
cd webui && npm test -- admin-audit.test.ts
```

Expected: PASS.

### Task 3: Update Audit Page UI

**Files:**
- Modify: `webui/src/pages/admin/Audit.tsx`
- Test: `webui/src/__tests__/admin-audit-turns.test.tsx`
- Test: `webui/src/__tests__/audit.test.tsx`

**Step 1: Write/update tests**

Update header parity tests:

- On `view=turns`, the primary export link text is `导出问询记录`, `data-testid="audit-export-primary"`, and href starts with `/api/admin/audit/turns/export`.
- On `view=calls`, the primary export link text is `导出调用流水`, `data-testid="audit-export-primary"`, and href starts with `/api/admin/audit/export`.
- Both tabs render the alternate export link with `data-testid="audit-export-secondary"`.
- Both tabs render the Help link `/help?section=admin-audit-turns-vs-calls`.

**Step 2: Split export URLs**

Build `turnExportUrl` from the turn query filter without pagination. Build `callExportUrl` from the call query filter without pagination. Keep `exportPackUrl` on the call-level audit filter.

**Step 3: Render tab-aware export actions**

Replace the single `audit-export-csv` link with tab-aware primary/secondary links. Preserve `audit-export-csv` as an alias test id only if needed by legacy tests; otherwise update tests to the clearer ids.

**Step 4: Add concise tab guidance**

Add a short explanatory block below the tab segmented control. Keep it concise and avoid in-app instructional clutter:

- Turns: `问询记录按一次用户问询聚合，适合查看整体结果、涉及数据表和慢调用概况。`
- Calls: `调用流水按一次工具调用展开，适合排查权限裁决、生成 SQL、访问上下文和单次耗时。`

**Step 5: Run frontend tests**

Run:

```bash
cd webui && npm test -- admin-audit-turns.test.tsx audit.test.tsx
```

Expected: PASS.

### Task 4: Update Help

**Files:**
- Modify: `docs/SYSTEM_HANDBOOK.md`
- Modify: `webui/server/help.ts`
- Test: `webui/server/__tests__/help.test.ts`
- Test: `webui/src/__tests__/help-center.test.tsx`

**Step 1: Add handbook section**

Under `3.5 访问治理 Admin`, add `#### 问询记录与调用流水怎么选、怎么导出` with the selection/export table and relation statement.

**Step 2: Add stable alias**

Map the heading to `admin-audit-turns-vs-calls` in `SECTION_ALIASES`, and include the heading in the admin governance level-4 allowlist.

**Step 3: Add tests**

Assert the bundled handbook contains the new section, the deep link, and the FAQ/search terms. Assert `parseHelpToc` includes the stable id.

**Step 4: Run Help tests**

Run:

```bash
cd webui && npm test -- help-center.test.tsx
cd webui && npm test -- server/__tests__/help.test.ts
```

Expected: PASS.

### Task 5: Final Verification and Code Review

**Files:**
- All touched files

**Step 1: Terminology lint**

Run:

```bash
cd webui && npm run lint:terminology
```

Expected: PASS.

**Step 2: Build**

Run:

```bash
cd webui && npm run build
```

Expected: PASS.

**Step 3: Review changed diff**

Run:

```bash
git diff -- webui/docs/140-admin-audit-dual-csv-export-spec.md webui/docs/plans/wo-202609-03-admin-audit-dual-csv-export.md webui/docs/README.md webui/docs/00-product-terminology-standard.md webui/server/admin/audit.ts webui/server/__tests__/admin-audit.test.ts webui/src/pages/admin/Audit.tsx webui/src/__tests__/admin-audit-turns.test.tsx webui/src/__tests__/audit.test.tsx docs/SYSTEM_HANDBOOK.md webui/server/help.ts webui/server/__tests__/help.test.ts webui/src/__tests__/help-center.test.tsx
```

Review for:

- No Docker or browser validation added.
- Existing `/api/admin/audit/export` and `/api/admin/audit/export-pack` semantics preserved.
- `Agent`, `SQL`, `CSV`, `Manifest`, path/URL/id DOM snippets are protected where rendered.
- CSV uses formula escaping.
- Help section and page guidance tell the same story.

**Step 4: Report**

Summarize implementation, test results, code review findings, and any residual risks.
