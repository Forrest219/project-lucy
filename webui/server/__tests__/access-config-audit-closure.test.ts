import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lucy v0.25 — L25-14 §3.4 / §5.3 / §7: the access-configuration durable-audit closure.
 *
 * Contract under test:
 *   durable intent → atomic write → runtime commit/ack → durable terminal
 * - No intent ⇒ no configuration write at all.
 * - A terminal that cannot be persisted reverts the configuration and re-commits the
 *   previous policy; the audit row records `rolled_back`.
 * - An unverifiable revert closes the recovery gate: further writes are rejected and
 *   the effective policy degrades globally (data plane fails closed).
 */

const ACCESS_YAML = `roles:
  ok_role:
    description: Compiles cleanly
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
  - id: ok_agent
    name: OK Agent
    enabled: true
    role: ok_role
    tokens: []
defaults:
  deny_tools: []
`;

const KTX_YAML = `connections:
  warehouse:
    driver: mysql
    enabled_tables:
      - fin.fin_ledger
`;

const FIN_SCHEMA_YAML = `tables:
  fin_ledger:
    table: fin.fin_ledger
`;

const hooks = vi.hoisted(() => ({
  /** Called right after the configuration file is written. */
  afterWrite: null as null | (() => Promise<void>),
  /** Number of terminal-record attempts. */
  terminalCalls: 0,
  /** Make the Nth terminal write fail. 0 = never fail. */
  failTerminalAt: 0,
  /** Make the intent record unavailable (no id returned). */
  intentUnavailable: false,
  /** Force the post-write runtime ack to fail. */
  forceNoAck: false
}));

vi.mock("../admin/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../admin/audit")>();
  return {
    ...actual,
    recordConfigChange: vi.fn(async (...args: Parameters<typeof actual.recordConfigChange>) => {
      if (hooks.intentUnavailable) return undefined;
      return actual.recordConfigChange(...args);
    }),
    updateConfigChangeStatus: vi.fn(async (...args: Parameters<typeof actual.updateConfigChangeStatus>) => {
      hooks.terminalCalls += 1;
      if (hooks.failTerminalAt > 0 && hooks.terminalCalls === hooks.failTerminalAt) {
        throw new Error("injected: terminal audit write failed");
      }
      return actual.updateConfigChangeStatus(...args);
    })
  };
});

vi.mock("../admin/config-audit-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../admin/config-audit-write")>();
  return {
    ...actual,
    auditedWriteFile: vi.fn(async (...args: Parameters<typeof actual.auditedWriteFile>) => {
      const result = await actual.auditedWriteFile(...args);
      if (hooks.afterWrite) await hooks.afterWrite();
      return result;
    })
  };
});

vi.mock("../proxy/acl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../proxy/acl")>();
  return {
    ...actual,
    evaluateRuntimeAck: vi.fn((...args: Parameters<typeof actual.evaluateRuntimeAck>) =>
      hooks.forceNoAck ? false : actual.evaluateRuntimeAck(...args)
    )
  };
});

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

async function makeProject(accessYaml = ACCESS_YAML): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-access-closure-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYaml, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
    FIN_SCHEMA_YAML,
    "utf8"
  );
  return root;
}

type AuditRow = {
  id: number;
  change_type: string;
  write_status: string;
  error_reason: string | null;
  actor: string;
};

async function auditRows(): Promise<AuditRow[]> {
  const { getAuditDb } = await import("../admin/audit");
  const db = await getAuditDb();
  return db
    .prepare(
      `SELECT id, change_type, write_status, error_reason, actor
         FROM config_change_log ORDER BY id`
    )
    .all() as AuditRow[];
}

