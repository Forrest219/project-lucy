export type TurnCorrelationIdentity = {
  userId: string;
  tokenHashPrefix: string;
};

export type TurnAttributionMode = "explicit" | "session_bound" | "identity_inferred" | "unassigned";
export type TurnAttributionConfidence = "high" | "low" | "none";

/**
 * Spec 173 v0.3 / 2026-10-19 audit-trust:正交于 turn_attribution_mode 的关联质量判定。
 * 由准入路径冻结；prepared / delivered 阶段不改写。
 */
export type AssociationStatus = "confirmed" | "candidate" | "unassigned" | "conflict" | "legacy_unverified";

/** 关联质量五态值域（读路径归一化的唯一依据）。 */
export const ASSOCIATION_STATUSES = [
  "confirmed",
  "candidate",
  "unassigned",
  "conflict",
  "legacy_unverified"
] as const;

const ASSOCIATION_STATUS_SET: ReadonlySet<string> = new Set(ASSOCIATION_STATUSES);

export function isAssociationStatus(value: unknown): value is AssociationStatus {
  return typeof value === "string" && ASSOCIATION_STATUS_SET.has(value);
}

export type TurnAttribution = {
  turnId?: string;
  mode: TurnAttributionMode;
  confidence: TurnAttributionConfidence;
  /**
   * Spec 173 v0.3: 调用方在 T01 后写入 `original*`/`effective*` 双视图。
   * resolve() 仅返回基础元数据；association_status 由 mcp-proxy.ts 入参路径派生。
   */
  associationStatus?: AssociationStatus;
  /**
   * 归属被拒 / 冲突的原因。既有值 `turn_attribution_rejected` 保持不变；
   * B10 新增 `attribution_evidence_conflict`（同级证据互相矛盾，不选边）。
   */
  reason?: "turn_attribution_rejected" | "attribution_evidence_conflict";
};

type TurnEntry = {
  turnId: string;
  identityKey: string;
  sessionId?: string;
  createdAt: number;
};

function identityKey(identity: TurnCorrelationIdentity): string {
  return `${identity.userId}:${identity.tokenHashPrefix}`;
}

export class TurnCorrelationRegistry {
  private readonly turns = new Map<string, TurnEntry>();

  constructor(private readonly windowMs: () => number) {}

  record(input: {
    identity: TurnCorrelationIdentity;
    sessionId?: string;
    turnId: string;
  }, now = Date.now()): void {
    this.purge(now);
    this.turns.set(input.turnId, {
      turnId: input.turnId,
      identityKey: identityKey(input.identity),
      sessionId: input.sessionId,
      createdAt: now
    });
  }

  /** 同一身份的新问询接替旧轮次。只移出内存候选，不改已写入的审计行。 */
  forget(turnId: string | undefined): void {
    if (turnId) this.turns.delete(turnId);
  }

