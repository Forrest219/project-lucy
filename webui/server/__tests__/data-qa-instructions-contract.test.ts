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
    // Spec 162 修订（D8 / SC-40）：口径改为「已结算数据处理时长」，不含思考时间。
    expect(text).toContain("同一问询最多 20 次数据工具调用，或累计 120 秒数据处理时长（不含思考时间）");
    expect(text).toContain("question_budget_exhausted");
    expect(text).toContain("部分可回答时仍必须回复");
    expect(text).toContain("`ok` / `no_data` / `unavailable` / `partial`");
  });

  // Spec 162 修订 / D8 / SC-40 —— 指导文本按 `continuable` 分支处置，
  // 且不得宽于代理预算（次数上限仍是 20，续查只能一次）。
  it("routes the budget stop by continuable and keeps the guidance within the proxy budget", async () => {    const text = await readFile(path.join(process.cwd(), "config", "data-qa-instructions.md"), "utf8");

    expect(text).toContain("若 `continuable` 为 true，调用 `lucy_continue_question`");
    expect(text).toContain("传入返回的 `continueToken`");
    expect(text).toContain("若 `continuable` 为 false，直接交付已验证的部分结果并说明缺口，不要重试");
    expect(text).toContain("同一问询只能继续一次");
    // 协议工具不占数据额度：声明与续查本身不计次数。
    expect(text).toContain("`lucy_begin_question` 与 `lucy_continue_question`）不占这个预算");
    // 指导不得宽于代理预算：不得出现比代理更宽松的上限表述。
    expect(text).not.toContain("墙钟 120 秒");
  });

  // Spec 162 修订 / SC-41 —— 术语标准的三条**既有**词条按新口径修订
  // （不新增术语）：「问询预算」「关联调用数」「可继续」。
  it("revises the three budget entries in the product terminology standard", async () => {
    const standard = await readFile(
      path.join(process.cwd(), "docs", "00-product-terminology-standard.md"),
      "utf8"
    );

    // 「问询预算」：次数上限 + 数据处理时长上限，不含思考等空闲时间。
    expect(standard).toContain("同一问询的数据工具次数上限与数据处理时长上限；不含 agent 思考等空闲时间");
    // 「关联调用数」：四桶恒等式含预算终止。
    expect(standard).toContain("成功 + 拒绝 + 错误 + 预算终止 = 本列");
    // 「可继续」：可达的继续通道（不是额度是否还在）。
    expect(standard).toContain("问询预算用尽后，该调用者是否仍有一条可达的继续通道");
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
