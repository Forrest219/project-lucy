// B3 measured, disposable PostgreSQL seed setup (Spec §6.2, §6.4).
//
// `--apply-db` is a measured producer. It connects to a disposable PostgreSQL host
// (the harness passes one via run.db.host / run.db.port / run.db.ownerRole /
// run.db.ownerPasswordFile / run.db.passwordFile) and produces:
//
//   1. a pair of disposable PostgreSQL DATABASES named per-run
//      (`lucy_e2e_fin_<runOwnerIsolationId>` and `lucy_e2e_sales_<runOwnerIsolationId>`),
//      so a leftover from a prior run cannot satisfy a check;
//   2. a per-run LOGIN role (`lucy_e2e_reader_<runOwnerIsolationId>`) created with the
//      per-run password read from the per-run password file (the password NEVER travels
//      in env, argv, or run.json);
//   3. per-database least-privilege grants:
//      - REVOKE ALL ON SCHEMA analytics FROM PUBLIC
//      - GRANT USAGE ON SCHEMA analytics TO <readerRole>
//      - GRANT SELECT on the specific masked views / tables the reader may see
//      - REVOKE ALL ON DATABASE FROM PUBLIC (so default-privilege changes apply)
//      The role is NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT, so DDL/DML on
//      tables it does not own is denied by the engine itself.
//   4. an actual `INSERT` of the synthetic rows produced by compute-gold.mjs (the
//      generated `seed-data.sql` is parsed, the `\connect` psql meta is split, and the
//      two halves are executed against the per-run fin / sales databases);
//   5. an INDEPENDENT `datasetDigest` check: after the INSERTs, the producer reads
//      every row back from both databases in canonical ORDER BY order_id /
//      (day, region, channel) order, computes a sha256 over the canonical rows, and
//      compares to the `datasetDigest` recorded by prepare-environment. "wrong values,
//      same rowcount" is therefore caught (a bare COUNT(*) cannot grant trust).
//   6. per-role per-database probes — every reader role must SELECT positive rowcounts
//      from every masked table in every database; a zero rowcount is a real failure
//      (the gold registry never ships an empty fixture);
//   7. per-role per-database write-attempt denials — every reader role is refused
//      INSERT on the base `analytics.orders` table inside an explicit
//      BEGIN/INSERT/ROLLBACK transaction so no destructive business data is touched.
//
// The function returns `{ok, measurement}`. The orchestrator records this against
// `run.db` BEFORE setting `run.db.applied = true`. A missing measurement, a
// digest mismatch, or any per-role probe failure keeps `applied` false.
//
// Production uses the real `pg` driver via `defaultExecuteSql`. Tests inject a
// schema-faithful `executeSql` so the dialect/args contract is asserted without
// needing a running database; a SEPARATE disposable-container integration test
// runs the producer end-to-end against postgres:16-alpine.
//
// Disposable scope guard: a non-empty `run.db.runOwnerIsolationId` is required so a
// user-supplied DB host/path cannot be used to seed a non-disposable database.
// The isolation id flows from the run manifest into the database names, the role
// name, and the GRANT scope.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const SEED_TABLES = [
  { db: "fin", table: "analytics.marketing_daily" },
  { db: "fin", table: "analytics.orders_masked" },
  { db: "sales", table: "analytics.orders_masked" }
];
// Tables we expect to find rows in after the seed apply.
const PROBE_TABLES = SEED_TABLES;
// The base PII table the readonly role must NOT be granted INSERT on (we attempt the
// write here so the engine denies it with `permission denied for table orders`,
// which is a real measurement rather than a synthetic constraint failure).
const WRITE_DENIAL_TABLE = "analytics.orders";

// Permitted identifier characters for per-run names; anything else is replaced.
const ID_SAFE = /[^a-zA-Z0-9_]/g;

/**
 * @param {Object} args
 * @param {Object} args.run                 the run manifest; `run.paths.checker`, `run.db.host`, `run.db.port`, `run.db.name`, `run.db.runOwnerIsolationId`, `run.db.passwordFile`, `run.db.ownerRole`, `run.db.ownerPasswordFile`, `run.db.seedSqlDigest`, `run.db.datasetDigest`
 * @param {string} [args.runMode]           "local" | "release" — affects only what `defaultExecuteSql` does, the SQL itself is identical
 * @param {Function} [args.executeSql]      injected SQL executor; production: `defaultExecuteSql`
 * @param {Function} [args.readFile]        injected file reader; production: `fs.readFileSync`
 * @param {Function} [args.readPassword]    injected per-run password reader; production: `fs.readFileSync`
 * @returns {Promise<{ok: boolean, measurement: object}>}
 */
