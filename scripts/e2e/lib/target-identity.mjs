// Target identity verification for an external (K8s) Lucy instance (Spec §6.2, §6.5, §8.3).
//
// Every check here consumes only what the WebUI server actually publishes:
//   - /api/health          public, ktxRuntime.ready / policy.healthy / execution.status / lucyVersion
//   - /api/auth/status      public, mode (bootstrap|required|open|unavailable) and authEnabled
//   - /api/wiki/<key>       requires a valid session; returns { data: { content, frontmatter, … } }
//
// The /api/health response does NOT carry an image digest or a deployed-instance marker. The image
// digest is measured by the K8s deploy step and written to <runDir>/results/deployment.json
// (lucy-deployment-v1 contract; see scripts/gates/k8s-gate-lib.sh::write_deployment_evidence). It
// is the ONLY authoritative source for what is actually running; we read it from disk.
//
// The /api/wiki/:key endpoint requires authentication. The first run after a fresh install is in
// `bootstrap` mode and has no session yet. We therefore split the verification into two phases:
//   1. preflightVerify — public + unauthenticated: the actual producer's responses, no bootstrap
//      consumption, no auth. This proves the deployment is real, healthy, and reachable.
//   2. postflightVerify — authenticated: owner login first, then GET the marker via the same
//      public API every other case uses. Marker content is a small frontmatter + body whose only
//      authoritative tokens are run= and fixture=; the file does NOT carry instanceId, so we do
//      not invent a check for it.
//
// ExternalInstance.start() runs BOTH phases in order and fails closed on any problem. The
// orchestrator must refuse to start cases if either phase does not succeed.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { URL } from "node:url";

export const TARGET_IDENTITY_OK = "ok";
export const TARGET_IDENTITY_REFUSED = "refused";
export const TARGET_IDENTITY_MISSING = "missing_measurement";

/**
 * Default JSON-capable fetch wrapper. Uses Node's built-in `fetch` with an AbortSignal timeout.
 *
 * Returns the same shape the rest of the harness (and `LucyHttp.request`) use, so call sites that
 * read `res.cookie` see a parsed session cookie from the response's Set-Cookie. The cookie is
 * inferred from `getSetCookie()` (Node 22) and matches what `LucyHttp` already returns; an
 * unparseable Set-Cookie that yields no candidate is `null` rather than invented.
 */
export async function defaultFetchUrl(url, { method = "GET", headers = {}, body, timeoutMs = 10_000 } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const sessionCookie = setCookies.map((value) => value.split(";")[0]).find((value) => /^(?:lucy[_-]|__Host-lucy[_-])/i.test(value)) ?? null;
  return { status: response.status, text, json, headers: Object.fromEntries(response.headers.entries()), setCookies, cookie: sessionCookie, resolvedUrl: response.url ?? String(url) };
}

/**
 * Strict origin/authority comparison between two URLs.
 *
 * "Origin" is the WHATWG tuple: protocol + host + port + userinfo. Pathname is intentionally NOT
 * compared here — the path is part of the resource the caller asked for, not the authority the
 * caller trusted. Path-prefix and query preservation is the caller's responsibility (see
 * `LucyHttp.request`, which keeps the registered MCP URL's full pathname+query verbatim).
 *
 * We reject:
 *   - any non-http(s) scheme (a target cannot be a `file:`, `javascript:`, etc.);
 *   - credentials (userinfo) embedded in the URL — proxies must never carry a token in the URL;
 *   - any of protocol / host / port that differs from the registered reference;
 *   - backslash variants (`\\` instead of `//` smuggle past naive string checks in some
 *     proxies; we surface them as a known shape).
 *
 * The function never reads or follows redirects; the caller passes the URL it actually requested.
 *
 * @param {Object} args
 * @param {URL|string} args.registered  the URL the run was prepared with (e.g. `run.instance.baseUrl`)
 * @param {URL|string} args.actual      the URL the probe actually contacted (e.g. fetch's response.url)
 */
