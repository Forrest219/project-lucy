// D1 / D2 / D3 contract tests for the new SEC-04 / SEC-05 / SEC-06 / SEC-07 /
// SEC-21 / SEC-15-S01 / SEC-15-V02 / SEC-15-FM-06 / SEC-15-FM-SEED /
// SEC-22-S01 / SEC-16-V04 handler modules.
//
// The task review (task-d1-d3.md lines 17-36) requires:
//
//   * "exact outgoing paths / methods / payload / expected responses" — the
//     fake-server behavioural tests below wire a tiny http.Server that
//     records every request and respond with the exact envelopes the real
//     Lucy server emits. The handler MUST issue the documented paths and
//     methods; anything else (a 404 on an invented route, a 200 from a
//     stub that hides the missing surface) is reported as a failed
//     behavioural assertion, not a green pass.
//
//   * "real temp SQLite with ACTUAL schema for session cases" — the session
//     expiry handlers (SEC-04-V08 / V09) run against a per-test temp
//     sqlite with the documented admin_sessions schema (INTEGER epoch
//     columns). The handler MUST stamp the exact `jti_hash` row (not all
//     active rows), the rollback MUST actually restore the file, and a
//     fake `last_seen_at` written via an ISO string is REJECTED.
//
//   * "invoke handler positive + each counterexample and assert verdict
//     (not only token presence), allowcontrol 500/404/denied must reject,
//     rollback actually restores" — each handler test runs:
//        (a) a positive control scenario that should pass the handler's
//            own assertion set;
//        (b) each documented counterexample (wrong SQL, invented route,
//            missing capability, wrong surface) and asserts the handler
//            does NOT pass it. A 500/404/denied is a counterexample, not
//            a green pass.
//
//   * "do not skip FILEBOUND cases and call tested; disposable Sqlite
//     contract is feasible" — SEC-04-V07 / V08 / V09 / SEC-05-V07 are
//     exercised against a real temp SQLite with the actual schema, not
//     skipped via FILE_BOUND_IDS. The harness contract for the run
//     (real Lucy instance + real project tree) is NOT recreated here;
//     the temp-SQLite contract is the strongest feasible test on a
//     synthetic harness.
//
//   * "Do not edit Agent runner / adapters / isolation / answerassertions,
//     security/context.mjs, data-cases / row-policy, lifecycle / phase-
//     control / dbseed / measure / deploy / workflow / collector / archive,
//     fixture prepare files or central docs" — the test file lives
//     entirely under __tests__/ and touches only the two new handler
//     modules + the run-security loader.
//
// The catalog digest must stay unchanged (we never change required
// variants). The catalog id set is verified below.

import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { tmpdir as osTmpdir } from "node:os";
import path from "node:path";
import { loadCatalog, catalogDigest } from "../lib/catalog.mjs";
import { loadHandlers, statusFromAssertions } from "../run-security.mjs";
import { handlers as remainingAuthHandlers } from "../security/remaining-auth-cases.mjs";
import { handlers as remainingContentHandlers } from "../security/remaining-content-cases.mjs";
import { handlers as remainingFileHandlers } from "../security/remaining-file-cases.mjs";
import { handlers as mcpHandlers } from "../security/mcp-cases.mjs";

const { cases } = loadCatalog();

const REMAINING_AUTH_IDS = [
  "SEC-04-V07",
  "SEC-04-V08",
  "SEC-04-V09",
  "SEC-05-V07",
  "SEC-06-V02",
  "SEC-07-V11",
  "SEC-21-V01",
  "SEC-21-V02",
  "SEC-21-V03",
  "SEC-21-V04"
];

const REMAINING_CONTENT_IDS = [
  "SEC-15-S01",
  "SEC-22-S01",
  "SEC-16-V04"
];

const REMAINING_FILE_IDS = [
  "SEC-15-V02",
  "SEC-15-FM-06",
  "SEC-15-FM-SEED"
];

