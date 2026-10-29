// Lucy v0.25 / L25-11 — D16/D18/D19/D20: the recovery journal lifecycle and
// the activation state of a release.
//
// Coverage:
//  - The journal is NOT closed after the promote: it enters the "files saved"
//    phase and stays open until the index and the terminal evidence are
//    durable (Spec §7.2).
//  - A startup recovery does NOT roll back a journal in the "files saved"
//    phase: the written content is proven, only the activation is unknown.
//  - A startup recovery DOES roll back a journal that was still writing.
//  - `published` is written only after the final digest verification; the
//    release carries `activationStatus = confirmed` and the journal is
//    completed only then.
//  - A reindex failure keeps the saved files with `activationStatus =
//    unconfirmed` — the activation is never claimed.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  atomicReplaceTarget,
  completeRecoveryJournal,
  createRecoveryJournal,
  listOpenRecoveryJournals,
  markRecoveryJournalFilesSaved,
  readRecoveryJournal,
  recoverPendingRecoveryJournals
} from "../semantic-recovery-journal";

let projectRoot: string;
let previousContentRoot: string | undefined;

const TARGET = "semantic-layer/shop-db/orders.yaml";

async function writeFileAt(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

beforeEach(async () => {
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-journal-"));
  await writeFileAt("ktx.yaml", "connections: {}\n");
  await writeFileAt(TARGET, "name: orders\n");
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("D16 — the journal phase decides what a startup recovery may do", () => {
  it("rolls back a journal that was still writing", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel-1",
      operationId: "op-1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET, newContent: "name: orders-v2\n" }]
    });
    // The rename landed but the journal update did not.
    await atomicReplaceTarget(projectRoot, TARGET, "name: orders-v2\n");

    const outcome = await recoverPendingRecoveryJournals(projectRoot);

    expect(outcome.recovered).toContain(journal.journalId);
    expect(outcome.activationPending).toHaveLength(0);
    expect(await readFile(path.join(projectRoot, TARGET), "utf8")).toBe("name: orders\n");
  });

  it("does NOT roll back a journal whose files were already saved", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel-2",
      operationId: "op-2",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET, newContent: "name: orders-v2\n" }]
    });
    await atomicReplaceTarget(projectRoot, TARGET, "name: orders-v2\n");
    await markRecoveryJournalFilesSaved(projectRoot, journal.journalId);

    const outcome = await recoverPendingRecoveryJournals(projectRoot);

    // The content is proven; only the activation is unknown. Rolling back here
    // would destroy a completed write because of a missing index.
    expect(outcome.recovered).toHaveLength(0);
    expect(outcome.activationPending).toContain(journal.journalId);
    expect(outcome.needsRepair).toHaveLength(0);
    expect(await readFile(path.join(projectRoot, TARGET), "utf8")).toBe("name: orders-v2\n");

    // The journal stays open so the index can be retried.
    const open = await listOpenRecoveryJournals(projectRoot);
    expect(open.map((entry) => entry.journalId)).toContain(journal.journalId);
  });

  it("only completes the journal when the caller says every evidence is durable", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel-3",
      operationId: "op-3",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET, newContent: "name: orders-v2\n" }]
    });
    expect(journal.phase).toBe("write_in_progress");

    const saved = await markRecoveryJournalFilesSaved(projectRoot, journal.journalId);
    expect(saved?.phase).toBe("files_saved");
    expect(saved?.status).toBe("open");

    const completed = await completeRecoveryJournal(projectRoot, journal.journalId);
    expect(completed?.phase).toBe("completed");
    expect(completed?.status).toBe("completed");
    expect((await listOpenRecoveryJournals(projectRoot)).map((e) => e.journalId)).not.toContain(
      journal.journalId
    );
  });
});

// ─── The publish state machine ─────────────────────────────────────────────

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

const OVERLAY = `name: orders
table: public.orders
grain:
  - id
`;

