/**
 * SC-30 / SC-15 / SC-21 — insertion-point locks for field-exposure hooks.
 * Static source lock: path A/B in acl.ts; Hive trim in mcp-proxy.ts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

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
});
