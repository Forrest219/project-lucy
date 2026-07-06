#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function valueAfter(flag) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

function absolute(file) {
  return path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
}

function hasSensitiveLeak(value) {
  const text = JSON.stringify(value);
  return /hunter2|abc123|should-not-leak|tokenHashPrefix|tokenLabel|password\s*[:=]|token\s*[:=]|secret\s*[:=]/i.test(text);
}

async function fetchObservability(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { parseError: "response was not valid JSON", preview: text.slice(0, 500) };
    }
    return { response, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(`Usage:
  node scripts/p1-observability-smoke.mjs
  node scripts/p1-observability-smoke.mjs --url http://127.0.0.1:5174/api/observability --out inbox/p1-observability-evidence.json

Writes headless evidence for the generic /api/observability endpoint.
If the WebUI service is not running, the evidence status is "blocked".`);
    return 0;
  }

  const root = process.cwd();
  const out = absolute(valueAfter("--out") ?? "inbox/p1-observability-evidence.json");
  const liveBase = process.env.LUCY_WEBUI_URL?.replace(/\/$/, "");
  const url = valueAfter("--url") ?? (liveBase ? `${liveBase}/api/observability` : "http://127.0.0.1:5174/api/observability?hours=24&slowMs=30000");
  const timeoutMs = Math.max(Number.parseInt(valueAfter("--timeout-ms") ?? "5000", 10) || 5000, 1);
  const results = [];
  const add = (status, id, message, detail) => results.push({ status, id, message, detail });

  const source = readFileSync(path.join(root, "webui/server/observability.ts"), "utf8");
  const index = readFileSync(path.join(root, "webui/server/index.ts"), "utf8");
  for (const phrase of ["/api/observability", "traffic", "error", "denied", "latency", "latest", "storage", "audit", "redactSensitive"]) {
    add(source.includes(phrase) ? "pass" : "fail", `observability.source.${phrase}`, `observability source includes ${phrase}`);
  }
  add(index.includes("registerR1ObservabilityRoutes(app)") ? "pass" : "fail", "observability.route.registered", "observability routes are registered by buildServer()");

  let observability = null;
  let httpStatus = null;
  try {
    const { response, body } = await fetchObservability(url, timeoutMs);
    httpStatus = response.status;
    observability = body?.data ?? null;
    const requiredSections = ["traffic", "error", "denied", "latency", "eval", "latest", "storage", "audit"];
    const missingSections = requiredSections.filter((key) => body?.data?.[key] === undefined);
    const sensitiveLeak = hasSensitiveLeak(body);
    add(response.ok ? "pass" : "fail", "observability.http.ok", "GET /api/observability returns HTTP success", { status: response.status });
    add(body?.ok === true ? "pass" : "fail", "observability.envelope.ok", "response uses ok envelope");
    add(missingSections.length === 0 ? "pass" : "fail", "observability.sections", "response includes required status sections", { requiredSections, missingSections });
    add(!sensitiveLeak ? "pass" : "fail", "observability.secrets", "response does not expose token/password/secret material");
  } catch (error) {
    add("blocked", "observability.live", "running WebUI service was not reachable", {
      url,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const summary = {
    pass: results.filter((item) => item.status === "pass").length,
    fail: results.filter((item) => item.status === "fail").length,
    blocked: results.filter((item) => item.status === "blocked").length
  };
  const evidence = {
    status: summary.fail > 0 ? "fail" : summary.blocked > 0 ? "blocked" : "pass",
    ok: summary.fail === 0 && summary.blocked === 0,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/p1-observability-smoke.mjs",
    url,
    httpStatus,
    summary,
    results,
    observability
  };

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`[p1-observability-smoke] ${evidence.status}: wrote ${out}`);
  return evidence.status === "pass" ? 0 : evidence.status === "blocked" ? 2 : 1;
}

process.exit(await main());
