import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  createAuthFixture,
  loginCookie,
  startLucy,
  type AuthFixture,
  type RunningLucy
} from "./webui-auth-fixture";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";
import { writeWiki } from "../wiki";
import { writeSourcePatch } from "../semantic-layer";
import { systemActor, trustedActorFromRequest, ActorUnresolvedError } from "../security/request-actor";

// The semantic save/import routes shell out to the ktx CLI for validation; the actor tests do not need it.
vi.mock("../ktx", () => ({
  validateSource: vi.fn(async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", issues: [] }))
}));

const SCHEMA_REL = "semantic-layer/mysql-aliyun/_schema/dataforai.yaml";
const SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
    columns:
      - name: id
        type: number
    descriptions:
      ai: Demo table.
`;

type Row = {
  actor: string;
  actor_type: string;
  actor_ip: string | null;
  request_id: string | null;
  session_id: string | null;
  change_type: string;
  write_status: string;
};

async function configRows(): Promise<Row[]> {
  const db = await getAuditDb();
  return db
    .prepare(
      `SELECT actor, actor_type, actor_ip, request_id, session_id, change_type, write_status
         FROM config_change_log ORDER BY id`
    )
    .all() as Row[];
}

const json = async (res: Response) => (await res.json()) as { ok: boolean; data?: any; error?: any };

/** Drives every wiki and semantic-layer write route once, over real HTTP. */
async function exerciseWrites(base: string, cookie: string, tag: string, headers?: Record<string, string>) {
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { cookie, "content-type": "application/json", ...(headers ?? {}) },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {})
    });
    expect(res.status, `${method} ${url}`).toBe(200);
    return json(res);
  };
  const key = `global/${tag}.md`;
  const enc = encodeURIComponent(key);

  await call("PUT", `/api/wiki/${enc}`, { dryRun: false, content: "# one\n", actor: "root" });
  const v1 = (await call("GET", `/api/wiki/${enc}`)).data.file_version as string;
  await call("PUT", `/api/wiki/${enc}`, { dryRun: false, content: "# two\n", expected_version: v1, actor: "root" });
  const v2 = (await call("GET", `/api/wiki/${enc}`)).data.file_version as string;
  // Spec 193 §5.4 — the upload commit carries the original Markdown, an
  // explicit authorization selection and the preview digest.
  const uploadSelection = { mode: "preserve_current" } as const;
  const uploadPreview = await call("POST", "/api/wiki/upload/preview", {
    key,
    markdown: "# three\n",
    mode: "replace",
    expected_version: v2,
    access: uploadSelection
  });
  await call("POST", "/api/wiki/upload/commit", {
    key,
    markdown: "# three\n",
    mode: "replace",
    expected_version: v2,
    access: uploadSelection,
    // The target keeps its current (empty) authorization, so the "nobody can
    // read this yet" confirmation is required.
    confirmed_empty: true,
    preview_digest: uploadPreview.data.access.preview_digest,
    actor: "root"
  });
  const v3 = (await call("GET", `/api/wiki/${enc}`)).data.file_version as string;
  const versions = (await call("GET", `/api/wiki/${enc}/versions`)).data.versions as Array<{ versionId: string }>;
  await call("POST", `/api/wiki/${enc}/versions/${versions.at(-1)!.versionId}/restore`, {
    expected_version: v3
  });
  const v4 = (await call("GET", `/api/wiki/${enc}`)).data.file_version as string;
  await call("POST", `/api/wiki/${enc}/move`, { targetDirectory: "ops", expected_version: v4 });

  const src = "/api/sources/mysql-aliyun/dataforai/superstore_orders";
  await call("PUT", src, { dryRun: false, patch: { tableDescription: `Saved by ${tag}.` } });
  await call("POST", `${src}/import`, {
    dryRun: false,
    yaml: `table: dataforai.superstore_orders\ncolumns:\n  - name: id\n    type: number\ndescriptions:\n  human: Imported by ${tag}.\n`
  });
}

const WRITE_TYPES = [
  "wiki_create",
  "wiki_edit_save",
  "wiki_upload_replace",
  "wiki_restore",
  "wiki_move",
  "semantic_table_save",
  "semantic_table_import"
];

describe("T08-1 trusted actor propagation (customer / auth required)", () => {
  let fx: AuthFixture;
  let lucy: RunningLucy;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    fx = await createAuthFixture({ secret: "env" });
    savedEnv.LUCY_CONTENT_ROOT = process.env.LUCY_CONTENT_ROOT;
    savedEnv.LUCY_TRUST_PROXY = process.env.LUCY_TRUST_PROXY;
    savedEnv.LUCY_AUDIT_DB = process.env.LUCY_AUDIT_DB;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = path.join(fx.root, "audit.sqlite");
    delete process.env.LUCY_TRUST_PROXY;
    await mkdir(path.join(fx.root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    await writeFile(path.join(fx.root, SCHEMA_REL), SCHEMA_YAML, "utf8");
    resetAuditDbForTests();
    await fx.writeAdmins([
      { id: "alice", role: "owner" },
      { id: "bob", role: "operator" }
    ]);
    lucy = await startLucy();
  });

  afterEach(async () => {
    await lucy.stop();
    resetAuditDbForTests();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fx.restore();
  });

  for (const [adminId] of [["alice"], ["bob"]] as const) {
    it(`attributes every wiki and semantic write by ${adminId} to ${adminId}, never local-admin`, async () => {
      const cookie = await loginCookie(lucy.baseUrl, adminId);
      await exerciseWrites(lucy.baseUrl, cookie, `${adminId}-doc`);

      const rows = (await configRows()).filter((row) => WRITE_TYPES.includes(row.change_type));
      expect(new Set(rows.map((row) => row.change_type))).toEqual(new Set(WRITE_TYPES));
      for (const row of rows) {
        expect(row.actor, row.change_type).toBe(adminId);
        expect(row.actor_type, row.change_type).toBe("ui_admin");
        expect(row.actor_ip, row.change_type).toMatch(/127\.0\.0\.1$/);
        expect(row.request_id, row.change_type).toBeTruthy();
        expect(row.session_id, row.change_type).toBeTruthy();
        expect(row.write_status, row.change_type).toBe("committed");
      }
    });
  }

  it("attributes Skill create and wiki delete by an operator to that operator", async () => {
    const cookie = await loginCookie(lucy.baseUrl, "bob");
    const created = await api(lucy.baseUrl, "POST", "/api/skills", cookie, {
      name: "t08-skill",
      domain: "acceptance",
      title: "T08 Skill",
      status: "draft",
      content: "# Hello\n"
    });
    expect(created.status).toBe(201);
    await api(lucy.baseUrl, "PUT", "/api/wiki/global%2Ft08-del.md", cookie, { dryRun: false, content: "# del\n" });
    // Spec 193 — the structural delete carries the document version it expects
    // to remove.
    const delPage = await api(lucy.baseUrl, "GET", "/api/wiki/global%2Ft08-del.md", cookie);
    const delVersion = (await delPage.json()).data.file_version as string;
    const deleted = await api(
      lucy.baseUrl,
      "DELETE",
      `/api/wiki/global%2Ft08-del.md?expected_version=${encodeURIComponent(delVersion)}`,
      cookie
    );
    expect(deleted.status).toBe(200);
    const rows = (await configRows()).filter((row) => ["skill_create", "wiki_delete"].includes(row.change_type));
    expect(rows.map((row) => row.change_type).sort()).toEqual(["skill_create", "wiki_delete"]);
    for (const row of rows) expect(row.actor, row.change_type).toBe("bob");
  });

  it("lets neither body.actor nor forwarded/device headers change the attributed actor or address", async () => {
    process.env.LUCY_TRUST_PROXY = "1";
    const cookie = await loginCookie(lucy.baseUrl, "bob");
    await exerciseWrites(lucy.baseUrl, cookie, "forged", {
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "203.0.113.10",
      "x-lucy-actor": "alice",
      "x-lucy-device-name": "alice-laptop",
      "user-agent": "alice-browser/1.0"
    });
    const rows = (await configRows()).filter((row) => WRITE_TYPES.includes(row.change_type));
    expect(rows.length).toBeGreaterThanOrEqual(WRITE_TYPES.length);
    for (const row of rows) {
      expect(row.actor, row.change_type).toBe("bob");
      expect(row.actor_ip ?? "", row.change_type).not.toContain("203.0.113");
    }
  });

  it("records a service-level write without a request as the system actor, not local-admin", async () => {
    await writeWiki(fx.root, "global/background.md", { content: "# bg\n" });
    await writeSourcePatch(fx.root, "mysql-aliyun", "dataforai", "superstore_orders", {
      tableDescription: "Written by a background task."
    });
    const rows = await configRows();
    const bg = rows.filter((row) => row.change_type === "wiki_create" || row.change_type === "semantic_table_save");
    expect(new Set(bg.map((row) => row.change_type))).toEqual(new Set(["wiki_create", "semantic_table_save"]));
    for (const row of bg) {
      expect(row.actor).toBe("system");
      expect(row.actor_type).toBe("system");
    }
  });

  it("refuses to resolve an actor for a request that is not authenticated in required mode", () => {
    const anonymous = {
      id: "req-x",
      socket: { remoteAddress: "127.0.0.1" },
      lucyAdmin: { session: null, admin: null, stateUnavailable: false, authMode: "required" }
    } as never;
    expect(() => trustedActorFromRequest(anonymous)).toThrow(ActorUnresolvedError);
    const unclassified = { id: "req-y", socket: {} } as never;
    expect(() => trustedActorFromRequest(unclassified)).toThrow(ActorUnresolvedError);
    expect(systemActor("scrub-tool")).toMatchObject({ actorId: "scrub-tool", actorType: "system" });
  });
});

describe("T08-1 open (development) mode keeps an explicit local-admin actor", () => {
  let fx: AuthFixture;
  let lucy: RunningLucy;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    fx = await createAuthFixture({ secret: "env" });
    for (const key of ["LUCY_CONTENT_ROOT", "LUCY_DEPLOYMENT_MODE", "LUCY_WEBUI_AUTH", "LUCY_AUDIT_DB"]) {
      savedEnv[key] = process.env[key];
    }
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = path.join(fx.root, "audit.sqlite");
    process.env.LUCY_DEPLOYMENT_MODE = "development";
    process.env.LUCY_WEBUI_AUTH = "off";
    await mkdir(path.join(fx.root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    await writeFile(path.join(fx.root, SCHEMA_REL), SCHEMA_YAML, "utf8");
    resetAuditDbForTests();
    lucy = await startLucy();
  });

  afterEach(async () => {
    await lucy.stop();
    resetAuditDbForTests();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fx.restore();
  });

  it("records open-mode writes as local-admin (deployment-local) with request correlation", async () => {
    const res = await api(lucy.baseUrl, "PUT", "/api/wiki/global%2Fopen.md", undefined, {
      dryRun: false,
      content: "# open\n"
    });
    expect(res.status).toBe(200);
    const row = (await configRows()).find((r) => r.change_type === "wiki_create");
    expect(row).toMatchObject({ actor: "local-admin", actor_type: "ui_admin" });
    expect(row?.request_id).toBeTruthy();
  });
});
