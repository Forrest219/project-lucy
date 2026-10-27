import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAuditDbForTests } from "../admin/audit";
import { openSecurityStore } from "../security/store";
import type {
  SecurityResult,
  WikiAccessBatchItemRecord,
  WikiAccessBatchRecord
} from "../security/types";
import { closeSecurityStore } from "../security/instance";
import {
  commitWikiAccessBatch,
  getWikiAccessBatchResult,
  normalizeBatchAction,
  normalizeBatchSelection,
  previewWikiAccessBatch,
  WIKI_BATCH_MAX_DOCUMENTS
} from "../wiki-access-batch";
import { listWikiVersions } from "../wiki";
import { wikiContentHash } from "../wiki-hash";
import { readAclDeclaration } from "../wiki-access-operation";
import { parseObjectAcl, type ObjectAcl } from "../proxy/context-acl";

/**
 * Spec 193 §7 — the recoverable bulk authorization run.
 *
 * The selection contract (1–100 unique keys after dedup), the per-item plan,
 * the two actions and the durable journal are asserted against the real
 * service, the real bytes and the real SQLite rows.
 */

let projectRoot: string;
let prevRoot: string | undefined;
let prevContent: string | undefined;
let prevAuditDb: string | undefined;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-wiki-batch-"));
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

async function writeDoc(key: string, frontmatter: string, body = "# Doc\n"): Promise<string> {
  const abs = path.join(projectRoot, "wiki", key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `---\n${frontmatter}---\n${body}`, "utf8");
  return wikiContentHash(await readFile(abs, "utf8"));
}

async function storedRaw(key: string): Promise<string> {
  return readFile(path.join(projectRoot, "wiki", key), "utf8");
}

/** The canonical ACL that is actually persisted for a document. */
async function storedAcl(key: string): Promise<ObjectAcl> {
  const raw = await storedRaw(key);
  const declaration = readAclDeclaration(raw);
  return parseObjectAcl(declaration.value, declaration.declared);
}

function journalRows(operationId: string): {
  batch: SecurityResult<WikiAccessBatchRecord | null>;
  items: SecurityResult<WikiAccessBatchItemRecord[]>;
} {
  const opened = openSecurityStore(projectRoot);
  if (!opened.ok) throw new Error(`the security store is unavailable: ${opened.reason}`);
  try {
    return {
      batch: opened.value.getWikiAccessBatch(operationId),
      items: opened.value.listWikiAccessBatchItems(operationId)
    };
  } finally {
    opened.value.close();
  }
}

