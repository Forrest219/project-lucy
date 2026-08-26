import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/agent-chat-a3-smoke.mjs");

describe("agent-chat-a3-smoke", () => {
  it("passes static packaging checks", () => {
    const out = path.join(ROOT, "inbox/agent-chat-a3-smoke-test-evidence.json");
    const result = spawnSync(process.execPath, [SCRIPT, "--out", out], {
      cwd: ROOT,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"status": "pass"/);
  });

  it("live without stack returns blocked (exit 2)", () => {
    const out = path.join(ROOT, "inbox/agent-chat-a3-smoke-live-blocked-evidence.json");
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "--live",
        "--out",
        out,
        "--open-webui-url",
        "http://127.0.0.1:9",
        "--timeout-ms",
        "500"
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stdout, /"status": "blocked"/);
  });
});
