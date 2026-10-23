// Test control plane + HTTP helpers (Spec §6.2, Plan T10 step 5).
//
// Fault injection lives HERE and only here: it acts on the run directory and on the Lucy process that this
// tooling spawned (kill, restart, chmod on files). The product exposes no fault-injection route or switch;
// scripts/e2e/__tests__/security-runner.test.mjs statically proves the server sources contain none.
//
// LucyHttp is the cookie-aware JSON/text client every runner uses to talk to a real Lucy instance.
// Two safety rules bind the wire so the security layer can never escape its registered endpoint:
//   - the constructor REJECTS a baseUrl that is not http(s); the registered MCP URL is the only
//     authority over what gets contacted;
//   - a request REJECTS an absolute URL pathname, which `new URL(pathname, baseUrl)` would silently
//     honour and override the base origin. Anyone who tries that pattern fails fast, with no
//     request issued. This is the same protection LucyHttp gave ad-hoc to security-integration
//     cases; it now applies to every call site that imports the helper.

import { spawn } from "node:child_process";
import { chmodSync, closeSync, createWriteStream, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { REPO_ROOT } from "./common.mjs";
import { preflightVerify, postflightVerify, TargetIdentityError } from "./target-identity.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeBaseUrl(baseUrl) {
  if (!(baseUrl instanceof URL)) {
    throw new Error(`LucyHttp baseUrl must be a URL or string (got ${typeof baseUrl})`);
  }
  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error(`LucyHttp baseUrl protocol must be http(s), got "${baseUrl.protocol}"`);
  }
  return baseUrl;
}

/** Minimal cookie-aware JSON/text client. Cookies are only ever held in memory. */
export class LucyHttp {
  constructor(baseUrl) {
    let parsed;
    if (typeof baseUrl === "string") {
      try {
        parsed = new URL(baseUrl);
      } catch (error) {
        throw new Error(`LucyHttp baseUrl is not a valid URL: ${error?.message ?? String(error)}`);
      }
    } else {
      parsed = normalizeBaseUrl(baseUrl);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`LucyHttp baseUrl protocol must be http(s), got "${parsed.protocol}"`);
    }
    this.baseUrl = parsed;
  }

  async request(method, pathname, { headers = {}, body, cookie, rawBody, timeoutMs = 20_000 } = {}) {
    if (typeof pathname !== "string") {
      throw new Error(`LucyHttp.request pathname must be a string (got ${typeof pathname})`);
    }
    // An absolute URL pathname would override the registered origin in `new URL(pathname, baseUrl)`.
    // Block any pattern that resembles a scheme (e.g. `http://`, `javascript:`, `mailto:`, `file:`):
    // even schemes without `//` get resolved as path-like references by the URL parser and would
    // leak the registered origin. The only authority over what gets contacted is the baseUrl
    // this LucyHttp was constructed with. Without this guard a future caller could quietly point
    // LucyHttp at a different deployment (security-integration regression).
    if (/^[a-z][a-z0-9+.-]*:/i.test(pathname)) {
      throw new Error(`LucyHttp.request refuses pathname with scheme "${pathname}"; only the constructor's baseUrl determines the origin`);
    }
    const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" };
    if (cookie) init.headers.cookie = cookie;
    if (rawBody !== undefined) {
      init.body = rawBody;
    } else if (body !== undefined) {
      init.headers["content-type"] ??= "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(new URL(pathname, this.baseUrl), init);
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    const sessionCookie = setCookies.map((value) => value.split(";")[0]).find((value) => /^lucy[_-]/i.test(value) || value.includes("="));
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      setCookies,
      cookie: sessionCookie ?? null,
      json,
      text
    };
  }
}

export function waitForPort(host, port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`timeout waiting for ${host}:${port}`));
        else setTimeout(attempt, 300);
      });
    };
    attempt();
  });
}