export async function applySyntheticDbSeed({ run, runMode = "local", executeSql, readFile = readFileSync, readPassword = readFileSync }) {
  const db = run?.db ?? {};
  const problems = [];
  const measurement = {
    contract: "lucy-db-seed-v1",
    runId: run?.runId ?? null,
    instanceId: run?.instanceId ?? null,
    measuredAt: null,
    host: db.host ?? null,
    port: db.port ?? null,
    name: db.name ?? null,
    runOwnerIsolationId: db.runOwnerIsolationId ?? null,
    finDatabase: null,
    salesDatabase: null,
    readerRole: null,
    readonlyRoles: [...(db.readonlyRoles ?? [])],
    seedSqlDigestExpected: db.seedSqlDigest ?? null,
    seedSqlDigestMeasured: null,
    seedDatasetDigestExpected: db.datasetDigest ?? null,
    seedDatasetDigestMeasured: null,
    seedApplied: false,
    readonlyProbes: [],
    writeAttemptsDenied: 0,
    roleGrants: [],
    applied: false,
    problems: []
  };

  // Pre-flight: refuse unsafe or malformed input BEFORE touching the database.
  if (!db.host || !db.port) problems.push("run.db.host/port are required for --apply-db");
  if (!db.runOwnerIsolationId || db.runOwnerIsolationId.length < 8) {
    problems.push("run.db.runOwnerIsolationId is required (>=8 chars) to scope the disposable database; refusing to seed an arbitrary user-supplied DB host/path without run-owned isolation identity");
  }
  if (!Array.isArray(db.readonlyRoles) || db.readonlyRoles.length === 0) problems.push("run.db.readonlyRoles must contain at least one role");
  if (!db.passwordFile) problems.push("run.db.passwordFile is required (a per-run file path that holds the reader role password; no password in env or in run.json)");
  if (!db.ownerRole) problems.push("run.db.ownerRole is required (the PostgreSQL superuser / role that owns the per-run databases)");
  if (!db.ownerPasswordFile) problems.push("run.db.ownerPasswordFile is required (the per-run file path that holds the owner password; no password in env or in run.json)");
  if (!run?.paths?.checker) problems.push("run.paths.checker is missing");
  if (typeof executeSql !== "function") problems.push("executeSql is required (production: defaultExecuteSql; tests: inject)");

  if (problems.length > 0) {
    measurement.problems = problems;
    return { ok: false, measurement };
  }

  // Per-run names — namespace every disposable object by runOwnerIsolationId so a
  // leftover from a prior run cannot satisfy a check.
  const iso = sanitizeIdent(db.runOwnerIsolationId);
  const finName = `lucy_e2e_fin_${iso}`;
  const salesName = `lucy_e2e_sales_${iso}`;
  const readerRole = db.readonlyRoles[0]; // a single shared reader identity across both DBs
  measurement.finDatabase = finName;
  measurement.salesDatabase = salesName;
  measurement.readerRole = readerRole;

  // Step 0: read the per-run password files. The producer NEVER holds the
  // password in argv/env; the values stay inside the per-run file.
  const readerPassword = readPasswordString(db.passwordFile, "reader", readPassword);
  if (!readerPassword || readerPassword.length < 8) {
    measurement.problems.push(`reader password file is missing or too short at ${db.passwordFile}`);
    return { ok: false, measurement };
  }
  const ownerPassword = readPasswordString(db.ownerPasswordFile, "owner", readPassword);
  if (!ownerPassword) {
    measurement.problems.push(`owner password file is missing at ${db.ownerPasswordFile}`);
    return { ok: false, measurement };
  }

  // Step 1: load seed-data.sql (the generated INSERT-only file from
  // compute-gold.mjs:renderSeedSql). We split the file by its `\connect` directives
  // so the two halves go to the two per-run databases. The original bytes are
  // hashed to produce `seedSqlDigest` and compared to `run.db.seedSqlDigest`.
  const seedPath = path.join(run.paths.checker, "seed-data.sql");
  let seedSql;
  try {
    seedSql = readFile(seedPath, "utf8");
  } catch (error) {
    measurement.problems.push(`seed-data.sql is not readable at ${seedPath}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, measurement };
  }
  const seedSqlDigest = `sha256:${createHash("sha256").update(seedSql).digest("hex")}`;
  measurement.seedSqlDigestMeasured = seedSqlDigest;
  if (!measurement.seedSqlDigestExpected) {
    measurement.problems.push("run.db.seedSqlDigest is missing; the harness must bind the seed-data.sql text digest to the run before --apply-db runs");
    return { ok: false, measurement };
  }
  if (seedSqlDigest !== measurement.seedSqlDigestExpected) {
    measurement.problems.push(`seed-data.sql digest mismatch: expected ${measurement.seedSqlDigestExpected}, measured ${seedSqlDigest}; refusing to apply`);
    return { ok: false, measurement };
  }

  const split = splitSeedDataSql(seedSql);
  if (split.fin.length === 0 || split.sales.length === 0) {
    measurement.problems.push(`seed-data.sql did not contain inserts for both fin and sales databases (fin=${split.fin.length}, sales=${split.sales.length})`);
    return { ok: false, measurement };
  }

  // Step 2: connect to the maintenance database and create the per-run role +
  // per-run databases. CREATE DATABASE is idempotent (we ignore "already exists");
  // CREATE ROLE must be idempotent in the same way.
  const ownerConn = { host: db.host, port: db.port, database: "postgres", role: db.ownerRole, password: ownerPassword };
  try {
    await execOrIgnore(executeSql, { ...ownerConn, sql: `CREATE ROLE ${quoteIdent(readerRole)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${quoteLiteral(readerPassword)}` }, /already exists/i);
    await execOrIgnore(executeSql, { ...ownerConn, sql: `CREATE DATABASE ${quoteIdent(finName)} OWNER ${quoteIdent(db.ownerRole)}` }, /already exists/i);
    await execOrIgnore(executeSql, { ...ownerConn, sql: `CREATE DATABASE ${quoteIdent(salesName)} OWNER ${quoteIdent(db.ownerRole)}` }, /already exists/i);
    // Strip the public default privilege on the new databases so the reader role
    // never inherits a public grant we did not intend. Then GRANT CONNECT
    // explicitly to the reader role — without this the role cannot even open
    // a session to the database, regardless of any per-table SELECT grant.
    await executeSql({ ...ownerConn, sql: `REVOKE ALL ON DATABASE ${quoteIdent(finName)} FROM PUBLIC` });
    await executeSql({ ...ownerConn, sql: `REVOKE ALL ON DATABASE ${quoteIdent(salesName)} FROM PUBLIC` });
    await executeSql({ ...ownerConn, sql: `GRANT CONNECT ON DATABASE ${quoteIdent(finName)} TO ${quoteIdent(readerRole)}` });
    await executeSql({ ...ownerConn, sql: `GRANT CONNECT ON DATABASE ${quoteIdent(salesName)} TO ${quoteIdent(readerRole)}` });
  } catch (error) {
    measurement.problems.push(`failed to provision role/databases: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, measurement };
  }

  // Step 3: per-database DDL + INSERT apply. The DDL is rendered per database so
  // the schema / table / view / GRANT/REVOKE references are exactly what the
  // reader role will see at SELECT time. Each database is applied independently;
  // a failure on one database aborts and reports back without setting applied=true.
  const ddlFin = renderDbDdl({ readerRole, hasMarketing: true });
  const ddlSales = renderDbDdl({ readerRole, hasMarketing: false });
  try {
    await executeSql({ host: db.host, port: db.port, database: finName, role: db.ownerRole, password: ownerPassword, sql: ddlFin });
    await executeSql({ host: db.host, port: db.port, database: finName, role: db.ownerRole, password: ownerPassword, sql: split.fin.join("\n") });
    await executeSql({ host: db.host, port: db.port, database: salesName, role: db.ownerRole, password: ownerPassword, sql: ddlSales });
    await executeSql({ host: db.host, port: db.port, database: salesName, role: db.ownerRole, password: ownerPassword, sql: split.sales.join("\n") });
    measurement.seedApplied = true;
  } catch (error) {
    measurement.problems.push(`seed apply failed: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, measurement };
  }

  // Step 4: dataset digest verification — read every row back from both databases
  // in canonical order, normalize the column names to the gold dataset's camelCase,
  // and compute a stable sha256. This catches "wrong values, same rowcount" that
  // a bare COUNT(*) check cannot.
  let measuredDataset;
  try {
    measuredDataset = await readDatasetFromDb({
      executeSql,
      host: db.host,
      port: db.port,
      ownerRole: db.ownerRole,
      ownerPassword,
      finName,
      salesName
    });
  } catch (error) {
    measurement.problems.push(`dataset readback failed: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, measurement };
  }
  const measuredDatasetDigest = computeDatasetDigest(measuredDataset);
  measurement.seedDatasetDigestMeasured = measuredDatasetDigest;
  if (!measurement.seedDatasetDigestExpected) {
    measurement.problems.push("run.db.datasetDigest is missing; prepare-environment must bind an independent canonical digest of the gold dataset rows");
    return { ok: false, measurement };
  }
  if (measuredDatasetDigest !== measurement.seedDatasetDigestExpected) {
    measurement.problems.push(`dataset digest mismatch: expected ${measurement.seedDatasetDigestExpected}, measured ${measuredDatasetDigest}; the actual DB rows do not match the gold dataset (same rowcount is not enough)`);
    return { ok: false, measurement };
  }

  // Step 5: per-role per-database readonly probes. Every role must SELECT, and
  // every probe must return a positive rowcount. A zero count is a real failure
  // (the harness does NOT produce an empty fixture).
  const probed = [];
  const grants = [{ role: readerRole, passwordFile: db.passwordFile, password: readerPassword }];
  measurement.roleGrants = grants;
  for (const grant of grants) {
    for (const probe of PROBE_TABLES) {
      const dbName = probe.db === "fin" ? finName : salesName;
      const [schema, name] = probe.table.split(".");
      try {
        const rows = await executeSql({
          host: db.host, port: db.port, database: dbName,
          role: grant.role, password: grant.password,
          sql: `SELECT COUNT(*)::bigint AS n FROM ${quoteIdent(schema)}.${quoteIdent(name)}`
        });
        const n = Number(rows?.[0]?.n ?? 0);
        if (!Number.isInteger(n) || n <= 0) {
          measurement.problems.push(`readonly probe of ${probe.table} on ${dbName} as ${grant.role} returned non-positive count: ${n}`);
        } else {
          probed.push({ db: dbName, table: probe.table, role: grant.role, rows: n });
        }
      } catch (error) {
        measurement.problems.push(`readonly probe of ${probe.table} on ${dbName} as ${grant.role} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  measurement.readonlyProbes = probed;

  // Step 6: per-role per-database write-attempt denials. Every role must refuse
  // INSERT on the base PII table inside an explicit BEGIN/INSERT/ROLLBACK. The
  // base table is the right target: a masked VIEW would refuse with "cannot insert
  // into view", which confounds the permission measurement with a constraint
  // error. The transaction guarantees no destructive business data is touched.
  let writeDenied = 0;
  for (const grant of grants) {
    for (const dbTarget of [{ db: finName, schema: "analytics", table: "orders" }, { db: salesName, schema: "analytics", table: "orders" }]) {
      const probeSql = `BEGIN; INSERT INTO ${quoteIdent(dbTarget.schema)}.${quoteIdent(dbTarget.table)} (order_id, region, amount_cents, customer_email, note) VALUES ('__probe', 'East', 0, '__probe@invalid', '__probe'); ROLLBACK;`;
      try {
        const writeResult = await executeSql({
          host: db.host, port: db.port, database: dbTarget.db,
          role: grant.role, password: grant.password,
          sql: probeSql
        });
        if (Array.isArray(writeResult) && writeResult.length > 0) {
          measurement.problems.push(`readonly write attempt by ${grant.role} on ${dbTarget.db}.${dbTarget.schema}.${dbTarget.table} succeeded (${writeResult.length} row(s) returned); the readonly role is not actually readonly`);
        } else {
          measurement.problems.push(`readonly write attempt by ${grant.role} on ${dbTarget.db}.${dbTarget.schema}.${dbTarget.table} produced an unexpected error: no exception was raised and no rows were returned`);
        }
      } catch (error) {
        if (/permission denied|insufficient privilege|42501/i.test(String(error?.message ?? error))) writeDenied += 1;
        else measurement.problems.push(`readonly write attempt by ${grant.role} on ${dbTarget.db}.${dbTarget.schema}.${dbTarget.table} produced an unexpected error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  measurement.writeAttemptsDenied = writeDenied;

  measurement.measuredAt = new Date().toISOString();
  measurement.applied =
    measurement.seedApplied &&
    measurement.seedSqlDigestMeasured === measurement.seedSqlDigestExpected &&
    measurement.seedDatasetDigestMeasured === measurement.seedDatasetDigestExpected &&
    measurement.writeAttemptsDenied === grants.length * 2 &&
    probed.length === grants.length * PROBE_TABLES.length;
  return { ok: measurement.applied, measurement };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render the per-database DDL. We do NOT rely on the legacy `examples/security-e2e/
 * db/seed.sql` because it uses psql-only meta commands (`\connect`, `\set`) and
 * hardcodes the legacy database / role names. The DDL below is plain PostgreSQL
 * (which the `pg` driver can execute) and is namespaced by `runOwnerIsolationId`.
 */
function renderDbDdl({ readerRole, hasMarketing }) {
  const lines = [];
  lines.push(`CREATE SCHEMA IF NOT EXISTS analytics;`);
  lines.push(`CREATE TABLE IF NOT EXISTS analytics.orders (
  order_id       TEXT   PRIMARY KEY,
  region         TEXT   NOT NULL CHECK (region IN ('East', 'West')),
  amount_cents   BIGINT NOT NULL,
  customer_email TEXT   NOT NULL,
  note           TEXT
);`);
  if (hasMarketing) {
    lines.push(`CREATE TABLE IF NOT EXISTS analytics.marketing_daily (
  day           DATE    NOT NULL,
  region        TEXT    NOT NULL CHECK (region IN ('East', 'West')),
  channel       TEXT    NOT NULL,
  spend_cents   BIGINT  NOT NULL,
  new_customers INTEGER,
  PRIMARY KEY (day, region, channel)
);`);
  }
  lines.push(`CREATE OR REPLACE VIEW analytics.orders_masked AS
  SELECT order_id, region, amount_cents, note FROM analytics.orders;`);
  lines.push(`REVOKE ALL ON SCHEMA analytics FROM PUBLIC;`);
  lines.push(`GRANT USAGE ON SCHEMA analytics TO ${quoteIdent(readerRole)};`);
  if (hasMarketing) lines.push(`GRANT SELECT ON analytics.marketing_daily TO ${quoteIdent(readerRole)};`);
  lines.push(`GRANT SELECT ON analytics.orders_masked TO ${quoteIdent(readerRole)};`);
  return lines.join("\n") + "\n";
}

function sanitizeIdent(value) {
  return String(value ?? "").replace(ID_SAFE, "_").slice(0, 32);
}

function quoteIdent(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function execOrIgnore(executeSql, params, ignorePattern) {
  try {
    await executeSql(params);
  } catch (error) {
    if (ignorePattern && ignorePattern.test(String(error?.message ?? error))) return;
    throw error;
  }
}

function readPasswordString(filePath, kind, readPassword) {
  try {
    const raw = readPassword(filePath, "utf8");
    const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw ?? "");
    return text.trim();
  } catch (error) {
    throw new Error(`${kind} password file is missing at ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Parse the generated seed-data.sql and split it into fin / sales halves. The
 * file uses psql `\connect` meta commands which the `pg` driver does not
 * understand, so we route the two halves ourselves.
 */
export function splitSeedDataSql(seedDataSql) {
  const lines = String(seedDataSql).split(/\r?\n/);
  const result = { fin: [], sales: [] };
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("--")) continue;
    const connectMatch = /^\\connect\s+(\S+)/i.exec(line);
    if (connectMatch) {
      const target = connectMatch[1].toLowerCase();
      if (target.includes("fin")) current = result.fin;
      else if (target.includes("sales")) current = result.sales;
      else current = null;
      continue;
    }
    if (current) current.push(raw);
  }
  return result;
}

/**
 * Read every row from the seeded tables in canonical order, normalize the
 * column names to the gold dataset's camelCase, and return the structure the
 * digest expects. Throws on any error so the producer can record a problem.
 */
async function readDatasetFromDb({ executeSql, host, port, ownerRole, ownerPassword, finName, salesName }) {
  // The seed-data.sql now also inserts the `marketingForecast` rows into the SAME
  // `analytics.marketing_daily` table (distinguished by channel prefix `forecast-`).
  // We return them as a separate array so the digest verification can include both
  // halves of the marketing surface (C3/C5 actual-vs-forecast disambiguation).
  const marketingRows = await executeSql({
    host, port, database: finName, role: ownerRole, password: ownerPassword,
    sql: `SELECT day::text AS day, region, channel, spend_cents::text AS spend_cents, new_customers FROM analytics.marketing_daily ORDER BY day, region, channel`
  });
  const finOrderRows = await executeSql({
    host, port, database: finName, role: ownerRole, password: ownerPassword,
    sql: `SELECT order_id, region, amount_cents::text AS amount_cents, customer_email, note FROM analytics.orders ORDER BY order_id`
  });
  const salesOrderRows = await executeSql({
    host, port, database: salesName, role: ownerRole, password: ownerPassword,
    sql: `SELECT order_id, region, amount_cents::text AS amount_cents, customer_email, note FROM analytics.orders ORDER BY order_id`
  });
  const splitMarketing = splitMarketingRows(marketingRows ?? []);
  return {
    marketing: splitMarketing.actual,
    marketingForecast: splitMarketing.forecast,
    finOrders: (finOrderRows ?? []).map((r) => ({
      orderId: r.order_id, region: r.region,
      amountCents: r.amount_cents,
      customerEmail: r.customer_email, note: r.note
    })),
    salesOrders: (salesOrderRows ?? []).map((r) => ({
      orderId: r.order_id, region: r.region,
      amountCents: r.amount_cents,
      customerEmail: r.customer_email, note: r.note
    }))
  };
}

/**
 * Split the marketing_daily readback into ACTUAL vs FORECAST halves by the channel
 * prefix. C3/C5 disambiguation is the whole reason both surfaces live in the SAME
 * table, so the digest must include both.
 */
function splitMarketingRows(rows) {
  const actual = [];
  const forecast = [];
  for (const r of rows) {
    const mapped = {
      day: r.day, region: r.region, channel: r.channel,
      spendCents: r.spend_cents,
      newCustomers: r.new_customers === null || r.new_customers === undefined ? null : Number(r.new_customers)
    };
    if (typeof r.channel === "string" && r.channel.startsWith("forecast-")) forecast.push(mapped);
    else actual.push(mapped);
  }
  return { actual, forecast };
}

/**
 * Canonical JSON digest for the dataset. Stable across runs: sorted keys,
 * bigints / numerics stringified, null preserved. The producer records this
 * BEFORE applying the seed (in prepare-environment) and the measured value
 * AFTER the readback; mismatch blocks `applied=true`. Includes both the
 * ACTUAL and FORECAST marketing surfaces so the C3/C5 forecast rows that
 * share the `analytics.marketing_daily` table are part of the measurement.
 */
export function computeDatasetDigest(dataset) {
  const stable = JSON.stringify(canonicalize({
    marketing: dataset.marketing ?? [],
    marketingForecast: dataset.marketingForecast ?? [],
    finOrders: dataset.finOrders ?? [],
    salesOrders: dataset.salesOrders ?? []
  }));
  return `sha256:${createHash("sha256").update(stable).digest("hex")}`;
}

function canonicalize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Number.isFinite(value) ? value.toString() : null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const sorted = {};
    for (const k of Object.keys(value).sort()) sorted[k] = canonicalize(value[k]);
    return sorted;
  }
  return value;
}

/**
 * Default SQL executor. Uses the `pg` driver (declared as a dependency in
 * package.json; node >= 22). The role's password is read from the file path
 * passed by the caller — it never travels in env, argv, or run.json. Returns
 * rows as plain objects (BIGINT columns come back as strings, which the digest
 * code coerces).
 */
export async function defaultExecuteSql({ host, port, database, role, password, sql }) {
  if (!password) throw new Error("defaultExecuteSql requires a per-role password (the production caller must read it from the per-run password file)");
  if (!role) throw new Error("defaultExecuteSql requires a role (the username to connect as)");
  if (!sql || !String(sql).trim()) throw new Error("defaultExecuteSql requires non-empty SQL");
  const mod = await import("pg").catch(() => null);
  if (!mod) throw new Error("defaultExecuteSql requires the `pg` driver (declared in package.json)");
  const { Client } = mod;
  const client = new Client({ host, port, database, user: role, password });
  try {
    await client.connect();
    const res = await client.query(sql);
    return res.rows ?? [];
  } finally {
    try { await client.end(); } catch { /* best effort */ }
  }
}