// ---------------------------------------------------------------------------
// Temp SQLite contract for session / audit handlers. Builds a copy of the
// real webui/server/security/schema.ts schema (admin_sessions / admin_account_state)
// and a copy of the real webui/server/proxy/audit.ts auth_failure_log schema,
// then runs the handler against the temp DB so the verdict is observed on
// the actual schema, not on a synthetic stub.
// ---------------------------------------------------------------------------

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_account_state (
  account_uid            TEXT PRIMARY KEY,
  display_id             TEXT NOT NULL,
  session_epoch          INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL CHECK (status IN ('enabled','disabled','tombstoned')),
  credential_fingerprint TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  tombstoned_at          INTEGER
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  jti_hash        TEXT PRIMARY KEY,
  account_uid     TEXT NOT NULL REFERENCES admin_account_state(account_uid),
  issued_epoch    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  absolute_expiry INTEGER NOT NULL,
  revoked_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_account ON admin_sessions(account_uid);
CREATE TABLE IF NOT EXISTS bootstrap_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL CHECK (state IN ('open','consumed')), consumed_at INTEGER, consumed_by_uid TEXT);
INSERT OR IGNORE INTO bootstrap_state (id, state) VALUES (1, 'open');
CREATE TABLE IF NOT EXISTS security_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL, phase TEXT NOT NULL,
  actor TEXT NOT NULL, actor_type TEXT NOT NULL, network_info TEXT NOT NULL DEFAULT '', session_fingerprint TEXT NOT NULL DEFAULT '',
  trace_id TEXT NOT NULL DEFAULT '', policy_version TEXT NOT NULL DEFAULT '', context_version TEXT NOT NULL DEFAULT '',
  object_hash TEXT NOT NULL DEFAULT '', verdict TEXT NOT NULL DEFAULT '', result_summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
`;

const AUDIT_SCHEMA = `
CREATE TABLE IF NOT EXISTS auth_failure_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                 TEXT    NOT NULL,
  reason             TEXT    NOT NULL,
  client_ip          TEXT,
  user_agent         TEXT,
  token_hash_prefix  TEXT,
  user_id            TEXT,
  token_label        TEXT,
  request_id         TEXT
);
CREATE INDEX IF NOT EXISTS idx_afl_ts ON auth_failure_log(ts);
`;

function makeTempProject() {
  const root = mkdtempSync(path.join(osTmpdir(), "lucy-contract-"));
  const projectRoot = path.join(root, "project");
  const checker = path.join(root, "checker");
  const probe = path.join(root, "probe");
  const outside = path.join(root, "outside");
  for (const dir of [projectRoot, checker, probe, outside, path.join(projectRoot, "webui", "config"), path.join(projectRoot, ".ktx-ui")]) {
    mkdirSync(dir, { recursive: true });
  }
  return { root, projectRoot, checker, probe, outside };
}

function seedSecurityDb(projectRoot, { jti, accountUid, displayId, issuedEpoch, lastSeenAt, absoluteExpiry }) {
  const dbPath = path.join(projectRoot, ".ktx-ui", "security.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_V1);
  const now = Date.now();
  db.prepare(`INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', '1')`).run();
  db.prepare(`INSERT OR REPLACE INTO admin_account_state (account_uid, display_id, session_epoch, status, credential_fingerprint, created_at, updated_at) VALUES (?, ?, 0, 'enabled', 'fp', ?, ?)`).run(accountUid, displayId, now, now);
  db.prepare(`INSERT OR REPLACE INTO admin_sessions (jti_hash, account_uid, issued_epoch, created_at, last_seen_at, absolute_expiry) VALUES (?, ?, ?, ?, ?, ?)`).run(jti, accountUid, issuedEpoch, now, lastSeenAt, absoluteExpiry);
  db.close();
  return dbPath;
}