describe("Spec 193 §7.3 — the selection is 1–100 unique keys after deduplication", () => {
  it("merges identical duplicate keys", async () => {
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const selection = normalizeBatchSelection([
      { key: "global/a.md", expected_version: version },
      { key: "global/a.md", expected_version: version },
      { key: "global/a.md", expected_version: version }
    ]);
    expect(selection.items).toEqual([{ key: "global/a.md", expected_version: version }]);
  });

  it("rejects the same key with two different versions", async () => {
    await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    expect(() =>
      normalizeBatchSelection([
        { key: "global/a.md", expected_version: "sha256:aaa" },
        { key: "global/a.md", expected_version: "sha256:bbb" }
      ])
    ).toThrowError(expect.objectContaining({ code: "wiki_batch_preview_stale", statusCode: 409 }));
  });

  it("canonicalizes the key BEFORE deduplicating (§7.3)", async () => {
    // Two spellings of the SAME document are one item, not two.
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const selection = normalizeBatchSelection([
      { key: "global/a.md", expected_version: version },
      { key: "global/b/../a.md", expected_version: version }
    ]);
    expect(selection.items).toEqual([{ key: "global/a.md", expected_version: version }]);
  });

  it("rejects the same canonical key with two different versions", async () => {
    await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    expect(() =>
      normalizeBatchSelection([
        { key: "global/a.md", expected_version: "sha256:aaa" },
        { key: "global/b/../a.md", expected_version: "sha256:bbb" }
      ])
    ).toThrowError(expect.objectContaining({ code: "wiki_batch_preview_stale", statusCode: 409 }));
  });

  it("keeps an illegal key as a per-item problem instead of throwing", async () => {
    // The key cannot name a Wiki document, so the plan reports it as a missing
    // document. It must NOT abort the whole batch with an unhandled error.
    await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const plan = await previewWikiAccessBatch(projectRoot, {
      items: [
        { key: "global/a.md", expected_version: version },
        { key: "../outside.md", expected_version: "sha256:zzz" }
      ],
      action: { mode: "add", role_ids: ["ops"] },
      operation_id: "wbo-illegal-key"
    });
    expect(plan.items).toHaveLength(2);
    const illegal = plan.items.find((item) => item.key === "../outside.md");
    expect(illegal?.issues.some((issue) => issue.blocking)).toBe(true);
    expect(illegal?.issues.map((issue) => issue.code)).toContain("wiki_batch_document_missing");
  });

  it("rejects an empty selection and creates no operation", async () => {
    expect(() => normalizeBatchSelection([])).toThrowError(
      expect.objectContaining({ code: "wiki_batch_empty", statusCode: 400 })
    );
    await expect(
      commitWikiAccessBatch(projectRoot, {
        operation_id: "wbo-empty",
        plan_digest: "wbd-empty",
        idempotency_key: "idem-empty",
        items: [],
        action: { mode: "add", role_ids: ["finance"] }
      })
    ).rejects.toMatchObject({ code: "wiki_batch_empty", statusCode: 400 });

    const journal = journalRows("wbo-empty");
    expect(journal.batch.ok && journal.batch.value).toBeNull();
    expect(journal.items.ok && journal.items.value).toEqual([]);
  });

  it("accepts exactly 100 unique keys", async () => {
    const items: Array<{ key: string; expected_version: string }> = [];
    for (let index = 0; index < WIKI_BATCH_MAX_DOCUMENTS; index += 1) {
      const key = `global/doc-${String(index).padStart(3, "0")}.md`;
      items.push({ key, expected_version: await writeDoc(key, "allowed_roles: [finance]\n") });
    }
    expect(items).toHaveLength(100);

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action: { mode: "add", role_ids: ["ops"] },
      operation_id: "wbo-100"
    });
    expect(plan.items).toHaveLength(100);
    expect(plan.blocking).toBe(false);
    expect(plan.summary.total).toBe(100);
  });

  it("rejects 101 unique keys and creates no operation", async () => {
    const items: Array<{ key: string; expected_version: string }> = [];
    for (let index = 0; index < WIKI_BATCH_MAX_DOCUMENTS + 1; index += 1) {
      const key = `global/doc-${String(index).padStart(3, "0")}.md`;
      items.push({ key, expected_version: await writeDoc(key, "allowed_roles: [finance]\n") });
    }

    expect(() => normalizeBatchSelection(items)).toThrowError(
      expect.objectContaining({ code: "wiki_batch_limit_exceeded", statusCode: 400 })
    );

    await expect(
      commitWikiAccessBatch(projectRoot, {
        operation_id: "wbo-101",
        plan_digest: "wbd-101",
        idempotency_key: "idem-101",
        items,
        action: { mode: "add", role_ids: ["ops"] }
      })
    ).rejects.toMatchObject({ code: "wiki_batch_limit_exceeded", statusCode: 400 });

    const journal = journalRows("wbo-101");
    expect(journal.batch.ok && journal.batch.value).toBeNull();
    expect(journal.items.ok && journal.items.value).toEqual([]);
  });

  it("enforces the limit AFTER deduplication and ignores a request-supplied limit", async () => {
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const duplicated = Array.from({ length: 500 }, () => ({ key: "global/a.md", expected_version: version }));
    expect(normalizeBatchSelection(duplicated).items).toHaveLength(1);

    const items: Array<{ key: string; expected_version: string }> = [];
    for (let index = 0; index < WIKI_BATCH_MAX_DOCUMENTS + 1; index += 1) {
      const key = `global/doc-${String(index).padStart(3, "0")}.md`;
      items.push({ key, expected_version: await writeDoc(key, "allowed_roles: [finance]\n") });
    }
    await expect(
      commitWikiAccessBatch(projectRoot, {
        operation_id: "wbo-limit",
        plan_digest: "wbd-limit",
        idempotency_key: "idem-limit",
        items,
        action: { mode: "add", role_ids: ["ops"] },
        // A request must never be able to raise the server-side limit.
        limit: 1000,
        max_documents: 1000
      } as never)
    ).rejects.toMatchObject({ code: "wiki_batch_limit_exceeded", statusCode: 400 });
  });
});