async function loadModules() {
  vi.resetModules();
  const accessConfig = await import("../admin/access-config");
  const acl = await import("../proxy/acl");
  return { accessConfig, acl };
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  projectRoot = await makeProject();
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  hooks.afterWrite = null;
  hooks.terminalCalls = 0;
  hooks.failTerminalAt = 0;
  hooks.intentUnavailable = false;
  hooks.forceNoAck = false;
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

describe("access configuration durable-audit closure", () => {
  it("persists the durable intent before the configuration is written", async () => {
    const { accessConfig } = await loadModules();
    let statusAtWriteTime: string | null = null;
    let rowsAtWriteTime = 0;

    hooks.afterWrite = async () => {
      const rows = await auditRows();
      statusAtWriteTime = rows[rows.length - 1]?.write_status ?? null;
      rowsAtWriteTime = rows.length;
    };

    const { parse } = await import("yaml");
    const { readFile: read } = await import("node:fs/promises");
    const raw = await read(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const config = parse(raw) as Parameters<typeof accessConfig.writeAccessYaml>[1];
    config.users[0]!.name = "Renamed Agent";

    const result = await accessConfig.writeAccessYaml(projectRoot, config, {
      enabled: true,
      changeType: "role_patch",
      targetId: "ok_role",
      actor: "tester",
      source: "admin_roles_api"
    });

    expect(result.runtimeAck).toBe(true);
    // The intent row already existed while the file was being written.
    expect(statusAtWriteTime).toBe("pending");
    expect(rowsAtWriteTime).toBe(1);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      change_type: "role_patch",
      write_status: "committed",
      actor: "tester"
    });
    expect(rows[0]!.error_reason).toBeNull();
  });

  it("writes no configuration at all when the durable intent cannot be persisted", async () => {
    const { accessConfig } = await loadModules();
    const { parse } = await import("yaml");
    const { readFile: read } = await import("node:fs/promises");
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = await read(accessPath, "utf8");

    hooks.intentUnavailable = true;

    const raw = await read(accessPath, "utf8");
    const config = parse(raw) as Parameters<typeof accessConfig.writeAccessYaml>[1];
    config.users[0]!.name = "Should Not Persist";

    await expect(
      accessConfig.writeAccessYaml(projectRoot, config, {
        enabled: true,
        changeType: "role_patch",
        targetId: "ok_role"
      })
    ).rejects.toThrow(/audit_intent_unavailable/);

    expect(await read(accessPath, "utf8")).toBe(before);
    expect(await auditRows()).toHaveLength(0);
  });

  it("reverts the configuration and records `rolled_back` when the terminal record cannot be persisted", async () => {
    const { accessConfig, acl } = await loadModules();
    const { parse } = await import("yaml");
    const { readFile: read } = await import("node:fs/promises");
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = await read(accessPath, "utf8");
    const beforeStatus = await acl.commitEffectivePolicy();

    // The first terminal write (the "committed" one) fails.
    hooks.failTerminalAt = 1;

    const raw = await read(accessPath, "utf8");
    const config = parse(raw) as Parameters<typeof accessConfig.writeAccessYaml>[1];
    config.users[0]!.name = "Must Not Persist";

    const result = await accessConfig.writeAccessYaml(projectRoot, config, {
      enabled: true,
      changeType: "role_patch",
      targetId: "ok_role"
    });

    expect(result.rolledBack).toBe(true);
    expect(result.runtimeAck).toBe(false);
    // The configuration is back to its previous content and the previous policy is live.
    expect(await read(accessPath, "utf8")).toBe(before);
    const afterStatus = await acl.commitEffectivePolicy();
    expect(afterStatus.accessConfigDigest).toBe(beforeStatus.accessConfigDigest);
    expect(afterStatus.degradedGlobal).toBe(false);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.write_status).toBe("rolled_back");
    expect(rows[0]!.error_reason).toContain("terminal audit write failed");
  });

  it("rolls the configuration back when the runtime does not acknowledge the write", async () => {
    const { accessConfig } = await loadModules();
    const { parse } = await import("yaml");
    const { readFile: read } = await import("node:fs/promises");
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const before = await read(accessPath, "utf8");

    hooks.forceNoAck = true;

    const raw = await read(accessPath, "utf8");
    const config = parse(raw) as Parameters<typeof accessConfig.writeAccessYaml>[1];
    config.users[0]!.name = "Must Not Persist";

    const result = await accessConfig.writeAccessYaml(projectRoot, config, {
      enabled: true,
      changeType: "role_patch",
      targetId: "ok_role"
    });

    expect(result.rolledBack).toBe(true);
    expect(result.runtimeAck).toBe(false);
    expect(await read(accessPath, "utf8")).toBe(before);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.write_status).toBe("rolled_back");
  });

  it("closes the recovery gate when a revert cannot be verified: further writes are rejected and the runtime degrades", async () => {
    const { accessConfig, acl } = await loadModules();
    const { parse } = await import("yaml");
    const { readFile: read } = await import("node:fs/promises");
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const raw = await read(accessPath, "utf8");
    const config = parse(raw) as Parameters<typeof accessConfig.writeAccessYaml>[1];
    config.users[0]!.name = "Must Not Persist";

    // Force an unverifiable revert: the runtime digest will not match the restored bytes.
    const { markAccessRecoveryRequired } = await import("../access-recovery");
    await markAccessRecoveryRequired(projectRoot, { reason: "test_injected" });

    await expect(
      accessConfig.writeAccessYaml(projectRoot, config, {
        enabled: true,
        changeType: "role_patch",
        targetId: "ok_role"
      })
    ).rejects.toThrow(/待恢复状态/);

    const status = await acl.commitEffectivePolicy();
    expect(status.degradedGlobal).toBe(true);
    expect(await read(accessPath, "utf8")).toBe(raw);
  });
});