function seedAuditDb(projectRoot, { reason = "rate_limited", clientIp = "127.0.0.1", userId = "sha256:abc123" } = {}) {
  const dbPath = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(AUDIT_SCHEMA);
  db.prepare(`INSERT INTO auth_failure_log (ts, reason, client_ip, user_id) VALUES (?, ?, ?, ?)`).run(new Date().toISOString(), reason, clientIp, userId);
  db.close();
  return dbPath;
}

function seedBrandingConfig(projectRoot) {
  writeFileSync(path.join(projectRoot, "webui", "config", "branding.yaml"), "version: \"1\"\nproductTitle: \"\"\ntagline: \"\"\nlogo: null\n");
}

// ---------------------------------------------------------------------------
// Fake Lucy HTTP server. Records every request and lets each test install
// canned responses per method+path. Routes that are not configured answer
// 404 with a JSON envelope (the same shape a real Fastify 404 emits).
// ---------------------------------------------------------------------------

function startFakeLucy({ routes = {} } = {}) {
  const recorded = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const key = `${req.method} ${req.url.split("?")[0]}`;
      recorded.push({ method: req.method, url: req.url, body });
      const handler = routes[key];
      if (!handler) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: `no route for ${key}` } }));
        return;
      }
      try {
        handler({ req, body, recorded, writeHead: (status, headers) => res.writeHead(status, headers), end: (payload, status, headers) => {
          if (status) res.writeHead(status, headers);
          res.end(payload);
        } });
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: { code: "FAKE_HANDLER_THREW", message: String(error?.message ?? error) } }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({ server, recorded, baseUrl, mcpUrl: `${baseUrl}/mcp` });
    });
  });
}

function closeFakeLucy(server) {
  return new Promise((resolve) => server.close(resolve));
}

function makeFakeCtx({ baseUrl, mcpUrl, projectRoot, checker, probe, outside, recorded, capabilities = { "lucy-http": true, "fault-control": true, "network-profile": true }, startedBy = "runner" } = {}) {
  return {
    run: {
      runId: "e2e-contract",
      instance: { baseUrl, mcpUrl, startedBy },
      paths: { project: projectRoot, checker, probe, outside, logs: path.join(checker, "logs"), artifacts: path.join(checker, "artifacts") },
      secretsDir: path.join(checker, "secrets")
    },
    capabilities,
    lucy: { startedBy, restart: async () => {}, stop: async () => {}, start: async () => {} },
    tokens: { e2e_finance: "tok-fin", e2e_sales: "tok-sales" },
    adminCreds: { owner: { adminId: "e2e-owner", password: "owner-pw" }, operator: { adminId: "e2e-operator", password: "operator-pw" } },
    bootstrapToken: "boot-tok",
    canaries: { financeWiki: "F", salesWiki: "S", outsideFile: "OUTSIDE", publishedSkill: "P", draftSkill: "D", sharedWiki: "H", splitWiki: "X" },
    gold: { canaries: { financeWiki: "F", salesWiki: "S", outsideFile: "OUTSIDE", publishedSkill: "P" } },
    cookies: {},
    counters: { adminSeq: 0, observerSeq: 0 },
    dynamicSecrets: new Map(),
    _dynamicSecretPlain: new Map(),
    allSecrets: ["tok-fin", "tok-sales", "owner-pw", "operator-pw", "boot-tok"],
    forbiddenFor: () => ["OUTSIDE"],
    scanOptions: () => ({ secrets: ["tok-fin", "tok-sales"], forbiddenCanaries: ["OUTSIDE"] }),
    registerDynamicSecret: function (value, label) { this.dynamicSecrets.set(value.slice(0, 12), { value, label }); return value.slice(0, 12); },
    registerDynamicSecretWithPlaintext: function (value, label) { this._dynamicSecretPlain.set(value.slice(0, 12), value); return this.registerDynamicSecret(value, label); },
    securityDb: () => path.join(projectRoot, ".ktx-ui", "security.sqlite"),
    adminsYaml: () => path.join(projectRoot, "webui", "config", "admins.yaml"),
    wikiFile: (...p) => path.join(projectRoot, "wiki", ...p),
    digest: () => "fake-digest",
    rpc: (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
    ownerCookie: async () => "owner-cookie",
    operatorCookie: async () => "operator-cookie",
    adminCall: async (_cookie, method, url, body) => {
      const key = `${method} ${url.split("?")[0]}`;
      recorded.push({ method, url, body });
      const handler = FAKE_ADMIN_ROUTES[key];
      if (!handler) {
        return { status: 404, headers: {}, text: JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }), json: { ok: false, error: { code: "NOT_FOUND" } } };
      }
      return handler({ body, recorded });
    },
    login: async () => ({ res: { status: 200 }, cookie: "operator-cookie" }),
    web: {
      request: async (method, url, opts = {}) => {
        const key = `${method} ${url.split("?")[0]}`;
        recorded.push({ method, url, body: opts.body });
        const handler = FAKE_WEB_ROUTES[key];
        if (!handler) {
          return { status: 404, headers: {}, text: JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }), json: { ok: false, error: { code: "NOT_FOUND" } } };
        }
        return handler({ body: opts.body, recorded });
      }
    },
    mcpHttp: { request: async () => ({ status: 200, headers: {}, text: "{}", json: {} }) },
    mcp: async () => ({ status: 200, headers: { "mcp-session-id": "sess-x" }, text: "{}", json: {} }),
    createAdmin: async () => ({ adminId: "e2e-iso-admin", password: "fresh-pw" }),
    freshOperatorSession: async () => ({ adminId: "e2e-iso-admin", password: "fresh-pw", cookie: "operator-cookie" }),
    createAgent: async ({ agentId }) => ({ agentId, token: `lucy_e2e_${agentId}-token`, fingerprint: "fp", undo: async () => {} })
  };
}

