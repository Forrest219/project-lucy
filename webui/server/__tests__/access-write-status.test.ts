import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRacsReceipt,
  canViewAccessWriteStatus,
  embedRacsReceiptInSummary,
  evaluateRacsIdempotencyClaim,
  mergeTerminalIntoRacsReceipt,
  queryAccessWriteStatus,
  racsIdempotencyKey
} from "../admin/access-write-status.js";
import {
  evaluateRolesAgentRacsIdempotencyClaim,
  respondRacsIdempotencyReplay
} from "../admin/access-config.js";
import { getAuditDb, recordConfigChange, resetAuditDbForTests, updateConfigChangeStatus } from "../admin/audit.js";
import { trustedActorFromRequest } from "../security/request-actor.js";
import { buildServer } from "../index.js";
import { closeSecurityStore } from "../security/instance.js";

let projectRoot: string;
let prevRoot: string | undefined;
let prevAuditDb: string | undefined;
let prevAuth: string | undefined;
let app: FastifyInstance;

const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_UID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_UID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function sampleReceipt(overrides: Partial<ReturnType<typeof buildRacsReceipt>> = {}) {
  return buildRacsReceipt({
    submitterAccountUid: OTHER_UID,
    submitterActorId: "operator-a",
    objectKind: "role",
    objectId: "analyst",
    requestDigest: "a".repeat(64),
    baseObjectVersion: "role/analyst@v1",
    committedObjectVersion: "role/analyst@v2",
    candidateConfigDigest: "b".repeat(64),
    ...overrides
  });
}

async function seedIntent(
  operationId: string,
  receipt: ReturnType<typeof sampleReceipt>,
  writeStatus: "pending" | "committed" | "failed" | "rolled_back" = "pending"
) {
  const id = await recordConfigChange({
    filePath: "webui/config/access.yaml",
    changeType: "role_update",
    actor: receipt.submitterActorId,
    assetKind: "governance",
    operation: "role.update",
    targetId: receipt.objectId,
    newSummary: embedRacsReceiptInSummary({ label: receipt.objectId }, receipt),
    idempotencyKey: racsIdempotencyKey(operationId),
    writeStatus: "pending"
  });
  expect(id).toBeTruthy();
  if (writeStatus !== "pending") {
    const terminalReceipt =
      writeStatus === "committed"
        ? mergeTerminalIntoRacsReceipt(receipt, {
            runtimeAck: true,
            effectiveDigest: receipt.candidateConfigDigest,
            writeStatus: "committed"
          })
        : mergeTerminalIntoRacsReceipt(receipt, {
            runtimeAck: false,
            writeStatus
          });
    await updateConfigChangeStatus({
      id: id!,
      writeStatus,
      newSummary: embedRacsReceiptInSummary({ label: receipt.objectId }, terminalReceipt),
      errorReason: writeStatus === "failed" ? "injected_failure" : undefined
    });
  }
  return id!;
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-access-write-status-"));
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevAuditDb = process.env.LUCY_AUDIT_DB;
  prevAuth = process.env.LUCY_WEBUI_AUTH;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  process.env.LUCY_WEBUI_AUTH = "off";
  resetAuditDbForTests();
  app = buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
  closeSecurityStore();
  resetAuditDbForTests();
  if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = prevAuditDb;
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevAuth === undefined) delete process.env.LUCY_WEBUI_AUTH;
  else process.env.LUCY_WEBUI_AUTH = prevAuth;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("access write status query (SC-08 / SC-09)", () => {
  it("returns unknown when no durable record exists", async () => {
    const result = await queryAccessWriteStatus(OPERATION_ID);
    expect(result.outcome).toBe("unknown");
    expect(result.disclosure).toBe("no_durable_record");
  });

  it("returns unknown while intent is still pending", async () => {
    const receipt = sampleReceipt();
    await seedIntent(OPERATION_ID, receipt, "pending");
    const result = await queryAccessWriteStatus(OPERATION_ID);
    expect(result.outcome).toBe("unknown");
    expect(result.disclosure).toBe("terminal_pending");
    expect(result.objectId).toBe("analyst");
  });

  it("returns committed only with terminal receipt evidence", async () => {
    const receipt = sampleReceipt();
    await seedIntent(OPERATION_ID, receipt, "committed");
    const result = await queryAccessWriteStatus(OPERATION_ID);
    expect(result.outcome).toBe("committed");
    expect(result.committedObjectVersion).toBe("role/analyst@v2");
    expect(result.committedConfigDigest).toBe("b".repeat(64));
  });

  it("does not mark committed when terminal runtime ack evidence is missing", async () => {
    const receipt = sampleReceipt();
    const id = await seedIntent(OPERATION_ID, receipt, "pending");
    await updateConfigChangeStatus({
      id,
      writeStatus: "committed",
      newSummary: embedRacsReceiptInSummary({ label: "analyst" }, receipt)
    });
    const result = await queryAccessWriteStatus(OPERATION_ID);
    expect(result.outcome).toBe("unknown");
    expect(result.disclosure).toBe("committed_terminal_evidence_missing");
  });

  it("returns not_committed for confirmed rolled_back terminal", async () => {
    const receipt = sampleReceipt();
    await seedIntent(OPERATION_ID, receipt, "rolled_back");
    const result = await queryAccessWriteStatus(OPERATION_ID);
    expect(result.outcome).toBe("not_committed");
    expect(result.disclosure).toBe("rolled_back_confirmed");
  });
});