export function portOpen(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * An instance this tooling did NOT start (the isolated single-replica K8s candidate). It can be driven over
 * HTTP, but there is no process or filesystem control plane here: restart/log access throw, and the catalog
 * cases that need them (`fault-control`) stay BLOCKED until a K8s control plane exists.
 *
 * External verification is split into two phases because first-owner bootstrap is part of the
 * intended UI flow (B2), not part of the orchestrator's bootstrap:
 *   1. `verifyPreflight()` — public endpoints only (/api/health, /api/auth/status); no bootstrap
 *      token is consumed, no admin session is created. Fails closed on missing/wrong/unhealthy target.
 *      Safe to call BEFORE the run's intended bootstrap (which it does not perform).
 *   2. `verifyPostflight()` — owner login (bootstrap or login), then GET /api/wiki/<markerKey> to read
 *      the run-scoped marker. Marker content must include this run's run= and fixture=.
 *      This MUST run AFTER the run's intended bootstrap: a fresh target is in `bootstrap` mode,
 *      and postflight refuses rather than auto-consume the token.
 *
 * `start()` runs BOTH phases in order and fails closed on any problem. The orchestrator
 * (run-management, run-agent-journey, run-security) calls `verifyPreflight()` itself when it
 * needs the intended bootstrap to happen in the middle (e.g. SEC02V01-V04 + management UI
 * bootstrap), then `verifyPostflight()` after the bootstrap is intended. The combined `start()`
 * remains for callers that don't drive a UI bootstrap.
 *
 * Both phases fail closed with a `TargetIdentityError` that carries every problem and the
 * per-aspect verdict. No fallback, no localhost, no silent pass.
 */
export class ExternalInstance {
  constructor(run, { preflight, postflight } = {}) {
    this.run = run;
    this.logPath = null;
    this.preflightFn = preflight ?? preflightVerify;
    this.postflightFn = postflight ?? postflightVerify;
    this.preflight = null;
    this.postflight = null;
  }

  async start() {
    await this.verifyPreflight();
    await this.verifyPostflight();
  }

  async verifyPreflight() {
    if (this.run.instance?.startedBy !== "external") {
      throw new TargetIdentityError({ stage: "startedBy", problems: [`run.instance.startedBy is "${this.run.instance?.startedBy}", expected "external"`], aspects: {} });
    }
    const pre = await this.preflightFn({ run: this.run });
    this.preflight = pre;
    if (!pre.ok) {
      throw new TargetIdentityError({ stage: "preflight", problems: pre.problems, aspects: pre.aspects, classification: pre.classification });
    }
    return pre;
  }

  async verifyPostflight() {
    if (this.run.instance?.startedBy !== "external") {
      throw new TargetIdentityError({ stage: "startedBy", problems: [`run.instance.startedBy is "${this.run.instance?.startedBy}", expected "external"`], aspects: {} });
    }
    const post = await this.postflightFn({ run: this.run });
    this.postflight = post;
    if (!post.ok) {
      throw new TargetIdentityError({ stage: "postflight", problems: post.problems, aspects: post.aspects, classification: post.classification });
    }
    return post;
  }

  async stop() {
    return { code: null, signal: null };
  }

  async restart() {
    throw new Error("an external instance has no restart control plane (fault-control is unavailable)");
  }
}

/** Spawns and supervises the Lucy WebUI+proxy for a run. Used for local security-integration evidence. */
export class LucyProcess {
  constructor(run, { extraEnv = {} } = {}) {
    this.run = run;
    this.extraEnv = extraEnv;
    this.child = null;
  }

  get logPath() {
    return path.join(this.run.paths.logs, "lucy.log");
  }

  async start() {
    if (this.child) throw new Error("instance already started");
    const { host, webuiPort, proxyPort, env } = this.run.instance;
    if (await portOpen(host, webuiPort)) throw new Error(`port ${webuiPort} is already in use: refusing to attach to an unknown service`);
    if (await portOpen(host, proxyPort)) throw new Error(`port ${proxyPort} is already in use: refusing to attach to an unknown service`);
    const out = openSync(this.logPath, "a");
    const tsx = path.join(REPO_ROOT, "webui", "node_modules", ".bin", "tsx");
    this.child = spawn(tsx, ["server/index.ts"], {
      cwd: path.join(REPO_ROOT, "webui"),
      env: { ...process.env, ...env, ...this.extraEnv },
      stdio: ["ignore", out, out],
      // Own process group: `tsx` forks the real server, and a signal to the wrapper alone would orphan it.
      detached: true
    });
    closeSync(out);
    this.exited = new Promise((resolve) => this.child.once("exit", (code, signal) => resolve({ code, signal })));
    await Promise.race([
      Promise.all([waitForPort(host, webuiPort), waitForPort(host, proxyPort)]),
      this.exited.then((exit) => {
        throw new Error(`Lucy exited during startup (code=${exit.code} signal=${exit.signal}); see ${this.logPath}`);
      })
    ]);
  }

  async stop(signal = "SIGTERM") {
    if (!this.child) return { code: null, signal: null };
    const child = this.child;
    this.child = null;
    killGroup(child, signal);
    const result = await Promise.race([this.exited, sleep(10_000).then(() => null)]);
    if (!result) {
      killGroup(child, "SIGKILL");
      await this.exited;
    }
    // The wrapper can exit before its forked server releases the ports.
    await waitForPortFree(this.run.instance.host, this.run.instance.webuiPort);
    await waitForPortFree(this.run.instance.host, this.run.instance.proxyPort);
    return result ?? this.exited;
  }

  async restart(signal = "SIGKILL") {
    await this.stop(signal);
    await this.start();
  }

  /**
   * Starts a second, throw-away server with extra env on shifted ports and reports what it does: whether it
   * refused to start, and otherwise which auth mode it serves. Used for customer+off style preflight checks.
   */
  static async probeVariant(run, env, timeoutMs = 40_000) {
    const tsx = path.join(REPO_ROOT, "webui", "node_modules", ".bin", "tsx");
    const webuiPort = run.instance.webuiPort + 100;
    const proxyPort = run.instance.proxyPort + 100;
    const logPath = path.join(run.paths.logs, `variant-${Date.now()}.log`);
    const log = createWriteStream(logPath);
    const child = spawn(tsx, ["server/index.ts"], {
      cwd: path.join(REPO_ROOT, "webui"),
      env: { ...process.env, ...run.instance.env, LUCY_WEBUI_PORT: String(webuiPort), LUCY_PROXY_PORT: String(proxyPort), ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const exited = new Promise((resolve) => child.once("exit", (code) => resolve({ exited: true, code })));
    const listening = waitForPort(run.instance.host, webuiPort, timeoutMs).then(() => ({ exited: false, code: null }), () => ({ exited: false, code: null, timedOut: true }));
    const outcome = await Promise.race([exited, listening]);
    let authMode = null;
    if (!outcome.exited && !outcome.timedOut) {
      try {
        const res = await fetch(`http://${run.instance.host}:${webuiPort}/api/auth/status`);
        authMode = (await res.json())?.data?.mode ?? null;
      } catch {
        authMode = null;
      }
    }
    if (!outcome.exited) killGroup(child, "SIGKILL");
    await Promise.race([exited, sleep(5000)]);
    await waitForPortFree(run.instance.host, webuiPort);
    await waitForPortFree(run.instance.host, proxyPort);
    log.end();
    return { ...outcome, authMode, log: readFileSync(logPath, "utf8") };
  }
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

async function waitForPortFree(host, port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portOpen(host, port, 300))) return;
    await sleep(200);
  }
  throw new Error(`port ${port} did not become free within ${timeoutMs} ms`);
}

/** Test-control-plane file faults. Each returns an undo function; callers must always run it. */
export const faults = {
  chmod(file, mode) {
    if (!existsSync(file)) throw new Error(`fault target does not exist: ${file}`);
    const original = statSync(file).mode & 0o777;
    chmodSync(file, mode);
    return () => chmodSync(file, original);
  },
  replaceFile(file, content) {
    const original = existsSync(file) ? readFileSync(file) : null;
    writeFileSync(file, content);
    return () => {
      if (original === null) rmSync(file, { force: true });
      else writeFileSync(file, original);
    };
  }
};