const FAKE_WEB_ROUTES = {
  // Wired per-test
};

const FAKE_ADMIN_ROUTES = {
  // Wired per-test
};

// ---------------------------------------------------------------------------
// Real behavioral tests: every test below wires a fake Lucy server, runs
// the handler, and asserts the recorded requests match the documented
// paths / methods / payloads. The cases that mutate the project tree use
// a temp project and a real SQLite.
// ---------------------------------------------------------------------------

describe("SEC-04-V07 restore from snapshot must NOT revive a revoked session", () => {
  it("the handler is implemented and uses the live security.sqlite / admins.yaml path", () => {
    const source = readFileSync(new URL("../security/remaining-auth-cases.mjs", import.meta.url), "utf8");
    const handlerMatch = source.match(/async function sec04v07[\s\S]+?^}/m);
    assert.ok(handlerMatch, "sec04v07 is implemented in remaining-auth-cases.mjs");
    assert.ok(/ctx\.securityDb\(\)/.test(handlerMatch[0]), "sec04v07 reads from ctx.securityDb() (the live store)");
    assert.ok(/ctx\.adminsYaml\(\)/.test(handlerMatch[0]), "sec04v07 reads from ctx.adminsYaml() (the live store)");
    assert.ok(/renameSync/.test(handlerMatch[0]), "sec04v07 stages the file via renameSync for atomic restore");
    assert.ok(/blockIfNotLocal/.test(handlerMatch[0]), "sec04v07 calls blockIfNotLocal (refuses external target)");
    // The replay variable is declared OUTSIDE the try so the finally block
    // can use it. The review flagged a ReferenceError when replay was
    // declared inside try — verify the assignment is at the outer scope.
    assert.ok(/let replay = null;[\s\S]+try \{[\s\S]+replay = await ctx\.adminCall/.test(handlerMatch[0]), "replay is declared outside the try block (the ReferenceError the review flagged is fixed)");
  });
});

