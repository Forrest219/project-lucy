// Cross-track consistency gate for the v0.25 E2E implementation (Plan s1-b).
//
// This runs AFTER every track has landed. It does not test any single track's
// internals — the tracks own that. It proves the property that only the whole
// set can violate:
//
//   * every one of the 173 v0.25 execution ids (149 in newScenarios + the 24
//     AUD25/ARV25 ids that were migrated INTO the frozen catalog on 2026-10-28)
//     is implemented by EXACTLY ONE track (no id implemented twice, no id left
//     unimplemented);
//   * each track's ids are disjoint from every other track's;
//   * each descriptor re-declares the owner branch, source spec and source
//     requirement id exactly as the approved coverage manifest recorded them
//     (a descriptor that renames its owner or re-attributes its requirement
//     would otherwise pass unnoticed);
//   * the frozen release directory did not move;
//   * the v0.25 coverage contract still validates;
//   * the concurrently-owned files were not pulled into the v0.25 work.
//
// Run: node --test scripts/e2e/__tests__/v025-cross-track.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { REPO_ROOT } from "../lib/common.mjs";
import { catalogDigest, loadCatalog, readLock } from "../lib/catalog.mjs";
import { loadCoverage } from "../lib/v025-coverage.mjs";

/**
 * The tracks and the modules each one publishes its descriptors from.
 * `accessors` lists the accepted export names; the first one that exists and
 * yields ids wins, so a track may rename its export without breaking the gate
 * — but it must still deliver exactly `expected` ids.
 */
const TRACKS = [
  {
    id: "B",
    name: "W2-SEM + W2-ACCESS",
    expected: 44,
    sources: [
      { module: "semantic-v025.mjs", accessors: ["semanticCases", "SEM25_CASES"] },
      { module: "access-v025.mjs", accessors: ["accessCases", "ROW25_CASES"] }
    ]
  },
  {
    id: "C",
    name: "W2-OBSERVE + LOG25",
    expected: 25,
    sources: [
      { module: "audit-v025.mjs", accessors: ["AUDIT_V025_CASES", "auditCases"] },
      { module: "audit-reconciliation-v025.mjs", accessors: ["RECONCILIATION_V025_CASES", "auditReconciliationCases"] },
      { module: "multi-turn-log-v025.mjs", accessors: ["MULTI_TURN_LOG_V025_CASES", "MULTI_TURN_LOG_CASES", "multiTurnLogCases", "LOG25_CASES"] }
    ]
  },
  {
    id: "D",
    name: "W3 P1 + CON25",
    expected: 75,
    sources: [
      { module: "hive-v025.mjs", accessors: ["HIV25_CASES", "hiveCases"] },
      { module: "connection-matrix-v025.mjs", accessors: ["CON25_CASES", "connectionMatrixCases"] },
      { module: "row-policy-templates-v025.mjs", accessors: ["RTP25_CASES", "RTV25_CASES", "rowPolicyTemplateCases"] },
      { module: "authorization-summary-v025.mjs", accessors: ["ASV25_CASES", "authorizationSummaryCases"] },
      { module: "access-map-v025.mjs", accessors: ["ACM25_CASES", "accessMapCases"] }
    ]
  },
  {
    id: "E",
    name: "W4 LIFECYCLE",
    expected: 29,
    sources: [{ module: "upgrade-v025.mjs", accessors: ["LIFECYCLE_CASES"] }]
  }
];

/** Files owned by the external concurrent agent; the v0.25 work must not touch them. */
const CONCURRENT_FILES = [
  "webui/server/proxy/mcp-proxy.ts",
  "webui/server/admin/audit-export-v2.ts",
  "webui/server/admin/audit-reconciliation-routes.ts",
  "webui/server/admin/reconciliation-ports.ts",
  "webui/server/admin/reconciliation.ts",
  "webui/server/__tests__/audit-reconciliation-routes.test.ts",
  "webui/server/__tests__/audit-trust/audit-trust-manifest-conformance.test.ts",
  "webui/server/__tests__/audit-trust/audit-trust-v2-export-pack.test.ts",
  "webui/server/__tests__/audit-trust/audit-trust-v2-export.test.ts",
  "webui/server/__tests__/mcp-proxy-trace.test.ts"
];

