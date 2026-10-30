import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";
import { getSecurityStore, closeSecurityStore } from "../security/instance";
import { openSecurityStore, type SecurityStore } from "../security/store";
import { onSecurityStateChange } from "../security/state-changes";
import { isWikiKeyHeld, invalidateWikiAccessHoldCache } from "../wiki-access-holds";
import { recoverWikiAccessOperations } from "../wiki-access-recovery";
import { commitWikiAccessBatch, getWikiAccessBatchResult, previewWikiAccessBatch } from "../wiki-access-batch";
import { listWikiVersions } from "../wiki";
import { wikiContentHash } from "../wiki-hash";
import { readAclDeclaration } from "../wiki-access-operation";
import { parseObjectAcl, type ObjectAcl } from "../proxy/context-acl";
import type { TrustedActor } from "../security/request-actor";

/**
 * Spec 193 §7.4 / §7.5 — the recoverable bulk authorization run.
 *
 * The fault injection is real: a SQLite trigger aborts the durable audit
 * terminal of ONE document, and a second key that points at the same file
 * produces a genuine mid-run version conflict. Every assertion is on the
 * durable journal, the audit rows or the bytes on disk.
 */

let projectRoot: string;
let prevRoot: string | undefined;
let prevContent: string | undefined;
let prevAuditDb: string | undefined;

const OPERATOR: TrustedActor = {
  actorId: "operator-7",
  actorType: "ui_admin",
  accountUid: null,
  role: "owner",
  authMode: "required",
  sessionId: null,
  requestId: null,
  actorIp: null
};

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-wiki-batch-faults-"));
  await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevContent = process.env.LUCY_CONTENT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  prevAuditDb = process.env.LUCY_AUDIT_DB;
  // The global test setup points every suite at ONE shared audit database;
  // each test owns its own so the audit assertions are hermetic.
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  resetAuditDbForTests();
});

afterEach(async () => {
  closeSecurityStore();
  resetAuditDbForTests();
  if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = prevAuditDb;
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContent;
  await rm(projectRoot, { recursive: true, force: true });
});

async function writeDoc(key: string, frontmatter = "allowed_roles: [finance]\n", body = "# Doc\n"): Promise<string> {
  const abs = path.join(projectRoot, "wiki", key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `---\n${frontmatter}---\n${body}`, "utf8");
  return wikiContentHash(await readFile(abs, "utf8"));
}

async function storedAcl(key: string): Promise<ObjectAcl> {
  const raw = await readFile(path.join(projectRoot, "wiki", key), "utf8");
  const declaration = readAclDeclaration(raw);
  return parseObjectAcl(declaration.value, declaration.declared);
}

function openJournal(): SecurityStore {
  const opened = openSecurityStore(projectRoot);
  if (!opened.ok) throw new Error(`the security store is unavailable: ${opened.reason}`);
  return opened.value;
}

describe("Spec 193 §7.4 — a stale baseline rejects the WHOLE batch before any write", () => {
  it("rejects with 409 wiki_batch_preview_stale, zero file writes and zero journal rows", async () => {
    const versionA = await writeDoc("global/a.md");
    const versionB = await writeDoc("global/b.md");
    const items = [
      { key: "global/a.md", expected_version: versionA },
      { key: "global/b.md", expected_version: versionB }
    ];
    const action = { mode: "add", role_ids: ["ops"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-stale"
    });

    // Somebody changed one of the documents after the preview.
    await writeFile(
      path.join(projectRoot, "wiki", "global", "a.md"),
      "---\nallowed_roles: [finance]\n---\n# Doc changed\n",
      "utf8"
    );
    const bytesB = await readFile(path.join(projectRoot, "wiki", "global", "b.md"), "utf8");

    await expect(
      commitWikiAccessBatch(projectRoot, {
        operation_id: "wbo-stale",
        plan_digest: plan.plan_digest,
        idempotency_key: "idem-stale",
        items,
        action
      })
    ).rejects.toMatchObject({ code: "wiki_batch_preview_stale", statusCode: 409 });

    // Zero file writes.
    expect(await readFile(path.join(projectRoot, "wiki", "global", "b.md"), "utf8")).toBe(bytesB);
    expect(await storedAcl("global/b.md")).toEqual({ state: "roles", roles: ["finance"] });

    // Zero journal rows: no batch row and no item row exist.
    const journal = openJournal();
    try {
      const batch = journal.getWikiAccessBatch("wbo-stale");
      expect(batch.ok).toBe(true);
      if (batch.ok) expect(batch.value).toBeNull();
      const items = journal.listWikiAccessBatchItems("wbo-stale");
      expect(items.ok).toBe(true);
      if (items.ok) expect(items.value).toEqual([]);
    } finally {
      journal.close();
    }
  });
});

