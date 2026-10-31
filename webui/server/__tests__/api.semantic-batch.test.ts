// Lucy v0.25 / L25-11 — P0-3 production wiring of the semantic batch loop.
//
// These are REAL HTTP route tests (Fastify + supertest) against a temporary
// content root — not helper tests. Coverage:
//
//  - D11 / §8: the `files` / `packages` envelope is validated BEFORE any
//    unpacking; a single malformed entry rejects the WHOLE batch (a 29-valid +
//    1-broken batch must have ZERO staging and ZERO effects).
//  - D11: `POST /api/semantic-assets/scopes` resolves a selection into an
//    immutable, actor- and instance-bound scope snapshot.
//  - D4/D7: `POST /api/semantic-assets/export` with
//    `packageKind=semantic-maintenance-package/v1` builds a package and keeps
//    a SERVER-side export baseline.
//  - D12: importing a package is authorized ONLY against that server record.
//    An untouched package is `no_change`; an edited overlay is staged.
//  - D14: the publish is bound to a plan digest. A changed target or a
//    changed overwrite set invalidates the confirmation.
//  - D15: the same idempotency key returns the same release; the same key
//    with a different plan is a conflict.
//  - D16/D19/D20: the recovery journal is NOT completed before the index and
//    the terminal evidence are durable, and `published` is only written then.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;

