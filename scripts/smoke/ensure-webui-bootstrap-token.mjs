import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Ensure dir/webui-bootstrap-token exists as a 32-byte hex secret.
 * An existing non-empty file is kept. The secret value is never returned or logged.
 *
 * File mode: the demo compose files mount this file into the container as a Docker
 * secret. Compose implements file-based secrets as bind mounts, so the container sees
 * the host file's own mode and owner, and Docker Compose cannot remap uid/gid for a
 * file-backed secret. The image runs as UID 10001 (Dockerfile USER 10001:10001), so a
 * 0600 file owned by the host user is unreadable inside the container: the WebUI then
 * reports 503 BOOTSTRAP_NOT_PROVISIONED because the provisioned token cannot be read.
 * The file therefore has to be readable by the container user. Host-side secrecy comes
 * from the directory, which this helper creates 0700 (the smoke temp dir from mkdtemp
 * is 0700 as well).
 */
export async function ensureWebuiBootstrapToken(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, "webui-bootstrap-token");
  let existing = "";
  try {
    existing = await readFile(target, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (!existing.trim()) {
    await writeFile(target, `${randomBytes(32).toString("hex")}\n`, { mode: 0o644 });
  }
  // writeFile applies `mode` only when it creates the file, and the create mode is
  // masked by the process umask. chmod makes the result the same on every run and
  // repairs a file that was created 0600 by another producer.
  await chmod(target, 0o644);
  return target;
}