describe("Spec 193 §7.4 — a mid-run conflict is per-item", () => {
  it("marks the conflicting item and still runs the later items", async () => {
    const versionA = await writeDoc("global/a.md");
    const versionC = await writeDoc("global/c.md");
    const items = [
      { key: "global/a.md", expected_version: versionA },
      { key: "global/c.md", expected_version: versionC }
    ];
    const action = { mode: "add", role_ids: ["ops"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-conflict"
    });
    expect(plan.blocking).toBe(false);
    expect(plan.items).toHaveLength(2);

    // Spec 193 §7.4.4 — a change that arrives OUTSIDE the shared Wiki queue.
    // The batch holds that queue for the whole run, so an out-of-queue writer
    // cannot be scheduled through the normal API. The security state
    // notification is the deterministic seam: the first notification of this
    // commit happens while the FIRST document is being prepared, which is
    // before the loop reaches the second one.
    let injected = false;
    const unsubscribe = onSecurityStateChange(() => {
      if (injected) return;
      injected = true;
      writeFileSync(
        path.join(projectRoot, "wiki", "global", "c.md"),
        "---\nallowed_roles: [finance]\n---\n# Doc\n\nOut of band change.\n",
        "utf8"
      );
    });

    let result: Awaited<ReturnType<typeof commitWikiAccessBatch>>;
    try {
      result = await commitWikiAccessBatch(projectRoot, {
        operation_id: "wbo-conflict",
        plan_digest: plan.plan_digest,
        idempotency_key: "idem-conflict",
        items,
        action
      });
    } finally {
      unsubscribe();
    }
    expect(injected).toBe(true);

    const byKey = new Map(result.items.map((item) => [item.key, item]));
    expect(byKey.get("global/a.md")?.status).toBe("applied");
    expect(byKey.get("global/c.md")?.status).toBe("conflict");
    expect(byKey.get("global/c.md")?.error_code).toBe("wiki_write_conflict");

    expect(await storedAcl("global/a.md")).toEqual({ state: "roles", roles: ["finance", "ops"] });
    // The conflicting document kept the out-of-band bytes; the batch did NOT
    // overwrite them.
    const rawC = await readFile(path.join(projectRoot, "wiki", "global", "c.md"), "utf8");
    expect(rawC).toContain("Out of band change.");
    expect(await storedAcl("global/c.md")).toEqual({ state: "roles", roles: ["finance"] });

    // The per-item result is durable.
    const journal = openJournal();
    try {
      const rows = journal.listWikiAccessBatchItems("wbo-conflict");
      expect(rows.ok).toBe(true);
      if (!rows.ok) return;
      const conflict = rows.value.find((row) => row.wikiKey === "global/c.md");
      expect(conflict?.status).toBe("conflict");
      expect(conflict?.errorCode).toBe("wiki_write_conflict");
    } finally {
      journal.close();
    }
  });
});

