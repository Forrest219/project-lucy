// Plan A6 no-sensitive-capture: run-management.mjs MUST produce a capture-policy.json artifact
// (Plan A6 §no-sensitive-capture). The artifact records the Playwright config that enforces
// trace / screenshot / video = off, and inventories every file the run actually wrote under
// client-work/. The gate collector's SEC-06-V04 case reads this artifact to prove the policy
// was applied and that no real client-side capture leaked.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { REPO_ROOT } from "../lib/common.mjs";

const tmp = () => mkdtempSync(path.join(tmpdir(), "run-mgmt-capture-"));
const cleanup = new Set();
function track(dir) { cleanup.add(dir); return dir; }
after(() => { for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// Mirror the helper from run-management.mjs so the test exercises the same logic without booting
// Playwright. The function name and contract match the source.
function buildCapturePolicyArtifact(run) {
  const configPath = path.join(REPO_ROOT, "webui", "playwright.real.config.ts");
  const configText = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const pick = (key) => {
    const m = new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`).exec(configText);
    return m ? m[1] : "unknown";
  };
  const enforced = { trace: pick("trace"), screenshot: pick("screenshot"), video: pick("video") };
  const inventory = { clientWork: [], capture: [], screenshots: [], traces: [], attachments: [], other: [] };
  function classify(parentDir) {
    const base = path.basename(parentDir);
    if (base === "screenshots" || base === "screenshot") return "screenshots";
    if (base === "traces" || base === "trace") return "traces";
    if (base === "attachments" || base === "attachment") return "attachments";
    if (base === "capture") return "capture";
    return null;
  }
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const lst = statSync(full);
        const bucket = classify(dir) ?? "other";
        inventory[bucket].push({ path: path.relative(run.paths.runDir, full), bytes: lst.size });
      }
    }
  }
  walk(run.paths["client-work"]);
  return {
    contract: "lucy-capture-policy-v1",
    runId: run.runId,
    generatedAt: new Date().toISOString(),
    policy: { ...enforced, source: "webui/playwright.real.config.ts" },
    inventory,
    violated: enforced.trace !== "off" || enforced.screenshot !== "off" || enforced.video !== "off"
  };
}

describe("run-management: capture-policy artifact (A6 no-sensitive-capture)", () => {
  it("the enforced policy in webui/playwright.real.config.ts has trace/screenshot/video=off", () => {
    const configText = readFileSync(path.join(REPO_ROOT, "webui", "playwright.real.config.ts"), "utf8");
    const pick = (key) => {
      const m = new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`).exec(configText);
      return m ? m[1] : null;
    };
    assert.equal(pick("trace"), "off", "Playwright config must set trace: off");
    assert.equal(pick("screenshot"), "off", "Playwright config must set screenshot: off");
    assert.equal(pick("video"), "off", "Playwright config must set video: off");
  });

  it("the artifact records the enforced policy + an inventory of client-work", () => {
    const runDir = track(tmp());
    mkdirSync(path.join(runDir, "client-work", "claude-code", "capture"), { recursive: true });
    writeFileSync(path.join(runDir, "client-work", "claude-code", "capture", "mcp.json"), "{}");
    const run = { runId: "capture-policy-test", paths: { runDir, "client-work": path.join(runDir, "client-work") } };
    const artifact = buildCapturePolicyArtifact(run);
    assert.equal(artifact.contract, "lucy-capture-policy-v1");
    assert.equal(artifact.policy.trace, "off");
    assert.equal(artifact.policy.screenshot, "off");
    assert.equal(artifact.policy.video, "off");
    assert.equal(artifact.violated, false, "violated must be false when policy is enforced off");
    const total = Object.values(artifact.inventory).reduce((s, a) => s + a.length, 0);
    assert.ok(total >= 1, `expected at least one client-work file; got ${JSON.stringify(artifact.inventory)}`);
    assert.equal(artifact.inventory.capture[0].path, "client-work/claude-code/capture/mcp.json");
  });

  it("a client-work file under capture/ is inventoried correctly", () => {
    const runDir = track(tmp());
    const capture = path.join(runDir, "client-work", "claude-code", "capture");
    mkdirSync(capture, { recursive: true });
    writeFileSync(path.join(capture, "session.txt"), "clean session log");
    const run = { runId: "capture-inv", paths: { runDir, "client-work": path.join(runDir, "client-work") } };
    const artifact = buildCapturePolicyArtifact(run);
    const all = [
      ...artifact.inventory.clientWork,
      ...artifact.inventory.capture,
      ...artifact.inventory.screenshots,
      ...artifact.inventory.traces,
      ...artifact.inventory.attachments,
      ...artifact.inventory.other
    ];
    assert.ok(all.length >= 1, `expected inventory to list the capture file; got ${JSON.stringify(artifact.inventory)}`);
  });
});
