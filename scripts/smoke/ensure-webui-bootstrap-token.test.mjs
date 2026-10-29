import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureWebuiBootstrapToken } from "./ensure-webui-bootstrap-token.mjs";

// The compose demo mounts this file as a Docker secret. Compose bind-mounts file-based
// secrets, so the container sees the host file's mode and owner and cannot remap them.
// The image runs as UID 10001, so the file has to be readable by that user; otherwise the
// WebUI answers 503 BOOTSTRAP_NOT_PROVISIONED because it cannot read the provisioned
// token. Host-side secrecy comes from the 0700 directory, not from the file mode.
test("ensureWebuiBootstrapToken writes a container-readable secret once and does not return the value", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lucy-webui-bootstrap-"));
  try {
    const target = await ensureWebuiBootstrapToken(dir);
    assert.equal(target, path.join(dir, "webui-bootstrap-token"));
    const secret = readFileSync(target, "utf8").trim();
    assert.match(secret, /^[a-f0-9]{64}$/);
    assert.equal(statSync(target).mode & 0o777, 0o644);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(await ensureWebuiBootstrapToken(dir), target);
    assert.equal(readFileSync(target, "utf8").trim(), secret);

    writeFileSync(target, "\n");
    await ensureWebuiBootstrapToken(dir);
    const regenerated = readFileSync(target, "utf8").trim();
    assert.match(regenerated, /^[a-f0-9]{64}$/);
    assert.notEqual(regenerated, secret);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureWebuiBootstrapToken repairs a secret another producer created 0600", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lucy-webui-bootstrap-"));
  try {
    const target = path.join(dir, "webui-bootstrap-token");
    writeFileSync(target, "0123456789abcdef\n", { mode: 0o600 });
    assert.equal(statSync(target).mode & 0o777, 0o600);

    assert.equal(await ensureWebuiBootstrapToken(dir), target);
    assert.equal(statSync(target).mode & 0o777, 0o644);
    assert.equal(readFileSync(target, "utf8").trim(), "0123456789abcdef");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