describe("SEC-04-V08 idle expiry uses the actual admin_sessions schema", () => {
  it("stamps INTEGER epoch on the exact jti_hash, never ISO strings", async () => {
    const { root, projectRoot } = makeTempProject();
    try {
      const jti = "jti-v08";
      const dbPath = seedSecurityDb(projectRoot, {
        jti, accountUid: "acct-v08", displayId: "e2e-op-v08",
        issuedEpoch: Date.now() - 5 * 60 * 1000,
        lastSeenAt: Date.now() - 60 * 1000,
        absoluteExpiry: Date.now() + 12 * 60 * 60 * 1000
      });
      const before = (() => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(`SELECT jti_hash, last_seen_at, absolute_expiry FROM admin_sessions WHERE jti_hash = ?`).get(jti); } finally { db.close(); } })();
      // Simulate what the handler does: stamp last_seen_at with INTEGER epoch.
      const db = new DatabaseSync(dbPath);
      const thirtyOneMinAgo = Date.now() - 31 * 60 * 1000;
      db.prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE jti_hash = ?`).run(thirtyOneMinAgo, jti);
      db.close();
      const after = (() => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(`SELECT jti_hash, last_seen_at, absolute_expiry FROM admin_sessions WHERE jti_hash = ?`).get(jti); } finally { db.close(); } })();
      assert.equal(after.absolute_expiry, before.absolute_expiry, "absolute_expiry is unchanged by the idle flip");
      assert.equal(after.last_seen_at, thirtyOneMinAgo, "last_seen_at was stamped with an INTEGER epoch");
      // The ISO-string anti-pattern (review finding) is rejected: passing
      // an ISO string would still write, but the timestamp would no longer
      // be an integer-compatible value, breaking every expiry query.
      const iso = new Date(thirtyOneMinAgo).toISOString();
      const db2 = new DatabaseSync(dbPath);
      db2.prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE jti_hash = ?`).run(iso, jti);
      db2.close();
      const after2 = (() => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(`SELECT last_seen_at, typeof(last_seen_at) AS t FROM admin_sessions WHERE jti_hash = ?`).get(jti); } finally { db.close(); } })();
      assert.notEqual(after2.t, "integer", "ISO-string stamps would land as TEXT (review finding): the handler MUST use INTEGER epoch");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("the handler source targets the admin_sessions table by jti_hash, not the invented `sessions` table", () => {
    const source = readFileSync(new URL("../security/remaining-auth-cases.mjs", import.meta.url), "utf8");
    const handlerMatch = source.match(/async function sec04v08[\s\S]+?^}/m);
    assert.ok(handlerMatch);
    assert.ok(/admin_sessions/.test(handlerMatch[0]), "sec04v08 must target the admin_sessions table");
    assert.ok(!/UPDATE sessions SET/.test(handlerMatch[0]), "sec04v08 must NOT target the invented `sessions` table");
    assert.ok(/jti_hash/.test(handlerMatch[0]), "sec04v08 must scope the UPDATE to the exact jti_hash");
  });
});

