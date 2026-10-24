/**
 * Lucy v0.25 — the server-side idempotency store.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §7.2 ("使用服务端持久幂等键"), §10 V13, and §11 D15.
 *
 * ── The contract ───────────────────────────────────────────────────────────
 * A client may retry a publish (double click, HTTP retry, a reconnect after a
 * dropped connection). The retry must NOT write the files twice and must NOT
 * trigger a second index. Therefore the SERVER keeps a persistent record of
 * every accepted idempotency key:
 *
 *   key      = hash(instanceId + actor + clientKey)
 *   record   = { planDigest, releaseId, createdAt, expiresAt }
 *
 *   - the same key with the SAME plan digest → replay: the same releaseId is
 *     returned, nothing is written again.
 *   - the same key with a DIFFERENT plan digest → conflict: the request is
 *     refused, because the client is trying to reuse a key for another
 *     target set.
 *
 * The record is kept for at least 24 hours (D15). The store is a local file
 * under `.ktx-ui/` — this is a single-instance / single-replica product and
 * no distributed coordination is introduced.
 *
 * The key is bound to the instance AND the actor, so one user can never
 * consume another user's key, and a package produced elsewhere can never be
 * replayed here.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { SEMANTIC_BATCH_LIMITS } from "./semantic-limits";

const IDEMPOTENCY_FILE_REL = ".ktx-ui/semantic-idempotency.json";
const MAX_RECORDS = 500;

export interface SemanticIdempotencyRecord {
  /** The composite lookup key (instance + actor + client key). */
  key: string;
  instanceId: string;
  actor: string;
  /** The client-supplied idempotency key. */
  clientKey: string;
  /** The plan digest this key was bound to. */
  planDigest: string;
  /** The release this key produced. Replayed requests return the same id. */
  releaseId: string;
  validationId?: string;
  createdAt: string;
  expiresAt: string;
}

export type SemanticIdempotencyOutcome =
  | { kind: "accepted"; record: SemanticIdempotencyRecord }
  | { kind: "replay"; record: SemanticIdempotencyRecord };

export class SemanticIdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT";
  readonly statusCode = 409;

  constructor(
    readonly existing: SemanticIdempotencyRecord,
    message: string
  ) {
    super(message);
    this.name = "SemanticIdempotencyConflictError";
  }
}

interface IdempotencyFile {
  version: 1;
  records: SemanticIdempotencyRecord[];
}

function idempotencyPath(projectRoot: string): string {
  return path.resolve(projectRoot, IDEMPOTENCY_FILE_REL);
}

/** The composite lookup key. Never reversible into a client key by a reader. */
export function computeSemanticIdempotencyKey(input: {
  instanceId: string;
  actor: string;
  clientKey: string;
}): string {
  return createHash("sha256")
    .update(`${input.instanceId}\u0000${input.actor}\u0000${input.clientKey}`)
    .digest("hex");
}

async function readIdempotencyFile(projectRoot: string): Promise<IdempotencyFile> {
  try {
    const text = await readFile(idempotencyPath(projectRoot), "utf8");
    const parsed = JSON.parse(text) as IdempotencyFile;
    if (!parsed || !Array.isArray(parsed.records)) return { version: 1, records: [] };
    return {
      version: 1,
      records: parsed.records.filter(
        (record): record is SemanticIdempotencyRecord =>
          Boolean(record) && typeof record === "object" && typeof record.key === "string"
      )
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, records: [] };
    throw error;
  }
}

async function writeIdempotencyFile(
  projectRoot: string,
  file: IdempotencyFile
): Promise<void> {
  const abs = idempotencyPath(projectRoot);
  await mkdir(path.dirname(abs), { recursive: true });
  const temp = path.join(path.dirname(abs), `.semantic-idempotency.tmp-${randomUUID()}`);
  try {
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(temp, abs);
  } catch (error) {
    await (await import("node:fs/promises")).rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Read the record of an idempotency key, if it is still valid. */
export async function readSemanticIdempotencyKey(
  projectRoot: string,
  input: { instanceId: string; actor: string; clientKey: string },
  now: () => number = Date.now
): Promise<SemanticIdempotencyRecord | null> {
  const key = computeSemanticIdempotencyKey(input);
  const file = await readIdempotencyFile(projectRoot);
  const record = file.records.find((item) => item.key === key);
  if (!record) return null;
  if (Date.parse(record.expiresAt) <= now()) return null;
  return record;
}

/**
 * Register an idempotency key.
 *
 * Returns `accepted` for a new key and `replay` for a repeated submission of
 * the SAME plan. A repeated submission of a DIFFERENT plan is a conflict and
 * throws — it is never silently accepted.
 */
export async function registerSemanticIdempotencyKey(
  projectRoot: string,
  input: {
    instanceId: string;
    actor: string;
    clientKey: string;
    planDigest: string;
    releaseId: string;
    validationId?: string;
    now?: () => number;
  }
): Promise<SemanticIdempotencyOutcome> {
  if (!input.clientKey.trim()) {
    throw new Error("幂等键不能为空。");
  }
  const nowMs = (input.now ?? Date.now)();
  const key = computeSemanticIdempotencyKey(input);
  const file = await readIdempotencyFile(projectRoot);
  const existing = file.records.find((item) => item.key === key);

  if (existing && Date.parse(existing.expiresAt) > nowMs) {
    if (existing.planDigest !== input.planDigest) {
      throw new SemanticIdempotencyConflictError(
        existing,
        "同一幂等键已绑定另一个发布计划，拒绝复用；请使用新的幂等键或重新预览。"
      );
    }
    return { kind: "replay", record: existing };
  }

  const record: SemanticIdempotencyRecord = {
    key,
    instanceId: input.instanceId,
    actor: input.actor,
    clientKey: input.clientKey,
    planDigest: input.planDigest,
    releaseId: input.releaseId,
    ...(input.validationId ? { validationId: input.validationId } : {}),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + SEMANTIC_BATCH_LIMITS.idempotencyRetentionMs).toISOString()
  };

  const records = [
    ...file.records.filter((item) => item.key !== key),
    record
  ].slice(-MAX_RECORDS);

  await writeIdempotencyFile(projectRoot, { version: 1, records });
  return { kind: "accepted", record };
}

/** Drop expired records (opportunistic GC). */
export async function pruneSemanticIdempotencyKeys(
  projectRoot: string,
  now: () => number = Date.now
): Promise<number> {
  const file = await readIdempotencyFile(projectRoot);
  const kept = file.records.filter((record) => Date.parse(record.expiresAt) > now());
  if (kept.length === file.records.length) return 0;
  await writeIdempotencyFile(projectRoot, { version: 1, records: kept });
  return file.records.length - kept.length;
}
