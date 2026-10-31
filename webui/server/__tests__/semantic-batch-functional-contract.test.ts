// L25-11 functional contract — the checks that were not already direct.
//
// FC-29: unauthenticated, invalid session, and another actor cannot consume
// the scope, check, export, import, and publish entries.
// FC-32: single-table validate, batch check, import pre-check, and the
// publish gate share runSemanticTableCheck.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdminsCache } from "../auth/admins-store.js";
import { resetSessionSecretCache } from "../auth/session.js";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

const KTX_YAML = `connections:
  shop-db:
    driver: postgres
    schemas:
      - public
    enabled_tables:
      - public.orders
`;

const MANIFEST = `tables:
  orders:
    table: public.orders
    columns:
      - name: id
        type: number
`;

const ORDERS = `name: orders
table: public.orders
grain:
  - id
`;

const ILLEGAL_ORDERS = `name: orders
table: public.orders
grain:
  - id
columns:
  - name: id
    type: not_a_type
`;

const ENTRIES: Array<{ method: "post"; url: string; body: Record<string, unknown> }> = [
  { method: "post", url: "/api/semantic-assets/scopes", body: { refs: [] } },
  { method: "post", url: "/api/semantic-assets/check", body: {} },
  { method: "post", url: "/api/semantic-assets/export", body: {} },
  { method: "post", url: "/api/semantic-assets/validate", body: {} },
  { method: "post", url: "/api/semantic-assets/publish", body: {} }
];

let projectRoot = "";
let previousRoot: string | undefined;
let previousAuth: string | undefined;
let previousAdmins: string | undefined;
let previousSecret: string | undefined;
let previousContentRoot: string | undefined;

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(header ?? "").split(";")[0] ?? "";
}

async function seedProject(): Promise<void> {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-fc-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "shop-db", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "webui", "config", "admins.yaml"), 'version: "1"\nadmins: []\n');
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "users: []\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML);
  await writeFile(path.join(projectRoot, "semantic-layer/shop-db/_schema/public.yaml"), MANIFEST);
  await writeFile(path.join(projectRoot, "semantic-layer/shop-db/orders.yaml"), ORDERS);
}

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

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuth = process.env.LUCY_WEBUI_AUTH;
  previousAdmins = process.env.LUCY_ADMINS_CONFIG_PATH;
  previousSecret = process.env.LUCY_WEBUI_SESSION_SECRET;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  await seedProject();
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_ADMINS_CONFIG_PATH = path.join(projectRoot, "webui", "config", "admins.yaml");
  process.env.LUCY_WEBUI_SESSION_SECRET = "test-session-secret-32bytes-min!!";
  delete process.env.LUCY_WEBUI_AUTH;
  resetAdminsCache();
  resetSessionSecretCache();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuth === undefined) delete process.env.LUCY_WEBUI_AUTH;
  else process.env.LUCY_WEBUI_AUTH = previousAuth;
  if (previousAdmins === undefined) delete process.env.LUCY_ADMINS_CONFIG_PATH;
  else process.env.LUCY_ADMINS_CONFIG_PATH = previousAdmins;
  if (previousSecret === undefined) delete process.env.LUCY_WEBUI_SESSION_SECRET;
  else process.env.LUCY_WEBUI_SESSION_SECRET = previousSecret;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  resetAdminsCache();
  resetSessionSecretCache();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("FC-29 authentication on the batch entries", () => {
  it("rejects a missing session and an invalid session on every entry", async () => {
    process.env.LUCY_WEBUI_AUTH = "required";
    mockKtx();
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();

    const boot = await request(app.server)
      .post("/api/auth/bootstrap")
      .send({ adminId: "xingchen", displayName: "星尘", password: "correct-horse" });
    expect(boot.status).toBe(200);

    for (const entry of ENTRIES) {
      const missing = await request(app.server)[entry.method](entry.url).send(entry.body);
      expect(missing.status, entry.url).toBe(401);
      expect(missing.body.error.code).toBe("AUTH_REQUIRED");

      const invalid = await request(app.server)
        [entry.method](entry.url)
        .set("cookie", "lucy_admin_session=not-a-session")
        .send(entry.body);
      expect(invalid.status, entry.url).toBe(401);
      expect(invalid.body.error.code).toBe("AUTH_REQUIRED");
    }
    await app.close();
  });

  it("refuses another actor on scope export, check, and publish", async () => {
    process.env.LUCY_WEBUI_AUTH = "required";
    mockKtx();
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();

    const boot = await request(app.server)
      .post("/api/auth/bootstrap")
      .send({ adminId: "xingchen", displayName: "星尘", password: "correct-horse" });
    expect(boot.status).toBe(200);
    const owner = sessionCookie(boot.headers["set-cookie"]);

    const created = await request(app.server)
      .post("/api/admin/admins")
      .set("cookie", owner)
      .send({ adminId: "ada", displayName: "Ada", password: "correct-horse" });
    expect(created.status).toBe(200);

    const login = await request(app.server)
      .post("/api/auth/login")
      .send({ adminId: "ada", password: "correct-horse" });
    expect(login.status).toBe(200);
    const other = sessionCookie(login.headers["set-cookie"]);

    const scope = await request(app.server)
      .post("/api/semantic-assets/scopes")
      .set("cookie", owner)
      .send({ refs: [{ connectionId: "shop-db", schema: "public", table: "orders" }] });
    expect(scope.status).toBe(200);
    const scopeId = scope.body.data.scopeId as string;

    const exported = await request(app.server)
      .post("/api/semantic-assets/export")
      .set("cookie", other)
      .send({ packageKind: "semantic-maintenance-package/v1", scopeId });
    expect(exported.status).toBe(409);
    expect(exported.body.error.code).toBe("SCOPE_ACTOR_MISMATCH");

    const checked = await request(app.server)
      .post("/api/semantic-assets/check")
      .set("cookie", other)
      .send({ scopeId });
    expect(checked.status).toBe(409);
    expect(checked.body.error.code).toBe("SCOPE_ACTOR_MISMATCH");

    const published = await request(app.server)
      .post("/api/semantic-assets/publish")
      .set("cookie", other)
      .send({ validationId: "val_someone_else", confirmOverwrite: true });
    expect(published.status).toBeGreaterThanOrEqual(400);
    expect(published.status).not.toBe(401);
    await app.close();
  });
});