/** Markers that would prove the v0.25 work leaked into a concurrently-owned file. */
const V025_MARKERS = [
  "v025", "V025", "J25-01", "CON25", "LOG25", "UPG25", "RVC25",
  "ROW25", "SEM25", "AUD25", "ARV25", "RTP25", "RTV25", "ASV25", "ACM25", "HIV25"
];

const coverage = loadCoverage();
const manifestNew = coverage.newScenarios;
// 2026-10-28（D2 路径 A）：AUD25-A01..A12 与 ARV25-V01..V12 的**执行合同**已并入
// 冻结 catalog（case-catalog.yaml），因此在覆盖清单里从 newScenarios 移到
// existingCatalogMappings。但它们**仍由 track C 实现**，仍受本门禁约束 ——
// 所以「已批准」= newScenarios ∪ existing，「必须被实现」= newScenarios ∪ 这 24 个迁移项。
const manifestById = new Map(
  [...coverage.newScenarios, ...coverage.existing].map((s) => [s.executionId, s])
);
const MIGRATED_IDS = new Set(
  coverage.existing
    .filter((s) => s.sourceRequirementId !== undefined && s.sourceRequirementId !== null)
    .map((s) => s.executionId)
);
const mustBeImplemented = new Set([
  ...manifestNew.map((s) => s.executionId),
  ...MIGRATED_IDS
]);

/**
 * Reads the descriptors a module publishes.
 *
 * A module may expose one group (`HIV25_CASES`) or several groups plus a
 * combined export (`RTP25_CASES` + `RTV25_CASES` + `rowPolicyTemplateCases`).
 * Taking only the first accessor that yields ids would silently hide a whole
 * group, so every accessor is read and the union is de-duplicated by
 * execution id.
 */
async function readDescriptors(moduleName, accessors) {
  const file = path.join(REPO_ROOT, "scripts/e2e/lib", moduleName);
  if (!existsSync(file)) return { items: [], found: null, present: false };
  const mod = await import(file);
  const byId = new Map();
  const found = [];
  for (const accessor of accessors) {
    if (!(accessor in mod)) continue;
    let value = mod[accessor];
    if (typeof value === "function") {
      try { value = value(); } catch { continue; }
    }
    if (!Array.isArray(value)) continue;
    const items = value.filter((c) => typeof (c?.executionId ?? c?.id) === "string");
    if (items.length === 0) continue;
    found.push(accessor);
    for (const item of items) {
      const id = idOf(item);
      // Two accessors of the same module may publish the same descriptor
      // (a per-group export plus a combined export); that is one id, not two.
      if (!byId.has(id)) byId.set(id, item);
    }
  }
  return { items: [...byId.values()], found, present: true };
}

/** The execution id of a descriptor, whichever spelling the track used. */
const idOf = (d) => d?.executionId ?? d?.id;

/** Collects every descriptor of every track, tagged with the track that owns it. */
async function collectAll() {
  const collected = [];
  for (const track of TRACKS) {
    for (const src of track.sources) {
      const r = await readDescriptors(src.module, src.accessors);
      for (const item of r.items) collected.push({ track: track.id, module: src.module, item });
    }
  }
  return collected;
}

