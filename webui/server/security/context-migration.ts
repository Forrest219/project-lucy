import { createCipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditedWriteFile } from "../admin/config-audit-write.js";
import { readContextFile, safeWrite } from "../fs-safe.js";
import { loadContentPaths } from "../paths.js";
import { resolveProjectRoot } from "../project.js";
import { parseMarkdownFrontmatter, stringifyMarkdownFrontmatter } from "../markdown-frontmatter.js";
import { getAccessConfig, type AccessConfig } from "../proxy/identity.js";
import { listContextInventory } from "../proxy/context-inventory.js";
import type { ContextInventoryEntry } from "../proxy/context-policy.js";
import { loadAllSkillsFresh } from "../skills/loader.js";
import { getSecurityStore } from "./instance.js";

/**
 * Spec §4.3 — controlled migration of legacy Wiki / Skill ACLs.
 *
 * `scanContextAcl` is a read-only dry run: it reports metadata only (ids, ACL state, file
 * versions) — never body text or secrets. `applyContextAclMigration` is owner-only, takes the
 * reviewed `inventoryDigest` plus a per-file `expected_version`, validates the WHOLE batch
 * before the first write, keeps an encrypted backup and a durable journal, and never turns an
 * empty / corrupt / `visibility: public` ACL into `*` on its own: every target ACL is an explicit
 * owner decision. An interrupted batch leaves unconfirmed objects exactly as they were (deny).
 */

const CONTEXT_CHANNEL_TOOLS = ["wiki_search", "wiki_read", "lucy_skill_search", "lucy_skill_read"];
const JOURNAL_DIR = ".ktx-ui/context-acl-migration";

export type MigrationCategory = "keep" | "explicit_all" | "needs_confirmation";

export interface MigrationItem {
  kind: "wiki" | "skill";
  id: string;
  /** Skill lifecycle status; absent for Wiki. */
  status?: string;
  fileVersion: string;
  aclState: ContextInventoryEntry["acl"]["state"];
  roles: string[];
  /** Role ids in the ACL that the current role graph does not define (kept, never remapped). */
  unknownRoles: string[];
  /** Wiki `visibility: public` without an explicit ACL: only an owner decision may make it `*`. */
  legacyPublic: boolean;
  category: MigrationCategory;
}

export interface MigrationReport {
  inventoryDigest: string;
  roleGraphVersion: string;
  counts: { keep: number; explicitAll: number; needsConfirmation: number; legacyAgents: number };
  items: MigrationItem[];
  /** Agents with no formal Role (legacy direct-allow): context is refused until they get one. */
  legacyAgents: string[];
}

export type MigrationAclDecision =
  | { type: "roles"; roles: string[] }
  | { type: "all" }
  | { type: "none" };

export interface MigrationDecision {
  kind: "wiki" | "skill";
  id: string;
  expected_version: string;
  acl: MigrationAclDecision;
}

