#!/usr/bin/env node
/**
 * P1-58／P1-59 F58／F59 module smoke against live demo Docker.
 *
 * Maps to UAT-RACS selectors (partial evidence only — not full F58／F59／R):
 *   R0           health + login + candidate freeze
 *   RACS-01 slice roster vs full stats field split; multi-range statistics
 *   RACS-07 slice roles ×25 same-key concurrent read
 *   RACS-08 slice statisticsAsOf + ≤5s cache hit + refresh=bypass
 *   RACS-09／10  dryRun→save→access-write-status committed; same-object conflict
 *   RACS-12 slice optional MCP initialize/tools/list when LUCY_DEMO_MCP_TOKEN set
 *
 * Credentials (never printed):
 *   LUCY_DEMO_ADMIN_ID + LUCY_DEMO_ADMIN_PASSWORD
 *   or LUCY_DEMO_LOGIN_FILE (adminId\\npassword / 姓名：/密码：)
 *
 * Not a 2×／5× fixture run. Exit 0 = SMOKE_PASS; 1 = SMOKE_FAIL; 2 = runner error.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.LUCY_DEMO_WEBUI || "http://127.0.0.1:55176";
const MCP = process.env.LUCY_DEMO_MCP || "http://127.0.0.1:57881";
const LOGIN_FILE =
  process.env.LUCY_DEMO_LOGIN_FILE ||
  "/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-demo-webui.txt";
const OUT =
  process.env.LUCY_SMOKE_OUT ||
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../inbox/uat-racs-smoke",
    `smoke-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );

function resolveCred() {
  const envId = process.env.LUCY_DEMO_ADMIN_ID?.trim();
  const envPw = process.env.LUCY_DEMO_ADMIN_PASSWORD;
  if (envId && envPw) return { adminId: envId, password: envPw, source: "env" };
  if (!existsSync(LOGIN_FILE)) {
    throw new Error("no LUCY_DEMO_ADMIN_ID/PASSWORD and login file missing");
  }
  return { ...parseLogin(readFileSync(LOGIN_FILE, "utf8")), source: "file" };
}

function parseLogin(raw) {
  const text = raw.replace(/^\uFEFF/, "");
  const namedId = text.match(/(?:姓名|adminId|账号)[：:]\s*(\S+)/i)?.[1];
  const namedPw = text.match(/(?:密码|password)[：:]\s*(\S+)/i)?.[1];
  if (namedId && namedPw) return { adminId: namedId, password: namedPw };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^https?:\/\//i.test(l) && !/^(url|mcp|created|note|地址|webui)\b/i.test(l));
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

async function api(path, { method = "GET", cookie, body, headers = {}, base = WEB } = {}) {
  const t0 = performance.now();
  const res = await fetch(`${base}${path}`, {
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
    textSnippet: text.slice(0, 160),
    ok: res.ok
  };
}

function assert(cond, msg, failures) {
  if (!cond) failures.push(msg);
}

function dataOf(json) {
  return json?.data ?? json ?? {};
}

async function main() {
  const failures = [];
  const steps = [];
  const casesHit = new Set();
  const mark = (id) => casesHit.add(id);
  const cred = resolveCred();

  const health = await api("/api/health");
  const h = dataOf(health.json);
  steps.push({
    id: "R0-health",
    uat: "UAT-RACS-R0",
    status: health.status,
    ms: health.ms,
    gitSha: h.gitSha ?? null,
    gitDirty: h.gitDirty ?? null,
    lucyVersion: h.lucyVersion ?? null
  });
  assert(health.status === 200 && h.status === "ok", `health ${health.status}`, failures);
  mark("UAT-RACS-R0");

  const login = await fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: cred.adminId, password: cred.password })
  });
  const cookie = cookieJar(login);
  steps.push({
    id: "R0-login",
    uat: "UAT-RACS-R0",
    status: login.status,
    hasCookie: Boolean(cookie),
    credSource: cred.source
  });
  assert(login.status === 200 && cookie, `login failed status=${login.status}`, failures);
  if (!cookie) {
    finish(steps, failures, casesHit, h);
    return;
  }

  // --- F58 ---
  const roles = await api("/api/admin/roles", { cookie });
  const rolesData = dataOf(roles.json).roles ?? [];
  steps.push({
    id: "F58-roles",
    uat: "UAT-RACS-01",
    status: roles.status,
    ms: roles.ms,
    serverTiming: roles.serverTiming,
    roleCount: rolesData.length
  });
  assert(roles.status === 200, `roles ${roles.status}`, failures);
  mark("UAT-RACS-01");

  const agentsFull = await api("/api/admin/agents?range=7d", { cookie });
  const fullAgents = dataOf(agentsFull.json).agents ?? [];
  steps.push({
    id: "F58-agents-full",
    uat: "UAT-RACS-01",
    status: agentsFull.status,
    ms: agentsFull.ms,
    agentCount: fullAgents.length,
    hasStatsSample: Boolean(
      fullAgents[0]?.stats || fullAgents[0]?.callCount !== undefined
    )
  });
  assert(agentsFull.status === 200, `agents full ${agentsFull.status}`, failures);

  const roster = await api("/api/admin/agents?view=roster", { cookie });
  const rosterAgents = dataOf(roster.json).agents ?? [];
  const rosterHasWindowStats = rosterAgents.some(
    (a) => a?.stats != null || a?.callCount != null || a?.protocolEvents != null
  );
  steps.push({
    id: "F58-roster",
    uat: "UAT-RACS-01",
    status: roster.status,
    ms: roster.ms,
    agentCount: rosterAgents.length,
    hasWindowStats: rosterHasWindowStats,
    keysSample: rosterAgents[0] ? Object.keys(rosterAgents[0]).slice(0, 20) : []
  });
  assert(roster.status === 200, `roster ${roster.status}`, failures);
  assert(!rosterHasWindowStats, "roster must not include window stats fields", failures);

  // Same-range reuse must be asserted before other ranges (cache may be range-keyed
  // or single-slot; RACS-08 contract is ≤5s reuse of the same completed query).
  const stats7 = await api("/api/admin/agents/statistics?range=7d", { cookie });
  const stats7Meta = dataOf(stats7.json).meta ?? {};
  steps.push({
    id: "F58-statistics-7d",
    uat: "UAT-RACS-01",
    status: stats7.status,
    ms: stats7.ms,
    asOf: stats7Meta.statisticsAsOf ?? null,
    cache: stats7Meta.cache ?? null
  });
  assert(stats7.status === 200, `statistics 7d ${stats7.status}`, failures);
  assert(Boolean(stats7Meta.statisticsAsOf), "statisticsAsOf missing (7d)", failures);

  const stats2 = await api("/api/admin/agents/statistics?range=7d", { cookie });
  const stats2Meta = dataOf(stats2.json).meta ?? {};
  steps.push({
    id: "F58-statistics-reuse",
    uat: "UAT-RACS-08",
    status: stats2.status,
    ms: stats2.ms,
    asOf: stats2Meta.statisticsAsOf ?? null,
    cache: stats2Meta.cache ?? null
  });
  assert(stats2Meta.cache === "hit", `expected cache hit got ${stats2Meta.cache}`, failures);
  assert(
    stats2Meta.statisticsAsOf === stats7Meta.statisticsAsOf,
    "cache hit must preserve original statisticsAsOf",
    failures
  );
  mark("UAT-RACS-08");

  const statsRefresh = await api("/api/admin/agents/statistics?range=7d&refresh=true", {
    cookie
  });
  const statsRefreshMeta = dataOf(statsRefresh.json).meta ?? {};
  steps.push({
    id: "F58-statistics-refresh",
    uat: "UAT-RACS-08",
    status: statsRefresh.status,
    ms: statsRefresh.ms,
    cache: statsRefreshMeta.cache ?? null
  });
  assert(statsRefresh.status === 200, `statistics refresh ${statsRefresh.status}`, failures);
  assert(
    statsRefreshMeta.cache === "bypass",
    `expected cache bypass got ${statsRefreshMeta.cache}`,
    failures
  );

  for (const range of ["14d", "30d"]) {
    const stats = await api(`/api/admin/agents/statistics?range=${range}`, { cookie });
    const statsMeta = dataOf(stats.json).meta ?? {};
    steps.push({
      id: `F58-statistics-${range}`,
      uat: "UAT-RACS-01",
      status: stats.status,
      ms: stats.ms,
      asOf: statsMeta.statisticsAsOf ?? null,
      cache: statsMeta.cache ?? null
    });
    assert(stats.status === 200, `statistics ${range} ${stats.status}`, failures);
    assert(Boolean(statsMeta.statisticsAsOf), `statisticsAsOf missing (${range})`, failures);
  }

  const unauthorized = await api("/api/admin/roles");
  steps.push({
    id: "F58-roles-unauth",
    uat: "UAT-RACS-R0",
    status: unauthorized.status,
    contentType: unauthorized.contentType
  });
  assert(
    unauthorized.status === 401 || unauthorized.status === 403,
    `unauth roles expected 401/403 got ${unauthorized.status}`,
    failures
  );

  const concurrent = await Promise.all(
    Array.from({ length: 25 }, () => api("/api/admin/roles", { cookie }))
  );
  const msSorted = concurrent.map((r) => r.ms).sort((a, b) => a - b);
  steps.push({
    id: "F58-roles-25x",
    uat: "UAT-RACS-07",
    statuses: [...new Set(concurrent.map((r) => r.status))],
    msP95: msSorted[Math.floor(concurrent.length * 0.95)],
    msMax: msSorted[msSorted.length - 1],
    serverTimingSamples: concurrent.slice(0, 3).map((r) => r.serverTiming)
  });
  assert(
    concurrent.every((r) => r.status === 200),
    "roles 25x not all 200",
    failures
  );
  mark("UAT-RACS-07");

  // --- F59 object protocol ---
  const targetRole =
    rolesData.find((r) => r.id === "demo_readonly" || r.roleId === "demo_readonly") ||
    rolesData[0];
  const roleId = targetRole?.id || targetRole?.roleId;
  assert(roleId, "no role to patch", failures);

  const detail = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, { cookie });
  const baseObjectVersion =
    dataOf(detail.json).baseObjectVersion || detail.json?.baseObjectVersion || null;
  const prevDesc = dataOf(detail.json).role?.description ?? targetRole.description ?? "";
  steps.push({
    id: "F59-role-detail",
    uat: "UAT-RACS-09",
    status: detail.status,
    hasBaseObjectVersion: Boolean(baseObjectVersion)
  });
  assert(detail.status === 200, `role detail ${detail.status}`, failures);
  assert(baseObjectVersion, "detail missing baseObjectVersion", failures);
  mark("UAT-RACS-09");

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
    const dryData = dataOf(dry.json);
    const previewToken = dryData.previewToken;
    const dryBase = dryData.baseObjectVersion || baseObjectVersion;
    steps.push({
      id: "F59-dryRun",
      uat: "UAT-RACS-09",
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
        uat: "UAT-RACS-09",
        status: save.status,
        operationIdReturned: dataOf(save.json).operationId || null
      });
      assert(save.status === 200, `save ${save.status}`, failures);

      const statusQ = await api(`/api/admin/access-write-status/${operationId}`, { cookie });
      const outcome = dataOf(statusQ.json).outcome || statusQ.json?.outcome || null;
      steps.push({
        id: "F59-write-status",
        uat: "UAT-RACS-09",
        status: statusQ.status,
        outcome
      });
      assert(statusQ.status === 200, `write-status ${statusQ.status}`, failures);
      assert(
        outcome === "committed" || outcome === "success" || outcome === "ok",
        `write-status outcome expected committed got ${outcome}`,
        failures
      );

      // same-object conflict: two dryRuns from stale base, second save must not silent-win
      const d1 = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, { cookie });
      const bovConflict = dataOf(d1.json).baseObjectVersion;
      if (bovConflict) {
        const dryA = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
          method: "PATCH",
          cookie,
          body: {
            dryRun: true,
            baseObjectVersion: bovConflict,
            patch: { description: `${note}-A` }
          }
        });
        const dryB = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
          method: "PATCH",
          cookie,
          body: {
            dryRun: true,
            baseObjectVersion: bovConflict,
            patch: { description: `${note}-B` }
          }
        });
        const ptA = dataOf(dryA.json).previewToken;
        const ptB = dataOf(dryB.json).previewToken;
        const saveA = ptA
          ? await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
              method: "PATCH",
              cookie,
              body: {
                dryRun: false,
                baseObjectVersion: dataOf(dryA.json).baseObjectVersion || bovConflict,
                previewToken: ptA,
                operationId: randomUUID(),
                patch: { description: `${note}-A` }
              }
            })
          : { status: 0 };
        const saveB = ptB
          ? await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
              method: "PATCH",
              cookie,
              body: {
                dryRun: false,
                baseObjectVersion: dataOf(dryB.json).baseObjectVersion || bovConflict,
                previewToken: ptB,
                operationId: randomUUID(),
                patch: { description: `${note}-B` }
              }
            })
          : { status: 0 };
        const pair = [saveA.status, saveB.status];
        const oneOk = pair.filter((s) => s === 200).length === 1;
        const otherConflict = pair.some((s) => s === 409 || s === 412 || s === 428 || s === 503);
        steps.push({
          id: "F59-same-object-conflict",
          uat: "UAT-RACS-10",
          statuses: pair,
          oneCommittedOneConflict: oneOk && otherConflict
        });
        assert(
          oneOk && otherConflict,
          `same-object conflict expected 1×200 + conflict, got ${pair.join(",")}`,
          failures
        );
        mark("UAT-RACS-10");
      }

      // restore description
      const detail2 = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, { cookie });
      const bov2 = dataOf(detail2.json).baseObjectVersion;
      if (bov2) {
        const dry2 = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
          method: "PATCH",
          cookie,
          body: { dryRun: true, baseObjectVersion: bov2, patch: { description: prevDesc } }
        });
        const pt2 = dataOf(dry2.json).previewToken;
        if (pt2) {
          const restore = await api(`/api/admin/roles/${encodeURIComponent(roleId)}`, {
            method: "PATCH",
            cookie,
            body: {
              dryRun: false,
              baseObjectVersion: dataOf(dry2.json).baseObjectVersion || bov2,
              previewToken: pt2,
              operationId: randomUUID(),
              patch: { description: prevDesc }
            }
          });
          steps.push({ id: "F59-restore", uat: "UAT-RACS-09", status: restore.status });
          assert(restore.status === 200, `restore ${restore.status}`, failures);
        }
      }
    }
  }

  // --- optional pure MCP (RACS-12 slice) ---
  const mcpToken = process.env.LUCY_DEMO_MCP_TOKEN?.trim();
  if (mcpToken) {
    const init = await api("/mcp", {
      method: "POST",
      base: MCP,
      headers: {
        authorization: `Bearer ${mcpToken}`,
        accept: "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "uat-racs-smoke", version: "1.0.0" }
        }
      }
    });
    steps.push({
      id: "F58-mcp-initialize",
      uat: "UAT-RACS-12",
      status: init.status,
      ms: init.ms,
      hasResult: Boolean(dataOf(init.json).result || init.json?.result)
    });
    assert(init.status === 200, `mcp initialize ${init.status}`, failures);
    mark("UAT-RACS-12");
  } else {
    steps.push({
      id: "F58-mcp-initialize",
      uat: "UAT-RACS-12",
      status: "SKIPPED",
      reason: "LUCY_DEMO_MCP_TOKEN unset; not BLOCKED for smoke selector"
    });
  }

  finish(steps, failures, casesHit, h);
}

function finish(steps, failures, casesHit, healthData) {
  const report = {
    suite: "UAT-SUITE-ROLES-AGENT-CONCURRENCY-SCALE",
    selectors: ["F58-smoke", "F59-smoke"],
    casesTouched: [...casesHit].sort(),
    web: WEB,
    mcp: MCP,
    candidate: {
      gitSha: healthData?.gitSha ?? null,
      gitDirty: healthData?.gitDirty ?? null,
      lucyVersion: healthData?.lucyVersion ?? null
    },
    at: new Date().toISOString(),
    verdict: failures.length === 0 ? "SMOKE_PASS" : "SMOKE_FAIL",
    failures,
    steps,
    gaps: [
      "not full F58／F59／R",
      "no B／2×／5× fixture seed",
      "no browser E1–E28",
      "no audit-history RACS-02 scale",
      "MCP skipped unless LUCY_DEMO_MCP_TOKEN set"
    ]
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        out: OUT,
        verdict: report.verdict,
        failures,
        casesTouched: report.casesTouched,
        candidate: report.candidate
      },
      null,
      2
    )
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(String(err?.stack || err));
  process.exit(2);
});
