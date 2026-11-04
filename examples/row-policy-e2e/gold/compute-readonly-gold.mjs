#!/usr/bin/env node
// Read-only gold for row-policy-e2e: Region row counts from live RDS (SELECT only).
//
//   node examples/row-policy-e2e/gold/compute-readonly-gold.mjs \
//     --password-file .ktx/secrets/mysql-aliyun-password --out inbox/e2e/gold-snapshot
//
// Writes <out>/gold.json (mode 0600). No INSERT, no credentials in the output file.

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { REGIONS, ROW_POLICY_DB_DEFAULTS, TABLES } from "../../../scripts/e2e/lib/row-policy-pack.mjs";

export const READONLY_GOLD_CONTRACT = "lucy-row-policy-readonly-gold-v1";

/** Stable Region-set assertions for BY-01 (华东) and BY-10 (华东∪西南). */
export const REGION_ASSERT_SHAPE = Object.freeze({
  eastOnly: [REGIONS.A],
  union: [REGIONS.A, REGIONS.B]
});

const COUNT_KEYS = ["c", "count", "cnt", "n"];
const REGION_KEYS = ["Region", "region", TABLES.fact.field];

/**
 * Pure gold builder from Region counts (no network). Accepts a region→count map or
 * query-shaped rows `{ Region, c }`.
 *
 * @param {Record<string, number> | Array<Record<string, unknown>>} counts
 * @returns {{ contract: string, regions: Record<string, number>, assertShape: typeof REGION_ASSERT_SHAPE, readonlyGold: { regions: Record<string, number>, assertShape: typeof REGION_ASSERT_SHAPE } }}
 */
export function buildGoldFromCounts(counts) {
  const regions = normalizeRegionCounts(counts);
  const assertShape = {
    eastOnly: [...REGION_ASSERT_SHAPE.eastOnly],
    union: [...REGION_ASSERT_SHAPE.union]
  };
  return {
    contract: READONLY_GOLD_CONTRACT,
    regions,
    assertShape,
    readonlyGold: { regions, assertShape }
  };
}

/**
 * @param {Record<string, number> | Array<Record<string, unknown>>} counts
 * @returns {Record<string, number>}
 */
export function normalizeRegionCounts(counts) {
  if (counts === null || counts === undefined) {
    throw new Error("counts is required");
  }
  if (Array.isArray(counts)) {
    const out = {};
    for (const row of counts) {
      if (!row || typeof row !== "object") continue;
      const region = pickStringField(row, REGION_KEYS);
      const n = pickCountField(row);
      if (region === undefined || n === undefined) continue;
      out[region] = n;
    }
    return out;
  }
  if (typeof counts === "object") {
    const out = {};
    for (const [key, value] of Object.entries(counts)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`invalid count for region ${JSON.stringify(key)}`);
      }
      out[key] = Math.trunc(n);
    }
    return out;
  }
  throw new Error("counts must be a region map or an array of query rows");
}

/**
 * Parse `mysql -N -B` tab output: `Region<TAB>count` per line.
 *
 * @param {string} text
 * @returns {Array<{ Region: string, c: number }>}
 */
export function parseRegionCountBatchOutput(text) {
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    const region = line.slice(0, tab);
    const c = Number(line.slice(tab + 1));
    if (!region || !Number.isFinite(c)) continue;
    rows.push({ Region: region, c: Math.trunc(c) });
  }
  return rows;
}

function pickStringField(row, keys) {
  for (const key of keys) {
    if (typeof row[key] === "string" && row[key].length > 0) return row[key];
  }
  return undefined;
}

function pickCountField(row) {
  for (const key of COUNT_KEYS) {
    if (row[key] === undefined || row[key] === null) continue;
    const n = Number(row[key]);
    if (Number.isFinite(n) && n >= 0) return Math.trunc(n);
  }
  return undefined;
}

function readPasswordTrimmed(passwordFile) {
  if (!passwordFile) throw new Error("--password-file is required");
  const text = readFileSync(passwordFile, "utf8").trim();
  if (text.length < 1) throw new Error("password file is empty");
  return text;
}

function regionCountSql() {
  const { schema, name, field } = TABLES.fact;
  return `SELECT \`${field}\`, COUNT(*) AS c FROM \`${schema}\`.\`${name}\` GROUP BY \`${field}\``;
}

/** In-container path for a host-mounted client defaults-extra-file (docker fallback). */
export const DOCKER_MYSQL_CLIENT_CNF_PATH = "/tmp/lucy-row-policy-client.cnf";

