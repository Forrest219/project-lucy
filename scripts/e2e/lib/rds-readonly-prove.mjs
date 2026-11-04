// Prove Aliyun RDS MySQL is reachable read-only for 一推一 packs.
// Never INSERT/UPDATE/DDL. Password stays in a file — never logged.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { RDS_MYSQL_READONLY_DATAPLANE } from "./db-capability.mjs";

/**
 * @param {{ host: string, port?: number, user: string, passwordFile: string, database?: string }} opts
 * @returns {{ ok: true, regions: Record<string, number> } | { ok: false, reason: string }}
 */
export function proveRdsMysqlReadonly(opts) {
  const host = opts.host;
  const port = Number(opts.port ?? 3306);
  const user = opts.user;
  const passwordFile = opts.passwordFile;
  const database = opts.database ?? "dataforai";
  if (!host || !user || !passwordFile) {
    return { ok: false, reason: "host, user, and passwordFile are required" };
  }
  if (!existsSync(passwordFile)) {
    return { ok: false, reason: `password file missing: ${passwordFile}` };
  }
  let password;
  try {
    password = readFileSync(passwordFile, "utf8").replace(/\r?\n$/, "");
  } catch (error) {
    return { ok: false, reason: `cannot read password file: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!password) return { ok: false, reason: "password file is empty" };

  const sql =
    "SELECT region, COUNT(*) AS c FROM dataforai.superstore_orders GROUP BY region ORDER BY region;";
  const args = [
    "run",
    "--rm",
    "mysql:8",
    "mysql",
    "-h",
    host,
    "-P",
    String(port),
    "-u",
    user,
    `-p${password}`,
    "--default-character-set=utf8mb4",
    "--connect-timeout=8",
    "-N",
    "-e",
    sql
  ];
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").replace(password, "***").slice(0, 400);
    return { ok: false, reason: `RDS probe failed (exit ${result.status}): ${err || "no output"}` };
  }
  const regions = {};
  for (const line of (result.stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("mysql:")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const count = Number(parts[parts.length - 1]);
    const region = parts.slice(0, -1).join(" ");
    if (region && Number.isFinite(count)) regions[region] = count;
  }
  if (!regions["华东"] || !regions["西南"]) {
    return {
      ok: false,
      reason: `RDS probe missing 华东/西南 (saw ${JSON.stringify(Object.keys(regions))})`
    };
  }
  return { ok: true, regions };
}

/**
 * Mutates run.db with readonlyProven when the probe succeeds.
 * @param {object} run
 * @returns {{ ok: boolean, reason?: string, regions?: Record<string, number> }}
 */
export function markRunReadonlyProven(run) {
  if (!run?.db || run.db.dataPlane !== RDS_MYSQL_READONLY_DATAPLANE) {
    return { ok: false, reason: "run is not on rds-mysql-readonly dataPlane" };
  }
  const passwordFile = run.db.passwordFile;
  const proof = proveRdsMysqlReadonly({
    host: run.db.host,
    port: run.db.port,
    user: run.db.readerRole,
    passwordFile,
    database: run.db.name ?? "dataforai"
  });
  if (!proof.ok) {
    run.db.readonlyProven = false;
    run.db.readonlyProvenReason = proof.reason;
    return proof;
  }
  run.db.readonlyProven = true;
  run.db.readonlyProvenAt = new Date().toISOString();
  run.db.readonlyRegionCounts = proof.regions;
  delete run.db.readonlyProvenReason;
  return proof;
}