describe("v0.25 cross-track consistency (Plan s1-b)", () => {
  it("every track published its descriptor modules", async () => {
    const problems = [];
    for (const track of TRACKS) {
      for (const src of track.sources) {
        const r = await readDescriptors(src.module, src.accessors);
        if (!r.present) { problems.push(`track ${track.id}: missing module scripts/e2e/lib/${src.module}`); continue; }
        if (r.found.length === 0) problems.push(`track ${track.id}: ${src.module} exports none of ${src.accessors.join("/")}`);
      }
    }
    assert.deepEqual(problems, [], "descriptor module problems");
  });

  it("each track delivers exactly its approved number of ids", async () => {
    for (const track of TRACKS) {
      const ids = [];
      for (const src of track.sources) {
        const r = await readDescriptors(src.module, src.accessors);
        ids.push(...r.items.map(idOf));
      }
      const unique = [...new Set(ids)];
      assert.equal(unique.length, track.expected, `track ${track.id} (${track.name}) delivered ${unique.length} ids, expected ${track.expected}`);
      assert.equal(ids.length, unique.length, `track ${track.id} repeats an id across its own modules`);
    }
  });

  it("no execution id is implemented by two tracks, and none is left out", async () => {
    const seen = new Map();
    for (const { track, item } of await collectAll()) {
      const id = idOf(item);
      assert.ok(!seen.has(id), `${id} is implemented by both track ${seen.get(id)} and track ${track}`);
      seen.set(id, track);
    }
    const manifestIds = new Set(mustBeImplemented);
    const implemented = new Set(seen.keys());
    assert.deepEqual(
      [...implemented].filter((id) => !manifestById.has(id)),
      [],
      "ids implemented but not in the approved manifest"
    );
    assert.deepEqual(
      [...manifestIds].filter((id) => !implemented.has(id)),
      [],
      "approved manifest ids with no implementing track"
    );
    assert.equal(implemented.size, manifestIds.size);
  });

  it("every descriptor re-declares the owner branch and source the manifest approved", async () => {
    const problems = [];
    for (const { track, module, item } of await collectAll()) {
      const id = idOf(item);
      const approved = manifestById.get(id);
      if (!approved) {
        problems.push(`${id} (track ${track}, ${module}) is not in the approved manifest`);
        continue;
      }
      // A descriptor must not re-attribute the requirement it implements.
      if (item.ownerBranch !== undefined && item.ownerBranch !== approved.ownerBranch) {
        problems.push(`${id}: ownerBranch ${item.ownerBranch} != manifest ${approved.ownerBranch}`);
      }
      if (item.sourceRequirementId !== undefined && item.sourceRequirementId !== approved.sourceRequirementId) {
        problems.push(`${id}: sourceRequirementId ${item.sourceRequirementId} != manifest ${approved.sourceRequirementId}`);
      }
      if (item.sourceSpec !== undefined && item.sourceSpec !== approved.sourceSpec) {
        problems.push(`${id}: sourceSpec ${item.sourceSpec} != manifest ${approved.sourceSpec}`);
      }
      if (item.priority !== undefined && item.priority !== approved.priority) {
        problems.push(`${id}: priority ${item.priority} != manifest ${approved.priority}`);
      }
    }
    assert.deepEqual(problems, [], "descriptors disagreeing with the approved manifest");
  });

  it("the frozen release directory did not move", () => {
    // 2026-10-28（D2 路径 A）：冻结目录**有意**扩容过一次 —— AUD25-A01..A12 与
    // ARV25-V01..V12 并入冻结 catalog（分母 255 → 279，digest 240bff0f → c62cf23f）。
    // 这条断言守的是「此后不再无声漂移」：catalog 必须逐字等于冻结 lock。
    const { cases } = loadCatalog();
    const lock = readLock();
    assert.equal(catalogDigest(cases), lock.catalogDigest);
    assert.equal(lock.count, 279);
  });

  it("the v0.25 coverage contract still validates", () => {
    // The TAP reporter is pinned so the summary line this gate reads is stable
    // across Node versions (the default reporter prints "fail 0", not "# fail 0").
    let out = "";
    let code = 0;
    try {
      // NODE_TEST_CONTEXT is set when this gate itself runs under `node --test`.
      // A child that inherits it believes it is a test-runner child process,
      // reports over IPC instead of stdout, and captures as an empty string.
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      out = execFileSync(
        process.execPath,
        ["--test", "--test-reporter=tap", path.join(REPO_ROOT, "scripts/e2e/__tests__/v025-coverage.test.mjs")],
        { cwd: REPO_ROOT, encoding: "utf8", env }
      );
    } catch (err) {
      code = err.status ?? 1;
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    assert.equal(code, 0, `the coverage contract test exited ${code}:\n${out}`);
    assert.match(out, /# fail 0/);
  });

  it("the concurrently-owned files carry no v0.25 work", () => {
    for (const file of CONCURRENT_FILES) {
      const abs = path.join(REPO_ROOT, file);
      if (!existsSync(abs)) continue;
      const diff = execFileSync("git", ["diff", "--", file], { cwd: REPO_ROOT, encoding: "utf8" });
      for (const marker of V025_MARKERS) {
        assert.ok(!diff.includes(marker), `${file} diff mentions ${marker} — a concurrently-owned file was pulled into the v0.25 work`);
      }
    }
  });
});
