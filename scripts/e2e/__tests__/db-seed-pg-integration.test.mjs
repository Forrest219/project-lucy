// B3 db-seed: real PostgreSQL integration test (Spec §6.2, §6.4).
//
// Spins up a fresh disposable `postgres:16-alpine` container (random name, label
// `lucy.e2e.contract=true`, ephemeral 127.0.0.1 port, per-run password file
// bind-mounted read-only) and runs applySyntheticDbSeed against the produced
// dataset. This proves the producer:
//   - actually opens a TCP connection to PostgreSQL with the per-run password,
//   - executes CREATE ROLE / CREATE DATABASE / DDL / INSERT / GRANT SELECT /
//     REVOKE PUBLIC / role probe / write-denial against a real engine,
//   - returns applied=true only when every probe passes against real rows.
//
// The test cleans up ONLY its own container before exiting. Pre-existing
// `lucy-e2e-*` containers are NEVER touched (a missing `lucy.e2e.contract=true`
// label is the safety boundary).
//
// The harness `test:e2e-harness` glob includes this file. If Docker is
// unavailable, the test skips cleanly (the contract is portable; the integration
// step is environment-bound and reported as such).

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { computeDatasetDigest, generateDataset, renderSeedSql } from "../../../examples/security-e2e/gold/compute-gold.mjs";
import { applySyntheticDbSeed, defaultExecuteSql, splitSeedDataSql } from "../lib/db-seed.mjs";
import { startDisposablePostgres } from "../lib/db-pg-fixture.mjs";

const SEED = "0123456789abcdef0123456789abcdef";
const ISO = "iso1234567890ab"; // matches the runOwnerIsolationId shape
const RUN_ID = "int-pg-0001";