export function assertSameRegisteredOrigin({ registered, actual }) {
  const problems = [];
  if (registered === undefined || registered === null) { problems.push("registered URL is missing"); return { ok: false, problems }; }
  if (actual === undefined || actual === null) { problems.push("target URL is missing (the call did not produce a resolved URL)"); return { ok: false, problems }; }
  const regStr = typeof registered === "string" ? registered : registered.toString();
  const actStr = typeof actual === "string" ? actual : actual.toString();
  if (/\\/.test(regStr)) problems.push("registered URL contains a backslash (\\), which `new URL` may resolve as a forward slash on some runtimes");
  if (/\\/.test(actStr)) problems.push("target URL contains a backslash (\\)");
  let reg, act;
  try { reg = registered instanceof URL ? registered : new URL(regStr); } catch (error) { problems.push(`registered URL is not parseable: ${error?.message ?? String(error)}`); return { ok: false, problems }; }
  try { act = actual instanceof URL ? actual : new URL(actStr); } catch (error) { problems.push(`target URL is not parseable: ${error?.message ?? String(error)}`); return { ok: false, problems }; }
  if (!["http:", "https:"].includes(reg.protocol)) problems.push(`registered scheme is not http(s): ${reg.protocol}`);
  if (!["http:", "https:"].includes(act.protocol)) problems.push(`target scheme is not http(s): ${act.protocol}`);
  if (act.protocol !== reg.protocol) problems.push(`target protocol ${act.protocol} != registered ${reg.protocol}`);
  if (reg.username || reg.password) problems.push(`registered URL carries credentials (${reg.username || "?"}:***)`);
  if (act.username || act.password) problems.push(`target URL carries credentials (${act.username || "?"}:***)`);
  if (act.host !== reg.host) problems.push(`target host ${act.host} != registered host ${reg.host}`);
  return { ok: problems.length === 0, problems };
}

/**
 * Asserts the actual URL stays under the registered URL's authority and preserves the registered
 * URL's full pathname+search. Use this for MCP URL verification: the runner was told to drive
 * `https://lucy.example.com/lucy-v2/mcp?trace=1` and must end up calling exactly that resource
 * (same origin, same path+query).
 */
