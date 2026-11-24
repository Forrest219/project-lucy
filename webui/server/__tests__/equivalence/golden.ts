/** Golden-file helper: the golden is produced by the PRE-FIX implementation; the fix must reproduce it byte for byte. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden");

export function expectMatchesGolden(name: string, actual: unknown): void {
  const file = path.join(DIR, `${name}.json`);
  const text = `${JSON.stringify(actual, null, 2)}\n`;
  if (process.env.UPDATE_EQUIVALENCE_GOLDEN === "1") {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  expect(existsSync(file), `golden ${name}.json missing — generate it from the PRE-FIX code with UPDATE_EQUIVALENCE_GOLDEN=1`).toBe(true);
  expect(text).toBe(readFileSync(file, "utf8"));
}
