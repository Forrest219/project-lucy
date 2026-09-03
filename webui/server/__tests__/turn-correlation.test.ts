import { describe, expect, it } from "vitest";
import { TurnCorrelationRegistry } from "../proxy/turn-correlation";

const identity = { userId: "agent-a", tokenHashPrefix: "abc123" };

describe("TurnCorrelationRegistry", () => {
  it("isolates interleaved turns by session", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-a" }, 1_000);
    registry.record({ identity, sessionId: "session-b", turnId: "turn-b" }, 2_000);

    expect(registry.resolve({ identity, sessionId: "session-a" }, 3_000)).toEqual({
      turnId: "turn-a",
      mode: "session_bound",
      confidence: "high"
    });
    expect(registry.resolve({ identity, sessionId: "session-b" }, 3_000)).toEqual({
      turnId: "turn-b",
      mode: "session_bound",
      confidence: "high"
    });
  });

  it("rejects an explicit turn owned by another identity", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-a" }, 1_000);

    expect(registry.resolve({
      identity: { userId: "agent-b", tokenHashPrefix: "other" },
      sessionId: "session-a",
      explicitTurnId: "turn-a"
    }, 2_000)).toEqual({
      mode: "unassigned",
      confidence: "none",
      reason: "turn_attribution_rejected"
    });
  });

  it("rejects an explicit turn from another session", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-a" }, 1_000);

    expect(registry.resolve({
      identity,
      sessionId: "session-b",
      explicitTurnId: "turn-a"
    }, 2_000)).toMatchObject({ mode: "unassigned", confidence: "none" });
  });

  it("marks a unique no-session match as low-confidence inference", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-a" }, 1_000);

    expect(registry.resolve({ identity }, 2_000)).toEqual({
      turnId: "turn-a",
      mode: "identity_inferred",
      confidence: "low"
    });
  });

  it("leaves no-session calls unassigned when more than one turn is active", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-a" }, 1_000);
    registry.record({ identity, sessionId: "session-b", turnId: "turn-b" }, 2_000);

    expect(registry.resolve({ identity }, 3_000)).toEqual({
      mode: "unassigned",
      confidence: "none"
    });
  });

  it("purges expired turns before resolving", () => {
    const registry = new TurnCorrelationRegistry(() => 1_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-a" }, 1_000);
    expect(registry.resolve({ identity, sessionId: "session-a" }, 2_001)).toEqual({
      mode: "unassigned",
      confidence: "none"
    });
  });

  it("accepts an explicit turn only after ownership is known", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    expect(registry.resolve({ identity, explicitTurnId: "turn-unknown" }, 1_000)).toEqual({
      mode: "unassigned",
      confidence: "none",
      reason: "turn_attribution_rejected"
    });

    registry.record({ identity, turnId: "turn-known" }, 1_000);
    expect(registry.resolve({ identity, explicitTurnId: "turn-known" }, 2_000)).toEqual({
      turnId: "turn-known",
      mode: "explicit",
      confidence: "high"
    });
  });
});
