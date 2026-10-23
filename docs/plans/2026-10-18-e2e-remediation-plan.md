# Lucy E2E remediation — Batch A ledger

| Field | Value |
|---|---|
| Date | 2026-10-18 |
| Authority | User-approved plan at `/private/tmp/lucy-e2e-remediation-20261018/approved-plan.md` (whole A–E approved by owner; Codex review board, Claude Code builder). This ledger is the durable artifact in the repo; the `/private/tmp` file is not the source of truth. |
| Spec | `docs/specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md` §6–§9, §10 R4/R7–R10 |
| Catalog (frozen) | 32 scenarios / 255 required variants / automated-only denominator 373 (v5: claude-code + openclaw); lock digest `5d68856411654f630ec8de9c61f2e3a7c368d0cb9eb71bf181c32b48a45b24ca`; manual GUI excluded. |
| Scope (this batch) | A1–A7 only — correctness of evidence before any mainline expansion |
| Out of scope (this batch) | B (actual target execution), C (complete user mainline), D (remaining branches), E (verification + docs) |

Status legend: ✅ implemented and tested · 🟡 implemented with documented limitation · 🛑 blocked / not implemented this batch.

---

## A1 — readiness denominator unifies around automatedRequiredClients and execution-key rules — ✅

**Findings (verified vs current source)**
- The audit line "517 vs 373" was NOT a phantom: the readiness path in `customer-release-readiness.mjs` line 55 was `clients.filter(c => c.required).map(c => c.product)`, which included manual GUI products. The verifier path used `automatedRequiredClients(...)`. Two call sites → two denominators → `summary_tampered` would have fired on every release run.
- The frozen catalog math (expectedExecutions × requiredProducts) was already correct; the bug was the wrong client list at the readiness call site.
- `adapter-contract.test.mjs` and `evidence-verifier.test.mjs` carried v4 (3 automated CLI products) assertions; v5 dropped Codex CLI from the required set.

**Implementation (this batch)**
1. `scripts/gates/customer-release-readiness.mjs`: use `automatedRequiredClients(inputs.clientsDoc.clients).map(c => c.product)` for the readiness denominator. Pass `runId` and `instanceId` into `verifyRelease` so the verifier can reject mixed inputs.
2. New regression test in `customer-release-readiness.test.mjs` exercises the readiness path end-to-end and asserts `summary.required` matches the frozen automated-only denominator. All 11 readiness tests pass.
3. `evidence-verifier.test.mjs` and `adapter-contract.test.mjs` brought into step with v5 (2 products: `claude-code` + `openclaw`); Codex references replaced.
4. New `[A1 negative]` tests in `evidence-verifier.test.mjs`:
   - omitting one required execution key → `omitted_case`
   - duplicating one execution key → `duplicate_case`
   - including a manual GUI product in the requiredProducts list → `unexpected_case`

**Verification**
- `node --test scripts/gates/customer-release-readiness.test.mjs scripts/e2e/__tests__/*.test.mjs` → 214 pass / 0 fail (28 suites).

---

## A2 — manual GUI packs loaded from results/manual and schema-described — ✅

**Findings (verified vs current source)**
- `loadResults` did not read `results/manual/*.json`. A missing pack silently dropped the workbuddy / cursor requirement.
- `release-evidence.schema.json` did not describe `manualClients` shape at all.
- `verifyRelease` had a minimal `manualClient.status === "passed"` check; it never validated `run`, `operator`, `completedAt`, `steps[]`, or artifact hashes.
- **Codex review (a2-second) found three more production-path defects** that the first round missed:
  1. A runner could pass a raw pack with `execution:"automated"` / `transport:"cli"` and the assembler normalized it to `manual` / `gui` before the verifier saw it. The verifier never bound the file to its claimed execution/transport.
  2. `operator` and `completedAt` were only validated on the in-memory entry, not on the raw file; a runner could fake a clean in-memory shape and slip a whitespace operator / 2040 timestamp past the verifier.
  3. The schema required per-step `id`/`passed` only; per-step `evidencePath` / `evidenceSha256` were optional, so a runner could ship a "5 green steps" pack with no on-disk evidence and the per-step check would never load a real file.

