// The harness must never score a case it could not actually evaluate.
//
// Two failures showed up in a real security-leg run:
//
//  1. The server was launched through the `tsx` CLI, which FORKS a child to run the script.
//     The process the harness held was only the wrapper, so `child.once("exit")` said
//     nothing about the real server: a stop/start pair could race a port the old server
//     was still holding, the new instance died with EADDRINUSE, and every case after it
//     was scored against a service that was not running.
//  2. A handler that threw because the TARGET was unreachable was scored `failed`, which
//     attributes a harness/environment outage to the product.
//
// These tests pin the corrected behaviour: a single-process launch (so `exit` means "the
// server is gone") and a blocked-not-failed verdict for an unreachable target.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../lib/common.mjs";
import { serverLaunchSpec } from "../lib/instance.mjs";
import { classifyHandlerError, isServiceUnreachable } from "../run-security.mjs";

describe("the server under test is ONE process, so exit means the server is gone", () => {
  it("the launch spec runs the server in the spawned process, not through the forking tsx CLI", () => {
    const spec = serverLaunchSpec();
    assert.equal(spec.command, process.execPath, "the server must run under the same node binary as the harness");
    assert.deepEqual(spec.args, ["--import", "tsx", "server/index.ts"]);
    // The `tsx` CLI forks: its exit would report the wrapper, not the server.
    const source = readFileSync(path.join(REPO_ROOT, "scripts/e2e/lib/instance.mjs"), "utf8");
    assert.doesNotMatch(source, /node_modules"\s*,\s*"\.bin"\s*,\s*"tsx"/, "the forking tsx CLI must not be spawned any more");
  });

  it("the launched process IS the process that runs the code (no fork in between)", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-launch-"));
    try {
      const script = path.join(dir, "pid.ts");
      writeFileSync(script, "console.log(`PID:${process.pid}`);\n");
      const child = spawn(process.execPath, ["--import", "tsx", script], {
        cwd: path.join(REPO_ROOT, "webui"),
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      });
      let out = "";
      child.stdout.on("data", (chunk) => { out += String(chunk); });
      const exit = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
      const reported = /PID:(\d+)/.exec(out)?.[1];
      assert.ok(reported, `the launched script must report its pid (got ${JSON.stringify(out)})`);
      assert.equal(Number(reported), child.pid, "the spawned pid must be the process that ran the code");
      assert.equal(exit.code, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("an unreachable target is blocked, never a product failure", () => {
  it("recognises the ways a target turns out to be unreachable", () => {
    assert.equal(isServiceUnreachable(new TypeError("fetch failed")), true);
    assert.equal(isServiceUnreachable(new Error("Lucy exited during startup (code=1 signal=null)")), true);
    assert.equal(isServiceUnreachable(Object.assign(new TypeError("fetch failed"), {
      cause: new AggregateError([Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:15197"), { code: "ECONNREFUSED" })])
    })), true);
    assert.equal(isServiceUnreachable(new Error("Access denied: table_forbidden:analytics.orders")), false);
    assert.equal(isServiceUnreachable(new Error("expected 403, got 200")), false);
  });

  it("scores an unreachable target as blocked with the reason on the record", () => {
    const verdict = classifyHandlerError(new TypeError("fetch failed"));
    assert.equal(verdict.status, "blocked");
    assert.deepEqual(verdict.blockedBy, ["service_unreachable"]);
    assert.match(verdict.detail, /^service_unreachable: /);
  });

  it("keeps a missing precondition blocked, and a real product answer failed", () => {
    const precondition = Object.assign(new Error("login rate limited"), { blockedReason: "login_rate_limited" });
    const blocked = classifyHandlerError(precondition);
    assert.equal(blocked.status, "blocked");
    assert.deepEqual(blocked.blockedBy, ["login_rate_limited"]);
    assert.match(blocked.detail, /^precondition_unavailable: /);

    const failed = classifyHandlerError(new Error("expected 403, got 200"));
    assert.equal(failed.status, "failed");
    assert.match(failed.detail, /^handler_error: /);
    assert.equal(failed.blockedBy, undefined);
  });
});
