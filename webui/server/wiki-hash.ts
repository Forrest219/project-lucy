import { createHash } from "node:crypto";

/**
 * The identity of a Wiki document's bytes.
 *
 * `file_version` in every API response is this hash of the EXACT file bytes,
 * so an optimistic-concurrency check compares like with like.
 */
export function wikiContentHash(markdown: string): string {
  return `sha256:${createHash("sha256").update(markdown).digest("hex")}`;
}
