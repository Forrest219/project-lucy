#!/usr/bin/env node
/**
 * P1-58／P1-59 F58／F59 smoke against live demo Docker.
 * Reads login from LUCY_DEMO_LOGIN_FILE (adminId\\npassword or "姓名：/密码：" lines).
 * Does not print secrets. Not a full 2×／5× fixture run.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.LUCY_DEMO_WEBUI || "http://127.0.0.1:55176";
const LOGIN_FILE =
  process.env.LUCY_DEMO_LOGIN_FILE ||
  "/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-login.txt";
const OUT =
  process.env.LUCY_SMOKE_OUT ||
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../inbox/uat-racs-smoke",
    `smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );

function parseLogin(raw) {
  const text = raw.replace(/^\uFEFF/, "");
  const namedId = text.match(/(?:姓名|adminId)[：:]\s*(\S+)/i)?.[1];
  const namedPw = text.match(/(?:密码|password)[：:]\s*(\S+)/i)?.[1];
  if (namedId && namedPw) return { adminId: namedId, password: namedPw };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^https?:\/\//i.test(l) && !/^(url|mcp|created|note)\b/i.test(l));
  // Formats: "url\\nid\\npw" or "id\\npw"
  if (lines.length >= 3 && /^https?:\/\//i.test(lines[0])) {
    return { adminId: lines[1], password: lines[2] };
  }
  if (lines.length >= 2) return { adminId: lines[0], password: lines[1] };
  throw new Error("login file unparseable");
}

function cookieJar(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function api(path, { method = "GET", cookie, body, headers = {} } = {}) {
  const t0 = performance.now();
  const res = await fetch(`${WEB}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const ms = Math.round(performance.now() - t0);
  const ct = res.headers.get("content-type") || "";
  let json = null;
  let text = "";
  if (ct.includes("application/json")) {
    json = await res.json().catch(() => null);
  } else {
    text = await res.text();
  }
  return {
    path,
    method,
    status: res.status,
    ms,
    contentType: ct,
    serverTiming: res.headers.get("server-timing"),
    json,
    textSnippet: text.slice(0, 120),
    ok: res.ok
  };
}

function assert(cond, msg, failures) {
  if (!cond) failures.push(msg);
}

async function main() {
  const failures = [];
  const steps = [];
  const cred = parseLogin(readFileSync(LOGIN_FILE, "utf8"));

  const health = await api("/api/health");
  steps.push({ id: "R0-health", ...health, bodyKeys: health.json ? Object.keys(health.json) : [] });
  assert(health.status === 200, `health ${health.status}`, failures);

  const login = await fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: cred.adminId, password: cred.password })
  });
  const cookie = cookieJar(login);
  steps.push({
    id: "R0-login",
    status: login.status,
    hasCookie: Boolean(cookie),
    ms: null
  });
  assert(login.status === 200 && cookie, `login failed status=${login.status}`, failures);
  if (!cookie) {
    finish(steps, failures);
    return;
  }

  // --- F58 ---
  const roles = await api("/api/admin/roles", { cookie });
  steps.push({
    id: "F58-roles",
    status: roles.status,
    ms: roles.ms,
    serverTiming: roles.serverTiming,
    roleCount: roles.json?.data?.roles?.length ?? roles.json?.roles?.length ?? null
  });
  assert(roles.status === 200, `roles ${roles.status}`, failures);

  const agentsFull = await api("/api/admin/agents?range=7d", { cookie });
  steps.push({
    id: "F58-agents-full",
    status: agentsFull.status,
    ms: agentsFull.ms,
    agentCount: agentsFull.json?.data?.agents?.length ?? null,
    hasStatsSample: Boolean(agentsFull.json?.data?.agents?.[0]?.stats || agentsFull.json?.data?.agents?.[0]?.callCount !== undefined)
  });
  assert(agentsFull.status === 200, `agents full ${agentsFull.status}`, failures);

  const roster = await api("/api/admin/agents?view=roster", { cookie });
  const rosterAgents = roster.json?.data?.agents ?? roster.json?.agents ?? [];
  const rosterHasWindowStats = rosterAgents.some(
    (a) => a?.stats != null || a?.callCount != null || a?.protocolEvents != null
  );
  steps.push({
    id: "F58-roster",
    status: roster.status,
    ms: roster.ms,
    agentCount: rosterAgents.length,
    hasWindowStats: rosterHasWindowStats,
    keysSample: rosterAgents[0] ? Object.keys(rosterAgents[0]).slice(0, 20) : []
  });
  assert(roster.status === 200, `roster ${roster.status}`, failures);
  assert(!rosterHasWindowStats, "roster must not include window stats fields", failures);

  const stats = await api("/api/admin/agents/statistics?range=7d", { cookie });
  const statsMeta = stats.json?.data?.meta ?? stats.json?.meta ?? {};
  steps.push({
    id: "F58-statistics",
    status: stats.status,
    ms: stats.ms,
    asOf: statsMeta.statisticsAsOf ?? null,
    cache: statsMeta.cache ?? null
  });
  assert(stats.status === 200, `statistics ${stats.status}`, failures);
  assert(Boolean(statsMeta.statisticsAsOf), "statisticsAsOf missing", failures);

  const stats2 = await api("/api/admin/agents/statistics?range=7d", { cookie });
  const stats2Meta = stats2.json?.data?.meta ?? stats2.json?.meta ?? {};
  steps.push({
    id: "F58-statistics-reuse",
    status: stats2.status,
    ms: stats2.ms,
    cache: stats2Meta.cache ?? null
  });
  assert(stats2Meta.cache === "hit", `expected cache hit got ${stats2Meta.cache}`, failures);

  const statsRefresh = await api("/api/admin/agents/statistics?range=7d&refresh=true", { cookie });
  const statsRefreshMeta = statsRefresh.json?.data?.meta ?? statsRefresh.json?.meta ?? {};
  steps.push({
    id: "F58-statistics-refresh",
    status: statsRefresh.status,
    ms: statsRefresh.ms,
    cache: statsRefreshMeta.cache ?? null
  });
  assert(statsRefresh.status === 200, `statistics refresh ${statsRefresh.status}`, failures);
  assert(statsRefreshMeta.cache === "bypass", `expected cache bypass got ${statsRefreshMeta.cache}`, failures);

  const concurrent = await Promise.all(
    Array.from({ length: 25 }, () => api("/api/admin/roles", { cookie }))
  );
  const buildsHints = concurrent.map((r) => r.serverTiming || "");
  steps.push({
    id: "F58-roles-25x",
    statuses: [...new Set(concurrent.map((r) => r.status))],
    msP95: concurrent.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(concurrent.length * 0.95)],
    msMax: Math.max(...concurrent.map((r) => r.ms)),
    serverTimingSamples: buildsHints.slice(0, 3)
  });
  assert(
    concurrent.every((r) => r.status === 200),
    "roles 25x not all 200",
    failures
  );

  // --- F59 object protocol smoke on a disposable role note patch ---
  const rolesData = roles.json?.data?.roles ?? roles.json?.roles ?? [];
  const targetRole =
    rolesData.find((r) => r.id === "demo_readonly" || r.roleId === "demo_readonly") ||
    rolesData[0];
  const roleId = targetRole?.id || targetRole?.roleId;
  assert(roleId, "no role to patch", failures);

  const detail = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, { cookie });
  const baseObjectVersion =
    detail.json?.data?.baseObjectVersion || detail.json?.baseObjectVersion || null;
  steps.push({
    id: "F59-role-detail",
    status: detail.status,
    hasBaseObjectVersion: Boolean(baseObjectVersion)
  });
  assert(detail.status === 200, `role detail ${detail.status}`, failures);
  assert(baseObjectVersion, "detail missing baseObjectVersion", failures);

  if (baseObjectVersion) {
    const operationId = randomUUID();
    const note = `uat-racs-smoke-${Date.now()}`;
    const dry = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
      method: "PATCH",
      cookie,
      body: {
        dryRun: true,
        baseObjectVersion,
        patch: { description: note }
      }
    });
    const previewToken = dry.json?.data?.previewToken || dry.json?.previewToken;
    const dryBase =
      dry.json?.data?.baseObjectVersion || dry.json?.baseObjectVersion || baseObjectVersion;
    steps.push({
      id: "F59-dryRun",
      status: dry.status,
      hasPreviewToken: Boolean(previewToken)
    });
    assert(dry.status === 200 && previewToken, `dryRun failed ${dry.status}`, failures);

    if (previewToken) {
      const save = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
        method: "PATCH",
        cookie,
        body: {
          dryRun: false,
          baseObjectVersion: dryBase,
          previewToken,
          operationId,
          patch: { description: note }
        }
      });
      steps.push({
        id: "F59-save",
        status: save.status,
        operationIdReturned: save.json?.data?.operationId || save.json?.operationId || null
      });
      assert(save.status === 200, `save ${save.status}`, failures);

      const statusQ = await api(`/api/admin/access-write-status/${operationId}`, { cookie });
      steps.push({
        id: "F59-write-status",
        status: statusQ.status,
        outcome: statusQ.json?.data?.outcome || statusQ.json?.outcome || null
      });
      assert(statusQ.status === 200, `write-status ${statusQ.status}`, failures);

      // restore description if we have previous
      const prevDesc = targetRole.description ?? "";
      const detail2 = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, { cookie });
      const bov2 = detail2.json?.data?.baseObjectVersion || detail2.json?.baseObjectVersion;
      if (bov2) {
        const dry2 = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
          method: "PATCH",
          cookie,
          body: { dryRun: true, baseObjectVersion: bov2, patch: { description: prevDesc } }
        });
        const pt2 = dry2.json?.data?.previewToken || dry2.json?.previewToken;
        if (pt2) {
          await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
            method: "PATCH",
            cookie,
            body: {
              dryRun: false,
              baseObjectVersion: dry2.json?.data?.baseObjectVersion || bov2,
              previewToken: pt2,
              operationId: randomUUID(),
              patch: { description: prevDesc }
            }
          });
          steps.push({ id: "F59-restore", ok: true });
        }
      }
    }
  }

  finish(steps, failures);
}

function finish(steps, failures) {
  const report = {
    suite: "UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE",
    selectors: ["F58-smoke", "F59-smoke"],
    web: WEB,
    at: new Date().toISOString(),
    verdict: failures.length === 0 ? "SMOKE_PASS" : "SMOKE_FAIL",
    failures,
    steps
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, verdict: report.verdict, failures }, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(2);
});
