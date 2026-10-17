import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";
import { openSecurityStore, type SecurityStore } from "./store";
import { SECURITY_DB_FILE } from "./schema";
import type { SecurityResult } from "./types";

let cached: { root: string; store: SecurityStore } | null = null;

/**
 * Process-wide handle to `<projectRoot>/.ktx-ui/security.sqlite`.
 *
 * Fail-closed: when the store cannot be opened the structured failure is returned
 * (and not cached, so a repaired store is picked up on the next call). Callers must
 * never substitute in-memory or empty state.
 */
export async function getSecurityStore(): Promise<SecurityResult<SecurityStore>> {
  let root: string;
  try {
    root = await resolveProjectRoot();
  } catch (error) {
    return {
      ok: false,
      code: "SECURITY_STORE_UNAVAILABLE",
      reason: "open_failed",
      message: error instanceof Error ? error.message : "project root unavailable"
    };
  }
  if (cached && cached.root === root) return { ok: true, value: cached.store };
  closeSecurityStore();
  const opened = openSecurityStore(root, { now: () => Date.now() });
  if (!opened.ok) return opened;
  cached = { root, store: opened.value };
  return opened;
}

/** True when the project already has a security database (never creates one). */
export async function securityStoreExists(): Promise<boolean> {
  try {
    return existsSync(path.join(await resolveProjectRoot(), ".ktx-ui", SECURITY_DB_FILE));
  } catch {
    return false;
  }
}

/** Close the cached handle (server shutdown, and tests simulating a restart). */
export function closeSecurityStore(): void {
  if (!cached) return;
  try {
    cached.store.close();
  } finally {
    cached = null;
  }
}
