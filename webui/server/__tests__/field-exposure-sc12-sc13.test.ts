/**
 * P0-A SC-12 / SC-13 — catalog identity invariance + draft／serving Proxy 对照.
 *
 * SC-12: exposure set does not differ by Role/Agent; lucy_catalog sources
 *        table list is unchanged by exposure trimming (trim ≠ hide tables).
 * SC-13: save-without-publish stays draft; Proxy still serves prior activated
 *        generation; pending workbench classifies field_exposure.
 *
 * Full browser E2E is out of Spec 出口 scope; WebUI component coverage lives in
 * `webui/src/__tests__/field-exposure-workbench-sc13.test.tsx`.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateContentPathsCache } from "../paths.js";
import { lucyCatalog, resetEffectivePolicyForTests } from "../proxy/acl.js";
import type { Identity } from "../proxy/identity.js";
import {
  bootstrapEmptyServingGeneration,
  FIELD_NOT_EXPOSED,
  loadExposureSet,
  loadServingGeneration,
  parseLedgerYaml,
  pinServingGeneration,
  readDraftExposure,
  resetFieldExposureRuntimeForTests,
  sourceKey,
  validateQueryFieldsAgainstExposure,
  writeDraftExposure,
  type ActivatedSnapshot,
  type SourceMapLookup
} from "../proxy/field-exposure.js";
import { buildTestLedgerText } from "../proxy/field-exposure-publish.js";
import {
  kindForLogicalPath,
  readPublishPendingSnapshot
} from "../publish-workbench-state.js";

const SRC = {
  connectionId: "demo",
  schema: "dataforai",
  sourceName: "orders"
};

const CONNECTION = "demo-mysql";
const SCHEMA = "dataforai";
const VISIBLE = "orders_visible";
const TOKEN = "fe-sc12-catalog-token";

const ACL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../proxy/acl.ts");
const FIELD_EXPOSURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../proxy/field-exposure.ts"
);

function identity(userId: string): Identity {
  return { userId, tokenLabel: "fe-sc12", tokenHashPrefix: "fe-sc12" };
}

function accessYaml(agentIds: string[], visibleTables: string[]): string {
  const users = agentIds
    .map(
      (id) => `  - id: ${id}
    name: ${id}
    enabled: true
    tokens:
      - hash: "sha256:${TOKEN}-${id}"
        label: fe-sc12
        created: 2026-11-13
    allow:
      tables:
${visibleTables.map((t) => `        - ${t}`).join("\n")}
      tools:
        - lucy_catalog
        - lucy_query
`
    )
    .join("\n");
  return `users:
${users}
defaults:
  deny_tools: []
`;
}

async function writeProject(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf-8");
  }
}

function trimmedSnapshot(excluded: string[] = ["secret"]): ActivatedSnapshot {
  const text = buildTestLedgerText(SRC, excluded);
  const key = sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName);
  const base = bootstrapEmptyServingGeneration("gen-sc12");
  const parsed = parseLedgerYaml(text, SRC);
  return {
    ...base,
    generationId: "gen-sc12",
    upstreamExecutionGenerationId: "gen-sc12",
    admissionMode: "OPEN",
    expectedSetLoad: {
      state: "ready",
      set: new Set([key]),
      digest: "d-sc12",
      generationId: "gen-sc12",
      expectedSetRequired: true
    },
    exposureLedgersBySource: new Map([[key, text]]),
    exposureDigestPerSource: new Map([[key, parsed.digest ?? "digest-sc12"]])
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

describe("SC-12 exposure set identity-invariant + catalog sources stable", () => {
  beforeEach(() => {
    resetFieldExposureRuntimeForTests();
  });

  afterEach(() => {
    resetFieldExposureRuntimeForTests();
  });

  it("SC-12: loadExposureSet / validateQueryFieldsAgainstExposure take no Role or Agent identity", async () => {
    const src = await readFile(FIELD_EXPOSURE_PATH, "utf8");
    const loadSig = src.match(/export function loadExposureSet\(([^)]*)\)/);
    const validateSig = src.match(/export function validateQueryFieldsAgainstExposure\(([^)]*)\)/);
    expect(loadSig?.[1] ?? "").not.toMatch(/identity|role|agent/i);
    expect(validateSig?.[1] ?? "").not.toMatch(/identity|role|agent/i);
    expect(loadExposureSet.length).toBe(4);
  });

  it("SC-12: exposure excluded set does not differ across Role/Agent call contexts", () => {
    const snap = trimmedSnapshot(["secret", "ssn"]);
    // Two agents / roles would call the same reader with only Source + snapshot.
    const forAnalyst = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, snap);
    const forOperator = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, snap);
    expect([...forAnalyst.excluded].sort()).toEqual(["secret", "ssn"]);
    expect([...forOperator.excluded].sort()).toEqual([...forAnalyst.excluded].sort());
    expect(forAnalyst.digest).toBe(forOperator.digest);
    expect(forAnalyst.mode).toBe("trimmed");

    const denyAnalyst = validateQueryFieldsAgainstExposure(
      { connectionId: "demo", dimensions: [{ field: "orders.secret" }] },
      lookup,
      snap
    );
    const denyOperator = validateQueryFieldsAgainstExposure(
      { connectionId: "demo", dimensions: [{ field: "orders.secret" }] },
      lookup,
      snap
    );
    expect(denyAnalyst.denyReason).toBe(FIELD_NOT_EXPOSED);
    expect(denyOperator.denyReason).toBe(denyAnalyst.denyReason);
  });

  it("SC-12: lucyCatalog sources table list unchanged under trimmed exposure (trim ≠ hide tables)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "fe-sc12-cat-"));
    const prevProjectRoot = process.env.KTX_PROJECT_ROOT;
    const prevContentRoot = process.env.LUCY_CONTENT_ROOT;
    const prevAuditDb = process.env.LUCY_AUDIT_DB;
    try {
      process.env.KTX_PROJECT_ROOT = root;
      process.env.LUCY_CONTENT_ROOT = ".";
      delete process.env.LUCY_AUDIT_DB;
      invalidateContentPathsCache();
      resetEffectivePolicyForTests();
      resetFieldExposureRuntimeForTests();

      await writeProject(root, {
        "ktx.yaml": `connections:
  ${CONNECTION}:
    driver: mysql
    schemas:
      - ${SCHEMA}
    enabled_tables:
      - ${SCHEMA}.${VISIBLE}
`,
        "webui/config/access.yaml": accessYaml(["role_a_agent", "role_b_agent"], [
          `${SCHEMA}.${VISIBLE}`
        ]),
        [`semantic-layer/${CONNECTION}/_schema/${SCHEMA}.yaml`]: `tables:
  ${VISIBLE}:
    table: ${SCHEMA}.${VISIBLE}
    columns:
      - name: dt
      - name: secret
    descriptions:
      db: "visible orders"
`,
        [`semantic-layer/${CONNECTION}/${VISIBLE}.yaml`]: `name: ${VISIBLE}
table: ${SCHEMA}.${VISIBLE}
grain:
  - dt
`
      });

      const beforeA = await lucyCatalog(identity("role_a_agent"));
      const beforeB = await lucyCatalog(identity("role_b_agent"));
      const beforeKeys = beforeA.sources.map(
        (s) => `${s.connectionId}.${s.schema}.${s.sourceName}`
      );
      expect(beforeKeys).toEqual([`${CONNECTION}.${SCHEMA}.${VISIBLE}`]);
      expect(beforeB.sources.map((s) => s.sourceName)).toEqual(
        beforeA.sources.map((s) => s.sourceName)
      );

      // Activate trimmed exposure for the visible source — must NOT drop the table.
      const ledgerSrc = {
        connectionId: CONNECTION,
        schema: SCHEMA,
        sourceName: VISIBLE
      };
      const text = buildTestLedgerText(ledgerSrc, ["secret"]);
      const key = sourceKey(CONNECTION, SCHEMA, VISIBLE);
      const base = bootstrapEmptyServingGeneration("gen-sc12-cat");
      const parsed = parseLedgerYaml(text, ledgerSrc);
      const snap: ActivatedSnapshot = {
        ...base,
        generationId: "gen-sc12-cat",
        upstreamExecutionGenerationId: "gen-sc12-cat",
        admissionMode: "OPEN",
        expectedSetLoad: {
          state: "ready",
          set: new Set([key]),
          digest: "d",
          generationId: "gen-sc12-cat",
          expectedSetRequired: true
        },
        exposureLedgersBySource: new Map([[key, text]]),
        exposureDigestPerSource: new Map([[key, parsed.digest ?? "d"]])
      };
      pinServingGeneration(snap);

      const afterA = await lucyCatalog(identity("role_a_agent"));
      const afterB = await lucyCatalog(identity("role_b_agent"));
      expect(afterA.sources.map((s) => `${s.connectionId}.${s.schema}.${s.sourceName}`)).toEqual(
        beforeKeys
      );
      expect(afterB.sources.map((s) => s.sourceName)).toEqual(
        beforeA.sources.map((s) => s.sourceName)
      );
      // Trim ≠ hide: source still listed; examples may rewrite but member set stable.
      expect(afterA.sources).toHaveLength(beforeA.sources.length);
    } finally {
      resetFieldExposureRuntimeForTests();
      resetEffectivePolicyForTests();
      invalidateContentPathsCache();
      if (prevProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
      else process.env.KTX_PROJECT_ROOT = prevProjectRoot;
      if (prevContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
      else process.env.LUCY_CONTENT_ROOT = prevContentRoot;
      if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
      else process.env.LUCY_AUDIT_DB = prevAuditDb;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("SC-12 source lock: lucyCatalog builds sources from permissions; exposure only rewrites examples", async () => {
    const src = await readFile(ACL_PATH, "utf8");
    const start = src.indexOf("export async function lucyCatalog");
    const end = src.indexOf("export async function kxCatalog");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toContain("resolved.permissions.sources");
    expect(body).toContain("rewriteCatalogExamplesForExposure");
    expect(body).not.toMatch(/loadExposureSet\s*\(/);
    expect(body).not.toMatch(/applyDiscoveryTrim\s*\(/);
    // examples rewrite happens after sources are finalized
    expect(body.indexOf("finalSources")).toBeLessThan(
      body.indexOf("rewriteCatalogExamplesForExposure")
    );
  });
});

describe("SC-13 draft boundary + publish pending + Proxy对照", () => {
  let tmp: string;

  beforeEach(async () => {
    resetFieldExposureRuntimeForTests();
    tmp = await mkdtemp(path.join(os.tmpdir(), "fe-sc13-"));
  });

  afterEach(async () => {
    resetFieldExposureRuntimeForTests();
    await rm(tmp, { recursive: true, force: true });
  });

  it("SC-13: save without publish does not take effect — Proxy still sees prior activated exposure", async () => {
    // Activated: secret already trimmed.
    const activated = trimmedSnapshot(["secret"]);
    pinServingGeneration(activated);

    const before = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, activated);
    expect(before.mode).toBe("trimmed");
    expect([...before.excluded]).toEqual(["secret"]);
    expect(
      validateQueryFieldsAgainstExposure(
        { connectionId: "demo", dimensions: [{ field: "orders.secret" }] },
        lookup,
        activated
      ).denyReason
    ).toBe(FIELD_NOT_EXPOSED);

    // Workbench "toggle off trim" → draft only (would restore secret if published).
    await writeDraftExposure(
      {
        connectionId: SRC.connectionId,
        schema: SRC.schema,
        sourceName: SRC.sourceName,
        excluded_columns: [],
        updated_at: new Date().toISOString()
      },
      { projectRoot: tmp }
    );
    const draft = await readDraftExposure(SRC.connectionId, SRC.sourceName, {
      projectRoot: tmp
    });
    expect(draft?.excluded_columns).toEqual([]);

    // ServingGeneration / Proxy pin unchanged.
    const serving = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
    // Empty project serving file is bootstrap; pinned in-memory snapshot still governs pinServingGeneration callers.
    pinServingGeneration(activated);
    const after = loadExposureSet(SRC.connectionId, SRC.schema, SRC.sourceName, activated);
    expect([...after.excluded]).toEqual(["secret"]);
    expect(after.digest).toBe(before.digest);
    expect(
      validateQueryFieldsAgainstExposure(
        { connectionId: "demo", dimensions: [{ field: "orders.secret" }] },
        lookup,
        activated
      ).denyReason
    ).toBe(FIELD_NOT_EXPOSED);
    // Draft must not be merged into empty on-disk serving either.
    expect(serving.exposureLedgersBySource.has(sourceKey(SRC.connectionId, SRC.schema, SRC.sourceName))).toBe(
      false
    );
  });

  it("SC-13: writing draft does not change ServingGeneration generationId or ledgers", async () => {
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
    const after = await loadServingGeneration({ projectRoot: tmp, forceReload: true });
    expect(after.generationId).toBe(before.generationId);
    expect(after.exposureLedgersBySource.size).toBe(before.exposureLedgersBySource.size);
    expect(after.admissionMode).toBe(before.admissionMode);
  });

  it("SC-13: publish workbench pending classifies _exposure ledger as field_exposure", async () => {
    const prevContentRoot = process.env.LUCY_CONTENT_ROOT;
    process.env.LUCY_CONTENT_ROOT = ".";
    invalidateContentPathsCache();
    try {
      const ledgerPath = `semantic-layer/${SRC.connectionId}/_exposure/${SRC.sourceName}.yaml`;
      await writeProject(tmp, {
        [ledgerPath]: buildTestLedgerText(SRC, ["secret"])
      });
      expect(kindForLogicalPath(ledgerPath)).toBe("field_exposure");
      const snapshot = await readPublishPendingSnapshot(tmp);
      const pending = snapshot.changes.find((c) => c.logicalPath === ledgerPath);
      expect(pending).toBeDefined();
      expect(pending?.kind).toBe("field_exposure");
    } finally {
      if (prevContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
      else process.env.LUCY_CONTENT_ROOT = prevContentRoot;
      invalidateContentPathsCache();
    }
  });
});