describe("Spec 193 §7.4 — a systemic failure stops the remaining items", () => {
  it("marks the failing item and the later items `not_run`, without further Wiki writes", async () => {
    const versionA = await writeDoc("global/a.md");
    const versionB = await writeDoc("global/b.md");
    const versionC = await writeDoc("global/c.md");
    const items = [
      { key: "global/a.md", expected_version: versionA },
      { key: "global/b.md", expected_version: versionB },
      { key: "global/c.md", expected_version: versionC }
    ];
    const action = { mode: "add", role_ids: ["ops"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-systemic"
    });

    // A REAL durable-audit fault: the terminal record of ONE document can no
    // longer be written.
    const auditDb = await getAuditDb();
    auditDb.exec(`
      CREATE TRIGGER inject_terminal_failure
      BEFORE UPDATE ON config_change_log
      WHEN OLD.target_id = 'global/b.md'
      BEGIN
        SELECT RAISE(ABORT, 'injected audit terminal failure');
      END;
    `);

    const result = await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-systemic",
      plan_digest: plan.plan_digest,
      idempotency_key: "idem-systemic",
      items,
      action
    });

    const byKey = new Map(result.items.map((item) => [item.key, item]));
    expect(byKey.get("global/a.md")?.status).toBe("applied");
    expect(byKey.get("global/b.md")?.status).toBe("failed");
    expect(byKey.get("global/b.md")?.error_code).toBe("config_audit_unavailable");
    expect(byKey.get("global/c.md")?.status).toBe("not_run");
    expect(byKey.get("global/c.md")?.error_code).toBe("wiki_batch_stopped");
    expect(result.status).toBe("failed");

    // The failed document was rolled back to its previous bytes.
    expect(await storedAcl("global/b.md")).toEqual({ state: "roles", roles: ["finance"] });
    // The later document was NEVER written.
    expect(await storedAcl("global/c.md")).toEqual({ state: "roles", roles: ["finance"] });
    // The successful one is applied.
    expect(await storedAcl("global/a.md")).toEqual({ state: "roles", roles: ["finance", "ops"] });
  });

  it("stops the run when the audit database fails with an unmapped driver error", async () => {
    const versionA = await writeDoc("global/a.md");
    const versionB = await writeDoc("global/b.md");
    const versionC = await writeDoc("global/c.md");
    const items = [
      { key: "global/a.md", expected_version: versionA },
      { key: "global/b.md", expected_version: versionB },
      { key: "global/c.md", expected_version: versionC }
    ];
    const action = { mode: "add", role_ids: ["ops"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-raw-audit"
    });

    // The durable audit INTENT of ONE document can no longer be written. The
    // raw SQLite error is not one of the codes the audit layer maps itself,
    // so it reaches the coordinator unchanged.
    const auditDb = await getAuditDb();
    auditDb.exec(`
      CREATE TRIGGER inject_intent_failure
      BEFORE INSERT ON config_change_log
      WHEN NEW.target_id = 'global/b.md'
      BEGIN
        SELECT RAISE(ABORT, 'injected audit intent failure');
      END;
    `);

    const result = await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-raw-audit",
      plan_digest: plan.plan_digest,
      idempotency_key: "idem-raw-audit",
      items,
      action
    });

    const byKey = new Map(result.items.map((item) => [item.key, item]));
    expect(byKey.get("global/a.md")?.status).toBe("applied");
    expect(byKey.get("global/b.md")?.status).toBe("failed");
    expect(byKey.get("global/b.md")?.error_code).toBe("config_audit_unavailable");
    // Spec 193 §7.4.5 — an audit-library failure is SYSTEMIC: the remaining
    // documents are NOT written and are marked `not_run`.
    expect(byKey.get("global/c.md")?.status).toBe("not_run");
    expect(byKey.get("global/c.md")?.error_code).toBe("wiki_batch_stopped");
    expect(result.status).toBe("failed");

    // The failing document was not written.
    expect(await storedAcl("global/b.md")).toEqual({ state: "roles", roles: ["finance"] });
    // The later document was never written either.
    expect(await storedAcl("global/c.md")).toEqual({ state: "roles", roles: ["finance"] });
  });
});

