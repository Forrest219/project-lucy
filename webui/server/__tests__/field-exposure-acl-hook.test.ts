/**
 * SC-30 / SC-15 / SC-21 — insertion-point locks for field-exposure hooks.
 * SC-18 — unauthorized caller keeps original ACL codes (no exposure leak).
 * Static source lock: path A/B in acl.ts; Hive trim in mcp-proxy.ts.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import {
  bootstrapEmptyServingGeneration,
  FIELD_EXPOSURE_UNAVAILABLE,
  FIELD_NOT_EXPOSED,
  parseLedgerYaml,
  pinServingGeneration,
  resetFieldExposureRuntimeForTests,
  sourceKey,
  type ActivatedSnapshot
} from "../proxy/field-exposure.js";
import { buildTestLedgerText } from "../proxy/field-exposure-publish.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ACL_PATH = path.resolve(DIR, "../proxy/acl.ts");
const MCP_PROXY_PATH = path.resolve(DIR, "../proxy/mcp-proxy.ts");
const SEMANTIC_ASSETS_PATH = path.resolve(DIR, "../semantic-assets.ts");
const INDEX_PATH = path.resolve(DIR, "../index.ts");
const FIELD_EXPOSURE_PATH = path.resolve(DIR, "../proxy/field-exposure.ts");

describe("authorizeAndRewrite field-exposure insertion locks", () => {
  it("wires sensitive-meta passthrough outside tableTouching-only branch (SC-30)", async () => {
    const src = await readFile(ACL_PATH, "utf8");
    expect(src).toContain("SENSITIVE_META_PASSTHROUGH_TOOLS");
    expect(src).toContain("TABLE_TOUCHING_PASSTHROUGH_TOOLS");
    expect(src).toContain("afterAuthFieldExposureHook");
    expect(src).toContain("validateQueryFieldsAgainstExposure");
    // Path A block (D26) must appear, and must not be nested solely under TABLE_TOUCHING check.
    const sensIdx = src.indexOf("SENSITIVE_META_PASSTHROUGH_TOOLS.has(toolName)");
    const pathBIdx = src.indexOf("TABLE_TOUCHING_PASSTHROUGH_TOOLS.has(toolName)");
    expect(sensIdx).toBeGreaterThan(0);
    expect(pathBIdx).toBeGreaterThan(0);
    expect(src).toContain("路径 A");
    expect(src).toContain("路径 B");
    // Query exposure must not call validateProtectedLucyQueryArgs for exposure itself.
    const exposureBlock = src.slice(
      src.indexOf("validateQueryFieldsAgainstExposure"),
      src.indexOf("validateQueryFieldsAgainstExposure") + 400
    );
    expect(exposureBlock).not.toContain("validateProtectedLucyQueryArgs(args)");
  });

  it("wires Hive lucy_read_source trim via field-exposure-discovery (SC-21)", async () => {
    const src = await readFile(MCP_PROXY_PATH, "utf8");
    expect(src).toContain('carrierKind: "hive_columns"');
    expect(src).toContain("trimDiscoveryPayload");
    // Hive diversion must trim before writing the response body.
    const hiveFnIdx = src.indexOf("async function maybeWriteHiveDivertedResponse");
    const hiveTrimIdx = src.indexOf('carrierKind: "hive_columns"');
    expect(hiveFnIdx).toBeGreaterThan(0);
    expect(hiveTrimIdx).toBeGreaterThan(hiveFnIdx);
  });

  it("mcp-proxy tracks upstream semantic enter/leave for Strat-B DRAIN", async () => {
    const src = await readFile(MCP_PROXY_PATH, "utf8");
    expect(src).toContain("trackUpstreamSemanticEnter");
    expect(src).toContain("trackUpstreamSemanticLeave");
    expect(src).toContain("requestWouldHitUpstreamSemanticExecution");
  });

  it("activation failure forces STOP_ADMISSION (SC-26)", async () => {
    const src = await readFile(SEMANTIC_ASSETS_PATH, "utf8");
    expect(src).toContain("settleSharedIndexMutationBarrier");
    expect(src).toContain("activateFieldExposureServingFromSnapshot");
  });

  it("runReindex arms shared Strat-B barrier before reindexImpl; activation fail keeps STOP (SC-26)", async () => {
    const src = await readFile(SEMANTIC_ASSETS_PATH, "utf8");
    const runIdx = src.indexOf("const runReindex = async () =>");
    expect(runIdx).toBeGreaterThan(0);
    const runEnd = src.indexOf("const scheduleReindex =", runIdx);
    const runBody = src.slice(runIdx, runEnd > runIdx ? runEnd : runIdx + 14000);
    const armIdx = runBody.indexOf("await armSharedIndexMutationBarrier({ projectRoot })");
    const reindexIdx = runBody.indexOf("await reindexImpl(projectRoot");
    expect(armIdx).toBeGreaterThan(0);
    expect(reindexIdx).toBeGreaterThan(armIdx);
    // 索引成功后须耐久拉开 upstream（激活确认前）；失败路径统一 settle，禁旁路 RESUME。
    const markIdx = runBody.indexOf("await markUpstreamIndexAdvanced({ projectRoot })");
    expect(markIdx).toBeGreaterThan(reindexIdx);
    expect(runBody).toContain('outcome: "index_failed"');
    expect(runBody).not.toContain("forceResumeAdmission");
    expect(runBody).not.toContain("forceStopAdmission");
    // 激活失败路径禁止失败后 OPEN：须 keep_stop。
    const activateIdx = runBody.indexOf("activateFieldExposureServingFromSnapshot");
    expect(activateIdx).toBeGreaterThan(markIdx);
    const activateCatch = runBody.slice(activateIdx, activateIdx + 1200);
    expect(activateCatch).toContain('outcome: "index_succeeded_keep_stop"');
    // activationStatus confirmed 不得早于激活成功
    const confirmedIdx = runBody.indexOf('activationStatus: "confirmed"');
    expect(confirmedIdx).toBeGreaterThan(activateIdx);
  });

  it("manual reindex shares Strat-B barrier with publish (SC-26 Critical)", async () => {
    const src = await readFile(INDEX_PATH, "utf8");
    const routeIdx = src.indexOf('"/api/semantic-assets/reindex"');
    expect(routeIdx).toBeGreaterThan(0);
    const routeBody = src.slice(routeIdx, routeIdx + 9000);
    const armIdx = routeBody.indexOf("await armSharedIndexMutationBarrier({ projectRoot })");
    const reindexIdx = routeBody.indexOf("await reindexProject(projectRoot");
    expect(armIdx).toBeGreaterThan(0);
    expect(reindexIdx).toBeGreaterThan(armIdx);
    const markIdx = routeBody.indexOf("await markUpstreamIndexAdvanced({ projectRoot })");
    expect(markIdx).toBeGreaterThan(reindexIdx);
    expect(routeBody).toContain('outcome: "index_failed"');
    expect(routeBody).toContain('outcome: "index_succeeded_align"');
    expect(routeBody).toContain('outcome: "index_succeeded_keep_stop"');
  });

  it("shared barrier helper STOP→DRAIN before mutate; keep_stop marks upstream advanced", async () => {
    const src = await readFile(FIELD_EXPOSURE_PATH, "utf8");
    const armIdx = src.indexOf("export async function armSharedIndexMutationBarrier");
    expect(armIdx).toBeGreaterThan(0);
    const armBody = src.slice(armIdx, armIdx + 800);
    expect(armBody.indexOf("forceStopAdmission")).toBeGreaterThan(0);
    expect(armBody.indexOf("beginAdmissionDrain")).toBeGreaterThan(
      armBody.indexOf("forceStopAdmission")
    );
    const settleIdx = src.indexOf("export async function settleSharedIndexMutationBarrier");
    expect(settleIdx).toBeGreaterThan(0);
    const settleBody = src.slice(settleIdx, settleIdx + 900);
    expect(settleBody).toContain('outcome === "index_succeeded_keep_stop"');
    expect(settleBody).toContain("markUpstreamIndexAdvanced");
    expect(settleBody).not.toContain("return forceStopAdmission");
  });

  it("B1 affectedClosure scans external overlays for ledger-only trim", async () => {
    const src = await readFile(SEMANTIC_ASSETS_PATH, "utf8");
    expect(src).toContain("appendAffectedClosureOverlaysFromDisk");
    expect(src).toContain("affectedClosure");
  });

  it("kxCatalog examples use rewriteCatalogExamplesForExposure (SC-21 parity)", async () => {
    const src = await readFile(ACL_PATH, "utf8");
    const kxIdx = src.indexOf("export async function kxCatalog");
    expect(kxIdx).toBeGreaterThan(0);
    const kxBody = src.slice(kxIdx, kxIdx + 1200);
    expect(kxBody).toContain("rewriteCatalogExamplesForExposure");
  });

  it("SC-18 source lock: object-auth returns precede validateQueryFieldsAgainstExposure", async () => {
    const src = await readFile(ACL_PATH, "utf8");
    const fnIdx = src.indexOf("export async function authorizeAndRewrite");
    expect(fnIdx).toBeGreaterThan(0);
    const fnBody = src.slice(fnIdx, fnIdx + 12000);
    const authConnIdx = fnBody.indexOf("unknown_or_forbidden_connection:");
    const exposureIdx = fnBody.indexOf("validateQueryFieldsAgainstExposure");
    expect(authConnIdx).toBeGreaterThan(0);
    expect(exposureIdx).toBeGreaterThan(authConnIdx);
    // Comment contract: 越权路径已在上方 return 原 ACL 码
    expect(fnBody).toContain("越权路径已在上方 return 原 ACL 码");
  });
});

describe("SC-18 unauthorized caller keeps original ACL codes", () => {
  const SRC = {
    connectionId: "demo",
    schema: "dataforai",
    sourceName: "orders"
  };

  const ACCESS_YAML = `users:
  - id: insider_agent
    name: Insider Agent
    enabled: true
    tokens: []
    allow:
      connections:
        - demo
      tables:
        - dataforai.orders
      tools:
        - lucy_query
        - lucy_explain_query
        - lucy_read_source
  - id: outsider_agent
    name: Outsider Agent
    enabled: true
    tokens: []
    allow:
      connections:
        - otherdb
      tables:
        - ext.ext_data
      tools:
        - lucy_query
        - lucy_explain_query
defaults:
  deny_tools: []
`;

  const SCHEMA_YAML = `tables:
  orders:
    table: dataforai.orders
`;

  const OTHER_SCHEMA = `tables:
  ext_data:
    table: ext.ext_data
`;

  let projectRoot: string;
  let previousRoot: string | undefined;
  let previousContentRoot: string | undefined;

  function identity(userId: string) {
    return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
  }

  function assertNoExposureLeak(decision: { allowed: boolean; reason?: string }) {
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBeTruthy();
    expect(decision.reason).not.toBe(FIELD_NOT_EXPOSED);
    expect(decision.reason).not.toBe(FIELD_EXPOSURE_UNAVAILABLE);
    const body = JSON.stringify(decision);
    expect(body).not.toContain("field_not_exposed");
    expect(body).not.toContain("field_exposure_unavailable");
    expect(body).not.toContain("excluded_columns");
    expect(body).not.toContain("expected_ledger");
    expect(body).not.toContain("expectedSet");
    expect(body).not.toContain("_exposure");
    expect(body).not.toContain("exposureLedgers");
  }

  function trimmedServing(excluded: string[] = ["secret"]): ActivatedSnapshot {
    const text = buildTestLedgerText(SRC, excluded);
    const key = sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName);
    const parsed = parseLedgerYaml(text, SRC);
    const base = bootstrapEmptyServingGeneration("gen-sc18");
    return {
      ...base,
      generationId: "gen-sc18",
      upstreamExecutionGenerationId: "gen-sc18",
      admissionMode: "OPEN",
      expectedSetLoad: {
        state: "ready",
        set: new Set([key]),
        digest: "d-sc18",
        generationId: "gen-sc18",
        expectedSetRequired: true
      },
      exposureLedgersBySource: new Map([[key, text]]),
      exposureDigestPerSource: new Map([[key, parsed.digest ?? "d"]])
    };
  }

  function unavailableLedgerServing(): ActivatedSnapshot {
    const key = sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName);
    const base = bootstrapEmptyServingGeneration("gen-sc18-fault");
    return {
      ...base,
      generationId: "gen-sc18-fault",
      upstreamExecutionGenerationId: "gen-sc18-fault",
      admissionMode: "OPEN",
      expectedSetLoad: {
        state: "ready",
        set: new Set([key]),
        digest: "d-fault",
        generationId: "gen-sc18-fault",
        expectedSetRequired: true
      },
      exposureLedgersBySource: new Map() // expected but missing → unavailable
    };
  }

  async function makeProject() {
    const root = await mkdtemp(path.join(os.tmpdir(), "fe-sc18-acl-"));
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await mkdir(path.join(root, "semantic-layer", "demo", "_schema"), { recursive: true });
    await mkdir(path.join(root, "semantic-layer", "otherdb", "_schema"), { recursive: true });
    await writeFile(
      path.join(root, "ktx.yaml"),
      `connections:
  demo:
    driver: mysql
    enabled_tables:
      - dataforai.orders
  otherdb:
    driver: mysql
    enabled_tables:
      - ext.ext_data
`,
      "utf8"
    );
    await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
    await writeFile(
      path.join(root, "semantic-layer", "demo", "_schema", "dataforai.yaml"),
      SCHEMA_YAML,
      "utf8"
    );
    await writeFile(
      path.join(root, "semantic-layer", "otherdb", "_schema", "ext.yaml"),
      OTHER_SCHEMA,
      "utf8"
    );
    return root;
  }

  async function loadAclAndPin(snapshot: ActivatedSnapshot) {
    vi.resetModules();
    const fe = await import("../proxy/field-exposure.js");
    fe.resetFieldExposureRuntimeForTests();
    fe.pinServingGeneration(snapshot);
    const acl = await import("../proxy/acl.js");
    return acl;
  }

  beforeEach(async () => {
    previousRoot = process.env.KTX_PROJECT_ROOT;
    previousContentRoot = process.env.LUCY_CONTENT_ROOT;
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    resetFieldExposureRuntimeForTests();
  });

  afterEach(async () => {
    resetFieldExposureRuntimeForTests();
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("SC-18: unauthorized connection guess keeps original ACL; no exposure codes or config leak", async () => {
    const { authorizeAndRewrite } = await loadAclAndPin(trimmedServing(["secret"]));

    // Control: authorized insider hitting unexposed field → exposure deny (proves gate armed).
    const insider = await authorizeAndRewrite(identity("insider_agent"), "lucy_query", {
      connectionId: "demo",
      dimensions: [{ field: "orders.secret" }]
    });
    expect(insider).toEqual({ allowed: false, reason: FIELD_NOT_EXPOSED });

    // Outsider guesses secret on a connection they do not hold.
    const outsider = await authorizeAndRewrite(identity("outsider_agent"), "lucy_query", {
      connectionId: "demo",
      dimensions: [{ field: "orders.secret" }],
      measures: ["orders.secret"]
    });
    assertNoExposureLeak(outsider);
    expect(outsider.reason).toMatch(/^unknown_or_forbidden_connection:/);
  });

  it("SC-18: unauthorized table / ledger-fault guess keeps original ACL codes", async () => {
    // Ledger fault that WOULD yield field_exposure_unavailable for an authorized caller.
    const { authorizeAndRewrite } = await loadAclAndPin(unavailableLedgerServing());

    const insiderFault = await authorizeAndRewrite(identity("insider_agent"), "lucy_query", {
      connectionId: "demo",
      dimensions: [{ field: "orders.dt" }]
    });
    expect(insiderFault).toEqual({ allowed: false, reason: FIELD_EXPOSURE_UNAVAILABLE });

    // Same fault surface, but outsider never reaches exposure — original ACL only.
    const outsiderFault = await authorizeAndRewrite(identity("outsider_agent"), "lucy_query", {
      connectionId: "demo",
      dimensions: [{ field: "orders.secret" }],
      filters: ["orders.secret = 1"]
    });
    assertNoExposureLeak(outsiderFault);
    expect(outsiderFault.reason).toMatch(/^unknown_or_forbidden_connection:/);

    // Re-pin trimmed OPEN and assert explain path also keeps ACL for outsider.
    const fe = await import("../proxy/field-exposure.js");
    fe.pinServingGeneration(trimmedServing(["secret"]));
    const outsiderExplain = await authorizeAndRewrite(
      identity("outsider_agent"),
      "lucy_explain_query",
      {
        connectionId: "demo",
        measures: [{ expr: "sum(orders.secret)", name: "x" }]
      }
    );
    assertNoExposureLeak(outsiderExplain);
    expect(outsiderExplain.reason).toMatch(/^unknown_or_forbidden_connection:/);
  });
});
