#!/usr/bin/env node
/**
 * 202608 P1 — Tiered Access Governance Gate self-validation
 * Spec: `webui/docs/64-tiered-publish-gate-spec.md` §10
 *
 * Runs against the compiled gate module via the same Node loader that
 * `webui`'s Vitest suite uses for its in-memory tests. The script
 * intentionally avoids touching `.ktx-ui/audit.sqlite`; all SQLite work
 * uses a temp file (per `lucy-202608-upgrade-execution-control.md` §5.6).
 *
 * Required behaviors verified:
 *   1. Sensitive Role widening  → P0 block
 *   2. Global deny weakening    → P0 block
 *   3. Sensitive prefix weakening → P0 block
 *   4. Raw query path added     → P0 block
 *   5. Stale Token cleanup      → P2 warning
 *   6. Single approver override → fail
 *   7. Valid two-approver override → ok + reviewer_override evidence
 *   8. Frontend-independent decision shape (JSON serializable, no DB handles)
 *   9. Append-only: re-running the gate produces a new trace row, not an overwrite
 *  10. Hot store guard: no plaintext credential leaks into trace / evidence
 */
// Self-validation script for the 202608 P1 Tiered Access Governance Gate.
// Run from `webui/` so that `better-sqlite3` and the TypeScript modules
// resolve correctly:
//
//     cd webui && tsx ../scripts/verify-202608-access-governance-gate.mjs --strict
//
// Or invoke via the npm script wrapper added in `webui/package.json`:
//
//     npm -C webui run verify:gate -- --strict
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const WEBUI_DIR = path.join(REPO_ROOT, "webui");

// `better-sqlite3` is a devDep of `webui/`. When this script is launched
// from the repo root, Node ESM looks up `better-sqlite3` from `scripts/`
// first and fails. Switch into `webui/` so resolution finds the right
// `node_modules` tree.
if (process.cwd() !== WEBUI_DIR) {
  process.chdir(WEBUI_DIR);
}

// Use absolute `file://` URLs so Node ESM resolves the local TypeScript
// source files from the `webui/` tree rather than from `scripts/`, where
// `node_modules` is missing. `better-sqlite3` is a CJS package that we
// resolve to its real entry file via absolute path so Node does not
// attempt bare-specifier resolution from `scripts/`.
const tsxUrl = (relPath) => pathToFileURL(path.join(WEBUI_DIR, relPath)).href;
const { default: Database } = await import(
  pathToFileURL(path.join(WEBUI_DIR, "node_modules/better-sqlite3/lib/index.js")).href
);
const {
  evaluateAccessGovernanceGate,
  evaluateGovernanceOverride,
  recordAccessGovernanceGateEvent,
  P0_REQUIRED_APPROVERS
} = await import(tsxUrl("server/access-governance-gate.ts"));
const {
  ensureTraceEvidenceSchema,
  prepareTraceDatabase,
  listTraceEvents
} = await import(tsxUrl("server/trace/evidence.ts"));

const KX = "dataforai.kx_fact_financial_amount";
const SUPERSTORE = "dataforai.superstore_orders";

const results = [];
function record(id, ok, message) {
  results.push({ id, status: ok ? "pass" : "fail", message });
  // Print to stdout for grep-friendly CI output.
  console.log(`${ok ? "✓" : "✗"} ${id} — ${message}`);
}

const tempDir = mkdtempSync(path.join(tmpdir(), "lucy-202608-gate-"));
const dbPath = path.join(tempDir, "trace.sqlite");
const database = new Database(dbPath);
prepareTraceDatabase(database);
ensureTraceEvidenceSchema(database);