describe("racs idempotency claim (SC-09)", () => {
  it("allows first claim on a fresh key", async () => {
    const db = await getAuditDb();
    const receipt = sampleReceipt();
    const claim = evaluateRacsIdempotencyClaim(db, { operationId: OPERATION_ID, receipt });
    expect(claim).toEqual({
      kind: "fresh",
      idempotencyKey: racsIdempotencyKey(OPERATION_ID)
    });
  });

  it("replays the same payload and rejects different request digest", async () => {
    const db = await getAuditDb();
    const receipt = sampleReceipt();
    await seedIntent(OPERATION_ID, receipt, "pending");
    const replay = evaluateRacsIdempotencyClaim(db, { operationId: OPERATION_ID, receipt });
    expect(replay.kind).toBe("replay");

    const mismatch = evaluateRacsIdempotencyClaim(db, {
      operationId: OPERATION_ID,
      receipt: sampleReceipt({ requestDigest: "c".repeat(64) })
    });
    expect(mismatch).toEqual({ kind: "reject", code: "idempotency_payload_mismatch" });
  });

  it("rejects a different submitter account on the same operationId", async () => {
    const db = await getAuditDb();
    const receipt = sampleReceipt();
    await seedIntent(OPERATION_ID, receipt, "pending");
    const foreign = evaluateRacsIdempotencyClaim(db, {
      operationId: OPERATION_ID,
      receipt: sampleReceipt({ submitterAccountUid: OWNER_UID, submitterActorId: "owner" })
    });
    expect(foreign).toEqual({ kind: "reject", code: "idempotency_actor_mismatch" });
  });
});

