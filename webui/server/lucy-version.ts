import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FALLBACK = "0.17.0";
const PRODUCT_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function assertLucyProductVersion(value: string, source: string): string {
  const normalized = value.trim();
  if (!PRODUCT_VERSION_RE.test(normalized)) {
    throw new Error(`${source} must use numeric X.Y.Z form without a v prefix; got ${JSON.stringify(value)}`);
  }
  return normalized;
}

/**
 * Customer-facing Lucy product version.
 * Prefer LUCY_VERSION env (Docker/K8s); fall back to repo-root VERSION.
 */
export function resolveLucyVersion(): string {
  const fromEnv = process.env.LUCY_VERSION?.trim();
  if (fromEnv) return assertLucyProductVersion(fromEnv, "LUCY_VERSION");

  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../VERSION"),
    path.resolve(process.cwd(), "VERSION"),
    path.resolve(process.cwd(), "../VERSION")
  ];
  for (const candidate of candidates) {
    try {
      const value = readFileSync(candidate, "utf8").trim();
      if (value) return assertLucyProductVersion(value, candidate);
    } catch {
      // try next
    }
  }
  return FALLBACK;
}