describe("D19/D20 — the activation state of a release", () => {
  let previousRoot: string | undefined;

  beforeEach(async () => {
    previousRoot = process.env.KTX_PROJECT_ROOT;
    await writeFileAt("ktx.yaml", KTX_YAML);
    await writeFileAt("semantic-layer/shop-db/_schema/public.yaml", MANIFEST);
    await writeFileAt("semantic-layer/shop-db/orders.yaml", "name: orders\ntable: public.orders\n");
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
  });

  it("keeps the journal open and the activation unconfirmed until the index is done", async () => {
    vi.resetModules();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    let resolveReindex: () => void = () => undefined;
    const reindexDone = new Promise<void>((r) => {
      resolveReindex = r;
    });
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
        reindexProject: vi.fn(async () => {
          await reindexDone;
          return { exitCode: 0, stdout: "indexed", stderr: "" };
        })
      };
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();

    const validate = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({ files: [{ filename: "orders.yaml", content: OVERLAY }] });
    expect(validate.status).toBe(200);

    const publish = await request(app.server)
      .post("/api/semantic-assets/publish")
      .send({ validationId: validate.body.data.validationId, confirmOverwrite: true });
    expect(publish.status).toBe(200);
    const releaseId = publish.body.data.release.id as string;

    // The response says "reindexing", NOT "published": the HTTP accepted only
    // means the request was taken.
    expect(publish.body.data.release.status).toBe("reindexing");
    expect(publish.body.data.release.activationStatus).toBe("unconfirmed");

    // The journal is still open: the files are saved, the activation is not
    // proven yet.
    const openDuringReindex = await listOpenRecoveryJournals(projectRoot);
    expect(openDuringReindex).toHaveLength(1);
    expect(openDuringReindex[0]?.phase).toBe("files_saved");

    // Let the index finish.
    resolveReindex();
    const deadline = Date.now() + 5_000;
    let record: Record<string, unknown> | null = null;
    for (;;) {
      const status = await request(app.server).get(
        `/api/semantic-assets/releases/${releaseId}/status`
      );
      record = status.body.data.release as Record<string, unknown>;
      if (record?.status === "published" || Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(record?.status).toBe("published");
    expect(record?.activationStatus).toBe("confirmed");
    // Only now is the journal closed.
    expect(await listOpenRecoveryJournals(projectRoot)).toHaveLength(0);
    await app.close();
  });

  it("does not release the publish lock until the release is published", async () => {
    vi.resetModules();
    process.env.KTX_PROJECT_ROOT = projectRoot;
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

    const { buildServer } = await import("../index");
    const { publishSemanticAssets, readSemanticAssetRelease } = await import("../semantic-assets");
    const app = buildServer();
    await app.ready();

    const validate = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({ files: [{ filename: "orders.yaml", content: OVERLAY }] });
    expect(validate.status).toBe(200);

    let releaseId = "";
    let statusAtRelease = "";
    const response = await publishSemanticAssets(
      projectRoot,
      { validationId: validate.body.data.validationId, confirmOverwrite: true },
      {
        reindexImpl: async () => ({ exitCode: 0, stdout: "indexed", stderr: "" }),
        beforeLockRelease: async () => {
          const record = await readSemanticAssetRelease(projectRoot, releaseId);
          statusAtRelease = record?.status ?? "missing";
        }
      }
    );
    releaseId = response.release.id;

    const deadline = Date.now() + 5_000;
    while (!statusAtRelease && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(statusAtRelease).toBe("published");
    expect(response.release.status).toBe("reindexing");
    await app.close();
  });

  it("persists reindex_failed before releasing the publish lock", async () => {
    vi.resetModules();
    process.env.KTX_PROJECT_ROOT = projectRoot;
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
        reindexProject: vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "index down" }))
      };
    });

    const { buildServer } = await import("../index");
    const { publishSemanticAssets, readSemanticAssetRelease } = await import("../semantic-assets");
    const app = buildServer();
    await app.ready();

    const validate = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({ files: [{ filename: "orders.yaml", content: OVERLAY }] });
    expect(validate.status).toBe(200);

    let releaseId = "";
    let statusAtRelease = "";
    const response = await publishSemanticAssets(
      projectRoot,
      { validationId: validate.body.data.validationId, confirmOverwrite: true },
      {
        reindexImpl: async () => {
          throw new Error("index down");
        },
        beforeLockRelease: async () => {
          const record = await readSemanticAssetRelease(projectRoot, releaseId);
          statusAtRelease = record?.status ?? "missing";
        }
      }
    );
    releaseId = response.release.id;

    const deadline = Date.now() + 5_000;
    while (!statusAtRelease && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(statusAtRelease).toBe("reindex_failed");
    await app.close();
  });

  it("marks recovery required before releasing the lock when the digest restore throws", async () => {
    vi.resetModules();
    process.env.KTX_PROJECT_ROOT = projectRoot;
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

    const { buildServer } = await import("../index");
    const { publishSemanticAssets } = await import("../semantic-assets");
    const { isRecoveryRequired } = await import("../semantic-recovery-journal");
    const app = buildServer();
    await app.ready();

    const validate = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({ files: [{ filename: "orders.yaml", content: OVERLAY }] });
    expect(validate.status).toBe(200);

    let releaseId = "";
    let blockedAtRelease = false;
    const response = await publishSemanticAssets(
      projectRoot,
      { validationId: validate.body.data.validationId, confirmOverwrite: true },
      {
        reindexImpl: async () => {
          await writeFile(path.join(projectRoot, TARGET), "name: tampered\n", "utf8");
          return { exitCode: 0, stdout: "indexed", stderr: "" };
        },
        restoreImpl: async () => {
          throw new Error("restore io");
        },
        beforeLockRelease: async () => {
          blockedAtRelease = await isRecoveryRequired(projectRoot);
        }
      }
    );
    releaseId = response.release.id;

    const { readSemanticAssetRelease } = await import("../semantic-assets");
    const deadline = Date.now() + 5_000;
    let record: { status?: string; recoveryRequired?: boolean } | null = null;
    for (;;) {
      record = await readSemanticAssetRelease(projectRoot, releaseId);
      if (blockedAtRelease && record?.status === "promote_failed") break;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(blockedAtRelease).toBe(true);
    expect(record?.status).toBe("promote_failed");
    expect(record?.recoveryRequired).toBe(true);
    await app.close();
  });
});