describe("Spec 193 §7.5 — the idempotency binding", () => {
  it("the same key and digest returns the prior status without writing twice", async () => {
    const version = await writeDoc("global/a.md");
    const items = [{ key: "global/a.md", expected_version: version }];
    const action = { mode: "add", role_ids: ["ops"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-idem"
    });
    const first = await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-idem",
      plan_digest: plan.plan_digest,
      idempotency_key: "idem-replay",
      items,
      action
    });
    expect(first.items[0]?.status).toBe("applied");

    // The document is changed back outside the batch: the replay must NOT
    // re-validate the old baseline and must NOT write a second time.
    await writeFile(
      path.join(projectRoot, "wiki", "global", "a.md"),
      "---\nallowed_roles: [finance]\n---\n# Doc reverted\n",
      "utf8"
    );
    const versionsAfterFirst = (await listWikiVersions(projectRoot, "global/a.md")).versions.length;

    const replay = await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-idem",
      plan_digest: plan.plan_digest,
      idempotency_key: "idem-replay",
      items,
      action
    });
    expect(replay.status).toBe("completed");
    expect(replay.items[0]?.status).toBe("applied");
    expect(replay.plan_digest).toBe(plan.plan_digest);

    // The file was NOT written a second time.
    expect(await storedAcl("global/a.md")).toEqual({ state: "roles", roles: ["finance"] });
    expect((await listWikiVersions(projectRoot, "global/a.md")).versions).toHaveLength(versionsAfterFirst);
  });

  it("the same key with a different digest is a 409 idempotency conflict", async () => {
    const version = await writeDoc("global/a.md");
    const items = [{ key: "global/a.md", expected_version: version }];

    const firstPlan = await previewWikiAccessBatch(projectRoot, {
      items,
      action: { mode: "add", role_ids: ["ops"] },
      operation_id: "wbo-idem-1"
    });
    await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-idem-1",
      plan_digest: firstPlan.plan_digest,
      idempotency_key: "idem-conflict",
      items,
      action: { mode: "add", role_ids: ["ops"] }
    });

    const secondPlan = await previewWikiAccessBatch(projectRoot, {
      items: [{ key: "global/a.md", expected_version: wikiContentHash(await readFile(path.join(projectRoot, "wiki", "global", "a.md"), "utf8")) }],
      action: { mode: "add", role_ids: ["auditor"] },
      operation_id: "wbo-idem-2"
    });
    expect(secondPlan.plan_digest).not.toBe(firstPlan.plan_digest);

    await expect(
      commitWikiAccessBatch(projectRoot, {
        operation_id: "wbo-idem-2",
        plan_digest: secondPlan.plan_digest,
        idempotency_key: "idem-conflict",
        items,
        action: { mode: "add", role_ids: ["auditor"] }
      })
    ).rejects.toMatchObject({ code: "wiki_batch_idempotency_conflict", statusCode: 409 });
  });
});

describe("Spec 193 §7.5 — every file keeps its own trusted audit row", () => {
  it("uses the shared batch operation id as the request id and the trusted actor", async () => {
    const versionA = await writeDoc("global/a.md");
    const versionB = await writeDoc("global/b.md");
    const items = [
      { key: "global/a.md", expected_version: versionA },
      { key: "global/b.md", expected_version: versionB }
    ];
    const action = { mode: "add", role_ids: ["ops"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-audit"
    });
    await commitWikiAccessBatch(
      projectRoot,
      {
        operation_id: "wbo-audit",
        plan_digest: plan.plan_digest,
        idempotency_key: "idem-audit",
        items,
        action,
        // A body-supplied actor is never read.
        actor: "mallory"
      } as never,
      OPERATOR
    );

    const db = await getAuditDb();
    const rows = db
      .prepare(
        "SELECT file_path, actor, actor_type, request_id, operation, change_type FROM config_change_log WHERE file_path IN ('wiki/global/a.md', 'wiki/global/b.md') ORDER BY file_path ASC"
      )
      .all() as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.actor).toBe("operator-7");
      expect(row.actor).not.toBe("mallory");
      expect(row.actor_type).toBe("ui_admin");
      expect(row.request_id).toBe("wbo-audit");
      expect(row.operation).toBe("access_update");
      expect(row.change_type).toBe("wiki_access_update");
    }
  });
});

