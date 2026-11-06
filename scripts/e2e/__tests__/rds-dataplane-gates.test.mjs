import assert from "node:assert/strict";
import test from "node:test";
import {
  appliedDatabaseCapability,
  capabilitySatisfied,
  RDS_MYSQL_READONLY_DATAPLANE
} from "../lib/db-capability.mjs";
import { sanitizeKtxChildEnv } from "../lib/ktx-upstream.mjs";
import { missingCapabilities } from "../run-security.mjs";

test("sanitizeKtxChildEnv strips GIT_CONFIG_COUNT and KEY/VALUE slots", () => {
  const cleaned = sanitizeKtxChildEnv({
    PATH: "/usr/bin",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: "*",
    LUCY_WEBUI_PORT: "15174"
  });
  assert.equal(cleaned.PATH, "/usr/bin");
  assert.equal(cleaned.LUCY_WEBUI_PORT, "15174");
  assert.equal(cleaned.GIT_CONFIG_COUNT, undefined);
  assert.equal(cleaned.GIT_CONFIG_KEY_0, undefined);
  assert.equal(cleaned.GIT_CONFIG_VALUE_0, undefined);
});

test("capabilitySatisfied maps postgres require to proven mysql on rds-mysql-readonly", () => {
  const run = {
    db: { dataPlane: RDS_MYSQL_READONLY_DATAPLANE, readonlyProven: true, engine: "mysql" }
  };
  const caps = { "lucy-http": true, "ktx-upstream": true, mysql: true, postgres: false };
  assert.equal(capabilitySatisfied("mysql", caps, run), true);
  assert.equal(capabilitySatisfied("postgres", caps, run), true);
  assert.equal(capabilitySatisfied("postgres", caps, { db: { dataPlane: "other" } }), false);
  assert.deepEqual(
    missingCapabilities({ requires: ["lucy-http", "ktx-upstream", "postgres"] }, caps, run),
    []
  );
});

test("appliedDatabaseCapability honors readonlyProven mysql", () => {
  assert.equal(
    appliedDatabaseCapability({
      applied: false,
      engine: "mysql",
      readonlyProven: true
    }),
    "mysql"
  );
});

test("capabilitySatisfied accepts a Set capability container (management / v0.25 legs)", () => {
  const run = {
    db: { dataPlane: RDS_MYSQL_READONLY_DATAPLANE, readonlyProven: true, engine: "mysql" }
  };
  const caps = new Set(["lucy-http", "browser", "mysql"]);
  assert.equal(capabilitySatisfied("mysql", caps, run), true);
  // The proven RDS plane satisfies a historical postgres require in EVERY leg.
  assert.equal(capabilitySatisfied("postgres", caps, run), true);
  assert.equal(capabilitySatisfied("postgres", caps, { db: { dataPlane: "other" } }), false);
  assert.equal(capabilitySatisfied("agent-client", caps, run), false);
});

test("the v0.25 leg agrees with the security leg on one run's capabilities", async () => {
  const { evaluateV025Case } = await import("../lib/v025-evidence.mjs");
  const run = {
    db: { dataPlane: RDS_MYSQL_READONLY_DATAPLANE, readonlyProven: true, engine: "mysql" }
  };
  const scenario = {
    executionId: "ASV25-PROBE",
    executors: ["P", "B", "V"],
    requires: ["lucy-http", "ktx-upstream", "postgres", "browser"]
  };
  const capabilities = ["lucy-http", "ktx-upstream", "browser", "mysql"];
  // Without the shared rule this item is blocked with "missing capabilities: postgres".
  const verdict = evaluateV025Case({
    scenario,
    dimensions: { B: { status: "passed", detail: "" } },
    capabilities,
    run
  });
  assert.notEqual(verdict.blockedReason, "environment");
  assert.equal(verdict.status, "not_run");
  assert.deepEqual(verdict.missingCapabilities, []);
});
