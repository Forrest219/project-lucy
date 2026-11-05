/**
 * Spec lucy-20261105-customer-default-system-roles §3.3.1 / §6.
 *
 * SC-01、SC-02、SC-06、SC-09、SC-10、SC-11、SC-12，以及 lucy_ops_reader 的
 * 创建／已存在分支。状态表「否」由 ops-evidence-connection 测试覆盖。
 */

import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { resetAuditDbForTests } from "../admin/audit";
import { expandTemplate, LUCY_ADMIN_TOOLS } from "../admin/role-templates";
import { clearInMemoryRecoveryRequiredSync } from "../access-recovery";
import {
  ensureLucyAdminFormalRole,
  ensureLucyOpsReaderFormalRole,
  normativeLucyAdminRole,
  normativeLucyOpsReaderRole
} from "../admin/ensure-system-formal-roles";
import { OPS_EVIDENCE_FROZEN, OPS_EVIDENCE_ROLE_ID } from "../ops-evidence/contract";

let projectRoot: string | undefined;
let lockedDir: string | undefined;
let previousAuditDb: string | undefined;
let warnSpy: ReturnType<typeof vi.spyOn> | undefined;

const BASE_ACCESS = `roles:
  customer_readonly:
    description: Customer headless readonly agent role
    allow:
      connections:
        - customer-db
      tools:
        - lucy_query
users:
  - id: customer_agent
    name: Customer Agent
    enabled: true
    note: keep me
    tokens:
      - hash: "sha256:abc123"
        label: example-token-hash
        created: 2026-07-06
    role: customer_readonly
  - id: already_admin
    name: Existing Admin Binding
    enabled: false
    note: legal pre-existing
    tokens: []
    role: lucy_admin
defaults:
  deny_tools:
    - sql_execution
`;

function accessPathOf(root: string): string {
  return path.join(root, "webui", "config", "access.yaml");
}

async function makeProject(yaml: string = BASE_ACCESS): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-formal-roles-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await writeFile(accessPathOf(root), yaml, "utf8");
  return root;
}

async function openRecoveryGate(root: string): Promise<void> {
  resetAuditDbForTests();
  clearInMemoryRecoveryRequiredSync();
  const auditPath = path.join(root, ".ktx-ui", "audit.sqlite");
  await mkdir(path.dirname(auditPath), { recursive: true });
  process.env.LUCY_AUDIT_DB = auditPath;
}

function parseAccess(raw: string): Record<string, unknown> {
  const doc = parse(raw);
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("access.yaml did not parse to a map");
  }
  return doc as Record<string, unknown>;
}

function exceptRoles(doc: Record<string, unknown>, roleIds: string[]): Record<string, unknown> {
  const clone = structuredClone(doc) as { roles?: Record<string, unknown> };
  if (clone.roles && typeof clone.roles === "object" && !Array.isArray(clone.roles)) {
    for (const roleId of roleIds) delete clone.roles[roleId];
  }
  return clone as Record<string, unknown>;
}

function roleOf(doc: Record<string, unknown>, roleId: string): Record<string, unknown> | undefined {
  const roles = doc.roles;
  if (!roles || typeof roles !== "object" || Array.isArray(roles)) return undefined;
  const role = (roles as Record<string, unknown>)[roleId];
  if (!role || typeof role !== "object" || Array.isArray(role)) return undefined;
  return role as Record<string, unknown>;
}

function userBindings(doc: Record<string, unknown>): unknown {
  return doc.users;
}

beforeEach(() => {
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  clearInMemoryRecoveryRequiredSync();
  resetAuditDbForTests();
});

afterEach(async () => {
  warnSpy?.mockRestore();
  warnSpy = undefined;
  clearInMemoryRecoveryRequiredSync();
  resetAuditDbForTests();
  if (lockedDir) {
    await chmod(lockedDir, 0o755).catch(() => undefined);
    lockedDir = undefined;
  }
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (projectRoot) {
    await chmod(path.join(projectRoot, "webui", "config"), 0o755).catch(() => undefined);
    await rm(projectRoot, { recursive: true, force: true });
    projectRoot = undefined;
  }
});

describe("SC-10 — 规范块与 role-templates 同源", () => {
  it("lucy_admin / lucy_ops_reader 规范块等于 expandTemplate，且没有 id", () => {
    const admin = normativeLucyAdminRole();
    const reader = normativeLucyOpsReaderRole();
    expect(admin).toEqual(expandTemplate("lucy_admin"));
    expect(reader).toEqual(expandTemplate(OPS_EVIDENCE_ROLE_ID));
    expect(admin).not.toHaveProperty("id");
    expect(reader).not.toHaveProperty("id");
    expect(admin.allow?.source_scope).toBe("catalog_bound");
    expect(admin.allow?.connections).toEqual(["*"]);
    expect(admin.allow?.tools).toEqual([...LUCY_ADMIN_TOOLS]);
    expect(reader.allow?.source_scope).toBeUndefined();
    const selector = reader.allow?.tableSelectors?.[0];
    expect(selector && "names" in selector ? selector.names : undefined).toEqual(
      Object.values(OPS_EVIDENCE_FROZEN.sourceName)
    );
  });
});