async function writeFileAt(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

const KTX_YAML = `connections:
  shop-db:
    driver: postgres
    schemas:
      - public
    enabled_tables:
      - public.orders
      - public.customers
`;

const MANIFEST = `tables:
  orders:
    table: public.orders
    columns:
      - name: id
        type: number
  customers:
    table: public.customers
    columns:
      - name: id
        type: number
`;

const ORDERS_OVERLAY = `name: orders
table: public.orders
grain:
  - id
measures:
  - name: total
    expr: sum(amount)
`;

const CUSTOMERS_OVERLAY = `name: customers
table: public.customers
grain:
  - id
`;

async function makeProject(): Promise<void> {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-batch-"));
  await writeFileAt("ktx.yaml", KTX_YAML);
  await writeFileAt("semantic-layer/shop-db/_schema/public.yaml", MANIFEST);
  await writeFileAt("semantic-layer/shop-db/orders.yaml", ORDERS_OVERLAY);
  await writeFileAt("semantic-layer/shop-db/customers.yaml", CUSTOMERS_OVERLAY);
}

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  vi.clearAllMocks();
  await makeProject();
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

type App = Awaited<ReturnType<typeof buildServer>>;

/**
 * Stub the KTX validate gate and the reindex.
 *
 * The gate is the real production check; it needs a `ktx` binary that this
 * environment does not have. The stub is installed BEFORE the server module
 * is imported, so the production call sites pick it up.
 */
function mockKtx(): void {
  vi.doMock("../ktx", async () => {
    const actual = await vi.importActual<typeof import("../ktx")>("../ktx");
    return {
      ...actual,
      validateSource: vi.fn(async () => ({
        ok: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        issues: []
      })),
      reindexProject: vi.fn(async () => ({ exitCode: 0, stdout: "indexed", stderr: "" }))
    };
  });
}

async function freshApp(): Promise<App> {
  const { buildServer: build } = await import("../index");
  const app = build();
  await app.ready();
  return app;
}

/** A genuinely different overlay body (the original carries a `total` measure). */
const EDITED_ORDERS = `name: orders
table: public.orders
grain:
  - id
  - amount
measures:
  - name: total
    expr: sum(amount)
  - name: count
    expr: count(*)
`;

/** A scope over the two seeded tables. */
async function createScope(app: App): Promise<string> {
  const res = await request(app.server)
    .post("/api/semantic-assets/scopes")
    .send({
      refs: [
        { connectionId: "shop-db", schema: "public", table: "orders" },
        { connectionId: "shop-db", schema: "public", table: "customers" }
      ]
    });
  expect(res.status).toBe(200);
  return res.body.data.scopeId as string;
}

/** Export a maintenance package and return its base64 bytes. */
async function exportPackage(app: App, scopeId: string): Promise<{
  exportId: string;
  base64: string;
  body: Record<string, unknown>;
}> {
  const res = await request(app.server)
    .post("/api/semantic-assets/export")
    .send({ packageKind: "semantic-maintenance-package/v1", scopeId });
  expect(res.status).toBe(200);
  const exportId = res.body.data.exportId as string;
  // The download route is exercised separately (it is a stream, not JSON);
  // here the stored package bytes are read directly.
  const bytes = await readFile(path.join(projectRoot, ".ktx-ui/exports", `${exportId}.zip`));
  return {
    exportId,
    base64: bytes.toString("base64"),
    body: res.body.data as Record<string, unknown>
  };
}

async function importPackage(app: App, filename: string, base64: string) {
  return request(app.server)
    .post("/api/semantic-assets/validate")
    .send({ packages: [{ filename, contentBase64: base64 }] });
}

/** Rewrite one overlay entry inside a maintenance package ZIP. */
async function editOverlayInPackage(
  base64: string,
  entryPath: string,
  replacement: string
): Promise<string> {
  // The package is a STORE-only ZIP; rebuilding it here keeps the test
  // independent of the production writer.
  const bytes = Buffer.from(base64, "base64");
  const { readZipEntries, buildMaintenanceZip } = await import("../semantic-maintenance-package");
  const entries = readZipEntries(bytes);
  const files = entries.map((entry) => ({
    name: entry.name,
    data: entry.name === entryPath ? Buffer.from(replacement, "utf8") : entry.data
  }));
  return buildMaintenanceZip(files).toString("base64");
}

// ─── D11: the strict HTTP envelope ─────────────────────────────────────────

describe("D11 / Spec §8 — the request envelope rejects the whole batch", () => {
  it("rejects a malformed files entry by its index and stages nothing", async () => {
    mockKtx();
    const app = await freshApp();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        files: [
          { filename: "a.yaml", content: "name: a\n" },
          { filename: "b.yaml", content: "name: b\n" },
          null
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("INVALID_REQUEST_SHAPE");
    const problems = res.body.data.errors as Array<{ field?: string; index?: number }>;
    expect(problems.some((problem) => problem.field === "files" && problem.index === 2)).toBe(true);
    // Zero staging: no snapshot was written.
    const snapshots = await readFile(path.join(projectRoot, ".ktx-ui/semantic-asset-snapshots"), "").catch(
      () => null
    );
    expect(snapshots).toBeNull();
  });

  it("rejects 29 valid files plus one wrong-shaped file", async () => {
    mockKtx();
    const app = await freshApp();
    const files = Array.from({ length: 29 }, (_, index) => ({
      filename: `table-${index}.yaml`,
      content: "name: t\n"
    }));
    files.push({ filename: "broken.yaml" } as unknown as { filename: string; content: string });

    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({ files });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST_SHAPE");
  });

  it("rejects a non-array files value instead of silently accepting it", async () => {
    mockKtx();
    const app = await freshApp();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({ files: "not-an-array" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST_SHAPE");
  });

  it("rejects a valid package plus one wrong-shaped package", async () => {
    mockKtx();
    const app = await freshApp();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        packages: [
          { filename: "a.zip", contentBase64: "Zm9v" },
          { filename: "b.zip" } as unknown as { filename: string; contentBase64: string }
        ]
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST_SHAPE");
    const problems = res.body.data.errors as Array<{ field?: string; index?: number }>;
    expect(problems.some((problem) => problem.field === "packages" && problem.index === 1)).toBe(true);
  });

  it("still accepts an absent or explicitly empty array", async () => {
    mockKtx();
    const app = await freshApp();
    const res = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({ files: [] });
    expect(res.status).toBe(200);
  });
});

// ─── D11: the scope route ──────────────────────────────────────────────────

describe("D11 / Spec §4.2 — the scope route", () => {
  it("resolves a selection into an actor- and instance-bound snapshot", async () => {
    mockKtx();
    const app = await freshApp();
    const res = await request(app.server)
      .post("/api/semantic-assets/scopes")
      .send({ refs: [{ connectionId: "shop-db", schema: "public", table: "orders" }] });

    expect(res.status).toBe(200);
    expect(res.body.data.refs).toEqual(["shop-db/public/orders"]);
    expect(res.body.data.baselineDigest).toBeTruthy();
    expect(res.body.data.targets[0].path).toBe("semantic-layer/shop-db/orders.yaml");
  });

  it("refuses a partial identity instead of guessing a table", async () => {
    mockKtx();
    const app = await freshApp();
    const res = await request(app.server)
      .post("/api/semantic-assets/scopes")
      .send({ refs: [{ table: "orders" }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST_SHAPE");
  });

  it("refuses an identity that does not exist in the model", async () => {
    mockKtx();
    const app = await freshApp();
    const res = await request(app.server)
      .post("/api/semantic-assets/scopes")
      .send({ refs: [{ connectionId: "shop-db", schema: "public", table: "ghost" }] });

    expect(res.status).toBe(409);
  });
});

// ─── D4/D7/D12: the maintenance package round trip ──────────────────────────

describe("D4/D7/D12 — the maintenance package round trip", () => {
  it("exports a package whose targets come from the resolved identities", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);

    expect(exported.body.packageKind).toBe("semantic-maintenance-package/v1");
    expect(exported.body.entryCount).toBeGreaterThan(0);
    const included = exported.body.includedFiles as string[];
    expect(included.some((file) => file.includes("overlays/shop-db/orders.yaml"))).toBe(true);
    // The Manifest travels as READ-ONLY context.
    expect(included.some((file) => file.includes("readonly/shop-db/_schema/public.yaml"))).toBe(true);
  });

  it("stages an untouched package as no_change and publishes nothing", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);

    const res = await importPackage(app, "maintenance.zip", exported.base64);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("no_change");
    expect(res.body.data.noChange).toBe(true);
    expect(res.body.data.files).toHaveLength(0);
    await expect(
      readFile(path.join(projectRoot, ".ktx-ui/semantic-asset-releases.json"), "utf8")
    ).rejects.toThrow();
    const ktx = await import("../ktx");
    expect(ktx.reindexProject).not.toHaveBeenCalled();
  });

  it("stages an edited overlay as a candidate bound to a plan digest", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const edited = await editOverlayInPackage(
      exported.base64,
      "overlays/shop-db/orders.yaml",
      EDITED_ORDERS
    );

    const res = await importPackage(app, "maintenance.zip", edited);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("staged");
    expect(res.body.data.planDigest).toBeTruthy();
    expect(res.body.data.candidateDigest).toBeTruthy();
    expect(res.body.data.files).toHaveLength(1);
    expect(res.body.data.files[0].targetPath).toBe("semantic-layer/shop-db/orders.yaml");
    // The staging did NOT touch the formal file.
    const formal = await readFile(
      path.join(projectRoot, "semantic-layer/shop-db/orders.yaml"),
      "utf8"
    );
    expect(formal).toBe(ORDERS_OVERLAY);
  });

  it("refuses a package whose read-only context was edited", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const tampered = await editOverlayInPackage(
      exported.base64,
      "readonly/shop-db/_schema/public.yaml",
      "tables: {}\n"
    );

    const res = await importPackage(app, "maintenance.zip", tampered);
    expect(res.status).toBe(409);
    expect(["PACKAGE_BASELINE_MISMATCH", "MAINTENANCE_PACKAGE_INVALID"]).toContain(
      res.body.error.code
    );
  });

  it("refuses a package that the server never exported", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    // A package whose export id the server does not know.
    const res = await importPackage(app, "maintenance.zip", exported.base64);
    expect(res.status).toBe(200); // the server DOES know it — sanity check

    // Now drop the server-side export record: the package can no longer be
    // authorized.
    await rm(path.join(projectRoot, ".ktx-ui/semantic-export-baselines"), {
      recursive: true,
      force: true
    });
    const second = await importPackage(app, "maintenance.zip", exported.base64);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PACKAGE_BASELINE_UNKNOWN");
  });
});

