// Which database capability an applied run actually proved.
//
// MySQL is the floor declared by prepare-environment. PostgreSQL is granted
// only when the run selected that engine and the seed producer set applied.
// A run.json written before `db.engine` existed was a PostgreSQL contract.

export function appliedDatabaseCapability(db) {
  if (db?.applied !== true) return null;
  const engine = db.engine ?? "postgres";
  if (engine === "mysql" || engine === "postgres") return engine;
  return null;
}
