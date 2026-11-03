/**
 * Lucy v0.25 / L25-15 — pre-release batch snapshots.
 *
 * A snapshot is the bytes (or the absent marker) of each semantic target
 * immediately before a formal write. It is not the validation snapshot under
 * `.ktx-ui/semantic-asset-snapshots/`, and it is not the recovery journal.
 * Capture runs only while this process already holds the shared publish
 * window. The helper does not take the lock again.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import {
  currentProcessPublishHolder,
  publishLockOwnedBy,
  readPublishCoordinatorLock,
  type PublishLockHolder
} from "./publish-coordinator.js";
import { SEMANTIC_BATCH_LIMITS } from "./semantic-limits.js";
import { resolveContentPaths } from "./paths.js";

export const SEMANTIC_RELEASE_SNAPSHOT_SCHEMA = "semantic-release-snapshot/v1" as const;
const SNAPSHOTS_DIR_REL = ".ktx-ui/semantic-release-snapshots";
const INSTANCE_ID_REL = ".ktx-ui/semantic-instance-id";
const LEASES_REL = ".ktx-ui/semantic-release-snapshot-leases.json";
const RELEASES_REL = ".ktx-ui/semantic-asset-releases.json";
const FORBIDDEN_INSTANCE_IDS = new Set(["", "lucy-default"]);

export type SemanticReleaseSnapshotEntry = {
  order: number;
  targetPath: string;
  assetKind: "overlay" | "manifest";
  identity?: { connectionId: string; schema: string; table: string };
  originalBase64: string | null;
  originalDigest: string | null;
  expectedNewDigest: string | null;
};

export type SemanticReleaseSnapshot = {
  schemaVersion: typeof SEMANTIC_RELEASE_SNAPSHOT_SCHEMA;
  snapshotId: string;
  releaseId: string;
  instanceId: string;
  createdAt: string;
  actor: string;
  entries: SemanticReleaseSnapshotEntry[];
  snapshotDigest: string;
};

export type SnapshotLeaseKind = "publish" | "restore" | "preview" | "export";

export type SnapshotLease = {
  leaseId: string;
  snapshotId: string;
  kind: SnapshotLeaseKind;
  expiresAt: string;
};

export class SemanticReleaseSnapshotError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: string,
    message: string,
    statusCode = 409
  ) {
    super(message);
    this.name = "SemanticReleaseSnapshotError";
    this.statusCode = statusCode;
  }
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stable(item));
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (key === "snapshotDigest") continue;
      out[key] = stable(source[key]);
    }
    return out;
  }
  return value;
}

export function computeSnapshotDigest(snapshot: Omit<SemanticReleaseSnapshot, "snapshotDigest">): string {
  return sha256(JSON.stringify(stable(snapshot)));
}

export function assertSemanticTargetPath(targetPath: string): void {
  if (!targetPath || targetPath.startsWith("/") || targetPath.includes("\\") || targetPath.includes("\0")) {
    throw new SemanticReleaseSnapshotError("semantic_snapshot_unavailable", "批次前快照拒绝宿主绝对路径。");
  }
  const parts = targetPath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new SemanticReleaseSnapshotError("semantic_snapshot_unavailable", "批次前快照拒绝越界路径。");
  }
  if (!targetPath.startsWith("semantic-layer/") || !targetPath.endsWith(".yaml")) {
    throw new SemanticReleaseSnapshotError("semantic_snapshot_unavailable", "批次前快照只记录语义层 YAML。");
  }
}

export function assetKindForTarget(targetPath: string): "overlay" | "manifest" {
  return targetPath.includes("/_schema/") ? "manifest" : "overlay";
}

/**
 * Persistent instance id under `.ktx-ui`. An explicit env override is accepted.
 * The shared fallback `lucy-default` is never used.
 */
