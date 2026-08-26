import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  A3_DOCKERIGNORE_PATTERNS,
  assertDockerignoreCoversA3,
  isIgnoredByDockerignore,
  parseDockerignore,
  runFixtureSentinelCheck
} from "./lucy-delivery-isolation-smoke.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/lucy-delivery-isolation-smoke.mjs");

describe("lucy-delivery-isolation-smoke", () => {
  it("parses dockerignore and matches directory prefixes", () => {
    const patterns = parseDockerignore("agent-chat\n# comment\ndocker-compose.agent-chat.yml\n");
    assert.deepEqual(patterns, ["agent-chat", "docker-compose.agent-chat.yml"]);
    assert.equal(isIgnoredByDockerignore("agent-chat/.env", patterns), true);
    assert.equal(isIgnoredByDockerignore("webui/src/app.tsx", patterns), false);
  });

  it("requires A3 patterns in repo .dockerignore", async () => {
    const text = await readFile(path.join(ROOT, ".dockerignore"), "utf8");
    assert.doesNotThrow(() => assertDockerignoreCoversA3(text));
    for (const p of A3_DOCKERIGNORE_PATTERNS) {
      assert.match(text, new RegExp(`^${p.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}$`, "m"));
    }
  });

  it("fixture sentinel paths are ignored without touching real agent-chat/", async () => {
    const text = await readFile(path.join(ROOT, ".dockerignore"), "utf8");
    const patterns = assertDockerignoreCoversA3(text);
    const result = await runFixtureSentinelCheck(patterns);
    assert.ok(result.samplesChecked >= 5);
  });

  it("CLI static gate passes (A3 may be present or absent)", () => {
    const out = path.join(ROOT, "inbox/lucy-delivery-isolation-smoke-test.json");
    const result = spawnSync(process.execPath, [SCRIPT, "--out", out], {
      cwd: ROOT,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /"status": "pass"/);
  });

  it("fails when .dockerignore omits A3 patterns", () => {
    assert.throws(() => assertDockerignoreCoversA3(".git\nnode_modules\n"), /missing A3 isolation/);
  });
});