describe("SC-01 — 缺 lucy_admin 则创建，二次不写盘", () => {
  it("分支 A：只新增规范 lucy_admin，其余语义不变，第二次字节不变", async () => {
    projectRoot = await makeProject();
    await openRecoveryGate(projectRoot);
    const file = accessPathOf(projectRoot);
    const beforeRaw = await readFile(file, "utf8");
    const before = parseAccess(beforeRaw);

    const created = await ensureLucyAdminFormalRole({ projectRoot });
    expect(created.wrote).toBe(true);
    expect(created.branch).toBe("A");

    const afterRaw = await readFile(file, "utf8");
    const after = parseAccess(afterRaw);
    expect(roleOf(after, "lucy_admin")).toEqual(expandTemplate("lucy_admin"));
    expect(roleOf(after, "lucy_ops_reader")).toBeUndefined();
    expect(exceptRoles(after, ["lucy_admin"])).toEqual(exceptRoles(before, ["lucy_admin"]));
    expect(userBindings(after)).toEqual(userBindings(before));

    const again = await ensureLucyAdminFormalRole({ projectRoot });
    expect(again.wrote).toBe(false);
    expect(again.branch).toBe("D");
    expect(await readFile(file, "utf8")).toBe(afterRaw);
  });
});

describe("SC-02 — 已有 lucy_admin 只追加缺失工具", () => {
  it("分支 B：保留 description、connections、既有工具顺序，缺失工具追加在末尾", async () => {
    const gap = [...LUCY_ADMIN_TOOLS].filter((tool) => tool !== "entity_details");
    const doc = parseAccess(BASE_ACCESS) as {
      roles: Record<string, unknown>;
    };
    doc.roles.lucy_admin = {
      description: "custom description",
      permission_model_version: 2,
      allow: {
        connections: ["demo-mysql"],
        source_scope: "catalog_bound",
        tools: [...gap, "custom_extra"]
      }
    };
    doc.roles.customer_readonly = {
      description: "untouched",
      allow: { tools: ["lucy_query", "wiki_read"] }
    };
    projectRoot = await makeProject(stringify(doc));
    await openRecoveryGate(projectRoot);
    const file = accessPathOf(projectRoot);
    const before = parseAccess(await readFile(file, "utf8"));

    const patched = await ensureLucyAdminFormalRole({ projectRoot });
    expect(patched.wrote).toBe(true);
    expect(patched.branch).toBe("B");

    const afterRaw = await readFile(file, "utf8");
    const after = parseAccess(afterRaw);
    const admin = roleOf(after, "lucy_admin") as {
      description?: string;
      allow?: { connections?: string[]; source_scope?: string; tools?: string[] };
    };
    expect(admin.description).toBe("custom description");
    expect(admin.allow?.connections).toEqual(["demo-mysql"]);
    expect(admin.allow?.source_scope).toBe("catalog_bound");
    expect(admin.allow?.tools).toEqual([...gap, "custom_extra", "entity_details"]);
    expect(exceptRoles(after, ["lucy_admin"])).toEqual(exceptRoles(before, ["lucy_admin"]));

    const again = await ensureLucyAdminFormalRole({ projectRoot });
    expect(again.wrote).toBe(false);
    expect(await readFile(file, "utf8")).toBe(afterRaw);
  });
});