export async function readOrCreateSemanticInstanceId(projectRoot: string): Promise<string> {
  const override = process.env.LUCY_SEMANTIC_INSTANCE_ID?.trim();
  if (override && !FORBIDDEN_INSTANCE_IDS.has(override)) return override;
  const abs = path.resolve(projectRoot, INSTANCE_ID_REL);
  try {
    const existing = (await readFile(abs, "utf8")).trim();
    if (existing && !FORBIDDEN_INSTANCE_IDS.has(existing)) return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const created = `inst_${randomUUID()}`;
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    await writeFile(abs, `${created}\n`, { encoding: "utf8", flag: "wx" });
    return created;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const raced = (await readFile(abs, "utf8")).trim();
  if (!raced || FORBIDDEN_INSTANCE_IDS.has(raced)) {
    throw new SemanticReleaseSnapshotError(
      "semantic_restore_instance_mismatch",
      "实例标识未能持久化，已停止写入。"
    );
  }
  return raced;
}

export async function assertCallerHoldsPublishWindow(projectRoot: string): Promise<PublishLockHolder> {
  const memory = currentProcessPublishHolder();
  if (!memory || memory.pid !== process.pid) {
    throw new SemanticReleaseSnapshotError(
      "semantic_publish_busy",
      "批次前快照只能在本进程已持有的发布窗口内写入。"
    );
  }
  const file = await readPublishCoordinatorLock(projectRoot);
  if (!file || !publishLockOwnedBy(file, memory)) {
    throw new SemanticReleaseSnapshotError(
      "semantic_publish_busy",
      "发布锁文件与本进程持有者不一致，已停止写入。"
    );
  }
  if (file.pid !== memory.pid || file.acquiredAt !== memory.acquiredAt) {
    throw new SemanticReleaseSnapshotError(
      "semantic_publish_busy",
      "发布锁身份与本进程持有者不符，已停止写入。"
    );
  }
  return memory;
}

async function targetAbsolute(projectRoot: string, targetPath: string): Promise<string> {
  assertSemanticTargetPath(targetPath);
  const contentPaths = await resolveContentPaths(projectRoot);
  const abs = path.resolve(contentPaths.configDir, targetPath);
  const root = path.resolve(contentPaths.configDir);
  if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) {
    throw new SemanticReleaseSnapshotError("semantic_snapshot_unavailable", "批次前快照拒绝越界路径。");
  }
  return abs;
}