/**
 * @param {string} defaultsExtraFilePath path passed to mysql `--defaults-extra-file`
 * @param {string} sql
 * @returns {string[]}
 */
export function buildLocalMysqlCliArgs(defaultsExtraFilePath, sql) {
  return [`--defaults-extra-file=${defaultsExtraFilePath}`, "-N", "-B", "-e", sql];
}

/**
 * `docker run` argv (excluding `docker` itself). Mounts host cnf read-only so
 * `--defaults-extra-file` resolves inside the container.
 *
 * @param {string} hostCnfPath absolute or resolvable host path to client.cnf
 * @param {string} sql
 * @returns {string[]}
 */
export function buildDockerMysqlRunArgs(hostCnfPath, sql) {
  const mysqlArgs = buildLocalMysqlCliArgs(DOCKER_MYSQL_CLIENT_CNF_PATH, sql);
  return [
    "run",
    "--rm",
    "-v",
    `${hostCnfPath}:${DOCKER_MYSQL_CLIENT_CNF_PATH}:ro`,
    "mysql:8.4",
    "mysql",
    ...mysqlArgs
  ];
}

/**
 * SELECT Region counts from MySQL (read-only). Uses the mysql CLI; never runs INSERT/UPDATE/DDL.
 *
 * @param {{ host?: string, port?: number, user?: string, passwordFile: string, mysqlBin?: string, useDocker?: boolean }} options
 * @returns {Array<{ Region: string, c: number }>}
 */
export function fetchRegionCountsFromMysql(options) {
  const host = options.host ?? ROW_POLICY_DB_DEFAULTS.host;
  const port = options.port ?? ROW_POLICY_DB_DEFAULTS.port;
  const user = options.user ?? ROW_POLICY_DB_DEFAULTS.readerRole;
  const password = readPasswordTrimmed(options.passwordFile);
  const sql = regionCountSql();
  if (/\b(insert|update|delete|drop|create|alter|truncate|replace)\b/i.test(sql)) {
    throw new Error("refusing non-SELECT SQL");
  }

  const cnfDir = mkdtempSync(path.join(os.tmpdir(), "lucy-row-policy-mysql-"));
  const cnfPath = path.join(cnfDir, "client.cnf");
  try {
    writeFileSync(
      cnfPath,
      `[client]\nhost=${host}\nport=${port}\nuser=${user}\npassword=${password.replace(/\n/g, "")}\ndefault-character-set=utf8mb4\n`,
      { mode: 0o600 }
    );
    chmodSync(cnfPath, 0o600);

    const mysqlArgs = buildLocalMysqlCliArgs(cnfPath, sql);
    const dockerArgs = buildDockerMysqlRunArgs(cnfPath, sql);

    let result;
    if (options.useDocker) {
      result = spawnSync("docker", dockerArgs, {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024
      });
    } else {
      const bin = options.mysqlBin ?? "mysql";
      result = spawnSync(bin, mysqlArgs, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
      if (result.error?.code === "ENOENT" && options.mysqlBin === undefined && options.useDocker !== false) {
        result = spawnSync("docker", dockerArgs, {
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024
        });
      }
    }

    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim();
      throw new Error(detail ? `mysql exited ${result.status}: ${detail}` : `mysql exited ${result.status}`);
    }
    return parseRegionCountBatchOutput(result.stdout ?? "");
  } finally {
    try {
      unlinkSync(cnfPath);
    } catch {
      /* temp cleanup best-effort */
    }
  }
}

function parseArgs(argv) {
  const out = { out: null, passwordFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") out.out = argv[++i];
    else if (arg === "--password-file") out.passwordFile = argv[++i];
    else if (arg === "--host") out.host = argv[++i];
    else if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--user") out.user = argv[++i];
    else if (arg === "--mysql-bin") out.mysqlBin = argv[++i];
    else if (arg === "--docker") out.useDocker = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.out || !out.passwordFile) {
    throw new Error(
      "usage: compute-readonly-gold.mjs --password-file <path> --out <dir> [--host HOST] [--port PORT] [--user USER] [--docker]"
    );
  }
  return out;
}

function writeGoldFile(outDir, doc) {
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const goldPath = path.join(outDir, "gold.json");
  writeFileSync(goldPath, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  chmodSync(goldPath, 0o600);
  return goldPath;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const cli = parseArgs(process.argv.slice(2));
    const rows = fetchRegionCountsFromMysql(cli);
    const doc = buildGoldFromCounts(rows);
    const goldPath = writeGoldFile(cli.out, doc);
    process.stdout.write(`${JSON.stringify({ goldPath, regionKeys: Object.keys(doc.regions).sort() })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
