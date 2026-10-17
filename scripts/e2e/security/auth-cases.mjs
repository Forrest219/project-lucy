// SEC-01 … SEC-05, SEC-23-V04: management authentication, bootstrap, sessions, throttling (Spec §3.1–§3.2).
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/common.mjs";
import { LucyProcess, faults, sleep } from "../lib/instance.mjs";
import { Checks, explicitDeny } from "./context.mjs";

const DENIED = new Set([401, 403, 503]);
const UNAUTH_WRITES = [
  ["PUT", "/api/wiki/shared%2Fglossary.md", { dryRun: false, content: "# anonymous overwrite\n" }],
  ["POST", "/api/admin/agents", { dryRun: false, agent: { id: "anon_agent", name: "anon", roles: ["finance_reader"] } }],
  ["POST", "/api/admin/admins", { adminId: "anon-admin", password: "Anon-password-123", role: "owner" }]
];

async function operatorOnly(ctx, fn) {
  const session = await ctx.freshOperatorSession();
  return fn(session);
}

export const handlers = {
  "SEC-01-V01": async (ctx) => {
    const checks = new Checks();
    const res = await ctx.authStatus();
    const mode = res.json?.data?.mode;
    checks.expect("deny", mode !== undefined && mode !== "open", `auth mode is "${mode}"`);
    checks.expect("no_side_effect", res.status === 200, `status endpoint HTTP ${res.status}`);
    return { ...checks.result(), denyReason: `mode:${mode}` };
  },

  "SEC-01-V02": async (ctx) => {
    const checks = new Checks();
    const before = ctx.digest();
    const statuses = [];
    for (const [method, url, body] of UNAUTH_WRITES) {
      const res = await ctx.web.request(method, url, { body });
      statuses.push(res.status);
      checks.expect("deny", DENIED.has(res.status), `${method} ${url.split("%2F")[0]} -> ${res.status}`);
    }
    checks.expect("no_side_effect", ctx.digest() === before, "project tree digest unchanged");
    return { ...checks.result(), denyReason: `status:${[...new Set(statuses)].join("/")}` };
  },

  "SEC-01-V03": async (ctx) => {
    const checks = new Checks();
    const before = ctx.digest();
    const res = await ctx.web.request("POST", "/api/auth/bootstrap", {
      body: { adminId: "anon-owner", displayName: "anon", password: "Anon-password-123" }
    });
    checks.expect("deny", res.status === 401 || res.status === 503, `bootstrap without key -> ${res.status}`);
    checks.expect("no_side_effect", ctx.digest() === before, "no admins.yaml or content written");
    checks.expect("no_side_effect", (await ctx.authStatus()).json?.data?.mode !== "required", "no owner was created");
    return { ...checks.result(), denyReason: `status:${res.status}` };
  },

  "SEC-01-V04": async (ctx) => {
    const checks = new Checks();
    const undo = faults.replaceFile(ctx.adminsYaml(), "admins: [this is: not valid: yaml\n  - {");
    try {
      await sleep(6000); // outlast the 5 s display cache so the verdict is the fresh state
      const mode = (await ctx.authStatus()).json?.data?.mode;
      checks.expect("unavailable_not_open", mode === "unavailable" || mode === "required", `corrupt config reports "${mode}"`);
      checks.expect("deny", mode !== "open" && mode !== "bootstrap", `corrupt config never reopens ("${mode}")`);
      const boot = await ctx.web.request("POST", "/api/auth/bootstrap", {
        headers: { "x-lucy-bootstrap-token": ctx.bootstrapToken },
        body: { adminId: "e2e-owner", displayName: "x", password: ctx.adminCreds.owner.password }
      });
      checks.expect("deny", boot.status !== 200, `bootstrap on corrupt config -> ${boot.status}`);
      const write = await ctx.web.request("PUT", "/api/wiki/shared%2Fglossary.md", { body: { dryRun: false, content: "# x\n" } });
      checks.expect("no_side_effect", DENIED.has(write.status), `anonymous write on corrupt config -> ${write.status}`);
    } finally {
      undo();
    }
    return checks.result();
  },

  "SEC-01-V05": async (ctx) => {
    const checks = new Checks();
    // (a) The real entrypoint preflight (Chart / container path) refuses customer + auth=off before seeding.
    const probeRoot = path.join(ctx.run.paths.checker, "entrypoint-probe");
    mkdirSync(path.join(probeRoot, "template"), { recursive: true });
    writeFileSync(path.join(probeRoot, "template", "ktx.yaml"), "connections: {}\n");
    const entry = spawnSync("bash", [path.join(REPO_ROOT, "scripts/runtime/docker-entrypoint.sh")], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        LUCY_APP_ROOT: REPO_ROOT,
        LUCY_TEMPLATE_ROOT: path.join(probeRoot, "template"),
        KTX_PROJECT_ROOT: path.join(probeRoot, "project"),
        LUCY_ENTRYPOINT_SEED_ONLY: "1",
        LUCY_DEPLOYMENT_MODE: "customer",
        LUCY_WEBUI_AUTH: "off"
      }
    });
    checks.expect("deny", entry.status !== 0 && /LUCY_WEBUI_AUTH=off is not allowed when LUCY_DEPLOYMENT_MODE=customer/.test(entry.stderr), `entrypoint exit ${entry.status}`);
    checks.expect("deny", !existsSync(path.join(probeRoot, "project", "ktx.yaml")), "preflight ran before any seeding");
    // (b) Even if it is reached, the server never honours auth=off in customer mode.
    const variant = await LucyProcess.probeVariant(ctx.run, { LUCY_WEBUI_AUTH: "off" });
    checks.expect("deny", variant.exited || (variant.authMode !== null && variant.authMode !== "open"), `server with customer + auth=off: exited=${variant.exited} mode=${variant.authMode}`);
    return { ...checks.result(), denyReason: "customer_auth_off_refused" };
  },

  "SEC-02-V01": async (ctx) => {
    const checks = new Checks();
    const res = await ctx.web.request("POST", "/api/auth/bootstrap", {
      body: { adminId: "e2e-owner", displayName: "x", password: ctx.adminCreds.owner.password }
    });
    checks.expect("deny", res.status === 401, `no key -> ${res.status}`);
    checks.expect("no_side_effect", (await ctx.authStatus()).json?.data?.mode === "bootstrap", "still awaiting bootstrap");
    return { ...checks.result(), denyReason: `status:${res.status}` };
  },

  "SEC-02-V02": async (ctx) => {
    const checks = new Checks();
    const res = await ctx.web.request("POST", "/api/auth/bootstrap", {
      headers: { "x-lucy-bootstrap-token": "wrong-key-for-e2e-0000" },
      body: { adminId: "e2e-owner", displayName: "x", password: ctx.adminCreds.owner.password }
    });
    checks.expect("deny", res.status === 401, `wrong key -> ${res.status}`);
    checks.expect("no_side_effect", (await ctx.authStatus()).json?.data?.mode === "bootstrap", "still awaiting bootstrap");
    return { ...checks.result(), denyReason: `status:${res.status}` };
  },

  "SEC-02-V03": async (ctx) => {
    const checks = new Checks();
    const attempt = (adminId) =>
      ctx.web.request("POST", "/api/auth/bootstrap", {
        headers: { "x-lucy-bootstrap-token": ctx.bootstrapToken },
        body: { adminId, displayName: adminId, password: ctx.adminCreds.owner.password }
      });
    const results = await Promise.all([attempt("e2e-owner"), attempt("e2e-racer")]);
    const statuses = results.map((r) => r.status).sort();
    const winners = results.filter((r) => r.status === 200);
    checks.expect("exactly_one_wins", winners.length === 1, `statuses ${statuses.join(",")}`);
    checks.expect("deny", results.some((r) => r.status === 409), `loser got 409 (${statuses.join(",")})`);
    // Whichever racer won is the run's owner from here on.
    if (winners[0]?.cookie) {
      ctx.cookies.owner = winners[0].cookie;
      if (results[1].status === 200) ctx.adminCreds.owner.adminId = "e2e-racer";
    }
    return { ...checks.result(), denyReason: `status:${statuses.join("/")}` };
  },

  "SEC-02-V04": async (ctx) => {
    const checks = new Checks();
    const res = await ctx.web.request("POST", "/api/auth/bootstrap", {
      headers: { "x-lucy-bootstrap-token": ctx.bootstrapToken },
      body: { adminId: "e2e-late", displayName: "late", password: ctx.adminCreds.owner.password }
    });
    checks.expect("deny", res.status === 409, `consumed key -> ${res.status}`);
    const admins = await ctx.adminCall(await ctx.ownerCookie(), "GET", "/api/admin/admins");
    checks.expect("no_side_effect", !admins.json?.data?.admins?.some((a) => a.id === "e2e-late"), "late owner not created");
    return { ...checks.result(), denyReason: `status:${res.status}` };
  },

  "SEC-02-V05": async (ctx) => {
    const checks = new Checks();
    await ctx.ownerCookie();
    await ctx.lucy.restart("SIGKILL");
    const mode = (await ctx.authStatus()).json?.data?.mode;
    checks.expect("unavailable_not_open", mode === "required", `after SIGKILL the mode is "${mode}"`);
    const res = await ctx.web.request("POST", "/api/auth/bootstrap", {
      headers: { "x-lucy-bootstrap-token": ctx.bootstrapToken },
      body: { adminId: "e2e-after-crash", displayName: "x", password: ctx.adminCreds.owner.password }
    });
    checks.expect("unavailable_not_open", res.status === 409, `bootstrap after crash -> ${res.status}`);
    return checks.result();
  },

  "SEC-03-V01": async (ctx) =>
    operatorOnly(ctx, async (op) => {
      const checks = new Checks();
      const res = await ctx.adminCall(op.cookie, "POST", "/api/admin/admins", { adminId: "op-made-admin", password: "Op-made-password-1", role: "owner" });
      checks.expect("deny", res.status === 403, `operator creates account -> ${res.status}`);
      const admins = await ctx.adminCall(await ctx.ownerCookie(), "GET", "/api/admin/admins");
      checks.expect("deny", !admins.json?.data?.admins?.some((a) => a.id === "op-made-admin"), "no account was created");
      return { ...checks.result(), denyReason: `status:${res.status}` };
    }),

  "SEC-03-V02": async (ctx) =>
    operatorOnly(ctx, async (op) => {
      const checks = new Checks();
      const res = await ctx.adminCall(op.cookie, "PATCH", `/api/admin/admins/${ctx.adminCreds.owner.adminId}`, { password: "Op-reset-password-1" });
      checks.expect("deny", res.status === 403, `operator resets owner password -> ${res.status}`);
      const login = await ctx.login(ctx.adminCreds.owner.adminId, "Op-reset-password-1");
      checks.expect("deny", login.res.status === 401, `new password does not work -> ${login.res.status}`);
      return { ...checks.result(), denyReason: `status:${res.status}` };
    }),

  "SEC-03-V03": async (ctx) => {
    const checks = new Checks();
    const op = await ctx.operatorCookie();
    const roles = await ctx.adminCall(op, "GET", "/api/admin/roles");
    checks.expect("allow_control", roles.status === 200, `operator lists roles -> ${roles.status}`);
    const preview = await ctx.adminCall(op, "POST", "/api/wiki/upload/preview", {
      key: "shared/operator-control.md",
      markdown: "---\nsummary: control\nallowed_roles: [finance_reader]\n---\n# Control\n"
    });
    checks.expect("allow_control", preview.status === 200, `operator previews a Wiki upload -> ${preview.status}`);
    return checks.result();
  },

  "SEC-03-V04": async (ctx) => {
    const checks = new Checks();
    const op = await ctx.operatorCookie();
    const key = "shared/actor-spoof.md";
    const markdown = "---\nsummary: spoof\nallowed_roles: [finance_reader]\n---\n# Actor spoof control\n";
    const res = await ctx.web.request("POST", "/api/wiki/upload/commit", {
      cookie: op,
      body: { key, markdown, actor: ctx.adminCreds.owner.adminId, actorId: ctx.adminCreds.owner.adminId }
    });
    checks.expect("allow_control", res.status === 200, `operator commit -> ${res.status}`);
    const audit = await ctx.adminCall(await ctx.ownerCookie(), "GET", "/api/admin/config-audit?limit=50");
    const text = JSON.stringify(audit.json ?? {});
    const entries = audit.json?.data?.entries ?? audit.json?.data?.items ?? [];
    const mine = entries.filter((e) => JSON.stringify(e).includes("actor-spoof"));
    const attributedToOwner = mine.some((e) => (e.actor ?? e.actorId) === ctx.adminCreds.owner.adminId);
    const attributedToOperator = mine.some((e) => (e.actor ?? e.actorId) === ctx.adminCreds.operator.adminId);
    checks.expect("audit_event", mine.length > 0, `${mine.length} config-audit entries for the write`);
    checks.expect("deny", !attributedToOwner, "body.actor did not become the trusted actor");
    checks.expect("audit_event", attributedToOperator, "write attributed to the authenticated operator");
    checks.noLeak([text], ctx.scanOptions());
    return checks.result();
  },

  "SEC-04-V01": async (ctx) => {
    const checks = new Checks();
    const s = await ctx.freshOperatorSession();
    const before = await ctx.adminCall(s.cookie, "GET", "/api/auth/me");
    checks.expect("allow_control", before.status === 200, `session valid before logout -> ${before.status}`);
    const out = await ctx.web.request("POST", "/api/auth/logout", { cookie: s.cookie });
    checks.expect("allow_control", out.status === 200, `logout -> ${out.status}`);
    const replay = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("deny", replay.status === 401, `replay after logout -> ${replay.status}`);
    checks.noLeak([replay.text], ctx.scanOptions());
    ctx.revokedCookie = s.cookie;
    return { ...checks.result(), denyReason: `status:${replay.status}` };
  },

  "SEC-04-V02": async (ctx) => {
    const checks = new Checks();
    const s = await ctx.freshOperatorSession();
    const reset = await ctx.adminCall(await ctx.ownerCookie(), "PATCH", `/api/admin/admins/${s.adminId}`, { password: "Reset-by-owner-123" });
    checks.expect("allow_control", reset.status === 200, `owner resets password -> ${reset.status}`);
    const replay = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("deny", replay.status === 401, `old cookie after reset -> ${replay.status}`);
    checks.noLeak([replay.text], ctx.scanOptions());
    return { ...checks.result(), denyReason: `status:${replay.status}` };
  },

  "SEC-04-V03": async (ctx) => {
    const checks = new Checks();
    const s = await ctx.freshOperatorSession();
    const change = await ctx.adminCall(await ctx.ownerCookie(), "PATCH", `/api/admin/admins/${s.adminId}`, { role: "owner" });
    checks.expect("allow_control", change.status === 200, `owner changes role -> ${change.status}`);
    const replay = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("deny", replay.status === 401, `old cookie after role change -> ${replay.status}`);
    checks.noLeak([replay.text], ctx.scanOptions());
    return { ...checks.result(), denyReason: `status:${replay.status}` };
  },

  "SEC-04-V04": async (ctx) => {
    const checks = new Checks();
    const s = await ctx.freshOperatorSession();
    const disable = await ctx.adminCall(await ctx.ownerCookie(), "PATCH", `/api/admin/admins/${s.adminId}`, { enabled: false });
    checks.expect("allow_control", disable.status === 200, `owner disables account -> ${disable.status}`);
    const replay = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("deny", replay.status === 401, `old cookie after disable -> ${replay.status}`);
    checks.noLeak([replay.text], ctx.scanOptions());
    return { ...checks.result(), denyReason: `status:${replay.status}` };
  },

  "SEC-04-V05": async (ctx) => {
    const checks = new Checks();
    const s = await ctx.freshOperatorSession();
    const owner = await ctx.ownerCookie();
    const del = await ctx.adminCall(owner, "DELETE", `/api/admin/admins/${s.adminId}`);
    checks.expect("allow_control", del.status === 200, `owner deletes account -> ${del.status}`);
    const recreate = await ctx.adminCall(owner, "POST", "/api/admin/admins", { adminId: s.adminId, displayName: s.adminId, password: s.password, role: "operator" });
    checks.expect("allow_control", recreate.status === 200, `same id recreated -> ${recreate.status}`);
    const replay = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("deny", replay.status === 401, `old cookie of the previous incarnation -> ${replay.status}`);
    checks.noLeak([replay.text], ctx.scanOptions());
    return { ...checks.result(), denyReason: `status:${replay.status}` };
  },

  "SEC-04-V06": async (ctx) => {
    const checks = new Checks();
    const s = await ctx.freshOperatorSession();
    await ctx.web.request("POST", "/api/auth/logout", { cookie: s.cookie });
    const surviving = await ctx.freshOperatorSession();
    await ctx.lucy.restart("SIGKILL");
    const replay = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("deny", replay.status === 401, `revoked cookie after restart -> ${replay.status}`);
    checks.noLeak([replay.text], ctx.scanOptions());
    const live = await ctx.adminCall(surviving.cookie, "GET", "/api/auth/me");
    checks.expect("allow_control", live.status === 200, `non-revoked session survives restart -> ${live.status}`);
    return { ...checks.result(), denyReason: `status:${replay.status}` };
  },

  "SEC-04-V10": async (ctx) => {
    const checks = new Checks();
    const s = await ctx.freshOperatorSession();
    const live = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("consistency", /no-store/i.test(live.headers["cache-control"] ?? ""), `cache-control: ${live.headers["cache-control"] ?? "(none)"}`);
    await ctx.web.request("POST", "/api/auth/logout", { cookie: s.cookie });
    const replay = await ctx.adminCall(s.cookie, "GET", "/api/admin/agents");
    checks.expect("deny", replay.status === 401, `after logout -> ${replay.status}`);
    checks.noLeak([replay.text], { ...ctx.scanOptions(), forbiddenCanaries: ["e2e_finance", ...ctx.forbiddenFor([])] });
    return checks.result();
  },

  "SEC-05-V01": async (ctx) => {
    const checks = new Checks();
    const unknown = await ctx.login("e2e-no-such-admin", "Wrong-password-123");
    const wrong = await ctx.login(ctx.adminCreds.operator.adminId, "Wrong-password-123");
    checks.expect("consistency", unknown.res.status === 401 && wrong.res.status === 401, `unknown ${unknown.res.status} / wrong ${wrong.res.status}`);
    checks.expect("consistency", JSON.stringify(unknown.res.json) === JSON.stringify(wrong.res.json), "response bodies identical");
    checks.expect("deny", unknown.res.status === 401 && wrong.res.status === 401, "both failures are an explicit 401");
    checks.noLeak([unknown.res.text, wrong.res.text], ctx.scanOptions());
    return { ...checks.result(), denyReason: "AUTH_INVALID" };
  },

  "SEC-05-V02": async (ctx) => {
    const checks = new Checks();
    const id = "e2e-throttle-target";
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await ctx.login(id, "Wrong-password-123")).res.status);
    ctx.throttleStatuses = statuses;
    checks.expect("deny", statuses.slice(0, 5).every((s) => s === 401), `first 5 failures -> ${statuses.slice(0, 5).join(",")}`);
    checks.expect("deny", statuses[5] === 429, `6th attempt -> ${statuses[5]}`);
    return { ...checks.result(), denyReason: `status:${statuses[5]}` };
  },

  "SEC-05-V04": async (ctx) => {
    const checks = new Checks();
    const res = await ctx.login("e2e-throttle-target", "Wrong-password-123");
    const retry = Number(res.res.headers["retry-after"]);
    checks.expect("deny", res.res.status === 429, `throttled -> ${res.res.status}`);
    checks.expect("deny", Number.isFinite(retry) && retry > 0, `Retry-After: ${res.res.headers["retry-after"] ?? "(missing)"}`);
    return { ...checks.result(), denyReason: `status:${res.res.status}` };
  },

  "SEC-05-V05": async (ctx) => {
    const checks = new Checks();
    await ctx.lucy.restart("SIGKILL");
    const res = await ctx.login("e2e-throttle-target", "Wrong-password-123");
    checks.expect("deny", res.res.status === 429, `after restart the bucket still throttles -> ${res.res.status}`);
    return { ...checks.result(), denyReason: `status:${res.res.status}` };
  },

  "SEC-05-V03": async (ctx) => {
    const checks = new Checks();
    const statuses = [];
    for (let i = 0; i < 40; i += 1) statuses.push((await ctx.login(`e2e-scan-${i}`, "Wrong-password-123")).res.status);
    const firstThrottle = statuses.indexOf(429);
    checks.expect("deny", firstThrottle !== -1 && firstThrottle <= 31, `source throttle began at attempt ${firstThrottle + 1}`);
    return { ...checks.result(), denyReason: "status:429" };
  },

  "SEC-05-V06": async (ctx) => {
    const checks = new Checks();
    let log = "";
    try {
      log = readFileSync(ctx.lucy.logPath, "utf8");
    } catch (error) {
      checks.expect("artifact_scan", false, `cannot read the instance log: ${error.message}`);
      return checks.result();
    }
    checks.expect("artifact_scan", log.length > 0, `scanned ${log.length} bytes of instance log`);
    checks.noLeak([log], { secrets: [...ctx.allSecrets, "Wrong-password-123"] , forbiddenCanaries: [] });
    return checks.result();
  },

  "SEC-23-V04": async (ctx) => {
    const checks = new Checks();
    const owner = await ctx.ownerCookie();
    const isSqlite = (text) => text.startsWith("SQLite format 3");
    const api = [
      ["GET", "/api/wiki/..%2F.ktx-ui%2Fsecurity.sqlite/raw"],
      ["GET", "/api/wiki/%2E%2E%2F.ktx-ui%2Fsecurity.sqlite"]
    ];
    const bodies = [];
    for (const [method, url] of api) {
      const res = await ctx.web.request(method, url, { cookie: owner });
      bodies.push(res.text);
      checks.expect("deny", explicitDeny(res) && !isSqlite(res.text), `${url} -> ${res.status}`);
    }
    // Static path: the SPA fallback may answer 200 with HTML; what matters is that the file is never served.
    const direct = await ctx.web.request("GET", "/.ktx-ui/security.sqlite", { cookie: owner });
    bodies.push(direct.text);
    checks.expect("deny", !isSqlite(direct.text) && (explicitDeny(direct) || /html/i.test(direct.headers["content-type"] ?? "")), `/.ktx-ui/security.sqlite -> ${direct.status} ${direct.headers["content-type"] ?? ""}`);
    checks.expect("deny", bodies.every((b) => !isSqlite(b)), "no response carries a SQLite file header");
    return checks.result();
  },

  "SEC-18-V01": async (ctx) => {
    const checks = new Checks();
    const owner = await ctx.ownerCookie();
    const operator = await ctx.operatorCookie();
    const write = (cookie, key) =>
      ctx.web.request("POST", "/api/wiki/upload/commit", { cookie, body: { key, markdown: `---\nsummary: attribution\nallowed_roles: [finance_reader]\n---\n# ${key}\n` } });
    const [a, b] = [await write(owner, "e2e-audit/by-owner.md"), await write(operator, "e2e-audit/by-operator.md")];
    checks.expect("audit_event", a.status === 200 && b.status === 200, `both writes accepted (${a.status}/${b.status})`);
    const audit = await ctx.adminCall(owner, "GET", "/api/admin/config-audit?limit=100");
    const entries = audit.json?.data?.entries ?? audit.json?.data?.items ?? [];
    const find = (needle) => entries.find((e) => JSON.stringify(e).includes(needle));
    const byOwner = find("by-owner");
    const byOperator = find("by-operator");
    checks.expect("audit_event", (byOwner?.actor ?? byOwner?.actorId) === ctx.adminCreds.owner.adminId, `owner write attributed to ${byOwner?.actor ?? "(missing)"}`);
    checks.expect("audit_event", (byOperator?.actor ?? byOperator?.actorId) === ctx.adminCreds.operator.adminId, `operator write attributed to ${byOperator?.actor ?? "(missing)"}`);
    checks.expect("consistency", (byOwner?.actor ?? "") !== (byOperator?.actor ?? ""), "the two administrators are distinguishable");
    return checks.result();
  },

  "SEC-18-V03": async (ctx) => {
    const checks = new Checks();
    const operator = await ctx.operatorCookie();
    const res = await ctx.web.request("POST", "/api/wiki/upload/commit", {
      cookie: operator,
      headers: {
        "user-agent": `Spoof/9.9 (acting as ${ctx.adminCreds.owner.adminId})`,
        "x-forwarded-for": "203.0.113.9",
        "x-real-ip": "203.0.113.9",
        "x-lucy-actor": ctx.adminCreds.owner.adminId
      },
      body: { key: "e2e-audit/spoof-headers.md", markdown: "---\nsummary: spoof\nallowed_roles: [finance_reader]\n---\n# spoof headers\n" }
    });
    checks.expect("audit_event", res.status === 200, `write with forged headers -> ${res.status}`);
    // actor_ip is stored but not exposed by the admin API, so the checker reads the run's audit database
    // directly (read-only, control plane) to see what was recorded.
    const db = new DatabaseSync(path.join(ctx.run.paths.project, ".ktx-ui", "audit.sqlite"), { readOnly: true });
    let entry;
    try {
      entry = db.prepare("SELECT actor, actor_ip FROM config_change_log WHERE file_path LIKE ? ORDER BY id DESC LIMIT 1").get("%spoof-headers%");
    } finally {
      db.close();
    }
    checks.expect("deny", entry?.actor === ctx.adminCreds.operator.adminId, `trusted actor stays ${entry?.actor ?? "(missing)"}`);
    const ip = entry?.actor_ip ?? "";
    checks.expect("deny", /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(ip), `recorded peer is the socket address (${ip || "missing"}), not the forwarded one`);
    checks.expect("audit_event", Boolean(entry), "an audit entry exists for the write");
    return checks.result();
  }
};