try {
  // ─── 1. Sensitive Role widening → P0 block ──────────────────────────────
  {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "risk-officer",
      oldSources: [SUPERSTORE],
      newSources: [SUPERSTORE, KX]
    });
    assert.equal(decision.decision, "override_required", "P0 expected override_required");
    assert(decision.tierSummary.P0.count >= 1, "P0 count >= 1");
    record(
      "P0.sensitive-role-widening",
      true,
      `decision=${decision.decision} P0=${decision.tierSummary.P0.count}`
    );
  }

  // ─── 2. Global deny weakening → P0 block ───────────────────────────────
  {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "access_defaults",
      targetId: "defaults",
      oldDenyTools: ["sql_execution", "memory_ingest"],
      newDenyTools: ["sql_execution"]
    });
    assert.equal(decision.decision, "override_required");
    assert(decision.findings.some((f) => f.code === "GLOBAL_DENY_WEAKENED"));
    record("P0.global-deny-weakened", true, `decision=${decision.decision}`);
  }

  // ─── 3. Sensitive prefix weakening → P0 block ──────────────────────────
  {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "access_defaults",
      targetId: "defaults",
      oldSensitiveTablePrefixes: ["dataforai.kx_"],
      newSensitiveTablePrefixes: []
    });
    assert.equal(decision.decision, "override_required");
    assert(decision.findings.some((f) => f.code === "SENSITIVE_TABLE_PREFIXES_WEAKENED"));
    record("P0.sensitive-prefix-weakened", true, `decision=${decision.decision}`);
  }

  // ─── 4. Raw query path added → P0 block ─────────────────────────────────
  {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "tinkerer",
      oldSources: [],
      newSources: [],
      addedTools: ["sql_execution"]
    });
    assert.equal(decision.decision, "override_required");
    assert(decision.findings.some((f) => f.code === "RAW_QUERY_PATH_ADDED"));
    record("P0.raw-query-added", true, `decision=${decision.decision}`);
  }

  // ─── 5. Stale Token cleanup → P2 warning ───────────────────────────────
  {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "token",
      targetId: "stale:token"
    });
    assert.equal(decision.decision, "warn");
    assert(decision.tierSummary.P2.count >= 1);
    record("P2.stale-token-cleanup", true, `decision=${decision.decision} P2=${decision.tierSummary.P2.count}`);
  }

  // ─── 6. Single approver override → fail ─────────────────────────────────
  {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "risk",
      oldSources: [],
      newSources: [KX]
    });
    const single = {
      reason: "hotfix",
      approvers: [
        { actorKind: "admin", actorId: "local-admin-1", identityProvider: "deployment-local" }
      ],
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      rollbackPlan: "Revert via git"
    };
    const result = evaluateGovernanceOverride(single, gate);
    assert.equal(result.ok, false);
    assert.equal(result.code, "OVERRIDE_APPROVERS_INSUFFICIENT");
    record(
      "OVERRIDE.single-approver-fail",
      true,
      `code=${result.code}`
    );
  }

  // ─── 7. Valid two-approver override → ok + reviewer_override evidence ──
  {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "risk",
      oldSources: [],
      newSources: [KX]
    });
    const overrideRequest = {
      reason: "incident rollback",
      approvers: [
        { actorKind: "admin", actorId: "local-admin-1", identityProvider: "deployment-local" },
        { actorKind: "admin", actorId: "local-admin-2", identityProvider: "deployment-local" }
      ],
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      rollbackPlan: "Revert via git"
    };
    const evalResult = evaluateGovernanceOverride(overrideRequest, gate);
    assert.equal(evalResult.ok, true);

    recordAccessGovernanceGateEvent({
      database,
      decision: gate,
      overrideEvaluation: evalResult,
      overrideRequest,
      actor: { actorKind: "admin", actorId: "local-admin" }
    });

    const { events, evidence } = listTraceEvents(database, { traceId: gate.traceId });
    const reviewerEvidence = evidence.find((e) => e.relation === "reviewer_override");
    assert(reviewerEvidence, "reviewer_override evidence must exist");
    assert.equal(reviewerEvidence.metadata.approverCount, P0_REQUIRED_APPROVERS);
    // evidenceRef is hashed; the raw reason never lands in the hot store.
    assert.match(reviewerEvidence.evidenceRef, /^[a-f0-9]{32}$/);
    record(
      "OVERRIDE.two-approver-evidence",
      true,
      `events=${events.length} evidence=${evidence.length} approverCount=${reviewerEvidence.metadata.approverCount}`
    );
  }

  // ─── 8. Frontend-independent decision shape ─────────────────────────────
  {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "stable",
      oldSources: [SUPERSTORE],
      newSources: [SUPERSTORE]
    });
    // The decision must round-trip through JSON so the front-end can render
    // it directly without ever touching the classifier. We compare serialized
    // strings (not `deepStrictEqual`) because `undefined` fields are dropped by
    // `JSON.stringify` and the round-trip is what the wire actually sees.
    const round = JSON.stringify(JSON.parse(JSON.stringify(decision)));
    assert.equal(round, JSON.stringify(decision));
    // traceId must be opaque; no DB handle, no callable surfaces leak.
    assert.match(decision.traceId, /^gate-[0-9a-f-]{8,}$/);
    assert.equal(typeof decision.evidenceRefs[0].ref, "string");
    record("SHAPE.frontend-independent", true, `keys=${Object.keys(decision).length}`);
  }

  // ─── 9. Append-only: re-running the gate writes a second event row ──────
  {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "append-only",
      oldSources: [],
      newSources: [KX]
    });
    recordAccessGovernanceGateEvent({
      database,
      decision: gate,
      actor: { actorKind: "admin", actorId: "local-admin" }
    });
    const before = listTraceEvents(database, { traceId: gate.traceId }).events.length;
    recordAccessGovernanceGateEvent({
      database,
      decision: gate,
      actor: { actorKind: "admin", actorId: "local-admin" }
    });
    const after = listTraceEvents(database, { traceId: gate.traceId }).events.length;
    assert.equal(after, before + 1, "append-only invariant violated");
    record("APPEND-ONLY.replay-writes-new-row", true, `before=${before} after=${after}`);
  }

  // ─── 10. Hot store guard: no plaintext credential leaks into trace ──────
  {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "redaction",
      oldSources: [],
      newSources: [KX]
    });
    const maliciousApprover = {
      actorKind: "admin",
      actorId: "local-admin",
      tokenHash: "sha256:" + "a".repeat(64),
      identityProvider: "deployment-local"
    };
    const overrideRequest = {
      // JWT in `reason` — the gate's redactor must refuse this before any
      // row ever reaches SQLite.
      reason: "smuggle token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      approvers: [
        maliciousApprover,
        { actorKind: "admin", actorId: "local-admin-2", identityProvider: "deployment-local" }
      ],
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      rollbackPlan: "Revert via git"
    };
    const evalResult = evaluateGovernanceOverride(overrideRequest, gate);
    assert.equal(evalResult.ok, false);
    assert.equal(evalResult.code, "OVERRIDE_APPROVER_LEAKED_TOKEN");

    // Even if a caller tries to persist the gate decision, the JWT pattern
    // must not appear in the SQLite content.
    recordAccessGovernanceGateEvent({
      database,
      decision: gate,
      overrideEvaluation: evalResult,
      overrideRequest,
      actor: maliciousApprover
    });
    const dump = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map((row) => row.name);
    let blob = "";
    for (const table of dump) {
      blob += JSON.stringify(database.prepare(`SELECT * FROM ${table}`).all());
    }
    assert(!blob.includes("eyJhbGciOiJIUzI1NiJ9"), "JWT signature leaked into hot store");
    record("HOT-STORE.no-plaintext-credential", true, `tables=${dump.length} blobLen=${blob.length}`);
  }

  // Summary
  const failed = results.filter((r) => r.status === "fail");
  const summary = {
    ok: failed.length === 0,
    strict: process.argv.includes("--strict"),
    target: "access-governance-gate",
    counts: {
      pass: results.filter((r) => r.status === "pass").length,
      fail: failed.length,
      total: results.length
    },
    results
  };
  console.log("\n--- SUMMARY ---");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error("verify-202608-access-governance-gate.mjs crashed:", error);
  process.exit(2);
} finally {
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
}