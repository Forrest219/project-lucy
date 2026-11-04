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