export function assertSameRegisteredEndpoint({ registered, actual }) {
  const problems = [];
  const origin = assertSameRegisteredOrigin({ registered, actual });
  for (const p of origin.problems) problems.push(p);
  if (origin.ok) {
    const reg = registered instanceof URL ? registered : new URL(String(registered));
    const act = actual instanceof URL ? actual : new URL(String(actual));
    if (act.pathname !== reg.pathname) problems.push(`target pathname ${act.pathname} != registered pathname ${reg.pathname}`);
    if (reg.search && reg.search !== act.search) problems.push(`target search ${act.search} != registered search ${reg.search}`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Catches scheme-relative URLs (`//other/...`) and credentials inside the `URL(string)` constructor
 * so a caller cannot smuggle a different host. The pattern matches anywhere in the input — even
 * mid-string — because `new URL("//other/path", baseUrl)` would happily use `other` as host.
 */
export function isSuspiciousUrlString(value) {
  if (typeof value !== "string") return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return true; // any scheme, including javascript:/mailto:/file:
  if (/^\/\//.test(value)) return true;
  if (/^[^/]*@/.test(value)) return true; // userinfo before authority
  return false;
}

/**
 * Reads the deployment evidence written by the K8s deploy step (lucy-deployment-v1 contract).
 * Returns `{ found, deployment, problems }`. Missing file is a missing measurement, not invented
 * success; the caller must BLOCK.
 *
 * The contract records TWO instance ids: `instanceId` is the physical Pod UID (independently
 * measured) and `logicalInstanceId` is the run's logical UUID (matches `run.instanceId`). B1's
 * target-identity check correlates both so an actual run cannot silently target a deployment
 * that was prepared for a different run.
 */
export function loadDeploymentEvidence(run) {
  const problems = [];
  const file = path.join(run.paths?.runDir ?? "", "results", "deployment.json");
  if (!existsSync(file)) return { found: false, deployment: null, problems: [`deployment evidence not found at ${file}`] };
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { found: true, deployment: null, problems: [`deployment evidence is not parseable JSON: ${error?.message ?? String(error)}`] };
  }
  if (doc?.contract !== "lucy-deployment-v1") problems.push(`deployment evidence contract is "${doc?.contract}", expected "lucy-deployment-v1"`);
  if (!doc?.deployedImageDigest) problems.push("deployment evidence missing deployedImageDigest");
  if (!doc?.instanceId) problems.push("deployment evidence missing instanceId (Pod UID)");
  if (!doc?.logicalInstanceId) problems.push("deployment evidence missing logicalInstanceId (the run's logical id)");
  if (doc?.logicalInstanceId && run?.instanceId && doc.logicalInstanceId !== run.instanceId) problems.push(`deployment evidence logicalInstanceId ${doc.logicalInstanceId} != run.instanceId ${run.instanceId}`);
  if (doc?.topology !== "single-replica-k8s") problems.push(`deployment evidence topology is "${doc?.topology}", expected "single-replica-k8s"`);
  return { found: true, deployment: doc, problems };
}

/**
 * Compares the deployment's measured image digest to the candidate bound to the run. The only
 * authoritative source is <runDir>/results/deployment.json (written by kubectl + write_deployment_evidence).
 */
export function verifyCandidateFingerprintFromDeployment({ run }) {
  if (!run.candidate?.imageDigest) {
    return { ok: false, problems: ["run.candidate.imageDigest is missing for a release-mode external run"], classification: TARGET_IDENTITY_MISSING };
  }
  const loaded = loadDeploymentEvidence(run);
  if (!loaded.found) return { ok: false, problems: loaded.problems, classification: TARGET_IDENTITY_MISSING };
  if (loaded.problems.length > 0) return { ok: false, problems: loaded.problems, classification: TARGET_IDENTITY_REFUSED };
  const expected = run.candidate.imageDigest;
  if (loaded.deployment.deployedImageDigest !== expected) {
    return {
      ok: false,
      classification: TARGET_IDENTITY_REFUSED,
      problems: [`measured digest ${loaded.deployment.deployedImageDigest} != candidate ${expected}`],
      detail: { expected, actual: loaded.deployment.deployedImageDigest, instanceId: loaded.deployment.instanceId, logicalInstanceId: loaded.deployment.logicalInstanceId }
    };
  }
  return { ok: true, problems: [], classification: TARGET_IDENTITY_OK, detail: { expected, actual: loaded.deployment.deployedImageDigest, instanceId: loaded.deployment.instanceId, logicalInstanceId: loaded.deployment.logicalInstanceId } };
}

/**
 * Verifies the target's /api/health endpoint. Only reads what the WebUI server actually emits
 * (webui/server/index.ts:657-697): status, lucyVersion, bundledKtxVersion, ktxRuntime.ready,
 * policy.healthy, execution.status. Required observations MUST be present; missing fields are
 * refused (not silently defaulted). We do NOT compare image digests here — that lives in
 * deployment.json.
 *
 * The function also confirms the resolved URL has the same origin+pathname as the registered
 * baseUrl; this is the real test that an HTTP call did not silently escape the registered
 * target (no self-comparison, no scheme-relative smuggling).
 */
export async function verifyHealth({ fetchUrl = defaultFetchUrl, baseUrl }) {
  const url = new URL("/api/health", baseUrl);
  let res;
  try {
    res = await fetchUrl(url, { headers: { accept: "application/json" } });
  } catch (error) {
    return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: [`health endpoint unreachable: ${error?.message ?? String(error)}`], detail: null };
  }
  if (res.status !== 200) return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: [`health endpoint returned HTTP ${res.status}`], detail: { status: res.status } };
  const origin = assertSameRegisteredOrigin({ registered: baseUrl, actual: res.resolvedUrl });
  const data = res.json?.data ?? res.json ?? {};
  const status = data?.status;
  const ktxReady = data?.ktxRuntime?.ready;
  const policyHealthy = data?.policy?.healthy;
  const executionStatus = data?.execution?.status;
  const problems = [];
  for (const p of origin.problems) problems.push(`health ${p}`);
  if (typeof status !== "string") problems.push("health response is missing the 'status' field (or it is not a string)");
  else if (status !== "ok") problems.push(`health status is "${status}" (expected "ok")`);
  if (typeof ktxReady !== "boolean") problems.push("health response is missing the 'ktxRuntime.ready' boolean");
  else if (ktxReady !== true) problems.push("KTX runtime is not ready");
  if (typeof policyHealthy !== "boolean") problems.push("health response is missing the 'policy.healthy' boolean");
  else if (policyHealthy !== true) problems.push("policy runtime reports unhealthy");
  if (typeof executionStatus !== "string") problems.push("health response is missing the 'execution.status' string");
  else if (["stale", "unavailable", "error"].includes(executionStatus)) problems.push(`execution runtime status is "${executionStatus}"`);
  return {
    ok: problems.length === 0,
    classification: problems.length === 0 ? TARGET_IDENTITY_OK : TARGET_IDENTITY_REFUSED,
    problems,
    detail: { status, ktxReady, policyHealthy, executionStatus, lucyVersion: data?.lucyVersion ?? null, resolvedUrl: res.resolvedUrl }
  };
}

const ALLOWED_AUTH_MODES = new Set(["bootstrap", "required", "open", "unavailable"]);

/**
 * Verifies /api/auth/status reports the deployment is actually enforcing auth (not `open`) and
 * the auth config is not `unavailable`. Missing required observations (`mode`, `authEnabled`)
 * are REFUSED, not silently defaulted. A `bootstrap` result is allowed by preflight (it does
 * not consume the token); postflight/login uses it to signal `needs-bootstrap` instead.
 */
export async function verifyAuthMode({ fetchUrl = defaultFetchUrl, baseUrl }) {
  const url = new URL("/api/auth/status", baseUrl);
  let res;
  try {
    res = await fetchUrl(url, { headers: { accept: "application/json" } });
  } catch (error) {
    return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: [`auth/status unreachable: ${error?.message ?? String(error)}`] };
  }
  if (res.status !== 200) return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: [`auth/status returned HTTP ${res.status}`] };
  const origin = assertSameRegisteredOrigin({ registered: baseUrl, actual: res.resolvedUrl });
  const data = res.json?.data ?? res.json ?? {};
  const mode = data?.mode;
  const authEnabled = data?.authEnabled;
  const problems = [];
  for (const p of origin.problems) problems.push(`auth/status ${p}`);
  if (typeof mode !== "string" || !ALLOWED_AUTH_MODES.has(mode)) problems.push(`auth/status mode is missing or unknown: ${JSON.stringify(mode)} (expected one of ${[...ALLOWED_AUTH_MODES].join(", ")})`);
  if (typeof authEnabled !== "boolean") problems.push("auth/status is missing the 'authEnabled' boolean");
  else if (authEnabled === false) problems.push("auth is disabled on the target");
  if (mode === "open") problems.push("auth mode is 'open' (deployment must enforce auth in release mode)");
  if (mode === "unavailable") problems.push("auth config is 'unavailable' on the target");
  return {
    ok: problems.length === 0,
    classification: problems.length === 0 ? TARGET_IDENTITY_OK : TARGET_IDENTITY_REFUSED,
    problems,
    detail: { mode, authEnabled }
  };
}

