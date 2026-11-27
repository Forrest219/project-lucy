import { afterEach, describe, expect, it } from "vitest";
import {
  QUESTION_BUDGET_MAX_META_CALLS,
  QuestionBudget,
  classifyBudgetTier,
  isQuestionDataTool,
  questionBudgetMaxMetaCalls,
} from "../proxy/question-experience.js";

describe("REQ-0122 D1 budget tool tiering", () => {
  afterEach(() => {
    delete process.env.QUESTION_BUDGET_MAX_META_CALLS;
  });

  it("classifies query vs metadata vs none", () => {
    expect(classifyBudgetTier("lucy_query")).toBe("query");
    expect(classifyBudgetTier("lucy_certified_route")).toBe("query");
    expect(classifyBudgetTier("lucy_report_template")).toBe("query");
    expect(classifyBudgetTier("lucy_read_source")).toBe("metadata");
    expect(classifyBudgetTier("lucy_freshness")).toBe("metadata");
    expect(classifyBudgetTier("lucy_explain_query")).toBe("metadata");
    expect(classifyBudgetTier("wiki_search")).toBe("metadata");
    expect(classifyBudgetTier("wiki_read")).toBe("metadata");
    expect(classifyBudgetTier("lucy_catalog")).toBe("none");
    expect(classifyBudgetTier("lucy_begin_question")).toBe("none");
    expect(isQuestionDataTool("lucy_query")).toBe(true);
    expect(isQuestionDataTool("lucy_read_source")).toBe(true);
    // 旁路入口单独计费，不进通用 tools/call 预算闸。
    expect(isQuestionDataTool("lucy_certified_route")).toBe(false);
    expect(isQuestionDataTool("lucy_report_template")).toBe(false);
    expect(isQuestionDataTool("lucy_catalog")).toBe(false);
  });

  it("SC-02: metadata tools do not consume calls/busy/query inflight; 201st meta stops", async () => {
    const budget = new QuestionBudget();
    const identity = { identityKey: "u|tok", sessionId: "s-meta" };
    for (let i = 0; i < QUESTION_BUDGET_MAX_META_CALLS; i += 1) {
      const decision = await budget.consumePersisted(undefined, 1_000, undefined, undefined, {
        ...identity,
        toolName: "lucy_read_source",
        canContinue: true,
      });
      expect(decision.action).toBe("allow");
      if (decision.action === "allow") {
        expect(decision.ticket).toBeUndefined();
      }
    }
    const snap = budget.snapshotScope(`bq:${identity.identityKey}:${identity.sessionId}`);
    expect(snap?.calls).toBe(0);
    expect(snap?.busyMs ?? 0).toBe(0);
    expect(snap?.inflight ?? 0).toBe(0);
    expect(snap?.metaCalls).toBe(QUESTION_BUDGET_MAX_META_CALLS);

    const stopped = await budget.consumePersisted(undefined, 1_000, undefined, undefined, {
      ...identity,
      toolName: "wiki_search",
      canContinue: true,
    });
    expect(stopped.action).toBe("stop");
    if (stopped.action === "stop") {
      expect(stopped.reason).toBe("question_budget_exhausted");
      expect(stopped.continuable).toBe(true);
    }
  });

  it("metadata admit does not take query inflight slots", async () => {
    const budget = new QuestionBudget();
    const identity = { identityKey: "u|tok2", sessionId: "s-inflight" };
    // Fill query inflight to the default max (8) without settling.
    for (let i = 0; i < 8; i += 1) {
      const d = await budget.consumePersisted(undefined, 1_000, undefined, undefined, {
        ...identity,
        toolName: "lucy_query",
        canContinue: true,
      });
      expect(d.action).toBe("allow");
    }
    const rejected = await budget.consumePersisted(undefined, 1_000, undefined, undefined, {
      ...identity,
      toolName: "lucy_query",
      canContinue: true,
    });
    expect(rejected.action).toBe("reject");

    const meta = await budget.consumePersisted(undefined, 1_000, undefined, undefined, {
      ...identity,
      toolName: "lucy_freshness",
      canContinue: true,
    });
    expect(meta.action).toBe("allow");
    if (meta.action === "allow") expect(meta.ticket).toBeUndefined();
    const snap = budget.snapshotScope(`bq:${identity.identityKey}:${identity.sessionId}`);
    expect(snap?.calls).toBe(8);
    expect(snap?.metaCalls).toBe(1);
    expect(snap?.inflight).toBe(8);
  });

  it("SC-02b: continue clears metaCalls and restores the window meta quota", async () => {
    process.env.QUESTION_BUDGET_MAX_META_CALLS = "3";
    expect(questionBudgetMaxMetaCalls()).toBe(3);
    const budget = new QuestionBudget();
    const identity = { identityKey: "u|tok3", sessionId: "s-rollover" };
    for (let i = 0; i < 3; i += 1) {
      expect(
        (
          await budget.consumePersisted(undefined, 1_000, undefined, undefined, {
            ...identity,
            toolName: "lucy_read_source",
            canContinue: true,
          })
        ).action
      ).toBe("allow");
    }
    const firstStop = await budget.consumePersisted(undefined, 1_000, undefined, undefined, {
      ...identity,
      toolName: "lucy_read_source",
      canContinue: true,
    });
    expect(firstStop.action).toBe("stop");
    if (firstStop.action !== "stop") return;
    const scopeKey = `bq:${identity.identityKey}:${identity.sessionId}`;
    const declared = await budget.declareContinuation(scopeKey, firstStop.continueToken, 1_000, "continue");
    expect(declared.ok).toBe(true);

    const after = await budget.consumePersisted(undefined, 1_000, undefined, undefined, {
      ...identity,
      toolName: "lucy_read_source",
      canContinue: true,
    });
    expect(after.action).toBe("allow");
    const snap = budget.snapshotScope(scopeKey);
    expect(snap?.metaCalls).toBe(1);
    expect(snap?.continuations).toBe(1);
    expect(snap?.calls ?? 0).toBe(0);
  });

  it("beginQuestion clears metaCalls with the query window", async () => {
    process.env.QUESTION_BUDGET_MAX_META_CALLS = "5";
    const budget = new QuestionBudget();
    const identityKey = "u|tok4";
    const sessionId = "s-begin";
    for (let i = 0; i < 3; i += 1) {
      await budget.consumePersisted(undefined, 1_000, undefined, undefined, {
        identityKey,
        sessionId,
        toolName: "wiki_read",
        canContinue: true,
      });
    }
    const begun = await budget.beginQuestion({
      identityKey,
      sessionId,
      turnId: "turn-begin-1",
      now: 2_000,
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.state.metaCalls ?? 0).toBe(0);
    expect(begun.state.calls).toBe(0);
  });
});