describe("Spec 193 §7.5 — a restart reconciles the journal without continuing the loop", () => {
  it("never auto-commits a widening and never replays the write", async () => {
    const original = "---\nallowed_roles: [finance]\n---\n# Doc\n";
    const version = await writeDoc("global/a.md");
    const widened = "---\nallowed_roles: [finance, ops]\n---\n# Doc\n";

    // A journal that was created but never finished.
    const store = await getSecurityStore();
    expect(store.ok).toBe(true);
    if (!store.ok) return;
    const created = store.value.createWikiAccessBatch({
      operationId: "wbo-restart",
      planDigest: "wbd-restart",
      idempotencyKey: "idem-restart",
      actionJson: JSON.stringify({ mode: "add", role_ids: ["ops"] }),
      roleChannelVersion: "rcv-restart",
      items: [{ wikiKey: "global/a.md", expectedVersion: version, aclSummary: "roles:finance,ops", direction: "widen" }]
    });
    expect(created.ok).toBe(true);

    // The crash: the widening bytes reached the disk, the security operation
    // was prepared but never committed.
    await writeFile(path.join(projectRoot, "wiki", "global", "a.md"), widened, "utf8");
    const operationId = `wac-${randomUUID()}`;
    const prepared = store.value.prepareWikiAccessOperation({
      operationId,
      wikiKey: "global/a.md",
      direction: "widen",
      actor: "operator-7",
      actorType: "ui_admin",
      oldHash: version,
      targetHash: wikiContentHash(widened),
      summary: "wiki_access:global/a.md"
    });
    expect(prepared.ok).toBe(true);
    invalidateWikiAccessHoldCache();

    // ── the restart ──
    closeSecurityStore();

    const report = await recoverWikiAccessOperations();
    expect(report.needsReview).toContain(operationId);
    expect(report.committed).not.toContain(operationId);
    expect(report.holdWidening).toBe(true);

    // The widening is NOT committed and the hold stays.
    const after = await getSecurityStore();
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const record = after.value.getWikiAccessOperation(operationId);
    expect(record.ok).toBe(true);
    if (record.ok) expect(record.value?.state).toBe("needs_review");
    expect(await isWikiKeyHeld("global/a.md")).toBe(true);

    // The write was NOT replayed and the loop did NOT continue.
    expect(await readFile(path.join(projectRoot, "wiki", "global", "a.md"), "utf8")).toBe(widened);
    expect((await listWikiVersions(projectRoot, "global/a.md")).versions).toHaveLength(0);

    const readBack = await getWikiAccessBatchResult("wbo-restart");
    expect(readBack?.items[0]?.status).toBe("needs_review");
    expect(readBack?.status).toBe("pending");
  });
});

describe("Spec 193 §7.5 — the journal stores metadata only", () => {
  it("contains no body, no secret, no credential and no absolute path", async () => {
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n", "# Secret Body\n");
    const items = [{ key: "global/a.md", expected_version: version }];
    const action = { mode: "add", role_ids: ["ops"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-journal"
    });
    await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-journal",
      plan_digest: plan.plan_digest,
      idempotency_key: "idem-journal",
      items,
      action
    });

    const db = new Database(path.join(projectRoot, ".ktx-ui", "security.sqlite"), { readonly: true });
    try {
      const batches = db.prepare("SELECT * FROM wiki_access_batches").all() as Array<Record<string, unknown>>;
      const itemRows = db.prepare("SELECT * FROM wiki_access_batch_items").all() as Array<Record<string, unknown>>;
      expect(batches).toHaveLength(1);
      expect(itemRows).toHaveLength(1);

      const serialized = JSON.stringify({ batches, itemRows });
      expect(serialized).not.toContain(projectRoot);
      expect(serialized).not.toContain("/var/folders");
      expect(serialized).not.toContain("Secret Body");
      expect(serialized).not.toContain("# Doc");
      for (const forbidden of ["password", "secret", "token", "credential", "authorization"]) {
        expect(serialized.toLowerCase()).not.toContain(forbidden);
      }

      // The row carries the key, the version, the ACL summary and the status.
      const item = itemRows[0];
      expect(item?.wiki_key).toBe("global/a.md");
      expect(item?.expected_version).toBe(version);
      expect(item?.acl_summary).toBe("roles:finance,ops");
      expect(item?.status).toBe("applied");
    } finally {
      db.close();
    }
  });
});
