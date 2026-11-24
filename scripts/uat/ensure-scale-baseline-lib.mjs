/**
 * Pure helpers for ensure-scale-baseline (unit-testable, no Docker).
 * SOT：docs/qa/uat/scale-baseline.md
 */

export const MARKER_PATH = "/data/lucy/.lucy-scale-seed";
export const SCALE_SOT = "docs/qa/uat/scale-baseline.md";
export const SCALE_SEED = 20261123;

/**
 * @param {string} body
 * @returns {Record<string, string>}
 */
export function parseMarker(body) {
  const out = {};
  for (const line of String(body || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/**
 * @param {Record<string, string>} fields
 * @returns {string}
 */
export function formatMarker(fields) {
  const order = [
    "profile",
    "sot",
    "seed",
    "seeded_at",
    "include_mysql",
    "include_hive",
    "container",
  ];
  const lines = [];
  const seen = new Set();
  for (const key of order) {
    if (fields[key] == null || fields[key] === "") continue;
    lines.push(`${key}=${fields[key]}`);
    seen.add(key);
  }
  for (const [key, value] of Object.entries(fields)) {
    if (seen.has(key) || value == null || value === "") continue;
    lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Decide whether to reseed.
 * @param {{ force: boolean, checkOk: boolean, hasMarker: boolean }} input
 * @returns {{ action: 'skip' | 'reseed', reason: string }}
 */
export function shouldReseed(input) {
  if (input.force) {
    return { action: "reseed", reason: "force" };
  }
  if (input.checkOk) {
    return {
      action: "skip",
      reason: input.hasMarker ? "baseline_ok_with_marker" : "baseline_ok_write_marker",
    };
  }
  return {
    action: "reseed",
    reason: input.hasMarker ? "baseline_gap_despite_marker" : "baseline_gap_no_marker",
  };
}
