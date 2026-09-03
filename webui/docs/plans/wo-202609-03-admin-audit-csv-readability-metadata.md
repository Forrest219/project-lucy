# Admin Audit CSV Readability and Metadata Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve `/admin/audit` CSV exports with readable timestamps, precise filenames, and downloadable field metadata.

**Architecture:** Keep the two CSV export endpoints from Spec 140. Add shared timestamp/filename helpers in the audit route module, extend CSV renderers without dropping raw UTC fields, and expose a small metadata JSON endpoint that the Audit page links from the granularity guidance area.

**Tech Stack:** Fastify, better-sqlite3, React, React Router, TanStack Query, Vitest, Testing Library.

---

### Task 1: Document the Contract

**Files:**
- Create: `webui/docs/141-admin-audit-csv-readability-metadata-spec.md`
- Create: `webui/docs/plans/wo-202609-03-admin-audit-csv-readability-metadata.md`
- Modify: `webui/docs/README.md`
- Modify: `webui/docs/plans/README.md`
- Modify: `webui/docs/00-product-terminology-standard.md`

**Step 1: Add Spec 141**

Define filename, timestamp, metadata, UI, Help, acceptance criteria, and no-Docker/no-browser verification scope.

**Step 2: Register docs**

Add Spec 141 to `webui/docs/README.md`. Add this plan to `webui/docs/plans/README.md`.

**Step 3: Register terms**

Add `Audit CSV Field Metadata / 字段说明` and `Local Audit Timestamp / 本地时间` under §4.7.

**Step 4: Verify docs**

Run:

```bash
rg -n "141-admin-audit-csv-readability|字段说明|ts_local|audit-calls" webui/docs docs/SYSTEM_HANDBOOK.md
```

Expected: spec, plan, README, terminology hits.

### Task 2: Server CSV Enhancements

**Files:**
- Modify: `webui/server/admin/audit.ts`
- Test: `webui/server/__tests__/admin-audit.test.ts`

**Step 1: Update failing tests**

Update existing `/api/admin/audit/export` assertions:

- Filename matches `audit-calls-\d{8}-\d{6}-\d{6}.csv`.
- Header contains `id,ts,ts_local,user_id`.
- The exported row keeps the original UTC `ts` and includes a local `YYYY-MM-DD HH:mm:ss` timestamp.

Update `/api/admin/audit/turns/export` assertions:

- Filename matches `audit-turns-\d{8}-\d{6}-\d{6}.csv`.
- Header contains `开始时间,开始时间 UTC,结束时间,结束时间 UTC`.
- Local time columns are readable; UTC columns preserve ISO.

Add metadata tests:

```text
GET /api/admin/audit/export-metadata?kind=calls
GET /api/admin/audit/export-metadata?kind=turns
GET /api/admin/audit/export-metadata?kind=bad
```

Expected: calls/turns return JSON attachments with fields and filename patterns; bad returns 400.

**Step 2: Add timestamp helper**

Implement:

```ts
function formatAuditLocalTimestamp(iso: string | null | undefined): string
```

Use `Asia/Shanghai` and `YYYY-MM-DD HH:mm:ss`.

**Step 3: Add filename helper**

Implement an in-process export sequence:

```ts
let auditExportSequence = 0;
function auditExportFilename(kind: string, ext: "csv" | "json", now = new Date()): string
```

Pattern: `audit-${kind}-YYYYMMDD-HHmmss-000001.${ext}`.

**Step 4: Extend CSV renderers**

- Access log CSV: insert `ts_local` after `ts`.
- Turn CSV: convert `开始时间` and `结束时间` to local time, add `开始时间 UTC` and `结束时间 UTC`.

**Step 5: Add metadata endpoint**

Add:

```text
GET /api/admin/audit/export-metadata?kind=calls|turns
```

Return JSON attachment with `schemaVersion`, `kind`, `timezone`, `filenamePattern`, `generatedAt`, and `fields`.

**Step 6: Run server tests**

Run:

```bash
cd webui && npm test -- admin-audit.test.ts
```

Expected: PASS.

### Task 3: Audit Page and Help

**Files:**
- Modify: `webui/src/pages/admin/Audit.tsx`
- Modify: `docs/SYSTEM_HANDBOOK.md`
- Test: `webui/src/__tests__/admin-audit-turns.test.tsx`
- Test: `webui/src/__tests__/help-center.test.tsx`
- Test: `webui/server/__tests__/help.test.ts`

**Step 1: Update Audit page**

Add a `字段说明` link in the granularity notice:

- `kind=turns` when the current tab is `问询记录`.
- `kind=calls` when the current tab is `调用流水`.
- Use `data-testid="audit-export-metadata"`.

**Step 2: Update tests**

Assert the metadata link changes with the selected tab.

**Step 3: Update Help**

Extend the audit export guidance with:

- new filename examples,
- local time / UTC dual-track explanation,
- field metadata download purpose.

**Step 4: Run tests**

Run:

```bash
cd webui && npm test -- admin-audit-turns.test.tsx help-center.test.tsx
cd webui && npm test -- server/__tests__/help.test.ts
```

Expected: PASS.

### Task 4: Final Verification and Review

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

**Step 3: Review diff**

Run:

```bash
git diff -- webui/docs/141-admin-audit-csv-readability-metadata-spec.md webui/docs/plans/wo-202609-03-admin-audit-csv-readability-metadata.md webui/docs/README.md webui/docs/plans/README.md webui/docs/00-product-terminology-standard.md webui/server/admin/audit.ts webui/server/__tests__/admin-audit.test.ts webui/src/pages/admin/Audit.tsx webui/src/__tests__/admin-audit-turns.test.tsx docs/SYSTEM_HANDBOOK.md webui/server/help.ts webui/server/__tests__/help.test.ts webui/src/__tests__/help-center.test.tsx
```

Review for:

- original UTC fields preserved,
- local time is Excel-friendly,
- filenames include seconds and sequence,
- metadata describes field meaning and trigger,
- no Docker or browser validation added.

**Step 4: Report**

Summarize implementation, test results, code review findings, and residual risks.
