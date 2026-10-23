import { createDecipheriv, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuditDbForTests } from "../admin/audit";
import { auditedWriteFile } from "../admin/config-audit-write";
import { invalidateAccessConfigCache } from "../proxy/identity";
import { invalidateContentPathsCache } from "../paths";
import {
  applyContextAclMigration,
  ContextMigrationError,
  scanContextAcl,
  type MigrationDecision
} from "../security/context-migration";

/**
 * Spec §4.3 — controlled migration. Runs ONLY on a synthetic fixture project created below;
 * nothing here touches a real customer configuration.
 */

vi.mock("../admin/config-audit-write", async (importOriginal) => {
  const original = await importOriginal<typeof import("../admin/config-audit-write")>();
  return { ...original, auditedWriteFile: vi.fn(original.auditedWriteFile) };
});

const execFileAsync = promisify(execFile);

const ACCESS_YAML = `roles:
  analyst:
    description: analyst
    allow:
      tools: [wiki_search, wiki_read, lucy_skill_search, lucy_skill_read]
  finance:
    description: finance
    allow:
      tools: [wiki_search, wiki_read]
users:
  - id: roled_agent
    name: roled_agent
    enabled: true
    role: analyst
    tokens: []
  - id: legacy_agent
    name: legacy_agent
    enabled: true
    tokens: []
    allow:
      connections: []
      tables: []
      tools: [wiki_read]
`;

const OWNER = { id: "owner1", role: "owner" };
let root: string;
let backupDir: string;
const saved: Record<string, string | undefined> = {};
const KEYS = ["KTX_PROJECT_ROOT", "LUCY_CONTENT_ROOT"];

const wikiFile = (name: string) => path.join(root, "wiki", "global", name);
const skillFile = (name: string) => path.join(root, "skills", "ops", name);

async function snapshotTree(): Promise<string> {
  const out: string[] = [];
  for (const dir of [path.join(root, "wiki", "global"), path.join(root, "skills", "ops")]) {
    for (const name of (await readdir(dir)).sort()) out.push(`${name}\n${await readFile(path.join(dir, name), "utf8")}`);
  }
  return out.join("\n--\n");
}

beforeEach(async () => {
  for (const key of KEYS) saved[key] = process.env[key];
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-ctx-migrate-"));
  backupDir = await mkdtemp(path.join(os.tmpdir(), "lucy-ctx-backup-"));
  process.env.KTX_PROJECT_ROOT = root;
  process.env.LUCY_CONTENT_ROOT = ".";
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(root, "wiki", "global"), { recursive: true });
  await mkdir(path.join(root, "skills", "ops"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML);
  // keep: valid ACL; explicit_all; missing; public-without-ACL; empty; corrupt; unknown-only
  await writeFile(wikiFile("keep.md"), "---\nallowed_roles: [analyst, ghost]\n---\n# Keep\nBODY_KEEP\n");
  await writeFile(wikiFile("all.md"), "---\nallowed_roles: ['*']\n---\n# All\nBODY_ALL\n");
  await writeFile(wikiFile("missing.md"), "# Missing\nBODY_MISSING\n");
  await writeFile(wikiFile("public.md"), "---\nvisibility: public\n---\n# Public\nBODY_PUBLIC\n");
  await writeFile(wikiFile("empty.md"), "---\nallowed_roles: []\n---\n# Empty\nBODY_EMPTY\n");
  await writeFile(wikiFile("corrupt.md"), "---\nallowed_roles: analyst\nsummary: kept\n---\n# Corrupt\nBODY_CORRUPT\n");
  await writeFile(wikiFile("unknown.md"), "---\nallowed_roles: [ghost]\n---\n# Unknown\nBODY_UNKNOWN\n");
  await writeFile(
    skillFile("legacy.skill.md"),
    "---\nname: legacy-sop\ntitle: Legacy\ndomain: ops\nstatus: published\nversion: 2.0.0\n---\nBODY_SKILL\n"
  );
  invalidateAccessConfigCache();
  invalidateContentPathsCache();
  resetAuditDbForTests();
  vi.mocked(auditedWriteFile).mockClear();
});

