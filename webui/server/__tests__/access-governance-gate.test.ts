import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CORE_SENSITIVE_SOURCES,
  DEFAULT_HIGH_TRAFFIC_THRESHOLD,
  DEFAULT_SENSITIVE_SOURCE_PREFIXES,
  P0_REQUIRED_APPROVERS,
  RAW_QUERY_TOOLS,
  assertApproverIsRedacted,
  evaluateAccessGovernanceGate,
  evaluateGovernanceOverride,
  recordAccessGovernanceGateEvent
} from "../access-governance-gate";
import {
  ensureTraceEvidenceSchema,
  prepareTraceDatabase,
  listTraceEvents
} from "../trace/evidence";

let database: Database.Database;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "lucy-gate-"));
  database = new Database(path.join(tempDir, "trace.sqlite"));
  prepareTraceDatabase(database);
  ensureTraceEvidenceSchema(database);
});

afterEach(() => {
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
});

const KX_FACT = "dataforai.kx_fact_financial_amount";
const SUPERSTORE = "dataforai.superstore_orders";
const POC_METRIC = "data_agent_poc.poc_metric_catalog";

function futureIso(minutesAhead = 30): string {
  return new Date(Date.now() + minutesAhead * 60_000).toISOString();
}

function makeApprover(suffix: string) {
  return {
    actorKind: "admin" as const,
    actorId: `local-admin-${suffix}`,
    identityProvider: "deployment-local"
  };
}

function makeValidOverride(reason = "incident rollback", approverCount = P0_REQUIRED_APPROVERS) {
  return {
    reason,
    approvers: Array.from({ length: approverCount }, (_, index) => makeApprover(String(index + 1))),
    expiresAt: futureIso(30),
    rollbackPlan: "Revert via git and re-run the role_preview."
  };
}

describe("evaluateAccessGovernanceGate — P0 block rules", () => {
  it("blocks when Role selector widens into a sensitive KX source", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "risk-analyst",
      oldSources: [SUPERSTORE],
      newSources: [SUPERSTORE, KX_FACT],
      addedTools: ["sl_query"]
    });
    expect(decision.decision).toBe("override_required");
    expect(decision.tierSummary.P0.count).toBeGreaterThan(0);
    expect(decision.tierSummary.P0.reasons.some((reason) => reason.includes(KX_FACT))).toBe(true);
    expect(decision.override?.requiredApproverCount).toBe(P0_REQUIRED_APPROVERS);
    expect(decision.override?.requiredFields).toEqual(
      expect.arrayContaining(["reason", "approvers", "expiresAt", "rollbackPlan"])
    );
  });

  it("blocks when defaults.deny_tools loses a protected tool", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "access_defaults",
      targetId: "defaults",
      oldDenyTools: ["sql_execution", "sql_dialect_notes", "memory_ingest"],
      newDenyTools: ["sql_execution"]
    });
    expect(decision.decision).toBe("override_required");
    expect(
      decision.findings.some((finding) => finding.code === "GLOBAL_DENY_WEAKENED")
    ).toBe(true);
  });

  it("blocks when defaults.sensitive_table_prefixes loses a prefix", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "access_defaults",
      targetId: "defaults",
      oldSensitiveTablePrefixes: ["dataforai.kx_"],
      newSensitiveTablePrefixes: []
    });
    expect(decision.decision).toBe("override_required");
    expect(
      decision.findings.some((finding) => finding.code === "SENSITIVE_TABLE_PREFIXES_WEAKENED")
    ).toBe(true);
  });

  it("blocks when a raw-query / sensitive-metadata tool is added", () => {
    for (const tool of RAW_QUERY_TOOLS) {
      const decision = evaluateAccessGovernanceGate({
        targetKind: "role",
        targetId: "tinkerer",
        oldSources: [],
        newSources: [],
        addedTools: [tool]
      });
      expect(decision.decision).toBe("override_required");
      expect(
        decision.findings.some((finding) => finding.code === "RAW_QUERY_PATH_ADDED")
      ).toBe(true);
    }
  });

  it("blocks when a wildcard Agent is re-enabled", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "agent",
      targetId: "legacy-admin",
      oldValue: { id: "legacy-admin", enabled: false, allow: { tables: ["*"], tools: ["*"] } },
      newValue: { id: "legacy-admin", enabled: true, allow: { tables: ["*"], tools: ["*"] } }
    });
    expect(decision.decision).toBe("override_required");
    expect(
      decision.findings.some((finding) => finding.code === "WILDCARD_AGENT_RE_ENABLED")
    ).toBe(true);
  });

  it("uses the default sensitive prefixes and core sensitive sources", () => {
    expect(DEFAULT_SENSITIVE_SOURCE_PREFIXES).toContain("dataforai.kx_");
    expect(DEFAULT_CORE_SENSITIVE_SOURCES).toContain(KX_FACT);
  });
});