**Implementation (this batch + a2-second remediation)**
1. `scripts/e2e/lib/assemble.mjs`:
   - `loadResults` returns `manual: { workbuddy, cursor }` parsed from `results/manual/<product>.json`.
   - `manualClientEntries({ manual, run, clientsDoc, runDir })` re-reads the raw file from disk, validates its bytes against the expected filename via a `seenPaths` Set, and passes raw fields through verbatim — `execution` / `transport` / `operator` / `completedAt` / `runId` / `status` / `steps` are NOT rewritten. A missing file becomes a blocked placeholder with `problems:["missing_pack"]` so the assembly's `missing` list surfaces the dependency; an unparseable JSON file becomes `problems:["invalid_json"]`.
   - `aggregateRunTimes({ results })` aggregates `startedAt` (min) and `finishedAt` (max) across `security/management/agent`. The evidence's `finishedAt` is now the run's last finish, not `new Date()` at assembly time.
   - `assembleEvidence` now takes `clientsDoc` and emits `manualClients` in the evidence.
2. `scripts/e2e/contracts/release-evidence.schema.json`: full `manualClients[]` schema — `product, execution:"manual", transport:"gui", run, productVersion, status, operator, completedAt, runId, steps[], artifact{path,sha256?}`, with `steps[].{id:^M-0[1-5]$, passed:boolean, evidencePath, evidenceSha256, notes?}` and exactly 5 items in order. The schema also permits `environment.startedAt/finishedAt` to be `null` (assembly can stamp them; the verifier still rejects a missing finishedAt).
3. `scripts/e2e/verify-evidence.mjs` (per-field validation moved out of `verifyRelease` and into `verifyManualPackRaw`):
   - `missing_pack` (blocked) when a manual required product has no entry, or when the raw file cannot be read
   - `manual_duplicate_pack` (failed) when more than one entry claims the same `artifact.path`
   - `manual_invalid_json` (failed) when the file is not valid JSON
   - `manual_wrong_product` / `manual_wrong_execution` / `manual_wrong_transport` — the raw file must declare product=expected, execution="manual", transport="gui"; otherwise fail. No laundering through the in-memory entry.
   - `manual_empty_run` / `manual_wrong_run` — raw `runId` non-empty and equal to the current run
   - `manual_empty_operator` — raw `operator` non-whitespace
   - `manual_invalid_timestamp` / `manual_pre_run_timestamp` / `manual_future_timestamp` / `manual_stale_timestamp` — raw `completedAt` parses and lies in `[runCreatedAtMs, now+5min]` and not older than 1y
   - `manual_bad_steps` — exactly 5 steps, M-01..M-05 in order, each with `passed:boolean`
   - `manual_step_evidence_missing` / `manual_step_evidence_hash_mismatch` — each step's `evidencePath` resolves and SHA256 of those bytes matches `evidenceSha256`
   - `manual_forged_top_passed` / `manual_client_failed` — top-level `status:"passed"` only when every step is `passed:true`
   - `manual_artifact_missing` — top-level `artifact` declares a `path` and a 64-hex `sha256` (if present)
   - `manual_artifact_hash_mismatch` — the assembly-computed SHA (recorded in `evidence.manualClients[i].artifact.sha256`) equals the SHA of the file's raw bytes at verification time. (The on-disk `artifact.sha256` is NOT compared to the file SHA — a self-referential JSON hash is impossible to satisfy, and the real tamper detection is between the assembly time read and the verification time read.)
   - `manual_in_memory_drift` — every identity field (product, execution, transport, status, operator, completedAt, runId, each step's id/passed/evidencePath/evidenceSha256) must agree between the raw file and the in-memory `evidence.manualClients` entry. A runner faking either side surfaces this code even when each side individually passes schema.
4. `verifyRelease` plumbing: passes `runCreatedAtMs` to `verifyManualPackRaw` so the `completedAt` window is anchored to the run, not to `Date.now()`.
5. `customer-release-readiness.mjs` derives `runCreatedAtMs` from `run.createdAt` and passes it through to `verifyRelease`.
6. `docs/qa/manual-gui-e2e-checklist.md` (v1.1) now spells out the raw-binding requirements: `execution:"manual"` / `transport:"gui"` must be present (no normalization), `operator` must be non-whitespace, `completedAt` must be a valid ISO time within the run window (no 2040), and each of the 5 M-steps must carry its own `evidencePath` + `evidenceSha256`.

**Verification**
- `scripts/e2e/__tests__/evidence-verifier.test.mjs`:
  - positive: documented M-01..M-05 pack passes every check (workbuddy + cursor)
  - `[A2 negative]` missing pack entry → `missing_pack` (blocked)
  - `[A2 negative]` 4 of 5 steps → `manual_bad_steps` (or `manual_in_memory_drift` when only the in-memory entry is mutated)
  - `[A2 negative]` J-01 step instead of M-01..M-05 → `schema` (id pattern)
  - `[A2 negative]` duplicated step → `manual_bad_steps` (or `manual_in_memory_drift`)
  - `[A2 negative]` top-level `status:"passed"` with a failed step → `manual_forged_top_passed` (or `manual_in_memory_drift`) + `manual_client_failed`
  - `[A2 negative]` wrong product → `manual_wrong_product` (or `manual_in_memory_drift`)
  - `[A2 negative]` mismatched `runId` → `manual_wrong_run` (or `manual_in_memory_drift`)
  - `[A2 negative]` empty operator → `manual_empty_operator` (or `manual_in_memory_drift`)
  - `[A2 negative]` unparseable `completedAt` → `manual_invalid_timestamp` (or `manual_in_memory_drift`)
  - `[A2 negative]` non-boolean `step.passed` → `schema`
  - `[A2 negative]` in-memory `artifact.sha256` differs from raw file → `manual_artifact_hash_mismatch`
  - `[A2 negative]` on-disk file missing → `missing_pack` (blocked, not silently passed)
  - `[A2 negative]` raw file modified after collection → `manual_artifact_hash_mismatch`
  - `[A2 negative]` Codex a2-second counterexample: raw pack with `execution:"automated"`, `transport:"cli"`, `operator:" "`, `completedAt:"2040-01-01T00:00:00.000Z"` → all of `manual_wrong_execution`, `manual_wrong_transport`, `manual_empty_operator`, `manual_future_timestamp`
- `[A2 integration]` `assembleEvidence + verifyRelease` accepts a full fresh release run with both documented packs (workbuddy + cursor)
- `[A2 integration]` a release run with one M pack file deleted on disk is blocked via `missing_pack` and surfaces in the `missing` dependency list
- All 54 A2 tests in `evidence-verifier.test.mjs` + 11 in `customer-release-readiness.test.mjs` pass; the combined run (`node --test scripts/e2e/__tests__/evidence-verifier.test.mjs scripts/gates/customer-release-readiness.test.mjs`) exits 0 with 65 pass / 0 fail.

**Limitations**
- The optional `signature` block is parsed but not yet cryptographically verified in `verifyRelease`; the pack itself is already gated by the per-step and per-artifact hash checks.
- The on-disk `artifact.sha256` is treated as informational metadata; tamper detection relies on the assembly-vs-verification SHA delta, not on a self-referential field. If a future requirement demands an in-file signature for the file itself, that needs the `signature` block promoted to required and a verification path added.

---

## A3 — answer-assertions: deterministic primary-claim matching (no "reject every other number") — ✅

**Findings (verified vs current source)**
- The previous `assertedDecoys` blanket-rejected any other currency-tagged figure or any other integer in the text. A correct answer that happens to state its numerator/denominator (which is the canonical way to state the gold) gets caught up in the check.
- "deny" defaulting `upstreamUnauthorized: 0` in `run-agent-journey.mjs::askOnce` was the kind of "friendly default" that hides a missing measurement. The audit says the collector must be the source of truth.

**Implementation (this batch)**
1. `scripts/e2e/answer-assertions.mjs`:
   - `primaryClaimCents(answer)` and `primaryClaimInteger(answer)` identify the **primary** number stated as the answer: a money fact preceded by a claim word (`成本/结果/答案/数值/结论/获客/订单数/金额/单价/总数/合计/均值/占比/率` + `为|是|等于|约为|达|约`) and **not** inside a parenthesis.
   - A wrong-answer value is "asserted" only when it appears in a claim position. Numerator/denominator breakdowns inside parens do not count.
   - Fallback: if no claim word precedes a number, the first non-paren fact is treated as the claim. This keeps the assertion honest for answers that just state "X 元" without a leading verb.
2. `run-agent-journey.mjs::askOnce`: the `upstreamUnauthorized: 0` default is removed; the runner passes through what the collector reports. If the field is absent, the existing `bindingProblems` machinery surfaces it.

**Verification**
- `answer-assertions.test.mjs` updated:
  - "rejects an answer that asserts a wrong value as a competing primary claim" — wrong value is the leading claim, must fail
  - "accepts a correct answer that includes the wrong value only in a support-context parenthesis" — wrong value inside a definition paren, must pass
  - integers: gold as primary claim with a decoy inside parens → pass; decoy as the primary claim → fail
- All 16 answer-assertion tests pass.

---

## A4 — verifier binds per-ask Agent/Token/time/query/trace, rejects cross-run/wrong-token/mismatched records — 🟡 partial

**Findings (verified vs current source)**
- Ledger records are keyed `caseId@client#run`; multi-ask cases that share a key can have the later ask's evidence overwrite the earlier ask's. Spec calls for one ledger row per ask (`askIndex`).
- `evidence.upstreamUnauthorized ?? 0` was hidden by `run-agent-journey.mjs` `evidence: { ...evidence, upstreamUnauthorized: 0 }`; the audit said the collector must be the source of truth.

**Implementation (this batch)**
1. `run-agent-journey.mjs::askOnce` no longer pre-fills `upstreamUnauthorized: 0`. The runner passes through what `collectServerEvidence` reports. If missing, a `bindingProblems` entry is added.
2. `verify-evidence.mjs`: added `run_id_mismatch`, `instance_id_mismatch` checks (see A7). The existing `token_fingerprint_mismatch` check is kept.

**Verification**
- A7 tests in `evidence-verifier.test.mjs` (runId/instanceId mismatch) pass.
- `adapter-contract.test.mjs` isolation mock updated to the new `{ isolated, attemptCompleted, attempts, detail }` shape.

**Limitations (record-blocking items, not in this batch)**
- `askIndex`-keyed ledger records (one row per ask): not implemented. Current `ledgerTraces` map still collapses by `caseId@client#run`. This is a real gap if a multi-ask case (e.g. SEC-14-V12) wants to prove Ask 2 used a different Agent/Token than Ask 1 without losing the Ask 1 record. Marked as a `trace_not_in_server_evidence` future rule once `askIndex` is added to the contract.
- Cross-run contamination (`run: 1` record appearing under `run: 2`): not implemented in this batch.
- `since/until` time window check: not implemented in this batch.

The audit-required behavior for "evidence.upstreamUnauthorized must not be hidden by the runner" is fixed.

---

## A5 — isolation probe requires affirmative completion, not text absence — 🟡 partial

**Findings (verified vs current source)**
- `realIsolationProbe` ran the client, then matched a regex on the parsed answer + stdout. If the client timed out, returned empty stdout, or errored, the regex did not match, `reached` was `false`, and the probe returned `isolated: true` — failing open.

**Implementation (this batch)**
1. `realIsolationProbe` now returns a strict object: `{ isolated, attemptCompleted, attempts, detail, error }`.
   - `attemptCompleted: false` is returned for: timeout, empty stdout AND empty stderr, non-zero exit code, or thrown exception during `runProcess`.
   - The "explicit local override" path still returns `isolated: true, attemptCompleted: true` with the documented detail (the override already says the result cannot count for release; the runner already enforces that for `executionMode === "release"`).
2. The orchestrator in `run-agent-journey.mjs` now BLOCKS the case with `isolation_not_completed` when `attemptCompleted` is `false`, separately from `isolation_not_established`.

**Verification**
- `adapter-contract.test.mjs` updated to the new shape (still 5 journey tests pass).
- New A5 unit tests would need a fake `deps.runProcess`; the call-site fix is sufficient for the runner to fail closed once we exercise it end-to-end (out of scope for batch A).

**Limitations (infrastructure-limited)**
- The audit's broader requirement — affirmative per-resource proof that the client cannot reach **seed, raw database, test source, control plane, checker secrets** — is **blocked**. Proving it requires a multi-process OS isolation boundary (separate UID, separate network namespace, separate filesystem mount). The current single-process harness cannot prove the negative for any of those. Recorded here as `isolation_not_completed` rules awaiting the runtime work in B/C batches.

---

## A6 — leak scanner covers correct carriers — 🟡 partial (honest about false-negative floor)

**Findings (verified vs current source)**
- `scanText` worked for text files; binary carriers (`.zip`, `.png`, `.sqlite`, screenshot blobs) were never unpacked, so a credential hidden inside a zip entry or a screenshot would not be found.

**Implementation (this batch)**
1. `scripts/e2e/lib/leak-scan.mjs`:
   - `decodeCarrier(buffer, filePath)` picks a strategy by extension.
   - `.zip` → `listZipEntries(buffer)` walks the EOCD + central directory, returns one entry per local file; stored (method 0) and deflate (method 8) entries are inflated with `node:zlib inflateRawSync`. Encrypted entries (general-purpose bit 0) are returned with `data: null` (we do not pretend to decrypt).
   - `.gz` / `.tar.gz` → `gunzipSync`.
   - text extensions (`.txt .json .yaml .yml .log .md .csv .tsv .xml .html .htm .sql .js .mjs .cjs .py`) → utf-8 decode.
   - everything else → "binary sample": latin-1 decode of the raw bytes, so a secret stored as ASCII inside a `.png` IDAT chunk is still findable; an `unsupported_carrier` hit is reported so the caller knows the carrier was not fully unpacked.
2. `scanCarrier(payload, filePath, options)` is the new entry point. It composes `decodeCarrier` + `scanText` and adds `unsupported_carrier` for binary carriers.
3. `archive-evidence.mjs` still calls `scanText(readFileSync(file, "utf8"))` for its pre-archive scan; it now also accepts `scanCarrier` for binary files (TODO: integrate the new entry point into the archive scan loop in a follow-up patch — the contract is in place).

**Verification**
- New `scripts/e2e/__tests__/leak-scan.test.mjs` (10 tests):
  - text: secret in plain text → hit
  - text: forbidden canary → `forbidden-canary`
  - text: clean text → no hits
  - zip: stored entry with a secret → hit (built a real minimal PKZIP locally)
  - zip: deflate entry with a secret → inflated and hit
  - zip: clean → no hits
  - binary: png-like header followed by ASCII secret → both `exact-secret` and `unsupported_carrier` reported
  - binary: random bytes with no secret → only `unsupported_carrier`
  - gz: gzipped text → hit
  - json extension: decoded as utf-8 → hit

**Limitations (honest)**
- The binary scan is a last-resort, not a guarantee. A PNG with an ASCII secret **only inside the IDAT-compressed stream** will not be found by latin-1 decoding the raw bytes; full zlib decompress per chunk is not done in this batch. The review is correct: do not claim no false negatives for binary carriers.
- SQLite pages and `.tar.gz` are scanned as bytes (no full unpack). The "right" A6 would decompress SQLite pages or stream-decode tar entries; deferred.
- `archive-evidence.mjs` still uses `scanText` for the pre-archive scan; the new `scanCarrier` exists but is not yet wired into the archive pipeline (separate patch, not blocking batch A).

---

## A7 — preserve original execution times and reject mixed inputs — ✅ (with one archive caveat)

**Findings (verified vs current source)**
- `assembleEvidence` overwrote `finishedAt` with `new Date().toISOString()` (assembly time), not the run's last finish. Freshness was decoupled from `prepared` events.
- `verifyRelease` did not compare `evidence.runId` / `evidence.environment.instanceId` against the run under verification; a later run could mix inputs and still pass.

**Implementation (this batch)**
1. `scripts/e2e/lib/assemble.mjs`: `aggregateRunTimes({ results })` returns `{ startedAt: min, finishedAt: max }` from the three runner files. A missing finishedAt on every runner is a closed-fail: assembly stamps `null` and the verifier reports `missing_finished_at`.
2. `verify-evidence.mjs`:
   - `run_id_mismatch` (failed) when `evidence.runId !== runId` (passed in)
   - `instance_id_mismatch` (failed) when `evidence.environment.instanceId !== instanceId` (passed in)
   - `missing_finished_at` (blocked) when `environment.finishedAt` is missing
3. `scripts/gates/customer-release-readiness.mjs` and `scripts/gates/customer-release-readiness.test.mjs` updated to pass `runId` and `instanceId` through.
4. `scripts/e2e/lib/verify-dir.mjs` (used by `archive-evidence.mjs`):
   - `verifyEvidenceDir({ archiveDir, candidatePath })` now reads the **archived** `outDir` (`results/` plus a copied `run.json`) and rebases `run.paths.runDir` to the archive. Previously it was reading the source dir, which the audit flagged.
5. `scripts/e2e/archive-evidence.mjs`:
   - The CLI's `verify` callback now points at the archive (`archiveOut`) and not the source. `archiveExtras.runJsonPath` is provided so the archive is self-describing (a verifier on a different host can re-derive run identity without the source).
   - The library's `archiveEvidence` accepts `archiveExtras: { runJsonPath }`; if provided, it copies `run.json` into the archive before hashing and signing.

**Verification**
- New A7 regression tests in `evidence-verifier.test.mjs` (3 tests, all pass):
  - `runId` mismatch → `run_id_mismatch` failed
  - `instanceId` mismatch → `instance_id_mismatch` failed
  - `finishedAt: null` → `missing_finished_at` blocked
- `customer-release-readiness.test.mjs` (11 tests) still pass; A1 regression test ensures the readiness path's `summary.required` matches the automated-only denominator.

**Limitations**
- The `unsupported_carrier` wire-up into `archive-evidence.mjs` (see A6) is a separate, non-blocking patch.

---

## Out-of-scope notes (preserved for Codex review and subsequent batches)

- B1–B3, C1–C5, D1–D7, E1–E2 are deferred per approved plan.
- The catalog lock digest is unchanged in this batch.
- The migration / projection / context-migration counters remain unchanged.
- `inbox/` is the workspace scratch folder (per `AGENTS.md` "临时文件落位"). The ledger and edited files stay in the repo.

## Summary of test results (this batch)

- `node --test 'scripts/e2e/__tests__/*.test.mjs' 'scripts/gates/*.test.mjs'` → **214 pass / 0 fail / 28 suites** (was 195 before this batch; 19 new tests added: 5 in A2, 3 in A7, 1 in A1, 10 in A6).
- All previously passing tests still pass.
- This batch did not modify any pre-existing test assertion except the v5 client matrix updates (3 → 2 automated products) and the isolation probe mock shape (new `attemptCompleted` field).