afterEach(async () => {
  resetAuditDbForTests();
  const { closeSecurityStore } = await import("../security/instance");
  closeSecurityStore();
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  invalidateContentPathsCache();
  await rm(root, { recursive: true, force: true });
  await rm(backupDir, { recursive: true, force: true });
});

async function decisionsFor(report: Awaited<ReturnType<typeof scanContextAcl>>): Promise<MigrationDecision[]> {
  const version = (id: string) => report.items.find((item) => item.id === id)?.fileVersion ?? "";
  return [
    { kind: "wiki", id: "global/missing.md", expected_version: version("global/missing.md"), acl: { type: "roles", roles: ["analyst"] } },
    { kind: "wiki", id: "global/public.md", expected_version: version("global/public.md"), acl: { type: "all" } },
    { kind: "wiki", id: "global/corrupt.md", expected_version: version("global/corrupt.md"), acl: { type: "none" } },
    { kind: "skill", id: "lucy-skill://ops/legacy-sop", expected_version: version("lucy-skill://ops/legacy-sop"), acl: { type: "roles", roles: ["analyst", "finance"] } }
  ];
}

describe("dry run (read-only)", () => {
  it("classifies every object from metadata only and never emits body text", async () => {
    const before = await snapshotTree();
    const report = await scanContextAcl();
    expect(await snapshotTree()).toBe(before);

    const byId = Object.fromEntries(report.items.map((item) => [item.id, item]));
    expect(byId["global/keep.md"]).toMatchObject({ category: "keep", roles: ["analyst", "ghost"], unknownRoles: ["ghost"] });
    expect(byId["global/all.md"]).toMatchObject({ category: "explicit_all", aclState: "all" });
    expect(byId["global/missing.md"]).toMatchObject({ category: "needs_confirmation", aclState: "missing", legacyPublic: false });
    expect(byId["global/public.md"]).toMatchObject({ category: "needs_confirmation", legacyPublic: true });
    expect(byId["global/empty.md"]).toMatchObject({ category: "needs_confirmation", aclState: "empty" });
    expect(byId["global/corrupt.md"]).toMatchObject({ category: "needs_confirmation", aclState: "corrupt" });
    expect(byId["global/unknown.md"]).toMatchObject({ category: "needs_confirmation", unknownRoles: ["ghost"] });
    expect(byId["lucy-skill://ops/legacy-sop"]).toMatchObject({ kind: "skill", category: "needs_confirmation", aclState: "empty" });
    expect(report.legacyAgents).toEqual(["legacy_agent"]);
    expect(report.counts).toEqual({ keep: 1, explicitAll: 1, needsConfirmation: 6, legacyAgents: 1 });
    expect(JSON.stringify(report)).not.toMatch(/BODY_[A-Z]+/);
    expect(JSON.stringify(report)).not.toContain("password");
  });

  it("never turns an empty ACL, a `global` path or `visibility: public` into `*` by itself", async () => {
    const report = await scanContextAcl();
    for (const id of ["global/missing.md", "global/public.md", "global/empty.md"]) {
      expect(report.items.find((item) => item.id === id)?.category).toBe("needs_confirmation");
    }
    expect(await readFile(wikiFile("public.md"), "utf8")).not.toContain("allowed_roles");
  });

  it("the digest is stable and changes when any object, role graph or legacy agent set changes", async () => {
    const first = await scanContextAcl();
    expect((await scanContextAcl()).inventoryDigest).toBe(first.inventoryDigest);
    await writeFile(wikiFile("missing.md"), "# Missing\nedited\n");
    const edited = await scanContextAcl();
    expect(edited.inventoryDigest).not.toBe(first.inventoryDigest);
    await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML.replace("[wiki_search, wiki_read]\nusers", "[wiki_read]\nusers"));
    invalidateAccessConfigCache();
    expect((await scanContextAcl()).roleGraphVersion).not.toBe(first.roleGraphVersion);
  });
});