async function readOriginal(projectRoot: string, targetPath: string): Promise<Buffer | null> {
  try {
    return await readFile(await targetAbsolute(projectRoot, targetPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

type LeaseFile = { version: 1; leases: SnapshotLease[] };

function leasesPath(projectRoot: string): string {
  return path.resolve(projectRoot, LEASES_REL);
}

async function readLeases(projectRoot: string): Promise<LeaseFile> {
  try {
    const parsed = JSON.parse(await readFile(leasesPath(projectRoot), "utf8")) as LeaseFile;
    if (!parsed || !Array.isArray(parsed.leases)) return { version: 1, leases: [] };
    return { version: 1, leases: parsed.leases.filter((lease) => lease && typeof lease.leaseId === "string") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, leases: [] };
    throw error;
  }
}

async function writeLeases(projectRoot: string, file: LeaseFile): Promise<void> {
  const abs = leasesPath(projectRoot);
  await mkdir(path.dirname(abs), { recursive: true });
  const temp = path.join(path.dirname(abs), `.snapshot-leases.tmp-${randomUUID()}`);
  try {
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(temp, abs);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function pruneExpiredSnapshotLeases(
  projectRoot: string,
  now: () => number = Date.now
): Promise<number> {
  const file = await readLeases(projectRoot);
  const kept = file.leases.filter((lease) => Date.parse(lease.expiresAt) > now());
  if (kept.length === file.leases.length) return 0;
  await writeLeases(projectRoot, { version: 1, leases: kept });
  return file.leases.length - kept.length;
}

export async function acquireSnapshotLease(
  projectRoot: string,
  input: { snapshotId: string; kind: SnapshotLeaseKind; ttlMs: number },
  now: () => number = Date.now
): Promise<SnapshotLease> {
  await pruneExpiredSnapshotLeases(projectRoot, now);
  const file = await readLeases(projectRoot);
  const lease: SnapshotLease = {
    leaseId: `lease_${randomUUID()}`,
    snapshotId: input.snapshotId,
    kind: input.kind,
    expiresAt: new Date(now() + input.ttlMs).toISOString()
  };
  await writeLeases(projectRoot, { version: 1, leases: [...file.leases, lease] });
  return lease;
}

export async function releaseSnapshotLease(projectRoot: string, leaseId: string): Promise<void> {
  const file = await readLeases(projectRoot);
  await writeLeases(projectRoot, {
    version: 1,
    leases: file.leases.filter((lease) => lease.leaseId !== leaseId)
  });
}

type ReleaseFact = { id: string; status?: string; snapshotId?: string };

async function readReleaseFacts(projectRoot: string): Promise<ReleaseFact[]> {
  try {
    const parsed = JSON.parse(await readFile(path.resolve(projectRoot, RELEASES_REL), "utf8")) as {
      records?: ReleaseFact[];
    };
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

type SnapshotFact = {
  releaseId: string;
  snapshotId: string;
  createdAtMs: number;
  bytes: number;
  recoverable: boolean;
  orphan: boolean;
};

async function listSnapshotFacts(projectRoot: string, nowMs: number): Promise<SnapshotFact[]> {
  const dir = path.resolve(projectRoot, SNAPSHOTS_DIR_REL);
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const releases = await readReleaseFacts(projectRoot);
  const byId = new Map(releases.map((record) => [record.id, record]));
  const facts: SnapshotFact[] = [];
  for (const name of names) {
    const snapshotFile = path.join(dir, name, "snapshot.json");
    try {
      const info = await stat(snapshotFile);
      const snapshot = JSON.parse(await readFile(snapshotFile, "utf8")) as SemanticReleaseSnapshot;
      const release = byId.get(snapshot.releaseId);
      const recoverable =
        Boolean(release) && (release?.status === "published" || release?.status === "reindex_failed");
      facts.push({
        releaseId: snapshot.releaseId,
        snapshotId: snapshot.snapshotId,
        createdAtMs: Date.parse(snapshot.createdAt) || info.mtimeMs,
        bytes: info.size,
        recoverable,
        orphan: !release
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      const info = await stat(path.join(dir, name)).catch(() => null);
      facts.push({
        releaseId: name,
        snapshotId: name,
        createdAtMs: info?.mtimeMs ?? nowMs,
        bytes: info?.size ?? 0,
        recoverable: false,
        orphan: true
      });
    }
  }
  return facts;
}

function snapshotDir(projectRoot: string, releaseId: string): string {
  return path.resolve(projectRoot, SNAPSHOTS_DIR_REL, releaseId);
}

/**
 * Drop the oldest snapshots that are not leased until the incoming snapshot
 * fits the 20 / 30 day / 512 MiB contract. Throws when a fit is impossible.
 * Does not write the new snapshot.
 */
export async function reserveSemanticReleaseSnapshotCapacity(
  projectRoot: string,
  incomingBytes: number,
  now: () => number = Date.now
): Promise<void> {
  await pruneExpiredSnapshotLeases(projectRoot, now);
  const leased = new Set(
    (await readLeases(projectRoot)).leases.map((lease) => lease.snapshotId)
  );
  let facts = await listSnapshotFacts(projectRoot, now());
  const retentionMs = SEMANTIC_BATCH_LIMITS.restoreSnapshotRetentionMs;
  const maxBytes = SEMANTIC_BATCH_LIMITS.restoreSnapshotMaxBytes;
  const maxRecoverable = SEMANTIC_BATCH_LIMITS.restoreRecoverableBatches;

  const pickVictim = (): SnapshotFact | null => {
    const candidates = facts
      .filter((fact) => !leased.has(fact.snapshotId))
      .sort((a, b) => {
        const rank = (fact: SnapshotFact) => {
          if (fact.orphan) return 0;
          if (now() - fact.createdAtMs >= retentionMs) return 1;
          if (!fact.recoverable) return 2;
          return 3;
        };
        const delta = rank(a) - rank(b);
        if (delta !== 0) return delta;
        return a.createdAtMs - b.createdAtMs;
      });
    return candidates[0] ?? null;
  };

  for (;;) {
    const recoverable = facts.filter(
      (fact) => fact.recoverable && now() - fact.createdAtMs < retentionMs
    );
    const used = facts.reduce((sum, fact) => sum + fact.bytes, 0);
    const overCount = recoverable.length >= maxRecoverable;
    const overSize = used + incomingBytes > maxBytes;
    const aged = facts.some(
      (fact) => !leased.has(fact.snapshotId) && now() - fact.createdAtMs >= retentionMs
    );
    if (!overCount && !overSize && !aged) return;
    const victim = pickVictim();
    if (!victim) {
      throw new SemanticReleaseSnapshotError(
        "semantic_snapshot_unavailable",
        "批次前快照容量不足，且仍被引用的快照不能清理。本次没有写入正式文件。"
      );
    }
    if (!overCount && !overSize && now() - victim.createdAtMs < retentionMs && victim.recoverable) {
      return;
    }
    await rm(snapshotDir(projectRoot, victim.releaseId), { recursive: true, force: true });
    facts = facts.filter((fact) => fact.snapshotId !== victim.snapshotId);
  }
}

export type CaptureSnapshotInput = {
  projectRoot: string;
  releaseId: string;
  actor: string;
  entries: Array<{
    order: number;
    targetPath: string;
    assetKind: "overlay" | "manifest";
    identity?: { connectionId: string; schema: string; table: string };
    expectedNewDigest: string | null;
  }>;
  now?: () => Date;
};

export async function writeSemanticReleaseSnapshot(
  input: CaptureSnapshotInput
): Promise<SemanticReleaseSnapshot> {
  await assertCallerHoldsPublishWindow(input.projectRoot);
  if (input.entries.length === 0) {
    throw new SemanticReleaseSnapshotError(
      "semantic_snapshot_unavailable",
      "没有语义写入目标，不创建空的批次前快照。"
    );
  }
  const instanceId = await readOrCreateSemanticInstanceId(input.projectRoot);
  const createdAt = (input.now ?? (() => new Date()))().toISOString();
  const entries: SemanticReleaseSnapshotEntry[] = [];
  for (const entry of [...input.entries].sort((a, b) => a.order - b.order)) {
    assertSemanticTargetPath(entry.targetPath);
    const original = await readOriginal(input.projectRoot, entry.targetPath);
    entries.push({
      order: entry.order,
      targetPath: entry.targetPath,
      assetKind: entry.assetKind,
      ...(entry.identity ? { identity: entry.identity } : {}),
      originalBase64: original ? original.toString("base64") : null,
      originalDigest: original ? sha256(original) : null,
      expectedNewDigest: entry.expectedNewDigest
    });
  }
  const snapshotId = `snap_${randomUUID()}`;
  const body: Omit<SemanticReleaseSnapshot, "snapshotDigest"> = {
    schemaVersion: SEMANTIC_RELEASE_SNAPSHOT_SCHEMA,
    snapshotId,
    releaseId: input.releaseId,
    instanceId,
    createdAt,
    actor: input.actor,
    entries
  };
  const snapshot: SemanticReleaseSnapshot = {
    ...body,
    snapshotDigest: computeSnapshotDigest(body)
  };
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized);
  await reserveSemanticReleaseSnapshotCapacity(input.projectRoot, bytes);
  const dir = snapshotDir(input.projectRoot, input.releaseId);
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, "snapshot.json");
  const temp = path.join(dir, `.snapshot.tmp-${randomUUID()}`);
  const lease = await acquireSnapshotLease(input.projectRoot, {
    snapshotId,
    kind: "publish",
    ttlMs: 10 * 60_000
  });
  try {
    await writeFile(temp, serialized, "utf8");
    await rename(temp, finalPath);
    const readBack = JSON.parse(await readFile(finalPath, "utf8")) as SemanticReleaseSnapshot;
    if (readBack.snapshotDigest !== snapshot.snapshotDigest) {
      throw new SemanticReleaseSnapshotError("semantic_snapshot_unavailable", "批次前快照回读摘要不一致。");
    }
    if (readBack.entries.length !== entries.length) {
      throw new SemanticReleaseSnapshotError("semantic_snapshot_unavailable", "批次前快照回读条目数不一致。");
    }
    for (const entry of readBack.entries) {
      const original = await readOriginal(input.projectRoot, entry.targetPath);
      const digest = original ? sha256(original) : null;
      if (digest !== entry.originalDigest) {
        throw new SemanticReleaseSnapshotError(
          "semantic_snapshot_unavailable",
          "批次前快照回读与当前原文件摘要不一致。"
        );
      }
    }
    return readBack;
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof SemanticReleaseSnapshotError) throw error;
    throw new SemanticReleaseSnapshotError(
      "semantic_snapshot_unavailable",
      "批次前快照未能落盘，本次没有写入正式文件。"
    );
  } finally {
    await releaseSnapshotLease(input.projectRoot, lease.leaseId).catch(() => undefined);
  }
}

export async function readSemanticReleaseSnapshot(
  projectRoot: string,
  releaseId: string
): Promise<SemanticReleaseSnapshot | null> {
  try {
    const text = await readFile(path.join(snapshotDir(projectRoot, releaseId), "snapshot.json"), "utf8");
    const snapshot = JSON.parse(text) as SemanticReleaseSnapshot;
    if (snapshot.schemaVersion !== SEMANTIC_RELEASE_SNAPSHOT_SCHEMA) return null;
    const { snapshotDigest, ...body } = snapshot;
    if (computeSnapshotDigest(body) !== snapshotDigest) {
      throw new SemanticReleaseSnapshotError("semantic_snapshot_unavailable", "批次前快照已损坏。");
    }
    return snapshot;
  } catch (error) {
    if (error instanceof SemanticReleaseSnapshotError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SemanticReleaseSnapshotError("semantic_snapshot_unavailable", "批次前快照不可读。");
  }
}
