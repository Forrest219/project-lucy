import { existsSync, readFileSync } from "node:fs";

/**
 * Walk `candidates` in order; read and return the first path that exists.
 * If none exist, throw with a message that lists every candidate (for fail-closed diagnostics).
 */
export function readFirstExistingTextFile(
  candidates: readonly string[],
  encoding: BufferEncoding = "utf8"
): { path: string; text: string } {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return { path: candidate, text: readFileSync(candidate, encoding) };
    }
  }
  throw new Error(
    `none of the candidate files exist; candidates: ${candidates.join(", ")}`
  );
}