  /**
   * 解析问询归属。
   *
   * B10：本方法**只负责收集证据**，裁决交给 `resolveAttributionByEvidence` ——
   * 证据顺序（显式绑定 → 迟到修订 → 会话绑定 → 系统推断 → 未归属）是唯一的
   * 裁决依据，**永不按时间回绑**。
   *
   * 行为与既有实现等价：显式绑定被拒时保留 conflict + `turn_attribution_rejected`；
   * 会话候选降为 candidate + low；无候选时保持 unassigned + none。
   */
  resolve(input: {
    identity: TurnCorrelationIdentity;
    sessionId?: string;
    explicitTurnId?: string;
  }, now = Date.now()): TurnAttribution {
    this.purge(now);
    const ownerKey = identityKey(input.identity);
    const evidence: AttributionEvidence[] = [];

    if (input.explicitTurnId) {
      const entry = this.turns.get(input.explicitTurnId);
      const sessionConflicts = Boolean(
        entry?.sessionId && input.sessionId && entry.sessionId !== input.sessionId
      );
      if (!entry || entry.identityKey !== ownerKey || sessionConflicts) {
        // 显式绑定未通过既有边界校验 → 保留冲突，**不按时间回绑**。
        return {
          mode: "unassigned",
          confidence: "none",
          associationStatus: "conflict",
          reason: "turn_attribution_rejected"
        };
      }
      evidence.push({
        kind: "explicit_binding",
        turnId: entry.turnId,
        confidence: "high",
        associationStatus: "confirmed"
      });
    } else {
      const identityTurns = [...this.turns.values()].filter((entry) => entry.identityKey === ownerKey);
      if (input.sessionId) {
        // Spec L25-09 §12.4 / L25-09 audit-trust §12.4: session inference
        // requires EXACTLY ONE session candidate. Picking the most recent turn
        // would be a backbind by elapsed time, which the spec forbids, and it
        // would silently hide competing candidates.
        const sessionTurns = identityTurns.filter((entry) => entry.sessionId === input.sessionId);
        if (sessionTurns.length === 1) {
          // Spec 173 v0.3 / 2026-10-19 audit-trust: session 候选推断降为 candidate + low,
          // 不进入 confirmed 分母（EA-04 / EA-07）。association_status 由调用方写 effective_*。
          evidence.push({
            kind: "session_bound",
            turnId: sessionTurns[0].turnId,
            confidence: "low",
            associationStatus: "candidate"
          });
        } else if (sessionTurns.length > 1) {
          // More than one candidate is genuine ambiguity, not a licence to pick
          // one. The call stays unassigned and the conflict is recorded.
          evidence.push({
            kind: "unassigned",
            turnId: sessionTurns
              .map((entry) => entry.turnId)
              .sort()
              .join(","),
            confidence: "none",
            associationStatus: "conflict",
            reason: "attribution_session_candidate_ambiguous"
          });
        }
      } else if (identityTurns.length === 1) {
        evidence.push({
          kind: "identity_inferred",
          turnId: identityTurns[0].turnId,
          confidence: "low",
          associationStatus: "candidate"
        });
      }
    }

    const resolved = resolveAttributionByEvidence(evidence);
    return {
      turnId: resolved.turnId,
      mode: resolved.mode,
      confidence: resolved.confidence,
      associationStatus: resolved.associationStatus
    };
  }

  private purge(now: number): void {
    const windowMs = this.windowMs();
    for (const [turnId, entry] of this.turns.entries()) {
      if (now - entry.createdAt > windowMs) this.turns.delete(turnId);
    }
  }
}

// ─── B10：归属证据顺序（Spec §7.2 / §12.4 / U5）─────────────────────────────
//
// 权威顺序（Spec §7.2 冻结）：
//   1. 显式绑定（begin_question 及其确认的更正事件）
//   2. 经既有可见性/显式关联校验的迟到修订（带原因、证据与规则版本；
//      **迟到推断仍只是 candidate**）
//   3. 会话绑定（session_bound，low 置信）
//   4. 系统推断（identity_inferred / 候选，none 或 low 置信）
//   5. 未归属（unassigned）
//
// 硬规则：
//   - **永不按时间回绑**：本模块的证据裁决函数**不接受时间参数**，
//     仅凭证据种类定序；调用方传入时间也不会被使用。
//   - **迟到不代表更可信**：`late_revision` 最高只能得到 low 置信 +
//     candidate 关联状态。
//   - 事实矛盾不选边：同一级证据指向不同 turn 时保留冲突（unassigned +
//     conflict），不挑一个。

export const ATTRIBUTION_EVIDENCE_ORDER = [
  "explicit_binding",
  "late_revision",
  "session_bound",
  "identity_inferred",
  "unassigned"
] as const;

export type AttributionEvidenceKind = (typeof ATTRIBUTION_EVIDENCE_ORDER)[number];

export type AttributionEvidence = {
  kind: AttributionEvidenceKind;
  turnId?: string;
  confidence: TurnAttributionConfidence;
  associationStatus: AssociationStatus;
  /** 迟到修订的原因（可追溯）。 */
  reason?: string;
  /** 归属规则版本。 */
  ruleVersion?: string;
};

export type ResolvedAttribution = TurnAttribution & {
  /** 命中的证据种类。 */
  evidenceKind: AttributionEvidenceKind;
  /** 命中的原始证据（审计留痕）。 */
  evidence: AttributionEvidence | null;
  /** 命中证据自带的自由文本原因（与上面的枚举型 `reason` 分开）。 */
  evidenceReason?: string;
  /** 同一级证据互相矛盾时为 true（保留冲突，不选边）。 */
  conflicted: boolean;
};

function evidenceRank(kind: AttributionEvidenceKind): number {
  return ATTRIBUTION_EVIDENCE_ORDER.indexOf(kind);
}

