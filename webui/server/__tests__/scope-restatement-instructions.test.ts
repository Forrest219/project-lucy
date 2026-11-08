/**
 * WO-202610-13 T8 / SC-25 — 复述范围 + P0-3 多表命中先问.
 *
 * 指代／双意图复述仍约束模型行为；表级选表由 Proxy `source_ambiguity_gate`
 * 硬门闩执行（旅程 `confirmedSourceKey`＋宿主 attested 证据），不是旧式
 * boolean confirmation latch。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function instructions(): Promise<string> {
  return readFile(path.join(process.cwd(), "config", "data-qa-instructions.md"), "utf8");
}

describe("scope restatement instructions (SC-25)", () => {
  it("states the restatement scope and the fields it must cover", async () => {
    const text = await instructions();
    expect(text).toContain("问询范围确认／多表命中先问");
    expect(text).toContain("指代");
    expect(text).toContain("两个意图");
    expect(text).toContain("先复述账户、月份和产品线");
    expect(text).toContain("用户确认后再发 `lucy_query`");
  });

  it("lets an inferred question with no original wording skip the restatement", async () => {
    const text = await instructions();
    expect(text).toContain("原文");
    expect(text).toContain("跳过复述");
    expect(text).toMatch(/没有用户原文[\s\S]*跳过复述/);
  });

  it("states the source ambiguity tool gate (P0-3)", async () => {
    const text = await instructions();
    expect(text).toContain("source_ambiguity_gate");
    expect(text).toContain("Proxy 硬门闩");
    expect(text).toContain("不得自行挑选最高分表");
    expect(text).not.toContain("代理不实现确认门闩");
  });

  it("keeps the existing proxy budget wording alongside the new section", async () => {
    const text = await instructions();
    expect(text).toContain("同一问询最多 20 次数据工具调用，或累计 120 秒数据处理时长（不含思考时间）");
    expect(text).toContain("question_budget_exhausted");
  });

  it("does not revive the old boolean confirmation latch identifiers", async () => {
    const { questionBudget } = await import("../proxy/question-experience");
    const allowed = questionBudget.consume("turn-scope", 1_000);
    expect(allowed.action).toBe("allow");

    const source = await readFile(path.join(process.cwd(), "server", "proxy", "mcp-proxy.ts"), "utf8");
    expect(source).not.toMatch(/confirmation_required|awaiting_confirmation|confirmationState|\bconfirmed\s*[:=]\s*(?:true|false)\b/);
    expect(source).toContain("checkSourceAmbiguityGate");
    const journey = await readFile(path.join(process.cwd(), "server", "proxy", "source-ambiguity-journey.ts"), "utf8");
    expect(journey).toContain("confirmedSourceKey");
  });
});