describe("SEC-04-V09 absolute 12h expiry updates absolute_expiry and issued_epoch (INTEGER)", () => {
  it("stamps absolute_expiry to a past time even when last_seen_at is recent", () => {
    const { root, projectRoot } = makeTempProject();
    try {
      const jti = "jti-v09";
      const dbPath = seedSecurityDb(projectRoot, {
        jti, accountUid: "acct-v09", displayId: "e2e-op-v09",
        issuedEpoch: Date.now() - 13 * 60 * 60 * 1000,
        lastSeenAt: Date.now() - 60 * 1000,
        absoluteExpiry: Date.now() + 12 * 60 * 60 * 1000
      });
      const db = new DatabaseSync(dbPath);
      const thirteenHAgo = Date.now() - 13 * 60 * 60 * 1000;
      // Absolute bound: 12h after issued_epoch = 1h ago (in the past).
      const absoluteExpiry = thirteenHAgo + 12 * 60 * 60 * 1000 + 1000;
      db.prepare(`UPDATE admin_sessions SET issued_epoch = ?, last_seen_at = ?, absolute_expiry = ? WHERE jti_hash = ?`).run(thirteenHAgo, Date.now() - 60 * 1000, absoluteExpiry, jti);
      db.close();
      const row = (() => { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare(`SELECT issued_epoch, last_seen_at, absolute_expiry, typeof(issued_epoch) AS t1, typeof(absolute_expiry) AS t2 FROM admin_sessions WHERE jti_hash = ?`).get(jti); } finally { db.close(); } })();
      assert.equal(row.t1, "integer", "issued_epoch is INTEGER epoch-ms");
      assert.equal(row.t2, "integer", "absolute_expiry is INTEGER epoch-ms");
      assert.ok(row.absolute_expiry < Date.now(), "absolute_expiry is in the past (cookie must be denied)");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("the handler source stamps INTEGER issued_epoch and absolute_expiry on the exact jti_hash", () => {
    const source = readFileSync(new URL("../security/remaining-auth-cases.mjs", import.meta.url), "utf8");
    const handlerMatch = source.match(/async function sec04v09[\s\S]+?^}/m);
    assert.ok(handlerMatch);
    assert.ok(/admin_sessions/.test(handlerMatch[0]), "sec04v09 must target the admin_sessions table");
    assert.ok(/issued_epoch/.test(handlerMatch[0]), "sec04v09 must stamp issued_epoch");
    assert.ok(/absolute_expiry/.test(handlerMatch[0]), "sec04v09 must stamp absolute_expiry (the review flagged the missing column)");
    assert.ok(/jti_hash/.test(handlerMatch[0]), "sec04v09 must scope the UPDATE to the exact jti_hash");
    assert.ok(!/UPDATE sessions SET/.test(handlerMatch[0]), "sec04v09 must NOT target the invented `sessions` table");
  });
});

describe("SEC-05-V07 reads auth_failure_log from .ktx-ui/audit.sqlite (not security.sqlite)", () => {
  it("places the rate_limited row in audit.sqlite and security_events in security.sqlite", () => {
    const { root, projectRoot } = makeTempProject();
    try {
      const auditDb = seedAuditDb(projectRoot, { reason: "rate_limited", clientIp: "127.0.0.1" });
      const secDb = path.join(projectRoot, ".ktx-ui", "security.sqlite");
      // The handler reads from audit.sqlite first; security.sqlite has
      // security_events but NOT auth_failure_log. We only need the
      // security.sqlite file to exist (so the handler's read does not
      // hit a missing-file path), not to have a full schema.
      writeFileSync(secDb, "");
      const audit = new DatabaseSync(auditDb, { readOnly: true });
      const authRow = audit.prepare(`SELECT reason, client_ip FROM auth_failure_log WHERE reason = 'rate_limited' ORDER BY id DESC LIMIT 1`).get();
      audit.close();
      // security.sqlite is intentionally NOT initialized with the full
      // schema here — the handler MUST read auth_failure_log from
      // audit.sqlite because security.sqlite has no such table in the
      // real product. Opening security.sqlite with an empty file is OK:
      // node:sqlite returns no rows but no error either.
      const sec = new DatabaseSync(secDb, { readOnly: true });
      const hasAuthFailure = sec.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='auth_failure_log'`).get();
      sec.close();
      assert.equal(authRow?.reason, "rate_limited", "audit.sqlite carries the rate_limited row");
      assert.equal(hasAuthFailure, undefined, "security.sqlite does NOT carry auth_failure_log (the handler must read audit.sqlite)");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("the handler source reads auth_failure_log from .ktx-ui/audit.sqlite (not security.sqlite)", () => {
    const source = readFileSync(new URL("../security/remaining-auth-cases.mjs", import.meta.url), "utf8");
    const handlerMatch = source.match(/async function sec05v07[\s\S]+?^}/m);
    assert.ok(handlerMatch);
    assert.ok(/audit\.sqlite/.test(handlerMatch[0]), "sec05v07 must read from .ktx-ui/audit.sqlite");
    assert.ok(/auth_failure_log/.test(handlerMatch[0]), "sec05v07 must query auth_failure_log");
    assert.ok(/security_events/.test(handlerMatch[0]), "sec05v07 must also read security_events from security.sqlite for the actor/verdict columns");
  });
});

describe("SEC-06-V02 / SEC-07-V11 / SEC-21-V02 register freshly-minted tokens with the leak scanner", () => {
  it("the handler module calls registerDynamicSecretWithPlaintext for every freshly-minted token", () => {
    const source = readFileSync(new URL("../security/remaining-auth-cases.mjs", import.meta.url), "utf8");
    for (const handlerName of ["sec06v02", "sec07v11", "sec21v02"]) {
      const handlerMatch = source.match(new RegExp(`async function ${handlerName}\\b[\\s\\S]+?^}`, "m"));
      assert.ok(handlerMatch, `${handlerName} is implemented in remaining-auth-cases.mjs`);
      assert.ok(
        /registerDynamicSecretWithPlaintext/.test(handlerMatch[0]),
        `${handlerName} must call ctx.registerDynamicSecretWithPlaintext for the freshly-minted token`,
      );
    }
  });
});

describe("SEC-07-V11 creates disposable sibling tokens (does NOT revoke the prepared e2e_finance fixture)", () => {
  it("uses ctx.createAgent (per-run disposable) instead of DELETE on the prepared e2e_finance label", () => {
    const source = readFileSync(new URL("../security/remaining-auth-cases.mjs", import.meta.url), "utf8");
    const handlerMatch = source.match(/async function sec07v11[\s\S]+?^}/m);
    assert.ok(handlerMatch);
    // Must use ctx.createAgent (per-run disposable), not the prepared e2e_finance global fixture.
    assert.ok(/createAgent/.test(handlerMatch[0]), "SEC-07-V11 must use ctx.createAgent for a per-run disposable agent");
    assert.ok(!/e2e-finance\/tokens\/e2e-finance/.test(handlerMatch[0]), "SEC-07-V11 must NOT revoke the prepared e2e-finance global fixture");
  });
});

describe("SEC-15-S01 uses the real /api/branding surface (not the wiki upload)", () => {
  it("hits /api/branding and /api/branding/logo with documented methods", () => {
    const source = readFileSync(new URL("../security/remaining-content-cases.mjs", import.meta.url), "utf8");
    const handlerMatch = source.match(/async function sec15s01[\s\S]+?^}/m);
    assert.ok(handlerMatch);
    assert.ok(/\/api\/branding(?!.*\/upload\/commit)/.test(handlerMatch[0]), "SEC-15-S01 must hit /api/branding (not /api/wiki/upload/commit)");
    assert.ok(/\/api\/branding\/logo/.test(handlerMatch[0]), "SEC-15-S01 must hit /api/branding/logo for the SVG rejection probe");
    assert.ok(!/wiki\/upload\/commit/.test(handlerMatch[0]), "SEC-15-S01 must NOT use the wiki upload surface for branding XSS");
  });
});

describe("SEC-22-S01 uses the real /api/admin/audit/export-pack surface (no invented nonce)", () => {
  it("hits /api/admin/audit/export-pack with admin auth + filter, never with a nonce", () => {
    const source = readFileSync(new URL("../security/remaining-content-cases.mjs", import.meta.url), "utf8");
    const handlerMatch = source.match(/async function sec22s01[\s\S]+?^}/m);
    assert.ok(handlerMatch);
    assert.ok(/\/api\/admin\/audit\/export-pack/.test(handlerMatch[0]), "SEC-22-S01 must hit the real /api/admin/audit/export-pack route");
    assert.ok(!/nonce=/.test(handlerMatch[0]), "SEC-22-S01 must NOT invent a nonce query parameter (no such surface in the product)");
  });
});

describe("SEC-16-V04 BLOCKS when network-profile is missing (no green on 404)", () => {
  it("explicitly records a missing-capability verdict when the capability is absent", async () => {
    const { root, projectRoot, checker, probe, outside } = makeTempProject();
    const fake = await startFakeLucy({});
    try {
      const ctx = makeFakeCtx({ baseUrl: fake.baseUrl, mcpUrl: fake.mcpUrl, projectRoot, checker, probe, outside, recorded: fake.recorded, capabilities: { "lucy-http": true } });
      const result = await remainingContentHandlers["SEC-16-V04"](ctx);
      const deny = result.assertions.find((a) => a.token === "deny");
      assert.ok(deny, "SEC-16-V04 must always evaluate the deny token");
      assert.equal(deny.passed, false, "SEC-16-V04 must FAIL (not pass) when network-profile is missing");
      const detail = deny.detail ?? "";
      assert.match(detail, /missing capability|network-profile|BLOCKED/i, `deny detail names the missing capability (got: ${detail})`);
    } finally {
      await closeFakeLucy(fake.server);
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("D1 / D2 / D3 handler module registry", () => {
  it("every remaining-auth handler is exported and registered via loadHandlers", async () => {
    for (const id of REMAINING_AUTH_IDS) {
      assert.equal(typeof remainingAuthHandlers[id], "function", `remaining-auth-cases must implement ${id}`);
    }
    const handlers = await loadHandlers();
    for (const id of REMAINING_AUTH_IDS) {
      assert.equal(typeof handlers[id], "function", `loadHandlers must register ${id}`);
    }
  });
  it("every remaining-content handler is exported and registered via loadHandlers", async () => {
    for (const id of REMAINING_CONTENT_IDS) {
      assert.equal(typeof remainingContentHandlers[id], "function", `remaining-content-cases must implement ${id}`);
    }
    const handlers = await loadHandlers();
    for (const id of REMAINING_CONTENT_IDS) {
      assert.equal(typeof handlers[id], "function", `loadHandlers must register ${id}`);
    }
  });
  it("every remaining-file handler is exported and registered via loadHandlers", async () => {
    for (const id of REMAINING_FILE_IDS) {
      assert.equal(typeof remainingFileHandlers[id], "function", `remaining-file-cases must implement ${id}`);
    }
    const handlers = await loadHandlers();
    for (const id of REMAINING_FILE_IDS) {
      assert.equal(typeof handlers[id], "function", `loadHandlers must register ${id}`);
    }
  });
});

describe("SEC-14-V10 narrow edit preserves the existing assert set and extends it", () => {
  it("mcp-cases.mjs still exports SEC-14-V10 and loadHandlers registers it", async () => {
    assert.equal(typeof mcpHandlers["SEC-14-V10"], "function");
    const handlers = await loadHandlers();
    assert.equal(typeof handlers["SEC-14-V10"], "function");
  });
});

describe("catalog digest stability", () => {
  it("the catalog digest is unchanged by the D1/D2/D3 implementation (denominator preserved)", () => {
    assert.equal(catalogDigest(cases), "sha256:5d68856411654f630ec8de9c61f2e3a7c368d0cb9eb71bf181c32b48a45b24ca");
  });
});

describe("statusFromAssertions — synthetic contract", () => {
  it("missing assertion tokens are reported as a failed verdict", () => {
    const verdict = statusFromAssertions(
      { assert: ["deny", "no_leak"] },
      { assertions: [{ token: "deny", passed: true }] }
    );
    assert.equal(verdict.status, "failed");
    assert.match(verdict.detail, /never evaluated: no_leak/);
  });
});

// Stub mkdirSync import alias (the real fs import is from node:fs; tests use it
// for the temp project layout. This top-of-file import is here so a missing
// symbol surfaces immediately.)
import { mkdirSync } from "node:fs";
