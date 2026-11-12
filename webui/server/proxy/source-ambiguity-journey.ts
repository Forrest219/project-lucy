/**
 * P0-3 表级歧义门闩 — 问询旅程字段、候选快照与宿主 attested 用户参与证据。
 *
 * O1 确认载体＝旅程字段 `confirmedSourceKey`（互斥；不实现 query 参数载体）。
 * UserParticipationEvidence 须经非 MCP tools/call 通道写入（§4.4 层 B）。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";
import type { CanonicalSourceKey } from "./acl.js";
import { canonicalSourceKeyDisplay, canonicalSourceKeyEquals } from "./acl.js";

export type SourceIdentity = CanonicalSourceKey;

export type DescriptionState = "present" | "missing" | "truncated";

export type DescriptionReadHealth =
  | { status: "ok" }
  | { status: "read_failed"; reason: string }
  | { status: "index_unreliable" };

/** 宿主 attested 用户参与证据（§4.4 层 B）。 */
export type UserParticipationEvidence = {
  sessionKey: string;
  generation: number;
  selectedIdentity: SourceIdentity;
  attestedAt: string;
  /** 首期固定：宿主确认提交 API。 */
  sourceChannel: "host_confirm_api";
};

export type AmbiguityCandidateSnapshot = {
  generation: number;
  candidateIdentities: SourceIdentity[];
  issuedAt: string;
};

export type SourceAmbiguityJourney = {
  scopeKey: string;
  /** BindingSession generation，或 never_begun 哨兵代次。 */
  generation: number;
  intentSummary: string | null;
  question: string | null;
  /** O1 载体：完整 Source Identity。 */
  confirmedSourceKey: SourceIdentity | null;
  candidateSnapshot: AmbiguityCandidateSnapshot | null;
  userParticipation: UserParticipationEvidence | null;
  updatedAt: string;
};

/** never_begun 时的会话级「无绑定代次」哨兵（夹具固定）。 */
export const NEVER_BEGUN_GENERATION_SENTINEL = 0;

const STATE_DIR_REL = path.join(".ktx-ui", "source-ambiguity");
const JOURNEY_FILE_PREFIX = "journey-";

let stateDirOverride: string | null = null;

/** 测试钩子：把状态目录指到临时目录。传 null 恢复默认。 */
export function setSourceAmbiguityStateDir(dir: string | null): void {
  stateDirOverride = dir;
}

async function stateDir(): Promise<string> {
  if (stateDirOverride) return stateDirOverride;
  return path.join(await resolveProjectRoot(), STATE_DIR_REL);
}

function journeyFilePath(base: string, scopeKey: string): string {
  const digest = createHash("sha256").update(scopeKey).digest("hex").slice(0, 32);
  return path.join(base, "journeys", `${JOURNEY_FILE_PREFIX}${digest}.json`);
}

/** 与 BindingSession 对齐的作用域键。 */
export function ambiguityScopeKey(identityKey: string, sessionId: string | null | undefined): string {
  const session = sessionId && sessionId.length > 0 ? sessionId : "-";
  return `sag:${identityKey}:${session}`;
}

function emptyJourney(scopeKey: string, generation = NEVER_BEGUN_GENERATION_SENTINEL): SourceAmbiguityJourney {
  return {
    scopeKey,
    generation,
    intentSummary: null,
    question: null,
    confirmedSourceKey: null,
    candidateSnapshot: null,
    userParticipation: null,
    updatedAt: new Date(0).toISOString()
  };
}

type JourneyFileRead =
  | { kind: "missing" }
  | { kind: "ok"; journey: SourceAmbiguityJourney }
  | { kind: "failed"; reason: string };

async function readJourneyFile(base: string, scopeKey: string): Promise<JourneyFileRead> {
  const file = journeyFilePath(base, scopeKey);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return {
      kind: "failed",
      reason: `journey_io:${(err as NodeJS.ErrnoException).code ?? "unknown"}`
    };
  }
  try {
    return { kind: "ok", journey: JSON.parse(raw) as SourceAmbiguityJourney };
  } catch {
    return { kind: "failed", reason: "journey_parse_error" };
  }
}

async function writeJourneyFile(base: string, journey: SourceAmbiguityJourney): Promise<void> {
  const file = journeyFilePath(base, journey.scopeKey);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(journey), { encoding: "utf8" });
  await rename(tmp, file);
}

