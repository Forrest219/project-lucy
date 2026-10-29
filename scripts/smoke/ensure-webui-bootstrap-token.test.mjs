import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ensureWebuiBootstrapToken } from "./ensure-webui-bootstrap-token.mjs";

test("ensureWebuiBootstrapToken writes a 0600 secret once and does not return the value", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lucy-webui-bootstrap-"));
  try {
    const target = await ensureWebuiBootstrapToken(dir);
    assert.equal(target, path.join(dir, "webui-bootstrap-token"));
    const secret = readFileSync(target, "utf8").trim();
    assert.match(secret, /^[a-f0-9]{64}$/);
    assert.equal(statSync(target).mode & 0o777, 0o600);
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
