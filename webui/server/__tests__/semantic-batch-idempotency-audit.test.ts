// Lucy v0.25 — D15/D19/D22: idempotency store, release activation state and
// the audit payload builder.
//
// Coverage:
//  - The idempotency key is bound to instance + actor + client key.
//  - A repeated submission of the SAME plan returns the same releaseId; the
//    same key with a DIFFERENT plan is a conflict.
//  - Records are retained for at least 24 hours.
//  - A legacy release record without the new fields reports `unknown` and is
//    NOT upgraded to `confirmed`.
//  - The audit payload never describes a download / pre-check / validation as
//    a successful publish.

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SemanticIdempotencyCapacityError,
  SemanticIdempotencyConflictError,
  computeSemanticIdempotencyKey,
  pruneSemanticIdempotencyKeys,
  readSemanticIdempotencyKey,
  registerSemanticIdempotencyKey
} from "../semantic-idempotency";
import {
  buildSemanticActivationState,
  describeSemanticActivationStatus,
  isSemanticPublishBlocked,
  normalizeSemanticActivationState
} from "../semantic-release-status";
import {
  SemanticAuditPayloadError,
  assertSemanticAuditPayloadConsistent,
  buildSemanticBatchAuditPayload,
  buildSemanticBatchAuditRecord
} from "../semantic-batch-audit";

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-idem-"));
});

