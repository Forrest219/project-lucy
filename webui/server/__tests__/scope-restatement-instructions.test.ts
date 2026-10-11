/**
 * WO-202610-13 T8 / SC-25 — 复述范围.
 *
 * The instructions file states the restatement scope: an original question
 * with a pronoun or two intents gets restated (account, month, product line)
 * and no `lucy_query` before confirmation; an inferred question with no
 * original wording skips it. The proxy implements no confirmation latch — a
 * request without a confirmation field still reaches `lucy_query` (SC-1).
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
    expect(text).toContain("问询范围确认");
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

  it("states that the proxy has no confirmation latch", async () => {
    const text = await instructions();
    expect(text).toContain("代理不实现确认门闩");
    expect(text).toContain("仍然转发 `lucy_query`");
    // A missing confirmation field must never become a refusal: the file says
    // the proxy still forwards the call instead of refusing it.
    expect(text).toMatch(/缺少确认字段[\s\S]*不因此拒绝查询/);
  });

  it("keeps the existing proxy budget wording alongside the new section", async () => {
    const text = await instructions();
    // WO-12 T3 already moved this file from an 8-minute wording to the proxy
    // budget; the restatement section must not have displaced it.
    expect(text).toContain("同一问询最多 20 次数据工具调用，或墙钟 120 秒");
    expect(text).toContain("question_budget_exhausted");
  });

  it("does not gate the proxy on a confirmation field (SC-1)", async () => {
    const { questionBudget } = await import("../proxy/question-experience");
    // The budget gate is the only question-level interceptor. There is no
    // confirmation latch: a turn with no confirmation state still resolves.
    const allowed = questionBudget.consume("turn-scope", 1_000);
    expect(allowed.action).toBe("allow");

    // The proxy's query path never inspects a confirmation field.
    const source = await readFile(path.join(process.cwd(), "server", "proxy", "mcp-proxy.ts"), "utf8");
    expect(source).not.toMatch(/confirmed|confirmation_required|awaiting_confirmation/);
  });
});