describe("SC-03 / SC-05 — lucy_ops_reader 缺则创建，已存在不写", () => {
  it("分支 C：缺 reader 时写入冻结 names，其余语义不变，第二次不写盘", async () => {
    projectRoot = await makeProject();
    await openRecoveryGate(projectRoot);
    const file = accessPathOf(projectRoot);
    const before = parseAccess(await readFile(file, "utf8"));

    const created = await ensureLucyOpsReaderFormalRole({ projectRoot });
    expect(created.wrote).toBe(true);
    expect(created.branch).toBe("C");

    const afterRaw = await readFile(file, "utf8");
    const after = parseAccess(afterRaw);
    expect(roleOf(after, OPS_EVIDENCE_ROLE_ID)).toEqual(expandTemplate(OPS_EVIDENCE_ROLE_ID));
    expect(roleOf(after, "lucy_admin")).toBeUndefined();
    expect(exceptRoles(after, [OPS_EVIDENCE_ROLE_ID])).toEqual(exceptRoles(before, [OPS_EVIDENCE_ROLE_ID]));
    expect(userBindings(after)).toEqual(userBindings(before));

    const again = await ensureLucyOpsReaderFormalRole({ projectRoot });
    expect(again.wrote).toBe(false);
    expect(again.branch).toBe("D");
    expect(await readFile(file, "utf8")).toBe(afterRaw);
  });

  it("分支 D：已有窄 names 的 reader 整文件字节不变", async () => {
    const doc = parseAccess(BASE_ACCESS) as { roles: Record<string, unknown> };
    doc.roles.lucy_ops_reader = {
      description: "narrow on purpose",
      allow: {
        connections: ["lucy-ops"],
        tableSelectors: [
          {
            connection: "lucy-ops",
            schema: "main",
            names: ["ops_calls"],
            row_access: "all"
          }
        ],
        tools: ["lucy_query"]
      }
    };
    const narrow = stringify(doc);
    projectRoot = await makeProject(narrow);
    await openRecoveryGate(projectRoot);
    const file = accessPathOf(projectRoot);
    const before = await readFile(file);

    const result = await ensureLucyOpsReaderFormalRole({ projectRoot });
    expect(result.wrote).toBe(false);
    expect(result.branch).toBe("D");
    expect(await readFile(file)).toEqual(before);
    const after = parseAccess((await readFile(file)).toString("utf8"));
    const selector = (
      roleOf(after, "lucy_ops_reader") as {
        allow?: { tableSelectors?: Array<{ names?: string[] }> };
      }
    ).allow?.tableSelectors?.[0];
    expect(selector?.names).toEqual(["ops_calls"]);
  });
});

describe("SC-06 — users 全字段保持，不新增绑定", () => {
  it("两路 ensure 之后 users 语义相等，不新增 demo_ops，已有绑定保留", async () => {
    projectRoot = await makeProject();
    await openRecoveryGate(projectRoot);
    const file = accessPathOf(projectRoot);
    const before = parseAccess(await readFile(file, "utf8"));

    await ensureLucyAdminFormalRole({ projectRoot });
    await ensureLucyOpsReaderFormalRole({ projectRoot });

    const after = parseAccess(await readFile(file, "utf8"));
    expect(after.users).toEqual(before.users);
    const users = after.users as Array<{ id?: string; role?: string }>;
    expect(users.map((user) => user.id)).not.toContain("demo_ops");
    expect(users.filter((user) => user.role === "lucy_admin")).toEqual([
      expect.objectContaining({ id: "already_admin", role: "lucy_admin", enabled: false, note: "legal pre-existing" })
    ]);
    expect(users.filter((user) => user.role === "lucy_ops_reader")).toEqual([]);
    expect(users.filter((user) => user.role === "customer_readonly").map((user) => user.id)).toEqual([
      "customer_agent"
    ]);
    expect(exceptRoles(after, ["lucy_admin", OPS_EVIDENCE_ROLE_ID])).toEqual(
      exceptRoles(before, ["lucy_admin", OPS_EVIDENCE_ROLE_ID])
    );
  });
});

describe("SC-09 / SC-12 — 原子写失败保留原字节且不制造恢复现场", () => {
  it("目录不可写时字节不变并告警；恢复可写后能落到规范并二次稳定", async () => {
    projectRoot = await makeProject();
    await openRecoveryGate(projectRoot);
    const file = accessPathOf(projectRoot);
    const before = await readFile(file);
    const configDir = path.dirname(file);
    lockedDir = configDir;
    await chmod(configDir, 0o555);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const failed = await ensureLucyAdminFormalRole({ projectRoot });
    expect(failed.wrote).toBe(false);
    expect(failed.branch).toBe("D");
    expect(failed.reason).toBe("write_failed");
    expect(await readFile(file)).toEqual(before);
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes("system_ensure_formal_roles"))).toBe(true);
    const leftovers = (await readdir(configDir)).filter((name) => name.includes(".tmp-"));
    expect(leftovers).toEqual([]);
    await expect(stat(path.join(projectRoot, ".ktx-ui", "access-recovery.json"))).rejects.toThrow();

    await chmod(configDir, 0o755);
    lockedDir = undefined;
    const created = await ensureLucyAdminFormalRole({ projectRoot });
    expect(created.wrote).toBe(true);
    expect(created.branch).toBe("A");
    const afterRaw = await readFile(file, "utf8");
    expect(roleOf(parseAccess(afterRaw), "lucy_admin")).toEqual(expandTemplate("lucy_admin"));

    const again = await ensureLucyAdminFormalRole({ projectRoot });
    expect(again.wrote).toBe(false);
    expect(await readFile(file, "utf8")).toBe(afterRaw);
  });
});

