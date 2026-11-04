import { RDS_MYSQL_READONLY_DATAPLANE } from "./db-capability.mjs";
import { PACK_ID } from "./row-policy-pack.mjs";

export const ROW_POLICY_PACK_ID = PACK_ID;

export function isRdsMysqlReadonlyRun(run) {
  return (
    run?.pack === PACK_ID &&
    run?.db?.dataPlane === RDS_MYSQL_READONLY_DATAPLANE
  );
}

export function sec11AllowedOnRun(run) {
  if (run?.pack !== PACK_ID) {
    return {
      ok: false,
      blockedReason: "row_policy_pack_required",
      detail:
        "SEC-11 (BY) one-to-one evidence requires --pack row-policy; security-e2e/fin-db results are not RDS evidence"
    };
  }
  if (run?.db?.dataPlane !== RDS_MYSQL_READONLY_DATAPLANE) {
    return {
      ok: false,
      blockedReason: "rds_dataplane_required",
      detail: `SEC-11 requires dataPlane=${RDS_MYSQL_READONLY_DATAPLANE}, got ${run?.db?.dataPlane ?? "unset"}`
    };
  }
  if (run?.db?.readonlyProven !== true) {
    return {
      ok: false,
      blockedReason: "rds_readonly_unproven",
      detail: "SEC-11 requires run.db.readonlyProven=true (prepare/live RDS SELECT probe)"
    };
  }
  return { ok: true };
}

export function assertRowPolicyBDataPlane(run) {
  const gate = sec11AllowedOnRun(run);
  if (!isRdsMysqlReadonlyRun(run) || run?.db?.readonlyProven !== true) {
    const detail = gate.ok === false ? gate.detail : "row-policy B requires rds-mysql-readonly + readonlyProven";
    throw new Error(`assertRowPolicyBDataPlane: ${detail}`);
  }
}
