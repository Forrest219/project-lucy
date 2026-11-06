import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFirstExistingTextFile } from "../lib/readFirstExistingTextFile";

const temps: string[] = [];

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("readFirstExistingTextFile", () => {
  it("reads only the first existing candidate", () => {
    const dir = mkdtempSync(join(tmpdir(), "read-first-"));
    temps.push(dir);
    const missing = join(dir, "missing.md");
    const first = join(dir, "first.md");
    const second = join(dir, "second.md");
    writeFileSync(first, "alpha", "utf8");
    writeFileSync(second, "beta", "utf8");

    const result = readFirstExistingTextFile([missing, first, second]);
    expect(result.path).toBe(first);
    expect(result.text).toBe("alpha");
  });

  it("throws with every candidate when none exist", () => {
    const a = join(tmpdir(), `__missing_read_first_a_${Date.now()}.md`);
    const b = join(tmpdir(), `__missing_read_first_b_${Date.now()}.md`);

    expect(() => readFirstExistingTextFile([a, b])).toThrowError(
      /none of the candidate files exist; candidates:/
    );
    try {
      readFirstExistingTextFile([a, b]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain(a);
      expect(message).toContain(b);
    }
  });
});
