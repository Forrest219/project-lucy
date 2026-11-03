// Run-scoped schema for J01-02.
//
// The fixture already registers `analytics` on `fin-db`. A new connection that
// asks for that same schema is stopped by the endpoint gate. J01-02 still
// creates a connection; it uses a schema that belongs only to this run.

import { readFileSync } from "node:fs";
import pg from "pg";

const IDENT = /^[a-z][a-z0-9_]{0,62}$/;

/** A Postgres identifier that cannot collide with the fixture schema. */
export function journeySchemaName(runId) {
  const raw = String(runId ?? "run").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const name = `j25_${raw || "run"}`.slice(0, 63).replace(/_+$/g, "");
  if (!IDENT.test(name) || name === "analytics") {
    throw new Error(`refusing unsafe journey schema name ${name}`);
  }
  return name;
}

function ident(value, label) {
  if (!IDENT.test(value)) throw new Error(`refusing unsafe ${label} ${value}`);
  return value;
}

/**
 * Creates this run's schema and a readable copy of `analytics.marketing_daily`.
 * Returns the schema name the connection wizard must use.
 */
export async function provisionJourneySchema(run) {
  const schema = journeySchemaName(run.runId);
  const db = run.db ?? {};
  const database = db.finName ?? db.name;
  const owner = db.ownerRole;
  const reader = db.readerRole;
  const passwordFile = db.ownerPasswordFile;
  if (!database || !owner || !reader || !passwordFile) {
    throw new Error("J01-02 schema provisioning needs db.finName, ownerRole, readerRole and ownerPasswordFile");
  }
  const password = readFileSync(passwordFile, "utf8").trim();
  const client = new pg.Client({
    host: db.host,
    port: db.port,
    database,
    user: owner,
    password
  });
  const schemaSql = ident(schema, "schema");
  const readerSql = ident(reader, "reader role");
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaSql}`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${schemaSql}.marketing_daily (LIKE analytics.marketing_daily INCLUDING ALL)`
    );
    await client.query(
      `INSERT INTO ${schemaSql}.marketing_daily SELECT * FROM analytics.marketing_daily
       WHERE NOT EXISTS (SELECT 1 FROM ${schemaSql}.marketing_daily LIMIT 1)`
    );
    await client.query(`GRANT USAGE ON SCHEMA ${schemaSql} TO ${readerSql}`);
    await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA ${schemaSql} TO ${readerSql}`);
  } finally {
    await client.end();
  }
  return schema;
}
