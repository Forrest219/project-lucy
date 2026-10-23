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

export type TurnAttribution = {
  turnId?: string;
  mode: TurnAttributionMode;
  confidence: TurnAttributionConfidence;
  /**
   * Spec 173 v0.3: 调用方在 T01 后写入 `original*`/`effective*` 双视图。
   * resolve() 仅返回基础元数据；association_status 由 mcp-proxy.ts 入参路径派生。
   */
  associationStatus?: AssociationStatus;
  reason?: "turn_attribution_rejected";
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

  resolve(input: {
    identity: TurnCorrelationIdentity;
    sessionId?: string;
    explicitTurnId?: string;
  }, now = Date.now()): TurnAttribution {
    this.purge(now);
    const ownerKey = identityKey(input.identity);

    if (input.explicitTurnId) {
      const entry = this.turns.get(input.explicitTurnId);
      const sessionConflicts = Boolean(
        entry?.sessionId && input.sessionId && entry.sessionId !== input.sessionId
      );
      if (!entry || entry.identityKey !== ownerKey || sessionConflicts) {
        return {
          mode: "unassigned",
          confidence: "none",
          associationStatus: "conflict",
          reason: "turn_attribution_rejected"
        };
      }
      return { turnId: entry.turnId, mode: "explicit", confidence: "high", associationStatus: "confirmed" };
    }

    const identityTurns = [...this.turns.values()].filter((entry) => entry.identityKey === ownerKey);
    if (input.sessionId) {
      const sessionTurns = identityTurns
        .filter((entry) => entry.sessionId === input.sessionId)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (sessionTurns[0]) {
        // Spec 173 v0.3 / 2026-10-19 audit-trust: session 候选推断降为 candidate + low,
        // 不进入 confirmed 分母（EA-04 / EA-07）。association_status 由调用方写 effective_*。
        return {
          turnId: sessionTurns[0].turnId,
          mode: "session_bound",
          confidence: "low",
          associationStatus: "candidate"
        };
      }
      return { mode: "unassigned", confidence: "none", associationStatus: "unassigned" };
    }

    if (identityTurns.length === 1) {
      return {
        turnId: identityTurns[0].turnId,
        mode: "identity_inferred",
        confidence: "low",
        associationStatus: "candidate"
      };
    }
    return { mode: "unassigned", confidence: "none", associationStatus: "unassigned" };
  }

  private purge(now: number): void {
    const windowMs = this.windowMs();
    for (const [turnId, entry] of this.turns.entries()) {
      if (now - entry.createdAt > windowMs) this.turns.delete(turnId);
    }
  }
}