describe("apply (owner, reviewed digest, whole-batch preflight)", () => {
  const key = () => randomBytes(32);
  const apply = async (overrides: Partial<Parameters<typeof applyContextAclMigration>[0]> = {}) => {
    const report = await scanContextAcl();
    return applyContextAclMigration({
      expectedDigest: report.inventoryDigest,
      decisions: await decisionsFor(report),
      actor: OWNER,
      backup: { dir: backupDir, key: key() },
      ...overrides
    });
  };

  it("refuses a non-owner, a stale digest and a bad backup key — and writes nothing", async () => {
    const before = await snapshotTree();
    await expect(apply({ actor: { id: "ops1", role: "operator" } })).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    await expect(apply({ expectedDigest: "inv-stale" })).rejects.toMatchObject({ code: "INVENTORY_STALE" });
    await expect(apply({ backup: { dir: backupDir, key: Buffer.alloc(8) } })).rejects.toMatchObject({ code: "BACKUP_KEY_INVALID" });
    expect(await snapshotTree()).toBe(before);
    expect(vi.mocked(auditedWriteFile)).not.toHaveBeenCalled();
  });

  it.each([
    ["a stale expected_version", (d: MigrationDecision[]) => { d[1].expected_version = "sha256:stale"; }, "VERSION_STALE"],
    ["an unknown role", (d: MigrationDecision[]) => { d[0].acl = { type: "roles", roles: ["nope"] }; }, "ROLE_UNKNOWN"],
    ["a `*` smuggled into a roles decision", (d: MigrationDecision[]) => { d[0].acl = { type: "roles", roles: ["*"] }; }, "DECISION_INVALID"],
    ["an empty roles decision", (d: MigrationDecision[]) => { d[0].acl = { type: "roles", roles: [] }; }, "DECISION_INVALID"],
    ["an unknown object", (d: MigrationDecision[]) => { d[0].id = "global/nope.md"; }, "DECISION_INVALID"],
    ["a duplicate object", (d: MigrationDecision[]) => { d.push({ ...d[0] }); }, "DECISION_INVALID"]
  ])("rejects the WHOLE batch before the first write for %s", async (_label, mutate, code) => {
    const before = await snapshotTree();
    const report = await scanContextAcl();
    const decisions = await decisionsFor(report);
    mutate(decisions);
    await expect(
      applyContextAclMigration({ expectedDigest: report.inventoryDigest, decisions, actor: OWNER, backup: { dir: backupDir, key: key() } })
    ).rejects.toMatchObject({ code });
    expect(await snapshotTree()).toBe(before);
    expect(await readdir(backupDir)).toEqual([]);
  });

  it("rejects unreadable frontmatter instead of guessing", async () => {
    await writeFile(wikiFile("missing.md"), "---\nallowed_roles: [unterminated\n---\n# Missing\n");
    await expect(apply()).rejects.toMatchObject({ code: "FRONTMATTER_UNREADABLE" });
  });

  it("applies explicit owner decisions, keeps properties/body, journals and backs up (encrypted)", async () => {
    const encryptionKey = key();
    const originalCorrupt = await readFile(wikiFile("corrupt.md"), "utf8");
    const report = await scanContextAcl();
    const result = await applyContextAclMigration({
      expectedDigest: report.inventoryDigest,
      decisions: await decisionsFor(report),
      actor: OWNER,
      backup: { dir: backupDir, key: encryptionKey }
    });
    expect(result.failed).toEqual([]);
    expect(result.pending).toEqual([]);
    expect(result.applied).toHaveLength(4);

    expect(await readFile(wikiFile("missing.md"), "utf8")).toMatch(/allowed_roles:\n\s+- analyst/);
    expect(await readFile(wikiFile("public.md"), "utf8")).toMatch(/allowed_roles:\n\s+- ['"]?\*['"]?/);
    const corrupt = await readFile(wikiFile("corrupt.md"), "utf8");
    expect(corrupt).toContain("allowed_roles: []");
    expect(corrupt).toContain("summary: kept");
    expect(corrupt).toContain("BODY_CORRUPT");
    const skill = await readFile(skillFile("legacy.skill.md"), "utf8");
    expect(skill).toMatch(/roles_allowed:\n\s+- analyst\n\s+- finance/);
    expect(skill).toContain("version: 2.0.0");

    // objects without a decision are untouched
    expect(await readFile(wikiFile("empty.md"), "utf8")).toContain("allowed_roles: []");
    expect(await readFile(wikiFile("unknown.md"), "utf8")).toContain("ghost");

    // journal
    const journal = JSON.parse(await readFile(path.join(root, result.journalPath), "utf8")) as {
      actor: string;
      entries: Array<{ state: string }>;
    };
    expect(journal.actor).toBe("owner1");
    expect(journal.entries.map((entry) => entry.state)).toEqual(["applied", "applied", "applied", "applied"]);

    // encrypted backup: not readable as plaintext, decrypts to the original text
    const blob = await readFile(result.backupPath);
    expect(blob.toString("utf8")).not.toContain("BODY_CORRUPT");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, blob.subarray(0, 12));
    decipher.setAuthTag(blob.subarray(12, 28));
    const plain = JSON.parse(Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString("utf8")) as {
      files: Record<string, string>;
    };
    expect(plain.files["wiki/global/corrupt.md"]).toBe(originalCorrupt);

    // a second run with the reviewed (now stale) digest is refused
    await expect(
      applyContextAclMigration({ expectedDigest: report.inventoryDigest, decisions: await decisionsFor(report), actor: OWNER, backup: { dir: backupDir, key: key() } })
    ).rejects.toBeInstanceOf(ContextMigrationError);
    // and the next dry run no longer lists the confirmed objects as pending
    const next = await scanContextAcl();
    expect(next.counts.needsConfirmation).toBe(3);
  });

  it("a mid-batch failure leaves unconfirmed objects unchanged (still denied), never fully open", async () => {
    const real = (await vi.importActual<typeof import("../admin/config-audit-write")>("../admin/config-audit-write")).auditedWriteFile;
    vi.mocked(auditedWriteFile)
      .mockImplementationOnce(real)
      .mockImplementationOnce(async () => {
        throw new Error("simulated crash");
      });
    const result = await apply();
    expect(result.applied).toHaveLength(1);
    expect(result.failed).toEqual([{ id: expect.any(String), reason: "simulated crash" }]);
    expect(result.pending).toHaveLength(2);

    const journal = JSON.parse(await readFile(path.join(root, result.journalPath), "utf8")) as { entries: Array<{ id: string; state: string }> };
    expect(journal.entries.map((entry) => entry.state)).toEqual(["applied", "failed", "pending", "pending"]);
    // every failed / pending object kept its previous (deny) ACL state
    const report = await scanContextAcl();
    for (const entry of journal.entries.filter((item) => item.state !== "applied")) {
      expect(report.items.find((item) => item.id === entry.id)?.category).toBe("needs_confirmation");
    }
    expect(await readFile(wikiFile("public.md"), "utf8")).not.toMatch(/allowed_roles/);
  });
});

describe("command line tool (synthetic fixture)", () => {
  const tsx = path.resolve(__dirname, "../../node_modules/.bin/tsx");
  const script = path.resolve(__dirname, "../../../scripts/security/migrate-context-acl.mts");
  const run = (args: string[], env: Record<string, string> = {}) =>
    execFileAsync(tsx, [script, ...args], { env: { ...process.env, ...env }, cwd: path.resolve(__dirname, "../..") }).then(
      (result) => ({ code: 0, ...result }),
      (error: { code?: number; stdout?: string; stderr?: string }) => ({ code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" })
    );

  it("--dry-run prints a metadata-only report and writes nothing; --apply refuses without an owner", async () => {
    const before = await snapshotTree();
    const dry = await run(["--project-dir", root, "--dry-run"]);
    expect(dry.code).toBe(0);
    const report = JSON.parse(dry.stdout) as { inventoryDigest: string; items: unknown[] };
    expect(report.inventoryDigest).toMatch(/^inv-/);
    expect(dry.stdout).not.toMatch(/BODY_[A-Z]+/);
    expect(await snapshotTree()).toBe(before);

    const refused = await run(
      ["--project-dir", root, "--apply", "--owner", "nobody", "--expected-digest", report.inventoryDigest, "--decisions", "/dev/null", "--backup-dir", backupDir],
      { LUCY_MIGRATION_BACKUP_KEY: randomBytes(32).toString("base64") }
    );
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("owner 'nobody' not found");
    expect(await snapshotTree()).toBe(before);
  }, 60_000);
});
