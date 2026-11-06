import assert from "node:assert/strict";
import test from "node:test";
import {
  isRdsMysqlReadonlyRun,
  sec11AllowedOnRun,
  assertRowPolicyBDataPlane
} from "../lib/rds-dataplane-policy.mjs";
import { RDS_MYSQL_READONLY_DATAPLANE } from "../lib/db-capability.mjs";

// Production wiring: run-security.mjs calls sec11AllowedOnRun for SEC-11-* before handlers (see run-security-sec11-dataplane.test.mjs).
test("security pack run refuses SEC-11 even if postgres applied", () => {
  const run = {
    pack: "security",
    db: { engine: "postgres", applied: true, dataPlane: undefined }
  };
  assert.equal(isRdsMysqlReadonlyRun(run), false);
  const gate = sec11AllowedOnRun(run);
  assert.equal(gate.ok, false);
  assert.match(gate.blockedReason, /row_policy_pack_required|rds_dataplane_required/);
});

test("row-policy pack without readonlyProven refuses SEC-11", () => {
  const run = {
    pack: "row-policy",
    db: { dataPlane: RDS_MYSQL_READONLY_DATAPLANE, readonlyProven: false, engine: "mysql" }
  };
  const gate = sec11AllowedOnRun(run);
  assert.equal(gate.ok, false);
  assert.match(gate.detail, /readonlyProven/);
});

test("row-policy + readonlyProven allows SEC-11", () => {
  const run = {
    pack: "row-policy",
    db: { dataPlane: RDS_MYSQL_READONLY_DATAPLANE, readonlyProven: true, engine: "mysql" }
  };
  assert.equal(sec11AllowedOnRun(run).ok, true);
  assert.doesNotThrow(() => assertRowPolicyBDataPlane(run));
});

test("assertRowPolicyBDataPlane throws on security pack", () => {
  assert.throws(
    () => assertRowPolicyBDataPlane({ pack: "security", db: { applied: true } }),
    /row-policy|rds-mysql-readonly/
  );
});
