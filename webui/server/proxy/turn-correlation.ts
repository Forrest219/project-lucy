export type TurnCorrelationIdentity = {
  userId: string;
  tokenHashPrefix: string;
};

export type TurnAttributionMode = "explicit" | "session_bound" | "identity_inferred" | "unassigned";
export type TurnAttributionConfidence = "high" | "low" | "none";

export type TurnAttribution = {
  turnId?: string;
  mode: TurnAttributionMode;
  confidence: TurnAttributionConfidence;
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
          reason: "turn_attribution_rejected"
        };
      }
      return { turnId: entry.turnId, mode: "explicit", confidence: "high" };
    }

    const identityTurns = [...this.turns.values()].filter((entry) => entry.identityKey === ownerKey);
    if (input.sessionId) {
      const sessionTurns = identityTurns
        .filter((entry) => entry.sessionId === input.sessionId)
        .sort((a, b) => b.createdAt - a.createdAt);
      if (sessionTurns[0]) {
        return { turnId: sessionTurns[0].turnId, mode: "session_bound", confidence: "high" };
      }
      return { mode: "unassigned", confidence: "none" };
    }

    if (identityTurns.length === 1) {
      return {
        turnId: identityTurns[0].turnId,
        mode: "identity_inferred",
        confidence: "low"
      };
    }
    return { mode: "unassigned", confidence: "none" };
  }

  private purge(now: number): void {
    const windowMs = this.windowMs();
    for (const [turnId, entry] of this.turns.entries()) {
      if (now - entry.createdAt > windowMs) this.turns.delete(turnId);
    }
  }
}