describe("evaluateAccessGovernanceGate — P1 review rules", () => {
  it("warns when Role selector widens into a non-sensitive source", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "analyst-plus",
      oldSources: [],
      newSources: [SUPERSTORE, POC_METRIC]
    });
    expect(decision.decision).toBe("warn");
    expect(decision.tierSummary.P1.count).toBeGreaterThan(0);
    expect(
      decision.findings.some((finding) => finding.code === "PERMISSION_EXPANSION_NON_SENSITIVE")
    ).toBe(true);
  });

  it("warns when a high-traffic Agent is being patched", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "agent",
      targetId: "hot-agent",
      oldSources: [SUPERSTORE],
      newSources: [SUPERSTORE],
      highTrafficCalls7d: DEFAULT_HIGH_TRAFFIC_THRESHOLD
    });
    expect(decision.decision).toBe("warn");
    expect(
      decision.findings.some((finding) => finding.code === "HIGH_TRAFFIC_TARGET")
    ).toBe(true);
  });

  it("warns when a Token is created for a high-traffic Agent", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "token",
      targetId: "hot-agent:cursor",
      newValue: { userId: "hot-agent", label: "cursor" },
      highTrafficCalls7d: DEFAULT_HIGH_TRAFFIC_THRESHOLD + 5
    });
    expect(decision.decision).toBe("warn");
    expect(
      decision.findings.some((finding) => finding.code === "TOKEN_FOR_HIGH_TRAFFIC_AGENT")
    ).toBe(true);
  });

  it("warns when Role has a denial rate above threshold", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "noisy-role",
      newValue: { id: "noisy-role", denialRate7d: 0.4 }
    });
    expect(decision.decision).toBe("warn");
    expect(
      decision.findings.some((finding) => finding.code === "ROLE_HIGH_DENIAL_RATE")
    ).toBe(true);
  });
});

describe("evaluateAccessGovernanceGate — P2 cleanup rules", () => {
  it("warns for stale Token cleanup without blocking", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "token",
      targetId: "stale-token"
    });
    expect(decision.decision).toBe("warn");
    expect(decision.tierSummary.P2.count).toBeGreaterThan(0);
    expect(
      decision.findings.some((finding) => finding.code === "STALE_TOKEN_CLEANUP")
    ).toBe(true);
  });
});

describe("evaluateAccessGovernanceGate — clean allow", () => {
  it("returns allow with no findings when sources and tools are unchanged", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "stable",
      oldSources: [SUPERSTORE],
      newSources: [SUPERSTORE],
      addedTools: []
    });
    expect(decision.decision).toBe("allow");
    expect(decision.tierSummary.P0.count).toBe(0);
    expect(decision.tierSummary.P1.count).toBe(0);
    expect(decision.tierSummary.P2.count).toBe(0);
    expect(decision.findings).toEqual([]);
    expect(decision.override).toBeUndefined();
    expect(decision.evidenceRefs.length).toBeGreaterThan(0);
  });

  it("emits deterministic traceId and frontend-independent decision shape", () => {
    const decision = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "stable",
      oldSources: [SUPERSTORE],
      newSources: [SUPERSTORE]
    });
    // traceId must be opaque + stable-ish (starts with "gate-")
    expect(decision.traceId).toMatch(/^gate-[0-9a-f-]{8,}$/);
    // Decision shape is what the front-end renders; it carries no DB handles.
    expect(JSON.parse(JSON.stringify(decision))).toEqual(decision);
  });
});

describe("evaluateGovernanceOverride — two-approver enforcement", () => {
  it("rejects a missing override for an override_required gate", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
    });
    expect(gate.decision).toBe("override_required");
    const result = evaluateGovernanceOverride(undefined, gate);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("OVERRIDE_REASON_MISSING");
  });

  it("rejects a single-approver override for a P0 finding", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
    });
    const single = makeValidOverride("hotfix", 1);
    const result = evaluateGovernanceOverride(single, gate);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("OVERRIDE_APPROVERS_INSUFFICIENT");
  });

  it("rejects an override missing a rollback plan", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
    });
    const override = { ...makeValidOverride(), rollbackPlan: "" };
    const result = evaluateGovernanceOverride(override, gate);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("OVERRIDE_ROLLBACK_PLAN_MISSING");
  });

  it("rejects an override whose expiresAt is in the past", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
    });
    const override = { ...makeValidOverride(), expiresAt: new Date(Date.now() - 60_000).toISOString() };
    const result = evaluateGovernanceOverride(override, gate);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("OVERRIDE_EXPIRES_AT_EXPIRED");
  });

  it("rejects an override whose approvers are not distinct identities", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
    });
    const override = {
      ...makeValidOverride("dup", 2),
      approvers: [makeApprover("dup"), makeApprover("dup")]
    };
    const result = evaluateGovernanceOverride(override, gate);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("OVERRIDE_APPROVERS_NOT_DISTINCT");
  });

  it("rejects an override whose approver smuggles a plaintext Token", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
    });
    const override = {
      ...makeValidOverride("leak", 2),
      approvers: [
        makeApprover("1"),
        { actorKind: "admin", actorId: "sk-abcdef0123456789ABCDEF0123456789ABCDEF0123456789ABCD", identityProvider: "deployment-local" }
      ]
    };
    const result = evaluateGovernanceOverride(override, gate);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("OVERRIDE_APPROVER_LEAKED_TOKEN");
  });

  it("accepts a valid two-approver override with reason / expiry / rollback plan", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
    });
    const result = evaluateGovernanceOverride(makeValidOverride(), gate);
    expect(result.ok).toBe(true);
  });

  it("ignores an override payload when the gate does not require one", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "stable",
      oldSources: [SUPERSTORE],
      newSources: [SUPERSTORE]
    });
    expect(gate.decision).toBe("allow");
    expect(evaluateGovernanceOverride(undefined, gate).ok).toBe(true);
    expect(evaluateGovernanceOverride(makeValidOverride(), gate).ok).toBe(false);
  });
});

