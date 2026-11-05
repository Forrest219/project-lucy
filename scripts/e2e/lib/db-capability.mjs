// Which database capability a run actually proved.
//
// MySQL is the floor declared by prepare-environment. PostgreSQL is granted
// only when the run selected that engine and the seed producer set applied.
// A run.json written before `db.engine` existed was a PostgreSQL contract.
//
// Row-policy / 一推一 sync plane: `dataPlane: "rds-mysql-readonly"` with
// `readonlyProven: true` grants the `mysql` capability without claiming
// `applied` (no seed write). Historical catalog rows that still list
// `postgres` as the data-plane require are satisfied for that pack only via
// `missingCapabilities(..., run)` — never by lying that postgres was seeded.

export const RDS_MYSQL_READONLY_DATAPLANE = "rds-mysql-readonly";

export function appliedDatabaseCapability(db) {
  if (db?.readonlyProven === true && db.engine === "mysql") return "mysql";
  if (db?.applied !== true) return null;
  const engine = db.engine ?? "postgres";
  if (engine === "mysql" || engine === "postgres") return engine;
  return null;
}

/**
 * Whether a catalog `requires` entry is met.
 * For `rds-mysql-readonly` packs, a proven `mysql` capability satisfies a
 * historical `postgres` data-plane require (same 一推一 sync RDS).
 *
 * The capability container may be a plain object (the security leg's
 * `detectCapabilities` shape) or a Set (the management / v0.25 legs' shape).
 * Both are accepted so ONE rule decides the same run's capabilities in every
 * leg — a run must not be "postgres-capable" in one leg and "not" in another.
 */
export function capabilitySatisfied(cap, capabilities, run = null) {
  if (hasCapability(capabilities, cap)) return true;
  if (
    cap === "postgres" &&
    hasCapability(capabilities, "mysql") &&
    run?.db?.dataPlane === RDS_MYSQL_READONLY_DATAPLANE &&
    run?.db?.readonlyProven === true
  ) {
    return true;
  }
  return false;
}

/** Capability membership for both container shapes. */
function hasCapability(capabilities, cap) {
  if (!capabilities) return false;
  if (typeof capabilities.has === "function") return capabilities.has(cap);
  return Boolean(capabilities[cap]);
}