describe("B3 db-seed: real PostgreSQL integration", () => {
  let fixture = null;
  let runRoot;
  const collected = [];

  before(async () => {
    runRoot = mkdtempSync(path.join(tmpdir(), "lucy-db-int-"));
    fixture = await startDisposablePostgres({ runId: RUN_ID, label: RUN_ID, baseDir: runRoot });
    collected.push(fixture);
  });

  after(async () => {
    for (const f of collected) {
      if (f && typeof f.cleanup === "function") {
        await f.cleanup().catch(() => undefined);
      }
    }
  });

  it("runs end-to-end against a disposable postgres:16-alpine container", async (t) => {
    if (!fixture || !fixture.ok) {
      t.skip(`disposable postgres fixture unavailable in this environment: ${fixture?.reason ?? "unknown"}`);
      return;
    }

    const dataset = generateDataset(SEED);
    const datasetDigest = computeDatasetDigest(dataset);

    const checker = path.join(runRoot, "checker");
    mkdirSync(checker, { recursive: true, mode: 0o700 });
    const seedDataPath = path.join(checker, "seed-data.sql");
    const seedDataSql = renderSeedSql(dataset);
    writeFileSync(seedDataPath, seedDataSql, { mode: 0o600 });
    const seedSqlDigest = `sha256:${(await import("node:crypto")).createHash("sha256").update(seedDataSql).digest("hex")}`;
    const readerRole = `lucy_e2e_reader_${ISO}`;

    const run = {
      runId: RUN_ID,
      instanceId: "instance-int-0001",
      paths: { runDir: runRoot, checker },
      db: {
        host: fixture.host,
        port: fixture.port,
        name: `lucy_e2e_${ISO}`,
        runOwnerIsolationId: ISO,
        readonlyRoles: [readerRole],
        ownerRole: fixture.ownerRole,
        ownerPasswordFile: fixture.ownerPasswordFile,
        passwordFile: fixture.readerPasswordFile,
        seedSqlDigest,
        datasetDigest
      }
    };

    const { ok, measurement } = await applySyntheticDbSeed({
      run,
      runMode: "local",
      executeSql: defaultExecuteSql
    });

    assert.equal(ok, true, `applySyntheticDbSeed must succeed; problems: ${(measurement?.problems ?? []).join(" | ")}`);
    assert.equal(measurement.applied, true);
    assert.equal(measurement.seedApplied, true);
    assert.equal(measurement.seedSqlDigestMeasured, seedSqlDigest);
    assert.equal(measurement.seedDatasetDigestMeasured, datasetDigest);
    assert.equal(measurement.finDatabase, `lucy_e2e_fin_${ISO}`);
    assert.equal(measurement.salesDatabase, `lucy_e2e_sales_${ISO}`);
    assert.equal(measurement.readerRole, readerRole);
    assert.equal(measurement.writeAttemptsDenied, 2); // 1 role * 2 databases
    assert.equal(measurement.readonlyProbes.length, 3); // 1 role * 3 probe tables (marketing_daily in fin, orders_masked in fin, orders_masked in sales)
    for (const probe of measurement.readonlyProbes) {
      assert.ok(probe.rows > 0, `probe of ${probe.table} on ${probe.db} returned positive rows`);
    }

    // Confirm the dataset actually lives in BOTH databases via a separate read,
    // so a single-DB seed (a known regression in earlier drafts) is caught.
    const finOrders = await defaultExecuteSql({
      host: fixture.host, port: fixture.port, database: measurement.finDatabase,
      role: fixture.ownerRole, password: fixture.ownerPassword,
      sql: "SELECT order_id FROM analytics.orders ORDER BY order_id"
    });
    assert.equal(finOrders.length, dataset.finOrders.length);
    const salesOrders = await defaultExecuteSql({
      host: fixture.host, port: fixture.port, database: measurement.salesDatabase,
      role: fixture.ownerRole, password: fixture.ownerPassword,
      sql: "SELECT order_id FROM analytics.orders ORDER BY order_id"
    });
    assert.equal(salesOrders.length, dataset.salesOrders.length);
    // The two databases share the same relation name (`analytics.orders`) but
    // ship different rows; a cross-DB mix-up would show up as equal counts with
    // overlapping order_ids — confirm the FIRST order_id differs.
    assert.notEqual(finOrders[0]?.order_id, salesOrders[0]?.order_id);

    // Confirm the readonly role can authenticate AND read masked rows, but is
    // refused INSERT (real PostgreSQL permission denied).
    const probeRows = await defaultExecuteSql({
      host: fixture.host, port: fixture.port, database: measurement.finDatabase,
      role: readerRole, password: fixture.readerPassword,
      sql: "SELECT COUNT(*)::bigint AS n FROM analytics.orders_masked"
    });
    assert.ok(Number(probeRows[0]?.n ?? 0) > 0, "reader role can SELECT masked view");
    let denied = false;
    try {
      await defaultExecuteSql({
        host: fixture.host, port: fixture.port, database: measurement.finDatabase,
        role: readerRole, password: fixture.readerPassword,
        sql: "INSERT INTO analytics.orders (order_id, region, amount_cents, customer_email, note) VALUES ('__probe_int', 'East', 0, '__probe@invalid', '__probe')"
      });
    } catch (error) {
      denied = /permission denied|42501/i.test(String(error?.message ?? error));
    }
    assert.ok(denied, "reader role must be denied INSERT on analytics.orders");
  });

  it("refuses to mark applied=true when the seed SQL text digest does not match the run", async (t) => {
    if (!fixture || !fixture.ok) {
      t.skip(`disposable postgres fixture unavailable in this environment: ${fixture?.reason ?? "unknown"}`);
      return;
    }
    const dataset = generateDataset(SEED);
    const checker = path.join(runRoot, "checker2");
    mkdirSync(checker, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(checker, "seed-data.sql"), renderSeedSql(dataset), { mode: 0o600 });
    const readerRole = `lucy_e2e_reader_${ISO}_b`;
    const run = {
      runId: `${RUN_ID}-b`,
      instanceId: "instance-int-0002",
      paths: { runDir: runRoot, checker },
      db: {
        host: fixture.host,
        port: fixture.port,
        name: `lucy_e2e_${ISO}_b`,
        runOwnerIsolationId: ISO,
        readonlyRoles: [readerRole],
        ownerRole: fixture.ownerRole,
        ownerPasswordFile: fixture.ownerPasswordFile,
        passwordFile: fixture.readerPasswordFile,
        // Force a digest mismatch to prove the producer refuses on hash mismatch.
        seedSqlDigest: "sha256:" + "0".repeat(64),
        datasetDigest: computeDatasetDigest(dataset)
      }
    };
    const { ok, measurement } = await applySyntheticDbSeed({ run, runMode: "local", executeSql: defaultExecuteSql });
    assert.equal(ok, false);
    assert.equal(measurement.applied, false);
    assert.match((measurement.problems ?? []).join(" "), /digest mismatch/);
  });

  it("splitSeedDataSql splits psql \\connect directives into fin/sales insert batches", () => {
    const sample = renderSeedSql(generateDataset(SEED));
    const split = splitSeedDataSql(sample);
    assert.ok(split.fin.length > 0, "fin inserts are present");
    assert.ok(split.sales.length > 0, "sales inserts are present");
    assert.ok(split.fin.every((line) => /INSERT INTO/i.test(line)), "fin lines are INSERTs");
    assert.ok(split.sales.every((line) => /INSERT INTO/i.test(line)), "sales lines are INSERTs");
  });
});