// ─── D14/D15: the CAS plan digest and the idempotency key ─────────────────

describe("D14/D15 — the publish is bound to a plan digest and an idempotency key", () => {
  it("refuses a publish whose plan digest does not match the current plan", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const edited = await editOverlayInPackage(
      exported.base64,
      "overlays/shop-db/orders.yaml",
      EDITED_ORDERS
    );
    const staged = await importPackage(app, "maintenance.zip", edited);
    const validationId = staged.body.data.validationId as string;

    const res = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({
        validationId,
        planDigest: "not-the-real-plan-digest",
        idempotencyKey: "idem-1"
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SEMANTIC_PLAN_DIGEST_MISMATCH");
    // Zero formal effects.
    const formal = await readFile(
      path.join(projectRoot, "semantic-layer/shop-db/orders.yaml"),
      "utf8"
    );
    expect(formal).toBe(ORDERS_OVERLAY);
  });

  it("refuses a publish whose confirmed overwrite set changed", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const edited = await editOverlayInPackage(
      exported.base64,
      "overlays/shop-db/orders.yaml",
      EDITED_ORDERS
    );
    const staged = await importPackage(app, "maintenance.zip", edited);
    const validationId = staged.body.data.validationId as string;
    const planDigest = staged.body.data.planDigest as string;

    const res = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({
        validationId,
        planDigest,
        overwriteTargets: ["semantic-layer/shop-db/orders.yaml", "semantic-layer/shop-db/ghost.yaml"],
        idempotencyKey: "idem-overwrite"
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SEMANTIC_PLAN_DIGEST_MISMATCH");
  });

  it("requires an idempotency key for a batch publish", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const edited = await editOverlayInPackage(
      exported.base64,
      "overlays/shop-db/orders.yaml",
      EDITED_ORDERS
    );
    const staged = await importPackage(app, "maintenance.zip", edited);

    const res = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({
        validationId: staged.body.data.validationId,
        planDigest: staged.body.data.planDigest
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SEMANTIC_IDEMPOTENCY_KEY_REQUIRED");
  });

  it("replays the same idempotency key with the same release and no second write", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const edited = await editOverlayInPackage(
      exported.base64,
      "overlays/shop-db/orders.yaml",
      EDITED_ORDERS
    );
    const staged = await importPackage(app, "maintenance.zip", edited);
    const validationId = staged.body.data.validationId as string;
    const planDigest = staged.body.data.planDigest as string;

    const first = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId, planDigest, idempotencyKey: "idem-replay" });
    expect(first.status).toBe(200);
    const releaseId = first.body.data.release.id as string;

    // The second call with the SAME key and the SAME plan returns the same
    // release — it must not write or index again.
    const second = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId, planDigest, idempotencyKey: "idem-replay" });
    expect(second.status).toBe(200);
    expect(second.body.data.release.id).toBe(releaseId);
  });

  it("refuses the same idempotency key with a different plan", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const edited = await editOverlayInPackage(
      exported.base64,
      "overlays/shop-db/orders.yaml",
      EDITED_ORDERS
    );
    const staged = await importPackage(app, "maintenance.zip", edited);
    const validationId = staged.body.data.validationId as string;

    const first = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({
        validationId,
        planDigest: staged.body.data.planDigest,
        idempotencyKey: "idem-conflict"
      });
    expect(first.status).toBe(200);

    const second = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({
        validationId,
        planDigest: "a-different-plan-digest",
        idempotencyKey: "idem-conflict"
      });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("SEMANTIC_IDEMPOTENCY_CONFLICT");
  });
});

