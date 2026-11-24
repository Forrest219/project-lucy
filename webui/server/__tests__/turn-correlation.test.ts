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
      confidence: "low",
      associationStatus: "candidate"
    });
    expect(registry.resolve({ identity, sessionId: "session-b" }, 3_000)).toEqual({
      turnId: "turn-b",
      mode: "session_bound",
      confidence: "low",
      associationStatus: "candidate"
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
      associationStatus: "conflict",
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
      confidence: "low",
      associationStatus: "candidate"
    });
  });

  it("leaves no-session calls unassigned when more than one turn is active", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-a" }, 1_000);
    registry.record({ identity, sessionId: "session-b", turnId: "turn-b" }, 2_000);

    expect(registry.resolve({ identity }, 3_000)).toEqual({
      mode: "unassigned",
      confidence: "none",
      associationStatus: "unassigned"
    });
  });

  it("purges expired turns before resolving", () => {
    const registry = new TurnCorrelationRegistry(() => 1_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-a" }, 1_000);
    expect(registry.resolve({ identity, sessionId: "session-a" }, 2_001)).toEqual({
      mode: "unassigned",
      confidence: "none",
      associationStatus: "unassigned"
    });
  });

  it("accepts an explicit turn only after ownership is known", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    expect(registry.resolve({ identity, explicitTurnId: "turn-unknown" }, 1_000)).toEqual({
      mode: "unassigned",
      confidence: "none",
      associationStatus: "conflict",
      reason: "turn_attribution_rejected"
    });

    registry.record({ identity, turnId: "turn-known" }, 1_000);
    expect(registry.resolve({ identity, explicitTurnId: "turn-known" }, 2_000)).toEqual({
      turnId: "turn-known",
      mode: "explicit",
      confidence: "high",
      associationStatus: "confirmed"
    });
  });

  // 空桑基修复 Spec SC-01–SC-03
  it("SC-01 — after begin, same-session tool call without header continues as confirmed", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-begin" }, 1_000);

    expect(
      registry.resolveToolCall({ identity, sessionId: "session-a", explicitTurnId: null }, 2_000)
    ).toEqual({
      turnId: "turn-begin",
      mode: "explicit",
      confidence: "high",
      associationStatus: "confirmed"
    });
  });

  it("SC-02 — without sessionId, do not elevate begin turn to confirmed (stays candidate inference)", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-begin" }, 1_000);

    expect(registry.resolveToolCall({ identity, explicitTurnId: null }, 2_000)).toEqual({
      turnId: "turn-begin",
      mode: "identity_inferred",
      confidence: "low",
      associationStatus: "candidate"
    });
  });

  it("SC-03 — illegal header stays conflict and does not fall back to active turn", () => {
    const registry = new TurnCorrelationRegistry(() => 60_000);
    registry.record({ identity, sessionId: "session-a", turnId: "turn-begin" }, 1_000);

    expect(
      registry.resolveToolCall(
        { identity, sessionId: "session-a", explicitTurnId: "turn-forged" },
        2_000
      )
    ).toEqual({
      mode: "unassigned",
      confidence: "none",
      associationStatus: "conflict",
      reason: "turn_attribution_rejected"
    });
  });
});
