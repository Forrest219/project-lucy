// L25-11 V14(d) / V15(b) / V19(c) — one sub-assertion only:
// a runtime-mirror failure must not be recorded as restored or published,
// and startup recovery stays closed.
// This file does not mark V14, V15, or V19 as passed.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncContentToProjectRoot = vi.hoisted(() =>
  vi.fn(async () => ({ copied: 0, skipped: 0, failed: 1 }))
);

vi.mock("../content-mirror.js", () => ({
  syncContentToProjectRoot
}));

import { readPublishCoordinatorLock } from "../publish-coordinator";
import {
  createRecoveryJournal,
  isRecoveryRequired,
  readRecoveryJournal,
  recoverPendingRecoveryJournals,
  restoreRecoveryJournal
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
  syncContentToProjectRoot.mockResolvedValue({ copied: 0, skipped: 0, failed: 1 });
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-mirror-"));
  await writeFileAt(TARGET, "name: orders\n");
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("mirror failure stays closed", () => {
  it("does not mark a startup journal restored when the mirror fails", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel-mirror",
      operationId: "op-mirror",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET, newContent: "name: orders-v2\n" }]
    });

    const outcome = await recoverPendingRecoveryJournals(projectRoot);

    expect(outcome.recovered).not.toContain(journal.journalId);
    expect(outcome.needsRepair).toContain(journal.journalId);
    const stored = await readRecoveryJournal(projectRoot, journal.journalId);
    expect(stored?.status).toBe("recovery_required");
    expect(stored?.status).not.toBe("restored");
    expect(await isRecoveryRequired(projectRoot)).toBe(true);
  });

  it("does not mark a restore restored when the mirror fails", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel-restore",
      operationId: "op-restore",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET, newContent: "name: orders-v2\n" }]
    });

    const result = await restoreRecoveryJournal(projectRoot, journal.journalId);

    expect(result?.status).toBe("recovery_required");
    expect(result?.recoveryRequired).toBe(true);
    expect(result?.status).not.toBe("restored");
    const stored = await readRecoveryJournal(projectRoot, journal.journalId);
    expect(stored?.status).toBe("recovery_required");
    expect(await isRecoveryRequired(projectRoot)).toBe(true);
  });
});

describe("mirror failure during promote", () => {
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

  it("does not record the release as published", async () => {
    vi.resetModules();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    await writeFileAt("ktx.yaml", KTX_YAML);
    await writeFileAt("semantic-layer/shop-db/_schema/public.yaml", MANIFEST);
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
        }))
      };
    });

    const { buildServer } = await import("../index");
    const { publishSemanticAssets } = await import("../semantic-assets");
    const app = buildServer();
    await app.ready();
    const request = (await import("supertest")).default;

    const validate = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({ files: [{ filename: "orders.yaml", content: OVERLAY }] });
    expect(validate.status).toBe(200);

    await expect(
      publishSemanticAssets(projectRoot, {
        validationId: validate.body.data.validationId,
        confirmOverwrite: true
      })
    ).rejects.toThrow(/运行镜像/);

    const sidecar = JSON.parse(
      await readFile(path.join(projectRoot, ".ktx-ui/semantic-asset-releases.json"), "utf8")
    ) as { records: Array<{ status?: string; recoveryRequired?: boolean }> };
    const record = sidecar.records.at(-1);
    expect(record?.status).toBe("promote_failed");
    expect(record?.status).not.toBe("published");
    expect(record?.recoveryRequired).toBe(true);
    await app.close();
  });

  it("rolls the written targets back before the failure record, and still unlocks if that record throws", async () => {
    vi.resetModules();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    await writeFileAt("ktx.yaml", KTX_YAML);
    await writeFileAt("semantic-layer/shop-db/_schema/public.yaml", MANIFEST);
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
        }))
      };
    });

    const { buildServer } = await import("../index");
    const { publishSemanticAssets } = await import("../semantic-assets");
    const app = buildServer();
    await app.ready();
    const request = (await import("supertest")).default;

    const validate = await request(app.server)
      .post("/api/semantic-assets/validate")
      .send({ files: [{ filename: "orders.yaml", content: OVERLAY }] });
    expect(validate.status).toBe(200);

    let sawRollbackBeforeRecord = false;
    await expect(
      publishSemanticAssets(projectRoot, {
        validationId: validate.body.data.validationId,
        confirmOverwrite: true
      }, {
        recordPromoteFailureImpl: async () => {
          const bytes = await readFile(path.join(projectRoot, TARGET), "utf8");
          expect(bytes).toBe("name: orders\n");
          const { readdir } = await import("node:fs/promises");
          const dir = path.join(projectRoot, ".ktx-ui", "semantic-recovery-journals");
          const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
          expect(names).toHaveLength(1);
          const stored = JSON.parse(await readFile(path.join(dir, names[0]!), "utf8")) as {
            status?: string;
          };
          expect(stored.status).toBe("recovery_required");
          sawRollbackBeforeRecord = true;
          throw new Error("sidecar io");
        }
      })
    ).rejects.toThrow(/运行镜像/);

    expect(sawRollbackBeforeRecord).toBe(true);
    expect(await readFile(path.join(projectRoot, TARGET), "utf8")).toBe("name: orders\n");
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
    const sidecarPath = path.join(projectRoot, ".ktx-ui/semantic-asset-releases.json");
    let sidecar = "";
    try {
      sidecar = await readFile(sidecarPath, "utf8");
    } catch {
      sidecar = "";
    }
    expect(sidecar).not.toContain("\"published\"");
    const { readdir } = await import("node:fs/promises");
    const names = (await readdir(path.join(projectRoot, ".ktx-ui", "semantic-recovery-journals")))
      .filter((name) => name.endsWith(".json"));
    const stored = JSON.parse(
      await readFile(path.join(projectRoot, ".ktx-ui", "semantic-recovery-journals", names[0]!), "utf8")
    ) as { status?: string };
    expect(stored.status).toBe("recovery_required");
    await app.close();
  });
});