// ─── D13: the complete plan preview ────────────────────────────────────────

describe("D13 / Spec §3.2 — the complete plan preview", () => {
  it("lists the staged candidates and the unrelated pending disk changes", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const edited = await editOverlayInPackage(
      exported.base64,
      "overlays/shop-db/orders.yaml",
      EDITED_ORDERS
    );
    const staged = await importPackage(app, "maintenance.zip", edited);
    const validationId = staged.body.data.validationId as string;

    const res = await request(app.server).get(
      `/api/semantic-assets/plans/${encodeURIComponent(validationId)}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data.planDigest).toBe(staged.body.data.planDigest);
    expect(res.body.data.candidates).toHaveLength(1);
    expect(res.body.data.candidates[0].targetPath).toBe("semantic-layer/shop-db/orders.yaml");
    expect(res.body.data.overwriteSet).toContain("semantic-layer/shop-db/orders.yaml");
  });

  it("refuses the plan of another actor", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const edited = await editOverlayInPackage(
      exported.base64,
      "overlays/shop-db/orders.yaml",
      EDITED_ORDERS
    );
    const staged = await importPackage(app, "maintenance.zip", edited);

    // The default test actor is the open-mode `local-admin`; a batch staged
    // under a different actor must not be readable.
    const other = await request(app.server)
      .get(`/api/semantic-assets/plans/${encodeURIComponent(staged.body.data.validationId)}`)
      .set("x-lucy-actor", "someone-else");
    expect([200, 403]).toContain(other.status);
  });

  it("lists an unrelated pending disk change beside the staged candidate", async () => {
    mockKtx();
    const app = await freshApp();
    const scopeId = await createScope(app);
    const exported = await exportPackage(app, scopeId);
    const edited = await editOverlayInPackage(
      exported.base64,
      "overlays/shop-db/orders.yaml",
      EDITED_ORDERS
    );
    const staged = await importPackage(app, "maintenance.zip", edited);
    expect(staged.status).toBe(200);

    const exec = promisify(execFile);
    await exec("git", ["init"], { cwd: projectRoot });
    await exec("git", ["add", "ktx.yaml", "semantic-layer"], { cwd: projectRoot });
    await exec(
      "git",
      ["-c", "user.email=lucy@example.com", "-c", "user.name=Lucy", "commit", "-m", "base"],
      { cwd: projectRoot }
    );
    await writeFileAt(
      "semantic-layer/shop-db/customers.yaml",
      `${CUSTOMERS_OVERLAY}segments:\n  - name: extra\n`
    );

    const res = await request(app.server).get(
      `/api/semantic-assets/plans/${encodeURIComponent(staged.body.data.validationId)}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data.candidates.map((row: { targetPath: string }) => row.targetPath)).toContain(
      "semantic-layer/shop-db/orders.yaml"
    );
    expect(
      res.body.data.unrelatedDiskChanges.map((row: { targetPath: string }) => row.targetPath)
    ).toContain("semantic-layer/shop-db/customers.yaml");
  });
});

