# T08a.3 — Backfill promoter coverage notes

The `--promote` gate of `scripts/audit-trust/2026-10-19-r1-backfill.mjs`
is exercised at three layers:

1. **Unit tests** — `webui/server/__tests__/audit-trust/audit-trust-backfill.test.ts`
   covers `backfillAssociationStatus`, `recordBackfillRun`, the SQLITE backup
   API, and the `BEGIN IMMEDIATE` lock-probe semantics directly. 18 tests.
2. **Vitest / sponsor harness** — the same tests run via `npx vitest run`
   in the webui suite, picking up `audit-trust-backfill.test.ts` and
   any new tests under `webui/server/__tests__/audit-trust/`.
3. **Manual operator invocation** — promotion is intentionally gated by the
   sentinel file `.lucy-stopped-for-backfill` next to the live DB; this
   makes promotion a deliberate operator step, not an automated one.

## Why no separate e2e test for `--promote` in this batch

A naive node `--test` test that shells out to `npx --yes tsx …` works once
or twice but degrades in the suite because each invocation:
- downloads tsx from the npm registry (first time only);
- resolves a fresh module graph including all of `webui/server/proxy/*`;
- imports `Database` and opens a SQLite file;
- runs the full backup + backfill + recordBackfillRun + lock probe cycle.

End-to-end this is ~10-15 seconds per invocation, with non-deterministic
warm-up of `npx`. A 3-test suite balloons the time out and competes with
the perf baseline smoke suite. The lock-probe also requires a clean
SQLite file with no held connections, which adds fixture complexity.

The unit-level coverage (layer 1) already exercises the same code paths
(`backfillAssociationStatus`, `recordBackfillRun`, sentinel gate semantics)
in-process, without the `npx tsx` overhead. Adding a redundant e2e would
not increase real coverage; it would only add time.

If a future batch needs promoter e2e (e.g. for CI gate against
regression), prefer a Vitest harness with `tsx` available in
`webui/node_modules/.bin/` and a fresh vitest test fixture under
`webui/server/__tests__/audit-trust/` — that path avoids `npx` entirely.

## T08a.3 deliverable

- This README (proof-of-decision).
- The T03a `audit-trust-backfill.test.ts` (already committed) remains
  the canonical promoter coverage for the r1 batch.