describe("GET /api/admin/access-write-status/:operationId (SC-12)", () => {
  it("returns committed outcome through the HTTP surface", async () => {
    const receipt = sampleReceipt();
    await seedIntent(OPERATION_ID, receipt, "committed");
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/access-write-status/${OPERATION_ID}`
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.data.outcome).toBe("committed");
    expect(body.data.committedConfigDigest).toBe("b".repeat(64));
  });

  it("rejects viewers who are not the original submitter or owner", () => {
    const receipt = sampleReceipt();
    const operator = trustedActorFromRequest({
      lucyAdmin: {
        admin: {
          id: "operator-b",
          account_uid: OWNER_UID,
          role: "operator",
          display_name: "B",
          password_hash: "scrypt:x",
          created_at: new Date().toISOString()
        },
        session: null,
        stateUnavailable: false,
        authMode: "required"
      }
    } as never);
    expect(canViewAccessWriteStatus(operator, receipt, "operator-a")).toBe(false);
    const owner = trustedActorFromRequest({
      lucyAdmin: {
        admin: {
          id: "owner",
          account_uid: OWNER_UID,
          role: "owner",
          display_name: "Owner",
          password_hash: "scrypt:x",
          created_at: new Date().toISOString()
        },
        session: null,
        stateUnavailable: false,
        authMode: "required"
      }
    } as never);
    expect(canViewAccessWriteStatus(owner, receipt, "operator-a")).toBe(true);
  });

  it("returns 400 for invalid operationId format", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/access-write-status/not-a-uuid"
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_OPERATION_ID");
  });
});

describe("racs helpers", () => {
  it("generates stable idempotency keys per operationId", () => {
    const op = randomUUID();
    expect(racsIdempotencyKey(op)).toBe(racsIdempotencyKey(op));
    expect(racsIdempotencyKey(op)).toMatch(/^racs-v1:[0-9a-f]{64}$/);
  });
});

describe("Wave2 integrator — idempotency replay and status", () => {
  it("does not grant a reused display id access to a previous immutable account's receipt", () => {
    const receipt = sampleReceipt();
    const viewer = { ...trustedActorFromRequest({ lucyAdmin: { authMode: "open" } } as never),
      actorId: receipt.submitterActorId, accountUid: "a-different-immutable-account", role: "operator" as const };
    expect(canViewAccessWriteStatus(viewer, receipt, receipt.submitterActorId)).toBe(false);
  });

  it("does not call a legacy receipt's baseline the committed object version", async () => {
    const receipt = sampleReceipt({ committedObjectVersion: undefined });
    await seedIntent(OPERATION_ID, receipt, "committed");
    const status = await queryAccessWriteStatus(OPERATION_ID);
    expect(status.outcome).toBe("unknown");
    expect(status.committedObjectVersion).toBeUndefined();
  });
  it("replays the same operationId without inserting a second audit row", async () => {
    const db = await getAuditDb();
    const receipt = sampleReceipt();
    await seedIntent(OPERATION_ID, receipt, "committed");
    const countBefore = (db.prepare("SELECT COUNT(*) AS c FROM config_change_log").get() as { c: number }).c;
    const claim = await evaluateRolesAgentRacsIdempotencyClaim(OPERATION_ID, receipt);
    expect(claim.kind).toBe("replay");
    if (claim.kind !== "replay") return;
    const response = await respondRacsIdempotencyReplay(claim.auditId, { operationId: OPERATION_ID });
    expect(response.statusCode).toBe(200);
    expect(response.body.ok).toBe(true);
    expect((response.body.data as { racsReplay?: boolean }).racsReplay).toBe(true);
    const countAfter = (db.prepare("SELECT COUNT(*) AS c FROM config_change_log").get() as { c: number }).c;
    expect(countAfter).toBe(countBefore);
  });

  it("rejects a different request digest for the same operationId", async () => {
    const receipt = sampleReceipt();
    await seedIntent(OPERATION_ID, receipt, "pending");
    const claim = await evaluateRolesAgentRacsIdempotencyClaim(OPERATION_ID, sampleReceipt({ requestDigest: "d".repeat(64) }));
    expect(claim).toEqual({ kind: "reject", code: "idempotency_payload_mismatch" });
  });

  it("surfaces committed through status API after terminal receipt merge", async () => {
    const receipt = sampleReceipt();
    await seedIntent(OPERATION_ID, receipt, "committed");
    const status = await queryAccessWriteStatus(OPERATION_ID);
    expect(status.outcome).toBe("committed");
    expect(status.committedConfigDigest).toBe("b".repeat(64));
    const http = await app.inject({
      method: "GET",
      url: `/api/admin/access-write-status/${OPERATION_ID}`
    });
    expect(http.statusCode).toBe(200);
    expect(http.json().data.outcome).toBe("committed");
  });
});