export class ContextMigrationError extends Error {
  constructor(
    readonly code:
      | "OWNER_REQUIRED"
      | "INVENTORY_STALE"
      | "VERSION_STALE"
      | "DECISION_INVALID"
      | "ROLE_UNKNOWN"
      | "BACKUP_KEY_INVALID"
      | "FRONTMATTER_UNREADABLE"
      | "SECURITY_STORE_UNAVAILABLE",
    message: string
  ) {
    super(message);
    this.name = "ContextMigrationError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function roleGraphVersion(config: AccessConfig): string {
  const graph = Object.keys(config.roles ?? {}).sort().map((roleId) => ({
    roleId,
    channels: (config.roles?.[roleId]?.allow?.tools ?? []).filter((tool) => CONTEXT_CHANNEL_TOOLS.includes(tool)).sort()
  }));
  return `roles-${sha256(JSON.stringify(graph)).slice(0, 16)}`;
}

function legacyAgentIds(config: AccessConfig): string[] {
  return config.users
    .filter((user) => user.enabled !== false)
    .filter((user) => !(typeof user.role === "string" && user.role.trim()) && !(Array.isArray(user.roles) && user.roles.length > 0))
    .map((user) => user.id)
    .sort();
}

function classify(entry: ContextInventoryEntry, knownRoles: Set<string>): MigrationItem {
  const roles = entry.acl.state === "roles" ? [...entry.acl.roles] : [];
  const unknownRoles = roles.filter((role) => !knownRoles.has(role));
  let category: MigrationCategory;
  if (entry.acl.state === "all") category = "explicit_all";
  else if (entry.acl.state === "roles") category = unknownRoles.length === roles.length ? "needs_confirmation" : "keep";
  else category = "needs_confirmation";
  return {
    kind: entry.kind,
    id: entry.id,
    ...(entry.status ? { status: entry.status } : {}),
    fileVersion: entry.fileVersion,
    aclState: entry.acl.state,
    roles,
    unknownRoles,
    legacyPublic: entry.kind === "wiki" && entry.legacyVisibility === "public" && entry.acl.state !== "roles" && entry.acl.state !== "all",
    category
  };
}

/** Read-only dry run. Never writes and never emits body text. */
export async function scanContextAcl(): Promise<MigrationReport> {
  const config = await getAccessConfig({ fresh: true });
  const knownRoles = new Set(Object.keys(config.roles ?? {}));
  const items = (await listContextInventory())
    .map((entry) => classify(entry, knownRoles))
    .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  const legacyAgents = legacyAgentIds(config);
  const graphVersion = roleGraphVersion(config);
  const inventoryDigest = `inv-${sha256(JSON.stringify({ items, graphVersion, legacyAgents })).slice(0, 32)}`;
  return {
    inventoryDigest,
    roleGraphVersion: graphVersion,
    counts: {
      keep: items.filter((item) => item.category === "keep").length,
      explicitAll: items.filter((item) => item.category === "explicit_all").length,
      needsConfirmation: items.filter((item) => item.category === "needs_confirmation").length,
      legacyAgents: legacyAgents.length
    },
    items,
    legacyAgents
  };
}

export interface ApplyContextAclInput {
  expectedDigest: string;
  decisions: MigrationDecision[];
  actor: { id: string; role: string };
  backup: { dir: string; key: Buffer };
}

export interface ApplyContextAclResult {
  operationId: string;
  applied: string[];
  failed: Array<{ id: string; reason: string }>;
  pending: string[];
  journalPath: string;
  backupPath: string;
}

type PreparedWrite = { decision: MigrationDecision; relPath: string; before: string; after: string; field: string };

function aclValue(acl: MigrationAclDecision, knownRoles: Set<string>): string[] {
  if (acl.type === "all") return ["*"];
  if (acl.type === "none") return [];
  const roles = [...new Set(acl.roles.map((role) => String(role).trim()))];
  if (roles.length === 0 || roles.some((role) => !role || role === "*")) {
    throw new ContextMigrationError("DECISION_INVALID", "roles decision needs concrete role ids (use type \"all\" for *)");
  }
  const unknown = roles.filter((role) => !knownRoles.has(role));
  if (unknown.length > 0) throw new ContextMigrationError("ROLE_UNKNOWN", `unknown role id(s): ${unknown.join(", ")}`);
  return roles;
}

async function prepareWrites(
  decisions: MigrationDecision[],
  report: MigrationReport,
  knownRoles: Set<string>
): Promise<PreparedWrite[]> {
  const paths = await loadContentPaths();
  const skillPaths = new Map((await loadAllSkillsFresh()).map((skill) => [skill.uri, skill.relativePath]));
  const byKey = new Map(report.items.map((item) => [`${item.kind}:${item.id}`, item]));
  const seen = new Set<string>();
  const prepared: PreparedWrite[] = [];
  for (const decision of decisions) {
    const key = `${decision.kind}:${decision.id}`;
    const item = byKey.get(key);
    if (!item || seen.has(key)) throw new ContextMigrationError("DECISION_INVALID", `unknown or duplicate object: ${key}`);
    seen.add(key);
    if (decision.expected_version !== item.fileVersion) {
      throw new ContextMigrationError("VERSION_STALE", `${key} changed since the report was reviewed`);
    }
    const value = aclValue(decision.acl, knownRoles);
    const relPath = decision.kind === "wiki" ? `wiki/${decision.id}` : skillPaths.get(decision.id);
    if (!relPath) throw new ContextMigrationError("DECISION_INVALID", `no file for ${key}`);
    const root = decision.kind === "wiki" ? paths.wiki : paths.skills;
    const relInRoot = relPath.slice(relPath.indexOf("/") + 1);
    const before = (await readContextFile(root, relInRoot)).content;
    const field = decision.kind === "wiki" ? "allowed_roles" : "roles_allowed";
    let after: string;
    try {
      const parsed = parseMarkdownFrontmatter(before);
      after = stringifyMarkdownFrontmatter(parsed.content, { ...parsed.data, [field]: value });
    } catch {
      throw new ContextMigrationError("FRONTMATTER_UNREADABLE", `${key} has unreadable frontmatter; repair it before migrating`);
    }
    prepared.push({ decision, relPath, before, after, field });
  }
  return prepared;
}

function encryptBackup(files: Record<string, string>, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ files }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

type JournalState = "pending" | "applied" | "failed";
interface Journal {
  operationId: string;
  actor: string;
  inventoryDigest: string;
  startedAt: string;
  entries: Array<{ kind: string; id: string; relPath: string; state: JournalState; reason?: string }>;
}

async function writeJournal(journal: Journal, relPath: string): Promise<void> {
  const paths = await loadContentPaths();
  const projectRoot = await resolveProjectRoot();
  await safeWrite(paths, projectRoot, relPath, `${JSON.stringify(journal, null, 2)}\n`);
}

export async function applyContextAclMigration(input: ApplyContextAclInput): Promise<ApplyContextAclResult> {
  if (input.actor.role !== "owner") {
    throw new ContextMigrationError("OWNER_REQUIRED", "only an owner may apply a context ACL migration");
  }
  if (input.backup.key.length !== 32) {
    throw new ContextMigrationError("BACKUP_KEY_INVALID", "backup key must be 32 bytes");
  }
  if (input.decisions.length === 0) throw new ContextMigrationError("DECISION_INVALID", "no decisions supplied");

  const config = await getAccessConfig({ fresh: true });
  const knownRoles = new Set(Object.keys(config.roles ?? {}));
  const report = await scanContextAcl();
  if (report.inventoryDigest !== input.expectedDigest) {
    throw new ContextMigrationError("INVENTORY_STALE", "inventory changed since the report; re-run the dry run");
  }
  const writes = await prepareWrites(input.decisions, report, knownRoles);

  const store = await getSecurityStore();
  const operationId = `ctxacl-${randomUUID()}`;
  const prepareEvent = store.ok
    ? store.value.appendEvent({
        eventId: randomUUID(),
        operationId,
        phase: "prepare",
        actor: input.actor.id,
        actorType: "ui_admin",
        objectHash: report.inventoryDigest,
        verdict: "context_acl_migration",
        resultSummary: JSON.stringify({ objects: writes.length })
      })
    : store;
  if (!store.ok || !prepareEvent.ok) {
    throw new ContextMigrationError("SECURITY_STORE_UNAVAILABLE", "security store unavailable; migration not started");
  }

  await mkdir(input.backup.dir, { recursive: true, mode: 0o700 });
  const backupPath = path.join(input.backup.dir, `${operationId}.backup.enc`);
  await writeFile(
    backupPath,
    encryptBackup(Object.fromEntries(writes.map((write) => [write.relPath, write.before])), input.backup.key),
    { mode: 0o600 }
  );

  const journalPath = `${JOURNAL_DIR}/${operationId}.json`;
  const journal: Journal = {
    operationId,
    actor: input.actor.id,
    inventoryDigest: report.inventoryDigest,
    startedAt: new Date().toISOString(),
    entries: writes.map((write) => ({ kind: write.decision.kind, id: write.decision.id, relPath: write.relPath, state: "pending" }))
  };
  await writeJournal(journal, journalPath);

  const projectRoot = await resolveProjectRoot();
  const applied: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const [index, write] of writes.entries()) {
    try {
      await auditedWriteFile(projectRoot, write.relPath, write.after, {
        enabled: true,
        changeType: "context_acl_migration",
        assetKind: write.decision.kind,
        actor: input.actor.id,
        actorType: "ui_admin",
        source: "context_acl_migration",
        targetId: write.decision.id,
        operation: "acl_migrate",
        newSummary: { [write.field]: aclValue(write.decision.acl, knownRoles), operationId }
      });
      journal.entries[index].state = "applied";
      applied.push(write.decision.id);
    } catch (error) {
      journal.entries[index].state = "failed";
      journal.entries[index].reason = error instanceof Error ? error.message : String(error);
      failed.push({ id: write.decision.id, reason: journal.entries[index].reason ?? "write_failed" });
      await writeJournal(journal, journalPath);
      break; // later objects stay pending (unchanged, still denied)
    }
    await writeJournal(journal, journalPath);
  }

  store.value.appendEvent({
    eventId: randomUUID(),
    operationId,
    phase: failed.length > 0 ? "abort" : "commit",
    actor: input.actor.id,
    actorType: "ui_admin",
    objectHash: report.inventoryDigest,
    verdict: "context_acl_migration",
    resultSummary: JSON.stringify({ applied: applied.length, failed: failed.length })
  });

  return {
    operationId,
    applied,
    failed,
    pending: journal.entries.filter((entry) => entry.state === "pending").map((entry) => entry.id),
    journalPath,
    backupPath
  };
}
