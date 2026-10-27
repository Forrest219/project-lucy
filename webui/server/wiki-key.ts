import path from "node:path";
import { ForbiddenPathError } from "./fs-safe.js";

/**
 * The canonical Wiki key.
 *
 * A key is a RELATIVE path under `wiki/` that ends in `.md`. It never
 * escapes the content directory and never names a non-Markdown file.
 *
 * The rule lives in its own module so the Wiki service and the access
 * services share ONE definition (a second, drifting copy would be a path
 * validation hole).
 */
export function normalizeWikiKey(key: string): string {
  const decoded = decodeURIComponent(key);
  if (!decoded || decoded.startsWith("/") || path.isAbsolute(decoded)) {
    throw new ForbiddenPathError("Wiki key must be relative to wiki/");
  }
  const normalized = path.posix.normalize(decoded).replaceAll("\\", "/");
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    !normalized.endsWith(".md")
  ) {
    throw new ForbiddenPathError("Wiki key must be a markdown path under wiki/");
  }
  return normalized;
}