/**
 * Reads /api/auth/status and /api/health on the registered WEB URL (`run.instance.baseUrl`) without
 * authentication. Catches the deployment registration, basic health, and auth mode before any
 * state is consumed (no bootstrap token is sent). Fails closed on every problem.
 *
 * The top-level `classification` preserves the worst aspect's classification: a missing
 * `deployment.json` (missing_measurement) is NOT collapsed to refused.
 *
 * @param {Object} args
 * @param {Object} args.run        the run.json document
 * @param {Function} [args.fetchUrl]
 */
export async function preflightVerify({ run, fetchUrl = defaultFetchUrl }) {
  const problems = [];
  if (run.instance?.startedBy !== "external") {
    return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: [`run.instance.startedBy is "${run.instance?.startedBy}", expected "external"`], aspects: {} };
  }
  const webUrl = run.instance?.baseUrl;
  if (!webUrl) {
    return { ok: false, classification: TARGET_IDENTITY_MISSING, problems: ["run.instance.baseUrl is missing"], aspects: {} };
  }
  let regWeb, regMcp;
  try { regWeb = new URL(webUrl); } catch (error) { problems.push(`run.instance.baseUrl is not a valid URL: ${error?.message ?? String(error)}`); }
  try { regMcp = new URL(run.instance.mcpUrl); } catch (error) { problems.push(`run.instance.mcpUrl is not a valid URL: ${error?.message ?? String(error)}`); }
  if (problems.length > 0) return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems, aspects: {} };
  for (const url of [regWeb, regMcp]) {
    if (url.username || url.password) problems.push(`${url === regWeb ? "run.instance.baseUrl" : "run.instance.mcpUrl"} carries credentials`);
    if (!["http:", "https:"].includes(url.protocol)) problems.push(`${url === regWeb ? "baseUrl" : "mcpUrl"} protocol is ${url.protocol}, expected http(s)`);
  }
  if (problems.length > 0) return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems, aspects: {} };

  const aspects = {
    health: { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: ["not run"], detail: null },
    authMode: { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: ["not run"], detail: null },
    candidateFingerprint: verifyCandidateFingerprintFromDeployment({ run })
  };
  aspects.health = await verifyHealth({ fetchUrl, baseUrl: regWeb });
  aspects.authMode = await verifyAuthMode({ fetchUrl, baseUrl: regWeb });
  for (const aspect of [aspects.health, aspects.authMode, aspects.candidateFingerprint]) problems.push(...aspect.problems);
  const classification = problems.length === 0 ? TARGET_IDENTITY_OK : (aspects.candidateFingerprint.classification === TARGET_IDENTITY_MISSING || aspects.health.classification === TARGET_IDENTITY_MISSING || aspects.authMode.classification === TARGET_IDENTITY_MISSING ? TARGET_IDENTITY_MISSING : TARGET_IDENTITY_REFUSED);
  return {
    ok: problems.length === 0,
    classification,
    problems,
    aspects,
    registered: { webProtocol: regWeb.protocol, webHost: regWeb.host, webPathname: regWeb.pathname, webSearch: regWeb.search, mcpProtocol: regMcp.protocol, mcpHost: regMcp.host, mcpPathname: regMcp.pathname, mcpSearch: regMcp.search }
  };
}