describe("SC-11 — 恢复闸拒绝时两路都不写盘", () => {
  async function expectBothSkip(root: string, warnIncludes: string): Promise<void> {
    const file = accessPathOf(root);
    const before = await readFile(file);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const admin = await ensureLucyAdminFormalRole({ projectRoot: root });
    const reader = await ensureLucyOpsReaderFormalRole({ projectRoot: root });
    expect(admin).toMatchObject({ wrote: false, branch: "D" });
    expect(reader).toMatchObject({ wrote: false, branch: "D" });
    expect(await readFile(file)).toEqual(before);
    const warnings = warnSpy.mock.calls.map((args) => String(args[0])).join("\n");
    expect(warnings).toContain("system_ensure_formal_roles");
    expect(warnings).toContain(warnIncludes);
  }

  it("marker required 时不写，marker 字节保留", async () => {
    projectRoot = await makeProject();
    await openRecoveryGate(projectRoot);
    const markerPath = path.join(projectRoot, ".ktx-ui", "access-recovery.json");
    const marker = `${JSON.stringify(
      { required: true, reason: "test_hold", operationId: "op-1", since: "2026-11-05T00:00:00.000Z" },
      null,
      2
    )}\n`;
    await writeFile(markerPath, marker, "utf8");

    await expectBothSkip(projectRoot, "test_hold");
    expect(await readFile(markerPath, "utf8")).toBe(marker);
  });

  it("marker 损坏时不写，损坏字节保留", async () => {
    projectRoot = await makeProject();
    await openRecoveryGate(projectRoot);
    const markerPath = path.join(projectRoot, ".ktx-ui", "access-recovery.json");
    const marker = "{";
    await writeFile(markerPath, marker, "utf8");

    await expectBothSkip(projectRoot, "recovery_state_unprovable");
    expect(await readFile(markerPath, "utf8")).toBe(marker);
  });

  it("marker 不可读时不写，现场仍是目录", async () => {
    projectRoot = await makeProject();
    await openRecoveryGate(projectRoot);
    const markerPath = path.join(projectRoot, ".ktx-ui", "access-recovery.json");
    await mkdir(markerPath, { recursive: true });

    await expectBothSkip(projectRoot, "recovery_state_unprovable");
    expect((await stat(markerPath)).isDirectory()).toBe(true);
  });

  it("未终结 intent 时不写，intent 行保留", async () => {
    projectRoot = await makeProject();
    await openRecoveryGate(projectRoot);
    const { getAuditDb } = await import("../admin/audit");
    const database = await getAuditDb();
    database
      .prepare(
        `INSERT INTO config_change_log (ts, actor, file_path, change_type, write_status)
         VALUES ('2026-11-05T00:00:00.000Z', 'test', 'webui/config/access.yaml', 'update', 'pending')`
      )
      .run();

    await expectBothSkip(projectRoot, "unterminated_row_policy_intents");
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM config_change_log
         WHERE write_status = 'pending' AND file_path = 'webui/config/access.yaml'`
      )
      .get() as { count: number };
    expect(Number(row.count)).toBe(1);
  });

  it("审计库不可读时不写，已有 marker 字节保留", async () => {
    projectRoot = await makeProject();
    clearInMemoryRecoveryRequiredSync();
    resetAuditDbForTests();
    const auditDir = path.join(projectRoot, ".ktx-ui", "audit-is-a-directory");
    await mkdir(auditDir, { recursive: true });
    process.env.LUCY_AUDIT_DB = auditDir;
    const markerPath = path.join(projectRoot, ".ktx-ui", "access-recovery.json");
    const marker = '{"required":false}\n';
    await writeFile(markerPath, marker, "utf8");

    await expectBothSkip(projectRoot, "recovery_state_unprovable");
    expect(await readFile(markerPath, "utf8")).toBe(marker);
  });
});

describe("分支 D — YAML 无法解析时不写盘", () => {
  it("坏 YAML 保留原字节", async () => {
    const broken = "roles: [\n  oops\n";
    projectRoot = await makeProject(broken);
    await openRecoveryGate(projectRoot);
    const file = accessPathOf(projectRoot);
    const before = await readFile(file);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await ensureLucyAdminFormalRole({ projectRoot });
    expect(result).toMatchObject({ wrote: false, branch: "D" });
    expect(await readFile(file)).toEqual(before);
    expect(warnSpy.mock.calls.some((args) => String(args[0]).includes("system_ensure_formal_roles"))).toBe(true);
  });
});
