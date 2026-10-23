import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("data QA fallback instructions contract", () => {
  it("contains the enterprise answerability and delivery gates", async () => {
    const text = await readFile(path.join(process.cwd(), "config", "data-qa-instructions.md"), "utf8");

    expect(text).toContain("可回答性依赖表");
    expect(text).toContain("forecast、目标值或上期实际不得替代 budget");
    expect(text).toContain("标记为 `hybrid`");
    expect(text).toContain("只能称为“实现单价”");
    expect(text).toContain("同一指纹最多做一次");
    // WO-202610-12 T3: the 8-minute wording became the proxy budget
    // (20 data-tool calls / 120s wall clock, with one continuation).
    expect(text).toContain("同一问询最多 20 次数据工具调用，或墙钟 120 秒");
    expect(text).toContain("question_budget_exhausted");
    expect(text).toContain("部分可回答时仍必须回复");
    expect(text).toContain("`ok` / `no_data` / `unavailable` / `partial`");
  });

  // WO-202610-13 T8 / SC-25 — 复述范围 lives in the instructions only.
  // The proxy never gates on a confirmation field (SC-1).
  it("states the restatement scope and skips it for inferred questions", async () => {
    const text = await readFile(path.join(process.cwd(), "config", "data-qa-instructions.md"), "utf8");

    expect(text).toContain("问询范围确认");
    expect(text).toContain("先复述账户、月份和产品线");
    expect(text).toContain("用户确认后再发 `lucy_query`");
    expect(text).toContain("跳过复述");
    expect(text).toContain("代理不实现确认门闩");
    expect(text).toContain("仍然转发 `lucy_query`");
  });
});
