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
    expect(text).toContain("最多 12 次业务工具调用");
    expect(text).toContain("120 秒内取得首个已验证业务结果");
    expect(text).toContain("部分可回答时仍必须回复");
    expect(text).toContain("`ok` / `no_data` / `unavailable` / `partial`");
  });
});