describe("Spec 193 §7.2 — the two actions and their limits", () => {
  it("refuses `add` without a role and with the wildcard", async () => {
    expect(() => normalizeBatchAction({ mode: "add", role_ids: [] })).toThrowError(
      expect.objectContaining({ code: "wiki_batch_empty", statusCode: 400 })
    );
    expect(() => normalizeBatchAction({ mode: "add", role_ids: ["*"] })).toThrowError(
      expect.objectContaining({ code: "CONTEXT_ACL_INVALID", statusCode: 400 })
    );
    expect(normalizeBatchAction({ mode: "add", role_ids: ["b", "a", "a"] })).toEqual({
      mode: "add",
      role_ids: ["a", "b"]
    });
  });

  it("requires its own confirmation for an empty and for an all-roles replacement", async () => {
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const items = [{ key: "global/a.md", expected_version: version }];

    const emptyPlan = await previewWikiAccessBatch(projectRoot, {
      items,
      action: { mode: "replace", allowed_roles: [] },
      operation_id: "wbo-empty-acl"
    });
    expect(emptyPlan.items[0]?.next_acl).toEqual({ state: "empty" });
    await expect(
      commitWikiAccessBatch(projectRoot, {
        operation_id: "wbo-empty-acl",
        plan_digest: emptyPlan.plan_digest,
        idempotency_key: "idem-empty-acl",
        items,
        action: { mode: "replace", allowed_roles: [] }
      })
    ).rejects.toMatchObject({ code: "wiki_batch_blocked", statusCode: 400 });
    expect(await storedAcl("global/a.md")).toEqual({ state: "roles", roles: ["finance"] });

    const allPlan = await previewWikiAccessBatch(projectRoot, {
      items,
      action: { mode: "replace", allowed_roles: ["*"] },
      operation_id: "wbo-all-acl"
    });
    expect(allPlan.items[0]?.next_acl).toEqual({ state: "all" });
    await expect(
      commitWikiAccessBatch(projectRoot, {
        operation_id: "wbo-all-acl",
        plan_digest: allPlan.plan_digest,
        idempotency_key: "idem-all-acl",
        items,
        action: { mode: "replace", allowed_roles: ["*"] }
      })
    ).rejects.toMatchObject({ code: "wiki_batch_blocked", statusCode: 400 });
    expect(await storedAcl("global/a.md")).toEqual({ state: "roles", roles: ["finance"] });
  });
});

describe("Spec 193 §7.3 — the preview reports the per-item differences", () => {
  it("marks a missing document and a corrupt ACL as blocking", async () => {
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    await writeDoc("global/corrupt.md", "allowed_roles: ['*', finance]\n");

    const missingPlan = await previewWikiAccessBatch(projectRoot, {
      items: [
        { key: "global/a.md", expected_version: version },
        { key: "global/gone.md", expected_version: "sha256:whatever" }
      ],
      action: { mode: "add", role_ids: ["ops"] },
      operation_id: "wbo-missing"
    });
    const missingItem = missingPlan.items.find((item) => item.key === "global/gone.md");
    expect(missingItem?.issues.some((issue) => issue.code === "wiki_batch_document_missing" && issue.blocking)).toBe(true);
    expect(missingPlan.blocking).toBe(true);
    expect(missingPlan.summary.blocking).toBe(1);

    await expect(
      commitWikiAccessBatch(projectRoot, {
        operation_id: "wbo-missing",
        plan_digest: missingPlan.plan_digest,
        idempotency_key: "idem-missing",
        items: [
          { key: "global/a.md", expected_version: version },
          { key: "global/gone.md", expected_version: "sha256:whatever" }
        ],
        action: { mode: "add", role_ids: ["ops"] }
      })
    ).rejects.toMatchObject({ code: "wiki_batch_blocked", statusCode: 400 });

    const corruptPlan = await previewWikiAccessBatch(projectRoot, {
      items: [{ key: "global/corrupt.md" }],
      action: { mode: "add", role_ids: ["ops"] },
      operation_id: "wbo-corrupt"
    });
    const corruptItem = corruptPlan.items[0];
    expect(corruptItem?.current_acl.state).toBe("corrupt");
    expect(corruptItem?.issues.some((issue) => issue.code === "wiki_batch_acl_corrupt" && issue.blocking)).toBe(true);
    expect(corruptPlan.blocking).toBe(true);
    expect(corruptPlan.summary.corrupt).toBe(1);
  });

  it("shows the old and the new ACL, the direction, the no-op flag and the summary", async () => {
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const plan = await previewWikiAccessBatch(projectRoot, {
      items: [{ key: "global/a.md", expected_version: version }],
      action: { mode: "add", role_ids: ["ops"] },
      operation_id: "wbo-plan"
    });

    const item = plan.items[0];
    expect(item?.key).toBe("global/a.md");
    expect(item?.file_version).toBe(version);
    expect(item?.current_acl).toEqual({ state: "roles", roles: ["finance"] });
    expect(item?.next_acl).toEqual({ state: "roles", roles: ["finance", "ops"] });
    expect(item?.direction).toBe("widen");
    expect(item?.noop).toBe(false);
    expect(plan.summary).toMatchObject({
      total: 1,
      widening: 1,
      narrowing: 0,
      unchanged: 0,
      corrupt: 0,
      blocking: 0
    });
    expect(plan.plan_digest).toMatch(/^wbd-[0-9a-f]{32}$/);
    expect(plan.role_channel_version).toMatch(/^rcv-[0-9a-f]{32}$/);
  });

  it("keeps the plan_digest stable and changes it when a baseline changes", async () => {
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const items = [{ key: "global/a.md", expected_version: version }];

    const first = await previewWikiAccessBatch(projectRoot, {
      items,
      action: { mode: "add", role_ids: ["ops"] },
      operation_id: "wbo-digest"
    });
    const second = await previewWikiAccessBatch(projectRoot, {
      items,
      action: { mode: "add", role_ids: ["ops"] },
      operation_id: "wbo-digest"
    });
    expect(second.plan_digest).toBe(first.plan_digest);

    // A different baseline produces a different digest.
    await writeFile(
      path.join(projectRoot, "wiki", "global", "a.md"),
      "---\nallowed_roles: [finance]\n---\n# Doc changed\n",
      "utf8"
    );
    const third = await previewWikiAccessBatch(projectRoot, {
      items: [{ key: "global/a.md", expected_version: version }],
      action: { mode: "add", role_ids: ["ops"] },
      operation_id: "wbo-digest"
    });
    expect(third.plan_digest).not.toBe(first.plan_digest);
  });
});

