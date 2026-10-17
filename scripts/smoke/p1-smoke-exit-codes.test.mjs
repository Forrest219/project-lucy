import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Spec §8.2: a smoke whose checks are blocked/failed must not exit 0, and JSON status must match the exit code.

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const SMOKES = {
  governance: path.join(ROOT, "scripts", "smoke", "p1-governance-smoke.mjs"),
  "publish-regression": path.join(ROOT, "scripts", "smoke", "p1-publish-regression-smoke.mjs")
};

function startServer(statusFor) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const status = statusFor(req);
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(status === 200 ? { data: { mode: "test", files: [] } } : { error: "x" }));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done) => {
        for (const socket of sockets) socket.destroy();
        server.close(done);
      })
    }));
  });
}

function runSmoke(name, url, out) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SMOKES[name], "--url", url, "--out", out], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout.resume();
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

async function scenario(name, statusFor, expected) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "p1-smoke-exit-"));
  const server = statusFor ? await startServer(statusFor) : null;
  try {
    // No server -> connection refused on a closed port.
    const url = server ? server.url : "http://127.0.0.1:1";
    const out = path.join(dir, "evidence.json");
    const result = await runSmoke(name, url, out);
    const evidence = JSON.parse(await readFile(out, "utf8"));
    assert.equal(result.code, expected.code, `${name}: ${result.stderr}`);
    assert.equal(evidence.status, expected.status);
    assert.equal(evidence.exitCode, expected.code);
  } finally {
    await server?.close();
    await rm(dir, { recursive: true, force: true });
  }
}

for (const name of Object.keys(SMOKES)) {
  test(`${name}: unreachable service is blocked and exits 2, not 0`, async () => {
    await scenario(name, null, { code: 2, status: "blocked" });
  });

  test(`${name}: auth refusal without credentials is blocked and exits 2`, async () => {
    await scenario(name, () => 401, { code: 2, status: "blocked" });
  });

  test(`${name}: server errors fail and exit 1`, async () => {
    await scenario(name, () => 500, { code: 1, status: "failed" });
  });
}

test("governance: healthy endpoints pass and exit 0", async () => {
  await scenario("governance", () => 200, { code: 0, status: "passed" });
});