export type SourceAmbiguityJourneyRead =
  | { ok: true; journey: SourceAmbiguityJourney }
  | { ok: false; reason: string };

/**
 * ENOENT → 空旅程；IO／JSON 损坏 → fail-closed（不得当作空旅程放行）。
 */
export async function readSourceAmbiguityJourneyResult(
  scopeKey: string
): Promise<SourceAmbiguityJourneyRead> {
  const base = await stateDir();
  const read = await readJourneyFile(base, scopeKey);
  if (read.kind === "failed") return { ok: false, reason: read.reason };
  if (read.kind === "missing") return { ok: true, journey: emptyJourney(scopeKey) };
  return { ok: true, journey: read.journey };
}

export async function readSourceAmbiguityJourney(scopeKey: string): Promise<SourceAmbiguityJourney> {
  const result = await readSourceAmbiguityJourneyResult(scopeKey);
  if (!result.ok) {
    throw new Error(`source_ambiguity_journey_read_failed:${result.reason}`);
  }
  return result.journey;
}

/**
 * begin／supersede：写入词源，清掉旧确认／快照／用户证据，对齐 generation。
 */
export async function upsertJourneyOnBegin(input: {
  scopeKey: string;
  generation: number;
  intentSummary: string;
  question?: string | null;
}): Promise<SourceAmbiguityJourney> {
  const base = await stateDir();
  const next: SourceAmbiguityJourney = {
    scopeKey: input.scopeKey,
    generation: input.generation,
    intentSummary: input.intentSummary,
    question: input.question?.trim() ? input.question.trim() : null,
    confirmedSourceKey: null,
    candidateSnapshot: null,
    userParticipation: null,
    updatedAt: new Date().toISOString()
  };
  await writeJourneyFile(base, next);
  return next;
}

/** 门闩拒绝时持久化候选快照（§4.4）。 */
export async function persistAmbiguityCandidateSnapshot(input: {
  scopeKey: string;
  generation: number;
  candidates: SourceIdentity[];
  issuedAt?: string;
}): Promise<AmbiguityCandidateSnapshot> {
  const base = await stateDir();
  const read = await readJourneyFile(base, input.scopeKey);
  if (read.kind === "failed") {
    throw new Error(`source_ambiguity_journey_read_failed:${read.reason}`);
  }
  const current =
    read.kind === "ok" ? read.journey : emptyJourney(input.scopeKey, input.generation);
  const snapshot: AmbiguityCandidateSnapshot = {
    generation: input.generation,
    candidateIdentities: input.candidates.map((c) => ({ ...c })),
    issuedAt: input.issuedAt ?? new Date().toISOString()
  };
  const next: SourceAmbiguityJourney = {
    ...current,
    scopeKey: input.scopeKey,
    generation: input.generation,
    candidateSnapshot: snapshot,
    // 拒绝不得把未确认写成已确认
    confirmedSourceKey: current.confirmedSourceKey,
    updatedAt: new Date().toISOString()
  };
  await writeJourneyFile(base, next);
  return snapshot;
}

/**
 * 宿主确认 HTTP 入口可调用方：仅 `actorKind=person`。
 * MCP Agent／automation／未标注 actor 一律拒绝（D11／§4.4／SC-17）。
 */
export function hostConfirmCallerAllowed(identity: {
  actorKind?: string | null;
}): boolean {
  return identity.actorKind === "person";
}

/** 宿主 UI 须携带；MCP Agent 不得依赖此头自证。 */
export const LUCY_HOST_ATTESTATION_HEADER = "x-lucy-host-attestation";

/**
 * 宿主确认 HTTP 准入（与 mcp-proxy 共用；可单测）。
 * 同一 MCP Bearer 且 actorKind≠person／缺宿主头 → 拒绝，防止 Agent 自证选表。
 */
export function admitHostConfirmRequest(input: {
  identity: { actorKind?: string | null };
  hostAttestationHeader?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!hostConfirmCallerAllowed(input.identity)) {
    return { ok: false, reason: "host_confirm_requires_person" };
  }
  if (!input.hostAttestationHeader?.trim()) {
    return { ok: false, reason: "host_attestation_header_missing" };
  }
  return { ok: true };
}