describe("FC-32 shared legality", () => {
  it("fails the same illegal column on single-table validate, batch check, and import", async () => {
    mockKtx();
    const { buildServer } = await import("../index");
    const { buildSemanticModelIndex } = await import("../semantic-identity");
    const { runSemanticTableCheck } = await import("../semantic-checks");
    const app = buildServer();
    await app.ready();

    await writeFile(path.join(projectRoot, "semantic-layer/shop-db/orders.yaml"), ILLEGAL_ORDERS);
    const direct = await runSemanticTableCheck({
      projectRoot,
      index: await buildSemanticModelIndex(projectRoot),
      identity: { connectionId: "shop-db", schema: "public", table: "orders" }
    });
    expect(direct.verdict).toBe("failed");
    expect(direct.reasons.some((reason) => reason.code === "COLUMN_TYPE_CONTRACT")).toBe(true);

    const single = await request(app.server).post("/api/sources/shop-db/public/orders/validate");
    expect(single.status).toBe(200);
    expect(single.body.data.ok).toBe(false);
    expect(JSON.stringify(single.body.data.issues)).toContain("不符合");

    const scope = await request(app.server)
      .post("/api/semantic-assets/scopes")
      .send({ refs: [{ connectionId: "shop-db", schema: "public", table: "orders" }] });
    expect(scope.status).toBe(200);
    const started = await request(app.server)
      .post("/api/semantic-assets/check")
      .send({ scopeId: scope.body.data.scopeId });
    expect(started.status).toBe(202);

    let task: { status?: string; results?: Array<{ reasons?: Array<{ code?: string }> }> } = {};
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const polled = await request(app.server).get(
        `/api/semantic-assets/operations/${started.body.data.operationId}`
      );
      task = polled.body.data;
      if (task.status && task.status !== "queued" && task.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const codes = (task.results ?? []).flatMap((result) => result.reasons ?? []).map((reason) => reason.code);
    expect(codes).toContain("COLUMN_TYPE_CONTRACT");

    const publishGate = await readFile(new URL("../semantic-assets.ts", import.meta.url), "utf8");
    expect(publishGate).toContain("runSemanticTableCheck(");
    const batchRoute = await readFile(new URL("../semantic-batch-routes.ts", import.meta.url), "utf8");
    expect(batchRoute).toContain("runSemanticTableCheck(");
    const importer = await readFile(new URL("../semantic-batch-service.ts", import.meta.url), "utf8");
    expect(importer).toContain("runSemanticTableCheck(");
    const routes = await readFile(new URL("../index.ts", import.meta.url), "utf8");
    expect(routes.split("applySharedSemanticLegality(").length - 1).toBeGreaterThanOrEqual(3);

    await app.close();
  });

  it("rejects an illegal imported overlay before any formal write", async () => {
    mockKtx();
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    const before = await readFile(path.join(projectRoot, "semantic-layer/shop-db/orders.yaml"), "utf8");

    const scope = await request(app.server)
      .post("/api/semantic-assets/scopes")
      .send({ refs: [{ connectionId: "shop-db", schema: "public", table: "orders" }] });
    expect(scope.status).toBe(200);
    const exported = await request(app.server)
      .post("/api/semantic-assets/export")
      .send({ packageKind: "semantic-maintenance-package/v1", scopeId: scope.body.data.scopeId });
    expect(exported.status).toBe(200);
    const exportId = exported.body.data.exportId as string;
    const bytes = await readFile(path.join(projectRoot, ".ktx-ui/exports", `${exportId}.zip`));
    const { readZipEntries, buildMaintenanceZip } = await import("../semantic-maintenance-package");
    const files = readZipEntries(bytes).map((entry) => ({
      name: entry.name,
      data: entry.name === "overlays/shop-db/orders.yaml" ? Buffer.from(ILLEGAL_ORDERS) : entry.data
    }));
    const imported = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({
        packages: [{ filename: "maintenance.zip", contentBase64: buildMaintenanceZip(files).toString("base64") }]
      });
    expect(imported.status).toBe(400);
    expect(imported.body.error.message).toContain("导入预检未通过");
    expect(await readFile(path.join(projectRoot, "semantic-layer/shop-db/orders.yaml"), "utf8")).toBe(before);
    await app.close();
  });
});
