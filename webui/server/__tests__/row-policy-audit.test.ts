import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";

/**
 * Lucy v0.25 — L25-14 R4 行权限配置审计 (§3.4 / §5.3 / §7, V15).
 *
 * The durable audit MECHANISM already exists (Wave 1a: durable intent → atomic
 * write → runtime commit/ack → durable terminal, inside the shared publish
 * coordinator). This test proves the row-policy ATTRIBUTION:
 *  - the Role / row-policy save records the table identity, the before/after
 *    digest and the affected Agent count in the existing `config_change_log`
 *    channel;
 *  - a terminal that cannot be persisted reverts the configuration.
 */

const hooks = vi.hoisted(() => ({
  /** Make the terminal write of the row-policy audit record fail. */
  failTerminal: false
}));

vi.mock("../admin/audit.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../admin/audit")>();
  return {
    ...actual,
    updateConfigChangeStatus: vi.fn(async (...args: Parameters<typeof actual.updateConfigChangeStatus>) => {
      const input = args[0];
      if (hooks.failTerminal && input.writeStatus === "committed") {
        const db = await actual.getAuditDb();
        const row = db
          .prepare("SELECT change_type FROM config_change_log WHERE id = ?")
          .get(input.id) as { change_type: string } | undefined;
        if (row?.change_type === "row_policy_update") {
          throw new Error("injected: row policy terminal audit write failed");
        }
      }
      return actual.updateConfigChangeStatus(...args);
    })
  };
});

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
`;

const FIN_SCHEMA_YAML = `tables:
  fin_ledger:
    table: fin.fin_ledger
    columns:
      - name: region
      - name: category
`;

const ACCESS_YAML = `roles:
  analyst:
    description: Analyst role
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
          row_access: all
      tools:
        - lucy_query
users:
  - id: zhangsan
    name: 张三
    enabled: true
    role: analyst
    tokens: []
defaults:
  deny_tools: []
`;

type AuditRow = {
  id: number;
  change_type: string;
  operation: string | null;
  target_id: string | null;
  request_id: string | null;
  write_status: string;
  error_reason: string | null;
  actor: string;
  old_summary: string | null;
  new_summary: string | null;
};

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-row-policy-audit-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
    FIN_SCHEMA_YAML,
    "utf8"
  );
  return root;
}

async function auditRows(): Promise<AuditRow[]> {
  const { getAuditDb } = await import("../admin/audit");
  const db = await getAuditDb();
  return db
    .prepare(
      `SELECT id, change_type, operation, target_id, request_id, write_status, error_reason,
              actor, old_summary, new_summary
         FROM config_change_log ORDER BY id`
    )
    .all() as AuditRow[];
}

function scopedPatch(value: string) {
  return {
    dryRun: false,
    patch: {
      allow: {
        connections: ["warehouse"],
        tableSelectors: [
          {
            connection: "warehouse",
            schema: "fin",
            names: ["fin_ledger"],
            row_access: "scoped",
            row_policy: { predicates: [{ field: "region", op: "eq", value }] }
          }
        ],
        tools: ["lucy_query"]
      }
    }
  };
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  projectRoot = await makeProject();
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  hooks.failTerminal = false;
});

afterEach(async () => {
  const { resetAuditDbForTests } = await import("../admin/audit");
  resetAuditDbForTests();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("R4 行权限配置审计 — row-policy attribution in the existing audit channel", () => {
  it("records the table identity, the before/after digest and the affected Agent count", async () => {
    const app = buildServer();
    await app.ready();

    const res = await request(app.server)
      .patch("/api/admin/roles/analyst")
      .send(scopedPatch("East"))
      .expect(200);

    expect(res.body.data.written).toBe(true);
    expect(res.body.data.auditId).toBeGreaterThan(0);
    expect(res.body.data.rowPolicy).toMatchObject({
      tables: [{ connection: "warehouse", schema: "fin", name: "fin_ledger" }],
      affectedAgentCount: 1
    });
    expect(res.body.data.rowPolicy.beforeDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.data.rowPolicy.afterDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.data.rowPolicy.beforeDigest).not.toBe(res.body.data.rowPolicy.afterDigest);

    const rows = (await auditRows()).filter((row) => row.change_type === "row_policy_update");
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.operation).toBe("row_policy.update");
    expect(row.target_id).toBe("analyst");
    expect(row.write_status).toBe("committed");
    expect(row.error_reason).toBeNull();

    const oldSummary = JSON.parse(row.old_summary ?? "{}") as {
      rowPolicy?: {
        operationId?: string;
        tables?: unknown;
        beforeDigest?: string;
        affectedAgentCount?: number;
      };
    };
    const newSummary = JSON.parse(row.new_summary ?? "{}") as {
      rowPolicy?: {
        operationId?: string;
        tables?: unknown;
        beforeDigest?: string;
        afterDigest?: string;
        affectedAgentCount?: number;
      };
    };
    expect(oldSummary.rowPolicy?.operationId).toMatch(/^row_policy_update:analyst:/);
    expect(newSummary.rowPolicy?.operationId).toBe(oldSummary.rowPolicy?.operationId);
    expect(oldSummary.rowPolicy?.tables).toEqual([
      { connection: "warehouse", schema: "fin", name: "fin_ledger" }
    ]);
    expect(oldSummary.rowPolicy?.beforeDigest).toBe(res.body.data.rowPolicy.beforeDigest);
    expect(oldSummary.rowPolicy?.affectedAgentCount).toBe(1);
    expect(newSummary.rowPolicy?.afterDigest).toBe(res.body.data.rowPolicy.afterDigest);
    expect(newSummary.rowPolicy?.affectedAgentCount).toBe(1);
  });

  it("keeps a plain Role edit on its own change type (no row-policy event)", async () => {
    const app = buildServer();
    await app.ready();

    await request(app.server)
      .patch("/api/admin/roles/analyst")
      .send({ dryRun: false, patch: { description: "Renamed analyst" } })
      .expect(200);

    const rows = await auditRows();
    expect(rows.some((row) => row.change_type === "row_policy_update")).toBe(false);
    expect(rows.some((row) => row.change_type === "role_patch")).toBe(true);
  });

  it("reverts the configuration when the terminal audit record cannot be persisted", async () => {
    const app = buildServer();
    await app.ready();

    // First save succeeds and becomes the new baseline.
    await request(app.server)
      .patch("/api/admin/roles/analyst")
      .send(scopedPatch("East"))
      .expect(200);
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const baseline = await readFile(accessPath, "utf8");

    hooks.failTerminal = true;
    const res = await request(app.server)
      .patch("/api/admin/roles/analyst")
      .send(scopedPatch("West"))
      .expect(200);

    // The configuration is back to its previous content.
    expect(await readFile(accessPath, "utf8")).toBe(baseline);
    expect(res.body.data.runtimeAck).toBe(false);

    const rows = (await auditRows()).filter((row) => row.change_type === "row_policy_update");
    expect(rows).toHaveLength(2);
    const failed = rows[1]!;
    expect(failed.write_status).toBe("rolled_back");
    expect(failed.error_reason).toContain("row policy terminal audit write failed");
  });
});