/**
 * 宿主确认提交 API（非 tools/call）—— 写入 O1 载体 + 层 B 用户参与证据。
 * Agent 不得经 tools/call 调用本入口冒充。
 */
export async function attestSourceConfirmation(input: {
  scopeKey: string;
  generation: number;
  selectedIdentity: SourceIdentity;
  attestedAt?: string;
}): Promise<{ ok: true; journey: SourceAmbiguityJourney } | { ok: false; reason: string }> {
  const base = await stateDir();
  const read = await readJourneyFile(base, input.scopeKey);
  if (read.kind === "failed") {
    return { ok: false, reason: read.reason };
  }
  const current =
    read.kind === "ok" ? read.journey : emptyJourney(input.scopeKey, input.generation);
  const snapshot = current.candidateSnapshot;
  if (!snapshot) {
    return { ok: false, reason: "candidate_snapshot_missing" };
  }
  if (snapshot.generation !== input.generation || current.generation !== input.generation) {
    return { ok: false, reason: "generation_mismatch" };
  }
  const inSnapshot = snapshot.candidateIdentities.some((id) =>
    canonicalSourceKeyEquals(id, input.selectedIdentity)
  );
  if (!inSnapshot) {
    return { ok: false, reason: "identity_not_in_snapshot" };
  }
  const attestedAt = input.attestedAt ?? new Date().toISOString();
  if (Date.parse(attestedAt) <= Date.parse(snapshot.issuedAt)) {
    return { ok: false, reason: "attested_not_after_issued" };
  }
  const evidence: UserParticipationEvidence = {
    sessionKey: input.scopeKey,
    generation: input.generation,
    selectedIdentity: { ...input.selectedIdentity },
    attestedAt,
    sourceChannel: "host_confirm_api"
  };
  const next: SourceAmbiguityJourney = {
    ...current,
    confirmedSourceKey: { ...input.selectedIdentity },
    userParticipation: evidence,
    updatedAt: new Date().toISOString()
  };
  await writeJourneyFile(base, next);
  return { ok: true, journey: next };
}

export type ParticipationVerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Proxy 放行前核验：载体（A）＋用户参与证据（B）＋ generation／快照。
 */
export function verifyUserParticipationEvidence(input: {
  journey: SourceAmbiguityJourney;
  expectedGeneration: number;
  confirmedKey: SourceIdentity;
}): ParticipationVerifyResult {
  const evidence = input.journey.userParticipation;
  if (!evidence) return { ok: false, reason: "evidence_missing" };
  if (evidence.sourceChannel !== "host_confirm_api") {
    return { ok: false, reason: "invalid_source_channel" };
  }
  if (evidence.sessionKey !== input.journey.scopeKey) {
    return { ok: false, reason: "session_key_mismatch" };
  }
  if (
    evidence.generation !== input.expectedGeneration
    || input.journey.generation !== input.expectedGeneration
  ) {
    return { ok: false, reason: "generation_mismatch" };
  }
  const snapshot = input.journey.candidateSnapshot;
  if (!snapshot || snapshot.generation !== input.expectedGeneration) {
    return { ok: false, reason: "snapshot_generation_mismatch" };
  }
  if (Date.parse(evidence.attestedAt) <= Date.parse(snapshot.issuedAt)) {
    return { ok: false, reason: "attested_not_after_issued" };
  }
  if (!canonicalSourceKeyEquals(evidence.selectedIdentity, input.confirmedKey)) {
    return { ok: false, reason: "evidence_identity_mismatch" };
  }
  if (!canonicalSourceKeyEquals(input.journey.confirmedSourceKey ?? input.confirmedKey, input.confirmedKey)) {
    return { ok: false, reason: "carrier_identity_mismatch" };
  }
  const inSnapshot = snapshot.candidateIdentities.some((id) =>
    canonicalSourceKeyEquals(id, input.confirmedKey)
  );
  if (!inSnapshot) return { ok: false, reason: "identity_not_in_snapshot" };
  return { ok: true };
}

export function serializeSourceIdentity(key: SourceIdentity): string {
  return canonicalSourceKeyDisplay(key);
}

export async function clearSourceAmbiguityJourney(scopeKey: string): Promise<void> {
  const base = await stateDir();
  const file = journeyFilePath(base, scopeKey);
  try {
    await rm(file, { force: true });
  } catch {
    // ignore
  }
}