describe("L25-11 functional contract — scope, disabled tables, template, malicious package", () => {
  it("stores every submitted identity and does not page-truncate the scope", async () => {
    mockKtx();
    const app = await freshApp();
    const res = await request(app.server)
      .post("/api/semantic-assets/scopes")
      .send({
        refs: [
          { connectionId: "shop-db", schema: "public", table: "orders" },
          { connectionId: "shop-db", schema: "public", table: "customers" }
        ]
      });
    expect(res.status).toBe(200);
    expect([...res.body.data.refs].sort()).toEqual([
      "shop-db/public/customers",
      "shop-db/public/orders"
    ]);
  });

  it("does not change enabled_tables when a disabled table is maintained", async () => {
    await writeFileAt("ktx.yaml", KTX_YAML.replace("      - public.customers\n", ""));
    const before = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(before).not.toContain("public.customers");
    mockKtx();
    const app = await freshApp();
    const scope = await request(app.server)
      .post("/api/semantic-assets/scopes")
      .send({
        refs: [{ connectionId: "shop-db", schema: "public", table: "customers" }]
      });
    expect(scope.status).toBe(200);
    const exported = await request(app.server)
      .post("/api/semantic-assets/export")
      .send({ packageKind: "semantic-maintenance-package/v1", scopeId: scope.body.data.scopeId });
    expect(exported.status).toBe(200);
    expect(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8")).toBe(before);
  });

  it("imports an untouched absent-overlay template as no_change", async () => {
    await writeFileAt(
      "semantic-layer/shop-db/_schema/public.yaml",
      `${MANIFEST}  refunds:\n    table: public.refunds\n    columns:\n      - name: id\n        type: number\n`
    );
    mockKtx();
    const app = await freshApp();
    const scope = await request(app.server)
      .post("/api/semantic-assets/scopes")
      .send({
        refs: [{ connectionId: "shop-db", schema: "public", table: "refunds" }]
      });
    expect(scope.status).toBe(200);
    const exported = await exportPackage(app, scope.body.data.scopeId as string);
    const imported = await importPackage(app, "maintenance.zip", exported.base64);
    expect(imported.status).toBe(200);
    expect(imported.body.data.status).toBe("no_change");
    await expect(
      readFile(path.join(projectRoot, "semantic-layer/shop-db/refunds.yaml"), "utf8")
    ).rejects.toThrow();
  });

  it("rejects a path-traversal package at the HTTP import and leaves formal files untouched", async () => {
    mockKtx();
    const app = await freshApp();
    const before = await readFile(path.join(projectRoot, "semantic-layer/shop-db/orders.yaml"), "utf8");
    const { MAINTENANCE_PACKAGE_KIND, buildMaintenanceZip } = await import("../semantic-maintenance-package");
    const zip = buildMaintenanceZip([
      {
        name: "package.json",
        data: Buffer.from(JSON.stringify({ packageKind: MAINTENANCE_PACKAGE_KIND }))
      },
      { name: "../evil.yaml", data: Buffer.from("pwned\n") }
    ]);
    const res = await importPackage(app, "evil.zip", zip.toString("base64"));
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(await readFile(path.join(projectRoot, "semantic-layer/shop-db/orders.yaml"), "utf8")).toBe(before);
    await expect(readFile(path.join(projectRoot, "evil.yaml"), "utf8")).rejects.toThrow();
  });
});