describe("Spec 193 §7.4 — the commit writes the per-document result", () => {
  it("`add` performs the per-file union", async () => {
    const versionA = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const versionB = await writeDoc("global/b.md", "allowed_roles: [ops]\n");
    const items = [
      { key: "global/a.md", expected_version: versionA },
      { key: "global/b.md", expected_version: versionB }
    ];
    const action = { mode: "add", role_ids: ["auditor"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-union"
    });
    const result = await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-union",
      plan_digest: plan.plan_digest,
      idempotency_key: "idem-union",
      items,
      action
    });

    expect(result.status).toBe("completed");
    expect(result.items.map((item) => item.status)).toEqual(["applied", "applied"]);
    expect(await storedAcl("global/a.md")).toEqual({ state: "roles", roles: ["auditor", "finance"] });
    expect(await storedAcl("global/b.md")).toEqual({ state: "roles", roles: ["auditor", "ops"] });
  });

  it("`replace` repairs a corrupt ACL and writes the exact value", async () => {
    await writeDoc("global/corrupt.md", "allowed_roles: ['*', finance]\n");
    const items = [{ key: "global/corrupt.md" }];
    const action = { mode: "replace", allowed_roles: ["finance"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-replace"
    });
    expect(plan.items[0]?.current_acl.state).toBe("corrupt");
    expect(plan.items[0]?.next_acl).toEqual({ state: "roles", roles: ["finance"] });

    const result = await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-replace",
      plan_digest: plan.plan_digest,
      idempotency_key: "idem-replace",
      items,
      action
    });
    expect(result.items[0]?.status).toBe("applied");

    expect(await storedAcl("global/corrupt.md")).toEqual({ state: "roles", roles: ["finance"] });
    expect(await storedRaw("global/corrupt.md")).not.toContain("*");
  });

  it("a no-op item creates no redundant version", async () => {
    const version = await writeDoc("global/same.md", "allowed_roles: [finance]\n");
    const items = [{ key: "global/same.md", expected_version: version }];
    const action = { mode: "replace", allowed_roles: ["finance"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-noop"
    });
    expect(plan.items[0]?.noop).toBe(true);

    const result = await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-noop",
      plan_digest: plan.plan_digest,
      idempotency_key: "idem-noop",
      items,
      action
    });
    expect(result.items[0]?.status).toBe("noop");
    expect((await listWikiVersions(projectRoot, "global/same.md")).versions).toHaveLength(0);
    expect(await storedAcl("global/same.md")).toEqual({ state: "roles", roles: ["finance"] });
    expect(await storedRaw("global/same.md")).toBe("---\nallowed_roles: [finance]\n---\n# Doc\n");
  });

  it("the durable result can be read back by its operation id", async () => {
    const version = await writeDoc("global/a.md", "allowed_roles: [finance]\n");
    const items = [{ key: "global/a.md", expected_version: version }];
    const action = { mode: "add", role_ids: ["ops"] } as const;

    const plan = await previewWikiAccessBatch(projectRoot, {
      items,
      action,
      operation_id: "wbo-readback"
    });
    await commitWikiAccessBatch(projectRoot, {
      operation_id: "wbo-readback",
      plan_digest: plan.plan_digest,
      idempotency_key: "idem-readback",
      items,
      action
    });

    const readBack = await getWikiAccessBatchResult("wbo-readback");
    expect(readBack?.operation_id).toBe("wbo-readback");
    expect(readBack?.plan_digest).toBe(plan.plan_digest);
    expect(readBack?.items[0]?.status).toBe("applied");

    const journal = journalRows("wbo-readback");
    expect(journal.batch.ok && journal.batch.value?.status).toBe("completed");
    expect(journal.items.ok && journal.items.value[0]?.wikiKey).toBe("global/a.md");
  });
});