/**
 * Logs in as the run's owner and reads the marker wiki page. Marker content is the run-scoped
 * `shared/e2e-instance-marker` page written by prepare-environment; its body carries `run=`,
 * `fixture=`, and `instance=` (logical instanceId). The page itself is NOT a secret — it is a
 * synthetic identity marker — but it sits behind /api/wiki which requires auth, so we must
 * authenticate.
 *
 * This function NEVER auto-bootstraps: if the target is in `bootstrap` mode it returns
 * `classification: "needs-bootstrap"` so the orchestrator (B2 UI bootstrap) can refuse and
 * the run is BLOCKED with an explicit dependency rather than silently consume the bootstrap
 * token. It expects the caller to have already validated the deployment via `preflightVerify`.
 */
export async function postflightVerify({ run, fetchUrl = defaultFetchUrl, login = defaultLogin }) {
  const problems = [];
  if (run.instance?.startedBy !== "external") {
    return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: [`run.instance.startedBy is "${run.instance?.startedBy}", expected "external"`], aspects: {} };
  }
  const webUrl = run.instance?.baseUrl;
  if (!webUrl) return { ok: false, classification: TARGET_IDENTITY_MISSING, problems: ["run.instance.baseUrl is missing"], aspects: {} };
  let regWeb;
  try { regWeb = new URL(webUrl); } catch (error) { return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: [`run.instance.baseUrl is not a valid URL: ${error?.message ?? String(error)}`], aspects: {} }; }
  const markerKey = run.instance?.markerWikiKey;
  if (!markerKey) {
    return { ok: false, classification: TARGET_IDENTITY_MISSING, problems: ["run.instance.markerWikiKey is missing"], aspects: {} };
  }

  const aspects = {
    ownerLogin: { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: ["not run"], detail: null },
    markerRead: { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: ["not run"], detail: null }
  };
  const cookie = await login({ webUrl: regWeb, run, fetchUrl });
  if (!cookie.ok) {
    aspects.ownerLogin = { ok: false, classification: cookie.classification === "needs-bootstrap" ? TARGET_IDENTITY_MISSING : TARGET_IDENTITY_REFUSED, problems: cookie.problems, detail: { mode: cookie.detail?.mode ?? null } };
    return { ok: false, classification: aspects.ownerLogin.classification, problems: cookie.problems, aspects };
  }
  aspects.ownerLogin = { ok: true, classification: TARGET_IDENTITY_OK, problems: [], detail: { mode: cookie.mode ?? null } };

  const markerUrl = new URL(`/api/wiki/${encodeURIComponent(markerKey)}`, regWeb);
  let res;
  try {
    res = await fetchUrl(markerUrl, { headers: { accept: "application/json", ...(cookie.cookie ? { cookie: cookie.cookie } : {}) } });
  } catch (error) {
    aspects.markerRead = { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: [`marker endpoint unreachable: ${error?.message ?? String(error)}`] };
    return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: aspects.markerRead.problems, aspects };
  }
  if (res.status !== 200) {
    aspects.markerRead = { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: [`marker endpoint returned HTTP ${res.status}`] };
    return { ok: false, classification: TARGET_IDENTITY_REFUSED, problems: aspects.markerRead.problems, aspects };
  }
  const body = res.json?.data ?? res.json ?? {};
  const content = typeof body.content === "string" ? body.content : "";
  const raw = typeof body.rawMarkdown === "string" ? body.rawMarkdown : "";
  const haystack = `${content}${raw}`;
  const expectedRun = `run=${run.runId}`;
  const expectedFixture = `fixture=${run.fixtureDigest}`;
  const expectedInstance = `instance=${run.instanceId ?? ""}`;
  const markerProblems = [];
  if (!run.instanceId) markerProblems.push("run.instanceId is missing on the run manifest; the marker check cannot verify logical identity");
  if (!haystack.includes(expectedRun)) markerProblems.push(`marker does not contain this run's id (looking for "${expectedRun}")`);
  if (!haystack.includes(expectedFixture)) markerProblems.push(`marker does not contain this run's fixture digest (looking for "${expectedFixture}")`);
  if (run.instanceId && !haystack.includes(expectedInstance)) markerProblems.push(`marker does not contain this run's logical instance id (looking for "${expectedInstance}")`);
  aspects.markerRead = {
    ok: markerProblems.length === 0,
    classification: markerProblems.length === 0 ? TARGET_IDENTITY_OK : TARGET_IDENTITY_REFUSED,
    problems: markerProblems,
    detail: { markerKey, contentPreview: content.slice(0, 200) }
  };
  problems.push(...aspects.markerRead.problems);
  return { ok: problems.length === 0, classification: problems.length === 0 ? TARGET_IDENTITY_OK : TARGET_IDENTITY_REFUSED, problems, aspects };
}

