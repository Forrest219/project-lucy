import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Ensure dir/webui-bootstrap-token exists as a 32-byte hex secret (mode 0600).
 * An existing non-empty file is kept. The secret value is never returned or logged.
 */
export async function ensureWebuiBootstrapToken(dir) {
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, "webui-bootstrap-token");
  let existing = "";
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing.trim()) return target;
  await writeFile(target, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
  return target;
}
