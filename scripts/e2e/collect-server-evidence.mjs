#!/usr/bin/env node
// Server-side evidence for Agent cases (Spec §6.4, §8.1): query events, trace ids and policy/context versions are
// read from THIS instance's own audit ledger with the instance's administrator identity, then bound to the case by
// Token fingerprint, agent id and time window. The tool has no mock and no fallback: when the ledger cannot be read,
// or an entry does not match, the problem is reported and the case cannot claim a trace.
//
//   node scripts/e2e/collect-server-evidence.mjs --run <run.json> --agent e2e_finance --token-fingerprint <12hex> \
//        --since <iso> --until <iso>

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fail, loadRun, parseArgv } from "./lib/common.mjs";
import { LucyHttp } from "./lib/instance.mjs";

const MARGIN_MS = 2000;

/**
 * Pure binding: which of the ledger `entries` belong to this case. Anything that does not match the Token
 * fingerprint, agent or window is excluded, and a mismatch inside the window is a binding problem, not a pass.
 */
export function bindEvidence({ entries, agentId, tokenFingerprint, since, until }) {
  const start = Date.parse(since) - MARGIN_MS;
  const end = Date.parse(until) + MARGIN_MS;
  const problems = [];
  const bound = [];
  for (const entry of entries) {
    const at = Date.parse(entry.ts);
    if (!(at >= start && at <= end)) continue;
    if (entry.userId !== agentId) {
      problems.push(`entry ${entry.id} in the window belongs to agent ${entry.userId}, not ${agentId}`);
      continue;
    }
    const prefix = String(entry.tokenHashPrefix ?? "").replace(/^sha256:/, "");
    if (prefix !== tokenFingerprint) {
      problems.push(`entry ${entry.id} was made with Token ${prefix || "(none)"}, not ${tokenFingerprint}`);
      continue;
    }
    bound.push(entry);
  }
  const withTrace = bound.filter((e) => typeof e.traceId === "string" && e.traceId.startsWith("trace_"));
  const queries = bound.filter((e) => e.tool === "lucy_query").map((e) => ({ id: e.id, outcome: e.outcome, traceId: e.traceId ?? null }));
  const policyVersions = [...new Set(bound.map((e) => e.policyVersion).filter(Boolean))];
  if (bound.length > 0 && withTrace.length === 0) problems.push("bound entries carry no server trace id");
  if (policyVersions.length > 1) problems.push(`policy changed during the case window (${policyVersions.length} versions)`);
  return {
    events: bound.map((e) => ({ id: e.id, ts: e.ts, tool: e.tool, outcome: e.outcome, traceId: e.traceId ?? null, policyVersion: e.policyVersion ?? null, roleIds: e.roleIds ?? [], decisionReason: e.decisionReason ?? null })),
    queries,
    queryEventIds: queries.map((q) => String(q.id)),
    traceIds: [...new Set(withTrace.map((e) => e.traceId))],
    policyVersion: policyVersions[0] ?? null,
    roleIds: [...new Set(bound.flatMap((e) => e.roleIds ?? []))],
    deniedCount: bound.filter((e) => e.outcome === "denied").length,
    bindingProblems: problems
  };
}

export function tokenFingerprintOf(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

/** Reads the owner credentials the run holds in checker/secrets (controlled administrator identity). */
function ownerCredentials(run) {
  return JSON.parse(readFileSync(path.join(run.secretsDir, "admins.json"), "utf8")).owner;
}

/** Logs in as the instance administrator and returns an authenticated reader. Throws when the ledger is unreadable. */
export async function openLedgerReader(run, { http = new LucyHttp(run.instance.baseUrl), credentials = ownerCredentials(run) } = {}) {
  const login = await http.request("POST", "/api/auth/login", { body: { adminId: credentials.adminId, password: credentials.password } });
  if (login.status !== 200 || !login.cookie) throw new Error(`cannot read the server ledger: administrator login -> HTTP ${login.status}`);
  return {
    async entries({ agentId, since, until }) {
      const query = new URLSearchParams({ user: agentId, since, until, limit: "500", includeProtocol: "true" });
      const res = await http.request("GET", `/api/admin/audit?${query}`, { cookie: login.cookie });
      if (res.status !== 200) throw new Error(`cannot read the server ledger: audit API -> HTTP ${res.status}`);
      return { entries: res.json?.data?.entries ?? [], projection: res.json?.data?.projection ?? null };
    },
    async contextPolicyVersion(roleId) {
      const res = await http.request("GET", `/api/admin/roles/${encodeURIComponent(roleId)}`, { cookie: login.cookie });
      return res.status === 200 ? (res.json?.data?.contextPolicyVersion ?? null) : null;
    }
  };
}

export async function collectServerEvidence({ run, agentId, tokenFingerprint, since, until, reader }) {
  const live = reader ?? (await openLedgerReader(run));
  const { entries, projection } = await live.entries({ agentId, since, until });
  const bound = bindEvidence({ entries, agentId, tokenFingerprint, since, until });
  const roleId = bound.roleIds[0];
  const contextPolicyVersion = roleId ? await live.contextPolicyVersion(roleId) : null;
  if (projection && projection.complete === false) bound.bindingProblems.push("audit projection is incomplete (lag); evidence cannot be treated as complete");
  return { ...bound, contextPolicyVersion, projection };
}

/** Writes the aggregated per-run server evidence file referenced by the evidence document. */
export function writeServerEvidenceFile(run, cases) {
  const dir = path.join(run.paths.runDir, "results");
  mkdirSync(dir, { recursive: true });
  const body = { contract: "lucy-server-evidence-v1", source: "instance-ledger", runId: run.runId, instanceId: run.instanceId, collectedAt: new Date().toISOString(), cases };
  const text = `${JSON.stringify(body, null, 2)}\n`;
  const file = path.join(dir, "server-evidence.json");
  writeFileSync(file, text);
  return { path: path.relative(run.paths.runDir, file), sha256: createHash("sha256").update(text).digest("hex") };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { run: "value", agent: "value", "token-fingerprint": "value", since: "value", until: "value" });
    for (const required of ["run", "agent", "token-fingerprint", "since", "until"]) if (!args[required]) fail(`collect-server-evidence: --${required} is required`, 1);
    const run = loadRun(args.run);
    const result = await collectServerEvidence({ run, agentId: args.agent, tokenFingerprint: args["token-fingerprint"], since: args.since, until: args.until });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.bindingProblems.length === 0 ? 0 : 1);
  } catch (error) {
    fail(`collect-server-evidence: ${error instanceof Error ? error.message : String(error)}`, 2);
  }
}