/**
 * Default login: read /api/auth/status and, when the target is in `required` mode, POST
 * /api/auth/login with the run's owner credentials. In `bootstrap` mode this function does NOT
 * POST /api/auth/bootstrap — first-owner setup belongs to B2's UI bootstrap flow (run-management
 * cases for management; intended security cases for security). It returns a `needs-bootstrap`
 * classification so the orchestrator can refuse the run with an explicit blocker rather than
 * silently consume the bootstrap token. The classification also prevents postflightVerify from
 * ever issuing a POST against /api/auth/bootstrap.
 *
 * Failures are classified into `failed` (network/5xx/4xx) or `needs-bootstrap` (mode=bootstrap).
 */
export async function defaultLogin({ webUrl, run, fetchUrl = defaultFetchUrl }) {
  const secretsDir = run?.secretsDir;
  if (!secretsDir) return { ok: false, classification: "failed", problems: ["run.secretsDir is missing"] };
  const bootstrapTokenPath = path.join(secretsDir, "bootstrap-token");
  const adminsPath = path.join(secretsDir, "admins.json");
  if (!existsSync(bootstrapTokenPath)) return { ok: false, classification: "failed", problems: [`bootstrap-token not found at ${bootstrapTokenPath}`] };
  if (!existsSync(adminsPath)) return { ok: false, classification: "failed", problems: [`admins.json not found at ${adminsPath}`] };
  const bootstrapToken = readFileSync(bootstrapTokenPath, "utf8").trim();
  const admins = JSON.parse(readFileSync(adminsPath, "utf8"));
  const owner = admins?.owner;
  if (!owner?.adminId || !owner?.password) return { ok: false, classification: "failed", problems: ["owner credentials missing in admins.json"] };

  const statusUrl = new URL("/api/auth/status", webUrl);
  let statusRes;
  try {
    statusRes = await fetchUrl(statusUrl, { headers: { accept: "application/json" } });
  } catch (error) {
    return { ok: false, classification: "failed", problems: [`auth/status unreachable: ${error?.message ?? String(error)}`] };
  }
  if (statusRes.status !== 200) return { ok: false, classification: "failed", problems: [`auth/status returned HTTP ${statusRes.status}`] };
  const data = statusRes.json?.data ?? statusRes.json ?? {};
  const mode = data?.mode;
  if (mode === "bootstrap") {
    return { ok: false, classification: "needs-bootstrap", problems: ["target is in 'bootstrap' mode: first-owner setup is B2's responsibility; target verifier refuses to consume the bootstrap token"], detail: { mode, authEnabled: data?.authEnabled !== false } };
  }
  if (mode !== "required") {
    return { ok: false, classification: "failed", problems: [`unexpected auth mode: "${mode}" (expected 'required' or 'bootstrap')`], detail: { mode } };
  }
  const loginUrl = new URL("/api/auth/login", webUrl);
  let res;
  try {
    res = await fetchUrl(loginUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: { adminId: owner.adminId, password: owner.password }
    });
  } catch (error) {
    return { ok: false, classification: "failed", problems: [`owner login unreachable: ${error?.message ?? String(error)}`] };
  }
  if (res.status !== 200) return { ok: false, classification: "failed", problems: [`owner login -> HTTP ${res.status}`] };
  if (!res.cookie) return { ok: false, classification: "failed", problems: ["login returned HTTP 200 but no Set-Cookie session token"] };
  return { ok: true, cookie: res.cookie, classification: "ok", mode };
}