afterEach(async () => {
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("D15 idempotency store", () => {
  const base = {
    instanceId: "inst-a",
    actor: "admin-a",
    clientKey: "client-key-1",
    planDigest: "p".repeat(64),
    releaseId: "rel_1"
  };

  it("accepts a new key once", async () => {
    const outcome = await registerSemanticIdempotencyKey(projectRoot, base);
    expect(outcome.kind).toBe("accepted");
    expect(outcome.record.releaseId).toBe("rel_1");
    expect(outcome.record.expiresAt).toBeTruthy();
  });

  it("replays the same releaseId for the same plan", async () => {
    await registerSemanticIdempotencyKey(projectRoot, base);
    const replay = await registerSemanticIdempotencyKey(projectRoot, base);
    expect(replay.kind).toBe("replay");
    expect(replay.record.releaseId).toBe("rel_1");
  });

  it("refuses the same key with another plan", async () => {
    await registerSemanticIdempotencyKey(projectRoot, base);
    await expect(
      registerSemanticIdempotencyKey(projectRoot, { ...base, planDigest: "q".repeat(64) })
    ).rejects.toThrowError(SemanticIdempotencyConflictError);
  });

  it("binds the key to the actor and the instance", async () => {
    await registerSemanticIdempotencyKey(projectRoot, base);

    const otherActor = await readSemanticIdempotencyKey(projectRoot, {
      instanceId: "inst-a",
      actor: "admin-b",
      clientKey: "client-key-1"
    });
    expect(otherActor).toBeNull();

    const otherInstance = await readSemanticIdempotencyKey(projectRoot, {
      instanceId: "inst-b",
      actor: "admin-a",
      clientKey: "client-key-1"
    });
    expect(otherInstance).toBeNull();
  });

  it("derives a stable, non-reversible key", () => {
    const first = computeSemanticIdempotencyKey(base);
    const second = computeSemanticIdempotencyKey(base);
    expect(first).toBe(second);
    expect(first).not.toContain("client-key-1");
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the record for at least 24 hours and prunes it afterwards", async () => {
    const createdAt = Date.parse("2026-10-25T00:00:00.000Z");
    await registerSemanticIdempotencyKey(projectRoot, { ...base, now: () => createdAt });

    const stored = await readSemanticIdempotencyKey(projectRoot, base, () => createdAt + 23 * 60 * 60_000);
    expect(stored).toBeTruthy();

    expect(await readSemanticIdempotencyKey(projectRoot, base, () => createdAt + 25 * 60 * 60_000)).toBeNull();

    const pruned = await pruneSemanticIdempotencyKeys(projectRoot, () => createdAt + 25 * 60 * 60_000);
    expect(pruned).toBe(1);
  });

  it("refuses a new key instead of evicting one that is still inside 24 hours", async () => {
    const now = Date.parse("2026-10-30T00:00:00.000Z");
    for (let index = 0; index < 500; index += 1) {
      await registerSemanticIdempotencyKey(projectRoot, {
        ...base,
        clientKey: `key-${index}`,
        releaseId: `rel_${index}`,
        now: () => now
      });
    }

    await expect(
      registerSemanticIdempotencyKey(projectRoot, {
        ...base,
        clientKey: "key-new",
        releaseId: "rel_new",
        now: () => now + 1_000
      })
    ).rejects.toBeInstanceOf(SemanticIdempotencyCapacityError);

    const oldest = await readSemanticIdempotencyKey(
      projectRoot,
      { instanceId: base.instanceId, actor: base.actor, clientKey: "key-0" },
      () => now + 1_000
    );
    expect(oldest?.releaseId).toBe("rel_0");

    const replay = await registerSemanticIdempotencyKey(projectRoot, {
      ...base,
      clientKey: "key-0",
      releaseId: "rel_ignored",
      now: () => now + 1_000
    });
    expect(replay.kind).toBe("replay");
    expect(replay.record.releaseId).toBe("rel_0");
  });

  it("drops expired keys before accepting a new one", async () => {
    const createdAt = Date.parse("2026-10-25T00:00:00.000Z");
    for (let index = 0; index < 500; index += 1) {
      await registerSemanticIdempotencyKey(projectRoot, {
        ...base,
        clientKey: `old-${index}`,
        releaseId: `rel_old_${index}`,
        now: () => createdAt
      });
    }

    const later = createdAt + 25 * 60 * 60_000;
    const outcome = await registerSemanticIdempotencyKey(projectRoot, {
      ...base,
      clientKey: "fresh",
      releaseId: "rel_fresh",
      now: () => later
    });
    expect(outcome.kind).toBe("accepted");
    expect(outcome.record.releaseId).toBe("rel_fresh");
    expect(
      await readSemanticIdempotencyKey(
        projectRoot,
        { instanceId: base.instanceId, actor: base.actor, clientKey: "old-0" },
        () => later
      )
    ).toBeNull();
  });
});

describe("D19 release activation state", () => {
  it("reports unknown for a legacy record", () => {
    const state = normalizeSemanticActivationState({ id: "rel_old", status: "published" });
    expect(state.activationStatus).toBe("unknown");
    expect(state.recoveryRequired).toBe("unknown");
  });

  it("never upgrades a legacy published record to confirmed", () => {
    const state = normalizeSemanticActivationState({ status: "published" });
    expect(state.activationStatus).not.toBe("confirmed");
  });

  it("reads the explicit fields of a v0.25 record", () => {
    const state = normalizeSemanticActivationState({
      status: "reindex_failed",
      recoveryRequired: false,
      activationStatus: "unconfirmed"
    });
    expect(state.activationStatus).toBe("unconfirmed");
    expect(state.recoveryRequired).toBe(false);
  });

  it("separates recovery from activation", () => {
    const reindexFailed = buildSemanticActivationState({
      recoveryRequired: false,
      activationConfirmed: false
    });
    expect(reindexFailed.activationStatus).toBe("unconfirmed");
    expect(isSemanticPublishBlocked(reindexFailed)).toBe(false);

    const restoreFailed = buildSemanticActivationState({
      recoveryRequired: true,
      activationConfirmed: false
    });
    expect(isSemanticPublishBlocked(restoreFailed)).toBe(true);
    expect(describeSemanticActivationStatus(restoreFailed)).toContain("生效状态待确认");
  });
});

describe("D22 audit payload", () => {
  it("never marks a download / validation / staging as a publish", () => {
    for (const outcome of ["exported", "validated", "staged", "failed", "blocked"] as const) {
      const payload = buildSemanticBatchAuditPayload({
        actor: "admin-a",
        operationId: "op_1",
        outcome,
        objectCount: 3
      });
      expect(payload.publishEffect).toBe(false);
      expect(() => assertSemanticAuditPayloadConsistent(payload)).not.toThrow();
    }
  });

  it("marks a completed publish as a publish effect", () => {
    const payload = buildSemanticBatchAuditPayload({
      actor: "admin-a",
      operationId: "op_1",
      outcome: "published",
      releaseId: "rel_1",
      objectCount: 3,
      recovery: buildSemanticActivationState({
        recoveryRequired: false,
        activationConfirmed: true
      })
    });
    expect(payload.publishEffect).toBe(true);
    expect(() => assertSemanticAuditPayloadConsistent(payload)).not.toThrow();
  });

  it("refuses a publish effect without a release id or a confirmed activation", () => {
    const noRelease = buildSemanticBatchAuditPayload({
      actor: "admin-a",
      operationId: "op_1",
      outcome: "published",
      objectCount: 1
    });
    expect(() => assertSemanticAuditPayloadConsistent(noRelease)).toThrowError(
      SemanticAuditPayloadError
    );

    const unconfirmed = buildSemanticBatchAuditPayload({
      actor: "admin-a",
      operationId: "op_1",
      outcome: "published",
      releaseId: "rel_1",
      objectCount: 1,
      recovery: buildSemanticActivationState({
        recoveryRequired: false,
        activationConfirmed: false
      })
    });
    expect(() => assertSemanticAuditPayloadConsistent(unconfirmed)).toThrowError(
      /生效状态待确认/
    );
  });

  it("carries the required facts", () => {
    const payload = buildSemanticBatchAuditPayload({
      actor: "admin-a",
      operationId: "op_1",
      outcome: "validated",
      scopeId: "scope_1",
      planDigest: "p".repeat(64),
      attemptId: "attempt_1",
      baselineDigest: "b".repeat(64),
      candidateDigest: "c".repeat(64),
      objectCount: 30,
      results: { passed: 28, failed: 1, notRun: 1, stale: 0, dependencies: 4 }
    });

    expect(payload.scopeId).toBe("scope_1");
    expect(payload.planDigest).toBe("p".repeat(64));
    expect(payload.attemptId).toBe("attempt_1");
    expect(payload.baselineDigest).toBe("b".repeat(64));
    expect(payload.candidateDigest).toBe("c".repeat(64));
    expect(payload.objectCount).toBe(30);
    expect(payload.results.dependencies).toBe(4);
  });

  it("builds a recordConfigChange-compatible record", () => {
    const payload = buildSemanticBatchAuditPayload({
      actor: "admin-a",
      operationId: "op_1",
      outcome: "staged",
      scopeId: "scope_1",
      objectCount: 2
    });
    const record = buildSemanticBatchAuditRecord(payload);
    expect(record.assetKind).toBe("semantic");
    expect(record.writeStatus).toBe("pending");
    expect(record.oldSummary).toMatchObject({ outcome: "staged", publishEffect: false });
  });

  it("rejects a payload without an actor or operation id", () => {
    expect(() =>
      buildSemanticBatchAuditPayload({
        actor: "",
        operationId: "op",
        outcome: "validated",
        objectCount: 0
      })
    ).toThrowError(SemanticAuditPayloadError);
    expect(() =>
      buildSemanticBatchAuditPayload({
        actor: "admin-a",
        operationId: "",
        outcome: "validated",
        objectCount: 0
      })
    ).toThrowError(SemanticAuditPayloadError);
  });
});