describe("assertApproverIsRedacted", () => {
  it("accepts a sha256 hash format", () => {
    expect(assertApproverIsRedacted({ actorKind: "admin", tokenHash: "sha256:" + "a".repeat(64) })).toBeUndefined();
  });
  it("rejects a non-sha256 tokenHash", () => {
    expect(
      assertApproverIsRedacted({ actorKind: "admin", tokenHash: "plain-text-token" })
    ).toMatch(/sha256 hash/);
  });
  it("rejects a plaintext-like actorId", () => {
    expect(
      assertApproverIsRedacted({ actorKind: "admin", actorId: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG" })
    ).toMatch(/plaintext token/);
  });
});

describe("recordAccessGovernanceGateEvent — append-only evidence", () => {
  it("writes a publish_gate trace event and a reviewer_override evidence row", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
    });
    const overrideRequest = makeValidOverride();
    const evalResult = evaluateGovernanceOverride(overrideRequest, gate);
    expect(evalResult.ok).toBe(true);

    const writeResult = recordAccessGovernanceGateEvent({
      database,
      decision: gate,
      overrideEvaluation: evalResult,
      overrideRequest,
      actor: { actorKind: "admin", actorId: "local-admin" }
    });
    expect(writeResult.gateEventId).toBeGreaterThan(0);
    expect(writeResult.overrideEventId).toBeGreaterThan(0);
    expect(writeResult.evidenceIds.length).toBeGreaterThan(0);

    const { events, evidence } = listTraceEvents(database, { traceId: gate.traceId });
    expect(events.length).toBeGreaterThanOrEqual(2); // gate + override
    const gateEvent = events.find((event) => event.spanType === "publish_gate" && event.id === writeResult.gateEventId);
    expect(gateEvent).toBeDefined();
    expect(gateEvent?.metadata.gateKind).toBe("access_governance");
    expect(gateEvent?.metadata.targetKind).toBe("role");
    expect(gateEvent?.metadata.targetId).toBe("r");
    expect(gateEvent?.status).toBe("denied");
    expect(gateEvent?.actorKind).toBe("admin");

    const overrideEvidence = evidence.find(
      (entry) => entry.relation === "reviewer_override" && entry.traceEventId === writeResult.overrideEventId
    );
    expect(overrideEvidence).toBeDefined();
    expect(overrideEvidence?.evidenceKind).toBe("reviewer_override");
    // evidenceRef is the SHA-256 hash prefix of the reason so plaintext
    // never lands in the hot store. Rollback plan still survives in metadata.
    expect(overrideEvidence?.evidenceRef).toMatch(/^[a-f0-9]{32}$/);
    expect(overrideEvidence?.metadata.rollbackPlan).toBe("Revert via git and re-run the role_preview.");
  });

  it("refuses to write Token plaintext even when the reviewer pastes it into the reason", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
    });
    const maliciousApprover = {
      actorKind: "admin",
      actorId: "local-admin",
      tokenHash: "sha256:" + "a".repeat(64),
      identityProvider: "deployment-local"
    } as const;
    const overrideRequest = {
      reason: "incident rollback with token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      approvers: [
        maliciousApprover,
        { actorKind: "admin", actorId: "local-admin-2", identityProvider: "deployment-local" }
      ],
      expiresAt: futureIso(30),
      rollbackPlan: "Revert via git"
    };
    const evalResult = evaluateGovernanceOverride(overrideRequest, gate);
    expect(evalResult.ok).toBe(false);
    expect(evalResult.code).toBe("OVERRIDE_APPROVER_LEAKED_TOKEN");

    // The override is refused, so even if a caller proceeds to write the
    // gate event without the override, no plaintext credential should
    // appear in the trace / evidence chain.
    recordAccessGovernanceGateEvent({
      database,
      decision: gate,
      overrideEvaluation: evalResult,
      overrideRequest,
      actor: maliciousApprover
    });

    const { events, evidence } = listTraceEvents(database, { traceId: gate.traceId });
    const blob = JSON.stringify({ events, evidence });
    expect(blob).not.toMatch(/eyJhbGciOiJIUzI1NiJ9/);
    expect(blob).not.toMatch(/Bearer [A-Za-z0-9._~+\/=-]{12,}/);
  });

  it("appends, never overwrites: re-running the gate produces a second event row", () => {
    const gate = evaluateAccessGovernanceGate({
      targetKind: "role",
      targetId: "r",
      oldSources: [],
      newSources: [KX_FACT]
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
    expect(after).toBe(before + 1);
  });
});