import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sec11AllowedOnRun } from "../lib/rds-dataplane-policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN_SECURITY_PATH = path.join(HERE, "..", "run-security.mjs");

// run-security.mjs wires sec11AllowedOnRun in the SEC-11 case loop (wrong pack / unproven RDS → blocked).
test("run-security.mjs imports and applies sec11AllowedOnRun for SEC-11 ids", () => {
  const source = readFileSync(RUN_SECURITY_PATH, "utf8");
  assert.match(source, /sec11AllowedOnRun/);
  assert.match(source, /SEC-11-/);
  assert.match(source, /testCase\.id\.startsWith\("SEC-11-"\)/);
});

test("security pack SEC-11 gate matches run-security blocked contract (no Lucy)", () => {
  const run = {
    pack: "security",
    db: { engine: "postgres", applied: true, dataPlane: undefined }
  };
  const gate = sec11AllowedOnRun(run);
  assert.equal(gate.ok, false);
  assert.match(gate.blockedReason, /row_policy_pack_required|rds_dataplane_required/);
  assert.ok(gate.detail.length > 0);
});