/**
 * 按证据顺序裁决归属。
 *
 * 只看**证据种类**，不看任何时间戳：函数签名里没有时间参数，调用方也
 * 无法通过传入时间影响结果 —— 这是「永不按时间回绑」的可执行形态。
 */
export function resolveAttributionByEvidence(
  candidates: readonly AttributionEvidence[]
): ResolvedAttribution {
  const usable = candidates.filter((candidate) => candidate.kind !== "unassigned");
  if (usable.length === 0) {
    return {
      mode: "unassigned",
      confidence: "none",
      associationStatus: "unassigned",
      evidenceKind: "unassigned",
      evidence: null,
      conflicted: false
    };
  }

  const best = usable.reduce((acc, candidate) =>
    evidenceRank(candidate.kind) < evidenceRank(acc.kind) ? candidate : acc
  );
  const peers = usable.filter((candidate) => candidate.kind === best.kind);
  const turnIds = new Set(peers.map((peer) => peer.turnId ?? ""));
  if (turnIds.size > 1) {
    // 同级证据互相矛盾 → 保留冲突，不选边（Spec §4.3 第 1 行精神）。
    return {
      mode: "unassigned",
      confidence: "none",
      associationStatus: "conflict",
      reason: "attribution_evidence_conflict",
      evidenceKind: best.kind,
      evidence: null,
      conflicted: true
    };
  }

  const evidence = peers[0];
  // 迟到修订最高只到 low 置信 + candidate：**迟到不代表更可信**。
  const confidence: TurnAttributionConfidence =
    best.kind === "late_revision" && evidence.confidence === "high" ? "low" : evidence.confidence;
  const associationStatus: AssociationStatus =
    best.kind === "late_revision" && evidence.associationStatus === "confirmed"
      ? "candidate"
      : evidence.associationStatus;

  return {
    turnId: evidence.turnId,
    mode:
      best.kind === "explicit_binding"
        ? "explicit"
        : best.kind === "session_bound"
          ? "session_bound"
          : best.kind === "identity_inferred"
            ? "identity_inferred"
            : "unassigned",
    confidence,
    associationStatus,
    evidenceReason: evidence.reason,
    evidenceKind: best.kind,
    evidence,
    conflicted: false
  };
}

// ─── B9：标识字典语义（Spec §6.2）──────────────────────────────────────────

/**
 * `client_call_id` 的唯一性范围：**已认证适配器命名空间内唯一**。
 * 一次逻辑调用可有多个尝试、多个客户端观测 —— 因此 client_call_id
 * 相同**不能**单独证明两次执行是同一次。
 */
export type ClientCallIdentity = {
  /** 已认证适配器 ID。 */
  adapterId: string;
  clientCallId: string;
};

export function isSameLogicalCall(a: ClientCallIdentity, b: ClientCallIdentity): boolean {
  return a.adapterId === b.adapterId && a.clientCallId === b.clientCallId;
}

/**
 * `client_call_id` **不等于** `client_event_id`（Spec §6.2）。
 * 两者相等说明调用方复用了观测 ID 作逻辑调用 ID —— 拒绝这种形态。
 */
export function assertDistinctClientIdentifiers(input: {
  clientCallId: string | null;
  clientEventId: string | null;
}): { ok: true } | { ok: false; reason: "client_call_id_equals_client_event_id" } {
  if (input.clientCallId && input.clientEventId && input.clientCallId === input.clientEventId) {
    return { ok: false, reason: "client_call_id_equals_client_event_id" };
  }
  return { ok: true };
}

/**
 * `upstream_operation_id` 必须是上游**真实回传**的标识，且连同上游实例 /
 * 连接命名空间保存；**不得用 operation_id 填充**（Spec §6.2）。
 */
export function assertDistinctUpstreamIdentifier(input: {
  upstreamOperationId: string | null;
  operationId: string;
  /** 上游实例 / 连接命名空间。 */
  upstreamNamespace?: string | null;
}): { ok: true } | { ok: false; reason: "upstream_id_equals_operation_id" | "upstream_id_missing_namespace" } {
  if (input.upstreamOperationId === null) return { ok: true };
  if (input.upstreamOperationId === input.operationId) {
    return { ok: false, reason: "upstream_id_equals_operation_id" };
  }
  if (!input.upstreamNamespace) {
    return { ok: false, reason: "upstream_id_missing_namespace" };
  }
  return { ok: true };
}