/**
 * Validates an `args.external` CLI flag against `run.instance.startedBy`. Used by every external
 * runner (security, management, agent) so a registered external target never starts a local
 * Lucy child and a local run never claims to use a target it does not have.
 */
export function reconcileExternalFlag({ run, flagValue }) {
  const startedBy = run?.instance?.startedBy;
  const problems = [];
  if (startedBy === "external" && flagValue !== true) {
    problems.push("run.instance.startedBy=external but --external was not given: refusing to start a local source against an externally registered target");
  }
  if (startedBy !== "external" && flagValue === true) {
    problems.push(`run.instance.startedBy=${startedBy ?? "unknown"} but --external was given: an external target must be registered before the runner will skip the local Lucy process`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Classified failure used by ExternalInstance.start. Carries every per-aspect verdict and a
 * top-level `classification` (refused vs missing_measurement) so the orchestrator can map
 * missing_measurement to a blocked exit rather than a misleading product failure.
 */
export class TargetIdentityError extends Error {
  constructor({ stage, problems, aspects, classification }) {
    super(`target identity ${stage}: ${problems.join("; ")}`);
    this.name = "TargetIdentityError";
    this.stage = stage;
    this.problems = problems;
    this.aspects = aspects ?? {};
    this.classification = classification ?? TARGET_IDENTITY_REFUSED;
  }
}
