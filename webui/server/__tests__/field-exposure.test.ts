/**
 * REQ-030-012 / P0-A — field exposure unit coverage (SC-01…SC-30 可单测子集).
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  admitPassthroughForExposure,
  admitToolsCallEntry,
  activateExecutionGenerationStratB,
  applyDiscoveryTrim,
  bootstrapEmptyServingGeneration,
  collectNamedFieldRefs,
  exposureDecision,
  FIELD_EXPOSURE_NOT_COLUMN_SECURITY_COPY,
  FIELD_EXPOSURE_UNAVAILABLE,
  FIELD_NOT_EXPOSED,
  alignServingGenerationAfterSharedIndexSuccess,
  armSharedIndexMutationBarrier,
  beginAdmissionDrain,
  forceResumeAdmission,
  forceStopAdmission,
  getUpstreamSemanticInFlightForTests,
  isUpstreamAheadOfServing,
  loadExposureSet,
  loadServingGeneration,
  markUpstreamIndexAdvanced,
  parseExpectedSetDocument,
  parseLedgerYaml,
  pinServingGeneration,
  resetFieldExposureRuntimeForTests,
  resolvePassthroughScope,
  rewriteExamples,
  setPassthroughEvidenceNoFieldNames,
  settleSharedIndexMutationBarrier,
  snapshotHasAnyTrimmed,
  sourceKey,
  trackUpstreamSemanticEnter,
  trackUpstreamSemanticLeave,
  trustedEmptyExpectedSet,
  UPSTREAM_INDEX_ADVANCED_PREFIX,
  validateQueryFieldsAgainstExposure,
  type ActivatedSnapshot,
  type SourceMapLookup
} from "../proxy/field-exposure.js";
import {
  buildTestLedgerText,
  checkExposureReferenceContract
} from "../proxy/field-exposure-publish.js";
import { trimDiscoveryPayload } from "../proxy/field-exposure-discovery.js";
import {
  applyPublishExemption,
  isNonWaivableCheckId,
  NON_WAIVABLE_PREFIXES
} from "../publish-gate.js";

const SRC = {
  connectionId: "demo",
  schema: "dataforai",
  sourceName: "orders"
};

function trimmedSnapshot(excluded: string[] = ["secret"]): ActivatedSnapshot {
  const text = buildTestLedgerText(SRC, excluded);
  const key = sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName);
  const base = bootstrapEmptyServingGeneration("gen-v1");
  const parsed = parseLedgerYaml(text, SRC);
  const digest = parsed.digest ?? "digest-trim";
  return {
    ...base,
    generationId: "gen-v1",
    upstreamExecutionGenerationId: "gen-v1",
    admissionMode: "OPEN",
    expectedSetLoad: {
      state: "ready",
      set: new Set([key]),
      digest: "d",
      generationId: "gen-v1",
      expectedSetRequired: true
    },
    exposureLedgersBySource: new Map([[key, text]]),
    exposureDigestPerSource: new Map([[key, digest]])
  };
}

const lookup: SourceMapLookup = {
  resolveSource(sourceName, connectionId) {
    if (sourceName === SRC.sourceName || sourceName === "orders") {
      return {
        connectionId: connectionId ?? SRC.connectionId,
        schema: SRC.schema,
        sourceName: SRC.sourceName
      };
    }
    return null;
  }
};

describe("field-exposure reader (SC-01/02/10/11/23/24/27/28)", () => {
  beforeEach(() => {
    resetFieldExposureRuntimeForTests();
  });

  it("missing ledger + not expected → unconfigured full expose (SC-02/SC-24)", () => {
    const snap = bootstrapEmptyServingGeneration();
    const set = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, snap);
    expect(set.state).toBe("unconfigured");
    expect(set.mode).toBe("unconfigured");
    const decision = exposureDecision(set);
    expect(decision.allow).toBe(true);
    if (decision.allow) expect(decision.fullInventory).toBe(true);
  });

  it("configured empty excluded → full_expose (SC-01)", () => {
    const text = buildTestLedgerText(SRC, []);
    const key = sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName);
    const snap = bootstrapEmptyServingGeneration("g");
    snap.expectedSetLoad = {
      state: "ready",
      set: new Set([key]),
      digest: "d",
      generationId: "g",
      expectedSetRequired: true
    };
    snap.exposureLedgersBySource.set(key, text);
    const set = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, snap);
    expect(set.state).toBe("configured");
    expect(set.mode).toBe("full_expose");
  });

  it("expected + missing ledger → unavailable (SC-23)", () => {
    const key = sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName);
    const snap = bootstrapEmptyServingGeneration("g");
    snap.expectedSetLoad = {
      state: "ready",
      set: new Set([key]),
      digest: "d",
      generationId: "g",
      expectedSetRequired: true
    };
    const set = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, snap);
    expect(set.state).toBe("unavailable");
    expect(set.reason).toBe("expected_ledger_missing");
  });

  it("corrupt ledger → unavailable (SC-11)", () => {
    const key = sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName);
    const snap = bootstrapEmptyServingGeneration("g");
    snap.expectedSetLoad = {
      state: "ready",
      set: new Set([key]),
      digest: "d",
      generationId: "g",
      expectedSetRequired: true
    };
    snap.exposureLedgersBySource.set(key, "not: yaml: [[[");
    const set = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, snap);
    expect(set.state).toBe("unavailable");
  });

  it("source mismatch → unavailable (SC-11)", () => {
    const bad = buildTestLedgerText(
      { ...SRC, sourceName: "other" },
      ["secret"]
    );
    const parsed = parseLedgerYaml(bad, SRC);
    expect(parsed.state).toBe("unavailable");
    expect(parsed.reason).toBe("ledger_source_mismatch");
  });

  it("expected set corrupt → unavailable, not empty ready (SC-27)", () => {
    const load = parseExpectedSetDocument("{not json", "gen-1");
    expect(load.state).toBe("unavailable");
    expect(load.reason).toBe("expected_set_corrupt");
  });

  it("expected set generation mismatch → unavailable (SC-28)", () => {
    const doc = JSON.stringify({
      schemaVersion: 1,
      generationId: "gen-old",
      expectedSetRequired: true,
      sources: []
    });
    const load = parseExpectedSetDocument(doc, "gen-new");
    expect(load.state).toBe("unavailable");
    expect(load.reason).toBe("expected_set_generation_mismatch");
  });

  it("trusted empty sentinel is ready∅ (D25)", () => {
    const load = trustedEmptyExpectedSet("g");
    expect(load.state).toBe("ready");
    expect(load.set.size).toBe(0);
    expect(load.expectedSetRequired).toBe(false);
  });

  it("new columns not in excluded → default exposed (SC-10)", () => {
    const set = loadExposureSet(
      SRC.connectionId,
      SRC.schema,
      SRC.sourceName,
      trimmedSnapshot(["secret"])
    );
    expect(set.excluded.has("secret")).toBe(true);
    expect(set.excluded.has("brand_new_col")).toBe(false);
  });
});

describe("AdmissionMode / Strat-B (SC-25/26)", () => {
  it("STOP_ADMISSION blocks upstream semantic tools", () => {
    const snap = trimmedSnapshot();
    snap.admissionMode = "STOP_ADMISSION";
    expect(admitToolsCallEntry("lucy_query", snap).allow).toBe(false);
    expect(admitToolsCallEntry("lucy_catalog", snap).allow).toBe(true);
  });

  it("OPEN with upstream≠serving is denied", () => {
    const snap = trimmedSnapshot();
    snap.admissionMode = "OPEN";
    snap.upstreamExecutionGenerationId = "gen-other";
    expect(admitToolsCallEntry("lucy_query", snap).allow).toBe(false);
  });

  it("activateExecutionGenerationStratB ends OPEN with upstream==generationId", async () => {
    resetFieldExposureRuntimeForTests();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fe-stratb-"));
    try {
      const next = trimmedSnapshot(["secret"]);
      next.generationId = "gen-v2";
      next.upstreamExecutionGenerationId = "gen-v1";
      const open = await activateExecutionGenerationStratB(next, { projectRoot: tmp });
      expect(open.admissionMode).toBe("OPEN");
      expect(open.upstreamExecutionGenerationId).toBe("gen-v2");
      expect(open.generationId).toBe("gen-v2");
      const loaded = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
      expect(loaded.admissionMode).toBe("OPEN");
      expect(loaded.upstreamExecutionGenerationId).toBe(loaded.generationId);
    } finally {
      resetFieldExposureRuntimeForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("forceStopAdmission persists STOP (SC-26 activation failure path)", async () => {
    resetFieldExposureRuntimeForTests();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fe-stop-"));
    try {
      const open = await activateExecutionGenerationStratB(trimmedSnapshot(), { projectRoot: tmp });
      expect(open.admissionMode).toBe("OPEN");
      const stopped = await forceStopAdmission({ projectRoot: tmp });
      expect(stopped.admissionMode).toBe("STOP_ADMISSION");
      const loaded = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
      expect(loaded.admissionMode).toBe("STOP_ADMISSION");
      expect(admitToolsCallEntry("lucy_query", loaded).allow).toBe(false);
    } finally {
      resetFieldExposureRuntimeForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("reindex window: STOP→DRAIN never OPEN; resume only when binding consistent (SC-26)", async () => {
    resetFieldExposureRuntimeForTests();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fe-drain-"));
    try {
      await activateExecutionGenerationStratB(trimmedSnapshot(), { projectRoot: tmp });
      const stopped = await forceStopAdmission({ projectRoot: tmp });
      expect(stopped.admissionMode).toBe("STOP_ADMISSION");
      expect(admitToolsCallEntry("lucy_query", stopped).allow).toBe(false);

      const draining = await beginAdmissionDrain({ projectRoot: tmp, waitMs: 0 });
      expect(draining.admissionMode).toBe("DRAINING");
      expect(admitToolsCallEntry("lucy_query", draining).allow).toBe(false);
      // 夹具锁：reindex 窗口内不得 OPEN
      expect(draining.admissionMode).not.toBe("OPEN");

      const resumed = await forceResumeAdmission({ projectRoot: tmp });
      expect(resumed.admissionMode).toBe("OPEN");
      expect(resumed.upstreamExecutionGenerationId).toBe(resumed.generationId);

      // 激活失败语义：upstream≠serving 时 resume 必须保持 STOP
      const mismatched = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
      mismatched.upstreamExecutionGenerationId = "gen-other";
      mismatched.admissionMode = "STOP_ADMISSION";
      const { persistServingGeneration } = await import("../proxy/field-exposure.js");
      await persistServingGeneration(mismatched, { projectRoot: tmp });
      const kept = await forceResumeAdmission({ projectRoot: tmp });
      expect(kept.admissionMode).toBe("STOP_ADMISSION");
      expect(admitToolsCallEntry("lucy_query", kept).allow).toBe(false);
    } finally {
      resetFieldExposureRuntimeForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("armSharedIndexMutationBarrier never leaves OPEN before mutate (SC-26)", async () => {
    resetFieldExposureRuntimeForTests();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fe-arm-"));
    try {
      await activateExecutionGenerationStratB(trimmedSnapshot(), { projectRoot: tmp });
      const ok = await armSharedIndexMutationBarrier({ projectRoot: tmp, waitMs: 0 });
      expect(ok).toBe(true);
      const mid = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
      expect(mid.admissionMode).toBe("DRAINING");
      expect(mid.admissionMode).not.toBe("OPEN");
      expect(admitToolsCallEntry("lucy_query", mid).allow).toBe(false);
    } finally {
      resetFieldExposureRuntimeForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("align after shared-index success opens with upstream==serving (no-FE path)", async () => {
    resetFieldExposureRuntimeForTests();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fe-align-"));
    try {
      await activateExecutionGenerationStratB(trimmedSnapshot(), { projectRoot: tmp });
      await armSharedIndexMutationBarrier({ projectRoot: tmp, waitMs: 0 });
      const open = await alignServingGenerationAfterSharedIndexSuccess({
        projectRoot: tmp,
        generationId: "gen-after-reindex"
      });
      expect(open.admissionMode).toBe("OPEN");
      expect(open.generationId).toBe("gen-after-reindex");
      expect(open.upstreamExecutionGenerationId).toBe(open.generationId);
      expect(admitToolsCallEntry("lucy_query", open).allow).toBe(true);
    } finally {
      resetFieldExposureRuntimeForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("settle index_failed after resume mismatch keeps STOP (manual-reindex regression)", async () => {
    resetFieldExposureRuntimeForTests();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fe-settle-"));
    try {
      await activateExecutionGenerationStratB(trimmedSnapshot(), { projectRoot: tmp });
      await armSharedIndexMutationBarrier({ projectRoot: tmp, waitMs: 0 });
      // Simulate index failure while binding still consistent → may OPEN
      const resumed = await settleSharedIndexMutationBarrier({
        projectRoot: tmp,
        outcome: "index_failed"
      });
      expect(resumed.admissionMode).toBe("OPEN");

      // Index succeeded but align/binding cannot open → keep STOP + durable mismatch
      await armSharedIndexMutationBarrier({ projectRoot: tmp, waitMs: 0 });
      const kept = await settleSharedIndexMutationBarrier({
        projectRoot: tmp,
        outcome: "index_succeeded_keep_stop"
      });
      expect(kept.admissionMode).toBe("STOP_ADMISSION");
      expect(isUpstreamAheadOfServing(kept)).toBe(true);
      expect(kept.upstreamExecutionGenerationId.startsWith(UPSTREAM_INDEX_ADVANCED_PREFIX)).toBe(
        true
      );
      expect(admitToolsCallEntry("lucy_query", kept).allow).toBe(false);
    } finally {
      resetFieldExposureRuntimeForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("index success + activate fail then later index_failed must still STOP (D23 Critical)", async () => {
    resetFieldExposureRuntimeForTests();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fe-d23-half-"));
    try {
      await activateExecutionGenerationStratB(trimmedSnapshot(), { projectRoot: tmp });
      await armSharedIndexMutationBarrier({ projectRoot: tmp, waitMs: 0 });
      // Shared-index mutate succeeded; activation will fail → mark advanced + keep_stop
      const halfOpen = await markUpstreamIndexAdvanced({ projectRoot: tmp });
      expect(halfOpen.admissionMode).toBe("STOP_ADMISSION");
      expect(isUpstreamAheadOfServing(halfOpen)).toBe(true);
      const afterActivateFail = await settleSharedIndexMutationBarrier({
        projectRoot: tmp,
        outcome: "index_succeeded_keep_stop"
      });
      expect(afterActivateFail.admissionMode).toBe("STOP_ADMISSION");
      expect(isUpstreamAheadOfServing(afterActivateFail)).toBe(true);

      // Later manual／publish index failure must NOT OPEN（禁「上游 V2 + serving V1 + OPEN」）
      await armSharedIndexMutationBarrier({ projectRoot: tmp, waitMs: 0 });
      const afterLaterFail = await settleSharedIndexMutationBarrier({
        projectRoot: tmp,
        outcome: "index_failed"
      });
      expect(afterLaterFail.admissionMode).toBe("STOP_ADMISSION");
      expect(isUpstreamAheadOfServing(afterLaterFail)).toBe(true);
      expect(admitToolsCallEntry("lucy_query", afterLaterFail).allow).toBe(false);

      const loaded = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
      expect(loaded.admissionMode).toBe("STOP_ADMISSION");
      expect(loaded.upstreamExecutionGenerationId).not.toBe(loaded.generationId);
    } finally {
      resetFieldExposureRuntimeForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("beginAdmissionDrain waits for tracked in-flight then returns (bounded)", async () => {
    resetFieldExposureRuntimeForTests();
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fe-drain-wait-"));
    try {
      await activateExecutionGenerationStratB(trimmedSnapshot(), { projectRoot: tmp });
      await forceStopAdmission({ projectRoot: tmp });
      trackUpstreamSemanticEnter();
      expect(getUpstreamSemanticInFlightForTests()).toBe(1);
      const started = Date.now();
      const drainPromise = beginAdmissionDrain({ projectRoot: tmp, waitMs: 200 });
      setTimeout(() => trackUpstreamSemanticLeave(), 40);
      const draining = await drainPromise;
      expect(draining.admissionMode).toBe("DRAINING");
      expect(getUpstreamSemanticInFlightForTests()).toBe(0);
      expect(Date.now() - started).toBeGreaterThanOrEqual(30);
      expect(Date.now() - started).toBeLessThan(200);
    } finally {
      resetFieldExposureRuntimeForTests();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("query field exposure (SC-04/05/06/19/20/29)", () => {
  it("denies unexposed dimension (SC-04/05)", () => {
    const snap = trimmedSnapshot(["secret"]);
    pinServingGeneration(snap);
    const verdict = validateQueryFieldsAgainstExposure(
      {
        connectionId: "demo",
        dimensions: [{ field: "orders.secret" }]
      },
      lookup,
      snap
    );
    expect(verdict.denyReason).toBe(FIELD_NOT_EXPOSED);
  });

  it("allows exposed dimension", () => {
    const snap = trimmedSnapshot(["secret"]);
    const verdict = validateQueryFieldsAgainstExposure(
      {
        connectionId: "demo",
        dimensions: [{ field: "orders.dt" }]
      },
      lookup,
      snap
    );
    expect(verdict.denyReason).toBeNull();
  });

  it("covers filters object, string, order_by, measures expr, segments (SC-05/19)", () => {
    const snap = trimmedSnapshot(["secret"]);
    const carriers = [
      { filters: [{ field: "orders.secret", op: "eq", value: "1" }] },
      { filters: ["orders.secret = 'x'"] },
      { order_by: [{ field: "orders.secret" }] },
      { measures: [{ expr: "sum(orders.secret)", name: "m" }] },
      { segments: ["orders.secret"] }
    ];
    for (const args of carriers) {
      const verdict = validateQueryFieldsAgainstExposure(
        { connectionId: "demo", ...args },
        lookup,
        snap
      );
      expect(verdict.denyReason, JSON.stringify(args)).toBe(FIELD_NOT_EXPOSED);
    }
  });

  it("unconfigured path does not hard-deny unparseable (SC-29)", () => {
    const snap = bootstrapEmptyServingGeneration();
    const verdict = validateQueryFieldsAgainstExposure(
      {
        connectionId: "demo",
        filters: ["some weird @@ syntax"]
      },
      lookup,
      snap
    );
    expect(verdict.denyReason).toBeNull();
  });

  it("trimmed scope hard-denies unparseable (SC-20)", () => {
    const snap = trimmedSnapshot(["secret"]);
    const verdict = validateQueryFieldsAgainstExposure(
      {
        connectionId: "demo",
        sourceName: "orders",
        filters: ["@@@"]
      },
      lookup,
      snap
    );
    expect(verdict.denyReason).toBe(FIELD_NOT_EXPOSED);
  });

  it("collectNamedFieldRefs covers carriers", () => {
    const refs = collectNamedFieldRefs({
      dimensions: [{ field: "orders.dt" }],
      orderBy: [{ field: "orders.amt" }],
      measures: ["orders.revenue", { expr: "sum(orders.qty)", name: "q" }],
      filters: [{ field: "orders.region" }, "orders.city = 'x'"],
      segments: ["orders.seg"]
    });
    expect(refs.some((r) => r.carrier === "dimensions")).toBe(true);
    expect(refs.some((r) => r.carrier === "order_by")).toBe(true);
    expect(refs.some((r) => r.carrier === "measures")).toBe(true);
    expect(refs.some((r) => r.carrier === "filters")).toBe(true);
    expect(refs.some((r) => r.carrier === "segments")).toBe(true);
  });
});

describe("passthrough D26 / SC-30", () => {
  it("EMPTY → INSTANCE_WIDE (R3c lock)", () => {
    const snap = trimmedSnapshot(["secret"]);
    const scope = resolvePassthroughScope("entity_details", {}, snap, lookup);
    expect(scope.involved).toBe("INSTANCE_WIDE");
    expect(scope.touchesTrimmed).toBe(true);
  });

  it("entity_details empty scope + trimmed → deny (SC-30 ACL-passed empty)", () => {
    const snap = trimmedSnapshot(["secret"]);
    const admit = admitPassthroughForExposure("entity_details", {}, snap, lookup);
    expect(admit.allow).toBe(false);
    if (!admit.allow) expect(admit.reason).toBe(FIELD_EXPOSURE_UNAVAILABLE);
  });

  it("sl_validate empty scope + trimmed → deny", () => {
    const snap = trimmedSnapshot(["secret"]);
    const admit = admitPassthroughForExposure("sl_validate", {}, snap, lookup);
    expect(admit.allow).toBe(false);
  });

  it("dictionary_search / discover_data INSTANCE_WIDE + trimmed → deny (path A)", () => {
    const snap = trimmedSnapshot(["secret"]);
    for (const tool of ["dictionary_search", "discover_data"] as const) {
      const admit = admitPassthroughForExposure(tool, {}, snap, lookup);
      expect(admit.allow, tool).toBe(false);
    }
  });

  it("no trimmed / no fault → allow all four (compat)", () => {
    const snap = bootstrapEmptyServingGeneration();
    for (const tool of [
      "entity_details",
      "sl_validate",
      "dictionary_search",
      "discover_data"
    ] as const) {
      expect(admitPassthroughForExposure(tool, {}, snap, lookup).allow).toBe(true);
    }
  });

  it("evidenceNoFieldNames lifts trimmed deny", () => {
    const snap = trimmedSnapshot(["secret"]);
    setPassthroughEvidenceNoFieldNames("dictionary_search", true);
    expect(admitPassthroughForExposure("dictionary_search", {}, snap, lookup).allow).toBe(true);
    setPassthroughEvidenceNoFieldNames("dictionary_search", false);
  });

  it("insertion point sets: sensitive meta vs table touching", async () => {
    const {
      SENSITIVE_META_PASSTHROUGH_TOOLS,
      TABLE_TOUCHING_PASSTHROUGH_TOOLS
    } = await import("../proxy/field-exposure.js");
    expect(SENSITIVE_META_PASSTHROUGH_TOOLS.has("dictionary_search")).toBe(true);
    expect(SENSITIVE_META_PASSTHROUGH_TOOLS.has("discover_data")).toBe(true);
    expect(TABLE_TOUCHING_PASSTHROUGH_TOOLS.has("entity_details")).toBe(true);
    expect(TABLE_TOUCHING_PASSTHROUGH_TOOLS.has("sl_validate")).toBe(true);
    // Lock: sensitive tools are NOT only in table-touching set
    expect(TABLE_TOUCHING_PASSTHROUGH_TOOLS.has("dictionary_search")).toBe(false);
    expect(TABLE_TOUCHING_PASSTHROUGH_TOOLS.has("discover_data")).toBe(false);
  });
});

describe("discovery trim (SC-03/21/22)", () => {
  it("strips excluded columns from payload", () => {
    const decision = exposureDecision(
      loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, trimmedSnapshot(["secret"]))
    );
    expect(decision.allow).toBe(true);
    if (!decision.allow || decision.fullInventory) throw new Error("expected trimmed");
    const result = applyDiscoveryTrim(
      { columns: [{ name: "dt" }, { name: "secret" }, { name: "amt" }] },
      decision,
      "read_source_columns"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const cols = (result.payload as { columns: Array<{ name: string }> }).columns.map((c) => c.name);
      expect(cols).toEqual(["dt", "amt"]);
    }
  });

  it("unknown shape under trim → fail-closed, no original (SC-22)", () => {
    const decision = exposureDecision(
      loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, trimmedSnapshot(["secret"]))
    );
    if (!decision.allow || decision.fullInventory) throw new Error("expected trimmed");
    const result = applyDiscoveryTrim({ weird: true }, decision, "read_source_columns");
    expect(result.ok).toBe(false);
  });

  it("rewriteExamples drops examples naming excluded cols (SC-21)", () => {
    const snap = trimmedSnapshot(["secret"]);
    const out = rewriteExamples(
      ["use orders.dt", "never use orders.secret in query", "ok"],
      snap
    );
    expect(out).toEqual(["use orders.dt", "ok"]);
  });
});

describe("B1 publish exposure contract (SC-08/09/16/29)", () => {
  it("measure referencing trimmed column → exposure.measure.*", () => {
    const ledger = buildTestLedgerText(SRC, ["secret"]);
    const violations = checkExposureReferenceContract({
      ledgers: [
        {
          connectionId: SRC.connectionId,
          schema: SRC.schema,
          sourceName: SRC.sourceName,
          text: ledger,
          expected: true
        }
      ],
      semanticSources: [
        {
          targetPath: "semantic-layer/demo/orders.yaml",
          connectionId: SRC.connectionId,
          schema: SRC.schema,
          sourceName: SRC.sourceName,
          content: {
            measures: {
              bad: { expr: "sum(orders.secret)" }
            }
          }
        }
      ]
    });
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!.checkId.startsWith("exposure.measure.")).toBe(true);
  });

  it("grain / segment / join / derived hit trimmed (SC-08 five carriers)", () => {
    const ledger = buildTestLedgerText(SRC, ["secret"]);
    const ledgers = [
      {
        connectionId: SRC.connectionId,
        schema: SRC.schema,
        sourceName: SRC.sourceName,
        text: ledger,
        expected: true
      }
    ];
    const base = {
      targetPath: "semantic-layer/demo/orders.yaml",
      connectionId: SRC.connectionId,
      schema: SRC.schema,
      sourceName: SRC.sourceName
    };
    const cases = [
      { content: { grain: ["secret"] }, prefix: "exposure.grain." },
      { content: { segments: { s1: { expr: "orders.secret = 1" } } }, prefix: "exposure.segment." },
      { content: { joins: [{ name: "j1", on: "orders.secret = other.id" }] }, prefix: "exposure.join." },
      {
        content: { columns: [{ name: "derived_secret", expr: "orders.secret * 2" }] },
        prefix: "exposure.derived."
      }
    ];
    for (const c of cases) {
      const violations = checkExposureReferenceContract({
        ledgers,
        semanticSources: [{ ...base, content: c.content }]
      });
      expect(violations.length, JSON.stringify(c.content)).toBeGreaterThan(0);
      expect(violations[0]!.checkId.startsWith(c.prefix), violations[0]!.checkId).toBe(true);
    }
  });

  it("cross-source reference to trimmed target (SC-08)", () => {
    const other = { connectionId: "demo", schema: "dataforai", sourceName: "people" };
    const violations = checkExposureReferenceContract({
      ledgers: [
        {
          connectionId: other.connectionId,
          schema: other.schema,
          sourceName: other.sourceName,
          text: buildTestLedgerText(other, ["ssn"]),
          expected: true
        }
      ],
      semanticSources: [
        {
          targetPath: "semantic-layer/demo/orders.yaml",
          connectionId: SRC.connectionId,
          schema: SRC.schema,
          sourceName: SRC.sourceName,
          content: {
            measures: { m: { expr: "sum(people.ssn)" } }
          }
        },
        {
          targetPath: "semantic-layer/demo/people.yaml",
          connectionId: other.connectionId,
          schema: other.schema,
          sourceName: other.sourceName,
          content: {}
        }
      ]
    });
    expect(violations.some((v) => v.checkId.includes("people.ssn"))).toBe(true);
  });

  it("ledger-only trim loads external overlay via affectedClosure (B1)", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "fe-closure-"));
    try {
      const layer = path.join(tmp, "semantic-layer", "demo");
      await mkdir(layer, { recursive: true });
      await writeFile(
        path.join(layer, "orders.yaml"),
        "name: orders\nmeasures:\n  amt: { expr: sum(orders.amt) }\n",
        "utf8"
      );
      await writeFile(
        path.join(layer, "returns.yaml"),
        "name: returns\nmeasures:\n  bad: { expr: sum(orders.secret) }\n",
        "utf8"
      );
      const { appendAffectedClosureOverlaysFromDisk } = await import("../semantic-assets.js");
      const loaded: Array<{ connectionId: string; sourceName: string; content: string }> = [];
      const seen = new Set<string>(["demo\0orders"]);
      await appendAffectedClosureOverlaysFromDisk(
        path.join(tmp, "semantic-layer"),
        [{ connectionId: "demo", sourceName: "orders" }],
        (targetPath, connectionId, schema, sourceName, content) => {
          loaded.push({ connectionId, sourceName, content });
          void targetPath;
          void schema;
        },
        seen
      );
      expect(loaded.some((o) => o.sourceName === "returns" && o.content.includes("orders.secret"))).toBe(
        true
      );
      // Already-seen sibling must not be re-pushed.
      expect(loaded.some((o) => o.sourceName === "orders")).toBe(false);

      const violations = checkExposureReferenceContract({
        ledgers: [
          {
            connectionId: SRC.connectionId,
            schema: SRC.schema,
            sourceName: SRC.sourceName,
            text: buildTestLedgerText(SRC, ["secret"]),
            expected: true
          }
        ],
        semanticSources: loaded.map((o) => ({
          targetPath: `semantic-layer/${o.connectionId}/${o.sourceName}.yaml`,
          connectionId: o.connectionId,
          schema: SRC.schema,
          sourceName: o.sourceName,
          content: {
            measures: { bad: { expr: "sum(orders.secret)" } }
          }
        }))
      });
      expect(violations.some((v) => v.checkId.includes("orders.secret"))).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("unconfigured target does not add exposure.* (SC-29)", () => {
    const violations = checkExposureReferenceContract({
      ledgers: [],
      semanticSources: [
        {
          targetPath: "semantic-layer/demo/orders.yaml",
          connectionId: SRC.connectionId,
          schema: SRC.schema,
          sourceName: SRC.sourceName,
          content: {
            measures: {
              ok: { expr: "sum(orders.amt)" }
            }
          }
        }
      ]
    });
    expect(violations).toEqual([]);
  });

  it("NON_WAIVABLE_PREFIXES blocks exposure.* waiver (SC-09)", () => {
    expect(NON_WAIVABLE_PREFIXES).toContain("exposure.");
    expect(isNonWaivableCheckId("exposure.measure.bad.orders.secret")).toBe(true);
    const decision = applyPublishExemption(
      [
        {
          checkId: "exposure.measure.bad.orders.secret",
          message: "blocked"
        }
      ],
      {
        operator: "op",
        reason: "try",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        checkIds: ["exposure.measure.bad.orders.secret"]
      },
      new Date()
    );
    expect(decision.remaining).toHaveLength(1);
  });
});

describe("cross-face digest consistency (SC-07)", () => {
  it("discovery trim digest equals query deny digest for same snapshot", () => {
    const snap = trimmedSnapshot(["secret"]);
    const set = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, snap);
    const decision = exposureDecision(set);
    expect(decision.allow).toBe(true);
    if (!decision.allow || decision.fullInventory) throw new Error("expected trimmed");
    const discovery = applyDiscoveryTrim(
      { columns: [{ name: "dt" }, { name: "secret" }] },
      decision,
      "read_source_columns"
    );
    expect(discovery.ok).toBe(true);
    const query = validateQueryFieldsAgainstExposure(
      { connectionId: "demo", dimensions: [{ field: "orders.secret" }] },
      lookup,
      snap
    );
    expect(query.denyReason).toBe(FIELD_NOT_EXPOSED);
    expect(query.exposureDigest).toBe(set.digest);
    expect(set.digest).toBe(snap.exposureDigestPerSource.get(sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName)));
  });
});

describe("Hive carrier trim helper (SC-21)", () => {
  it("trimDiscoveryPayload strips hive_columns without restoring original", async () => {
    resetFieldExposureRuntimeForTests();
    const snap = trimmedSnapshot(["secret"]);
    pinServingGeneration(snap);
    const original = {
      ok: true,
      columns: [{ name: "dt" }, { name: "secret" }, { name: "amt" }],
      rows: []
    };
    const result = await trimDiscoveryPayload({
      toolName: "lucy_read_source",
      payload: structuredClone(original),
      connectionId: SRC.connectionId,
      schema: SRC.schema,
      sourceName: SRC.sourceName,
      carrierKind: "hive_columns"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cols = (result.payload as { columns: Array<{ name: string }> }).columns.map((c) => c.name);
    expect(cols).toEqual(["dt", "amt"]);
    expect(original.columns.map((c) => c.name)).toEqual(["dt", "secret", "amt"]);
  });
});

describe("SC-14 copy lock", () => {
  it("exports fixed 业务暴露裁剪 ≠ 列级安全 copy", () => {
    expect(FIELD_EXPOSURE_NOT_COLUMN_SECURITY_COPY).toContain("业务暴露裁剪 ≠ 列级安全");
  });
});

describe("draft vs serving (SC-13 / S6b)", () => {
  let tmp: string;

  beforeEach(async () => {
    resetFieldExposureRuntimeForTests();
    tmp = await mkdtemp(path.join(os.tmpdir(), "fe-draft-"));
  });

  afterEach(async () => {
    resetFieldExposureRuntimeForTests();
    await rm(tmp, { recursive: true, force: true });
  });

  it("writing draft does not change ServingGeneration", async () => {
    const { writeDraftExposure, readDraftExposure, loadServingGeneration } = await import(
      "../proxy/field-exposure.js"
    );
    const before = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
    await writeDraftExposure(
      {
        connectionId: SRC.connectionId,
        schema: SRC.schema,
        sourceName: SRC.sourceName,
        excluded_columns: ["secret"],
        updated_at: new Date().toISOString()
      },
      { projectRoot: tmp }
    );
    const draft = await readDraftExposure(SRC.connectionId, SRC.sourceName, { projectRoot: tmp });
    expect(draft?.excluded_columns).toEqual(["secret"]);
    const after = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
    expect(after.generationId).toBe(before.generationId);
    expect(after.exposureLedgersBySource.size).toBe(0);
  });
});

describe("serving generation persistence smoke", () => {
  let tmp: string;

  beforeEach(async () => {
    resetFieldExposureRuntimeForTests();
    tmp = await mkdtemp(path.join(os.tmpdir(), "fe-"));
  });

  afterEach(async () => {
    resetFieldExposureRuntimeForTests();
    await rm(tmp, { recursive: true, force: true });
  });

  it("missing serving file → bootstrap empty OPEN", async () => {
    const snap = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
    expect(snap.admissionMode).toBe("OPEN");
    expect(snap.expectedSetLoad.state).toBe("ready");
    expect(snapshotHasAnyTrimmed(snap)).toBe(false);
  });

  it("writes expected set dir structure", async () => {
    const ui = path.join(tmp, ".ktx-ui", "field-exposure");
    await mkdir(ui, { recursive: true });
    await writeFile(
      path.join(ui, "expected-ledgers.json"),
      JSON.stringify({
        schemaVersion: 1,
        generationId: "g1",
        expectedSetRequired: true,
        sources: [SRC]
      }),
      "utf8"
    );
    await writeFile(
      path.join(ui, "serving-generation.json"),
      JSON.stringify({
        generationId: "g1",
        upstreamExecutionGenerationId: "g1",
        activatedAt: new Date().toISOString(),
        admissionMode: "OPEN",
        expectedSetRequired: true,
        semanticDefinitionDigest: "d",
        indexConsumptionDigest: "d",
        ledgers: {}
      }),
      "utf8"
    );
    const snap = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
    expect(snap.expectedSetLoad.state).toBe("ready");
    expect(snap.expectedSetLoad.set.has(sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName))).toBe(
      true
    );
    // expected but missing ledger → unavailable when loading that source
    const set = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, snap);
    expect(set.state).toBe("unavailable");
  });
});
