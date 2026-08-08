#!/usr/bin/env node
/**
 * G-rt: Spider2-lite runtime smoke against starrocks-r1 / sandbox.s2_*.
 * Missing password or connection failure => status blocked (not fake pass).
 */
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import path from "node:path";

const CONNECTION = process.env.SPIDER2_CONNECTION_ID || "starrocks-r1";
const PROJECT = process.env.KTX_PROJECT_DIR || process.cwd();
const OUT = process.env.SPIDER2_RUNTIME_OUT || "inbox/spider2-lite-sqlite/results/p1-spider2-lite-runtime-evidence.json";
const OVERLAYS = [
  "s2_sakila_payment",
  "s2_chinook_invoices",
  "s2_northwind_orders",
  "s2_pagila_payment",
  "s2_ecommerce_order_items",
];
const ROW_PROBES = [
  { table: "sandbox.s2_sakila_payment", expect: 16049 },
  { table: "sandbox.s2_chinook_invoices", expect: 412 },
  { table: "sandbox.s2_northwind_orders", expect: 830 },
  { table: "sandbox.s2_ecommerce_orders", expect: 99441 },
  { table: "sandbox.s2_ecommerce_geolocation", expect: 1000163 },
];

function run(cmd, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: PROJECT, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: String(err) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const started = new Date().toISOString();
const checks = [];
let status = "pass";

async function addCheck(name, fn) {
  try {
    const detail = await fn();
    checks.push({ name, status: "pass", ...detail });
  } catch (err) {
    const msg = err?.message || String(err);
    const blocked = /missing|ENOENT|not configured|blocked/i.test(msg);
    checks.push({ name, status: blocked ? "blocked" : "fail", error: msg });
    if (blocked && status === "pass") status = "blocked";
    if (!blocked) status = "fail";
  }
}

await addCheck("secretPresent", async () => {
  const secret = path.join(PROJECT, ".ktx/secrets/starrocks-r1-password");
  await access(secret);
  return { secretPath: ".ktx/secrets/starrocks-r1-password" };
});

await addCheck("connectionTest", async () => {
  const r = await run("ktx", ["--project-dir", PROJECT, "connection", "test", CONNECTION]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout || "connection test failed");
  return { excerpt: (r.stdout || "").trim().split("\n").slice(-3) };
});

for (const source of OVERLAYS) {
  await addCheck(`slValidate:${source}`, async () => {
    const r = await run("ktx", [
      "--project-dir", PROJECT,
      "sl", "validate", source,
      "--connection-id", CONNECTION,
    ]);
    if (r.code !== 0) throw new Error(r.stderr || r.stdout || `validate failed ${source}`);
    return { source };
  });
}

await addCheck("rowProbes", async () => {
  const secret = (await readFile(path.join(PROJECT, ".ktx/secrets/starrocks-r1-password"), "utf8")).trim();
  const results = [];
  for (const probe of ROW_PROBES) {
    const sql = `SELECT COUNT(*) FROM ${probe.table}`;
    const r = await run(
      "/opt/homebrew/opt/mysql-client/bin/mysql",
      ["-h", "10.69.65.62", "-P", "8090", "-u", "admin", `-p${secret}`, "-N", "-e", sql],
    );
    if (r.code !== 0) throw new Error(r.stderr || `probe failed ${probe.table}`);
    const n = Number((r.stdout || "").trim().split("\n").filter(Boolean).pop());
    const ok = n === probe.expect;
    results.push({ ...probe, actual: n, ok });
    if (!ok) throw new Error(`row mismatch ${probe.table}: expected ${probe.expect} got ${n}`);
  }
  return { results };
});

if (checks.some((c) => c.status === "fail")) status = "fail";
else if (checks.some((c) => c.status === "blocked")) status = "blocked";

const evidence = {
  gateId: "G-rt",
  gateKind: "runtime",
  suite: "spider2_lite_sqlite",
  connectionId: CONNECTION,
  status,
  stub: false,
  startedAt: started,
  finishedAt: new Date().toISOString(),
  checks,
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(evidence, null, 2) + "\n");
console.log(`[p1-spider2-lite-runtime] ${status.toUpperCase()} evidence=${OUT}`);
process.exit(status === "pass" ? 0 : status === "blocked" ? 42 : 1);
