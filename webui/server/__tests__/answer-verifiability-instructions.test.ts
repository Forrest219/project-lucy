/**
 * P0-4／SC-08 — 动态 instructions 与 fallback 同步：须引用可核对块、不得隐藏。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANSWER_VERIFIABILITY_INSTRUCTION_LINES } from "../proxy/answer-verifiability.js";

describe("answer-verifiability instructions（SC-08）", () => {
  it("动态条款要求引用且禁止隐藏", () => {
    const joined = ANSWER_VERIFIABILITY_INSTRUCTION_LINES.join("\n");
    expect(joined).toContain("answer_verifiability");
    expect(joined).toMatch(/MUST surface|cite or restate/i);
    expect(joined).toMatch(/Do not hide|omit|strip/i);
    expect(joined).toContain("not_checked");
    expect(joined.toLowerCase()).not.toContain("hide answer_verifiability from the user");
  });

  it("fallback md 与动态条款语义对齐", async () => {
    const md = await readFile(path.join(process.cwd(), "config", "data-qa-instructions.md"), "utf8");
    const dynamic = ANSWER_VERIFIABILITY_INSTRUCTION_LINES.join("\n");
    expect(md).toContain("answer_verifiability");
    expect(md).toContain("不得隐藏、省略或剥离");
    expect(md).toContain("复述／引用");
    expect(dynamic).toContain("answer_verifiability");
    expect(md).toContain("not_checked");
    expect(dynamic).toContain("not_checked");
  });
});
