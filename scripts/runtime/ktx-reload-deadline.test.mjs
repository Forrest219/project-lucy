import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const entrypoint = process.env.LUCY_RELOAD_ENTRYPOINT_UNDER_TEST ?? path.join(root, "scripts/runtime/docker-entrypoint.sh");
async function waitFor(check, ms = 5_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("explicit supervisor witness deadline exceeded");
}
async function json(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}
async function makeSupervisor(ignoreTerm = false, drainOnTerm = false) {
  const project = await mkdtemp(path.join(os.tmpdir(), "lucy-reload-deadline-"));
  const bin = path.join(project, "bin"); await mkdir(bin);
  await writeFile(path.join(project, "ktx.yaml"), "connections: {}\n");
  const starts = path.join(project, "starts.jsonl");
  await writeFile(path.join(bin, "ktx"), `#!${process.execPath}
const fs=require('node:fs'),net=require('node:net');
fs.appendFileSync(process.env.TEST_STARTS,JSON.stringify({pid:process.pid,at:Date.now()})+'\\n');
const args=process.argv.slice(2),port=Number(args[args.indexOf('--port')+1]);
const server=net.createServer(s=>s.end());server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>{if(process.env.TEST_DRAIN_ON_TERM==='1')fs.writeFileSync(process.env.TEST_DRAIN_FILE,'phase=DRAINING\\n');if(process.env.TEST_IGNORE_TERM!=='1')server.close(()=>process.exit(0));});
`, { mode: 0o755 });
  const portProbe = createServer(); portProbe.listen(0, "127.0.0.1"); await once(portProbe, "listening");
  const port = portProbe.address().port; await new Promise((r) => portProbe.close(r));
  const child = spawn("bash", [entrypoint], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LUCY_APP_ROOT: root,
      KTX_PROJECT_ROOT: project, KTX_MCP_PORT: String(port), KTX_INTERNAL_TOKEN: "test-only-internal",
      LUCY_ENTRYPOINT_SUPERVISOR_ONLY: "1", TEST_STARTS: starts, TEST_IGNORE_TERM: ignoreTerm ? "1" : "0",
      TEST_DRAIN_ON_TERM: drainOnTerm ? "1" : "0", TEST_DRAIN_FILE: path.join(project, ".ktx-ui/lucy-process-drain.request") },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let log = ""; child.stdout.on("data", (c) => { log += c; }); child.stderr.on("data", (c) => { log += c; });
  const dir = path.join(project, ".ktx-ui");
  try {
    await waitFor(async () => { try { return (await readFile(path.join(dir, "ktx-ready"), "utf8")).trim(); } catch { return false; } });
  } catch (error) {
    process.kill(-child.pid, "SIGKILL");
    await once(child, "close");
    await rm(project, { recursive: true, force: true });
    throw new Error(`${String(error)}: ${log}`);
  }
  const rows = async () => (await readFile(starts, "utf8")).trim().split("\n").map(JSON.parse);
  return { project, dir, child, rows, log: () => log,
    async cleanup() {
      process.kill(-child.pid, "SIGTERM");
      const owned = await rows();
      const killer = setTimeout(() => {
        for (const row of owned) { try { process.kill(row.pid, "SIGKILL"); } catch {} }
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }, 2_000);
      await once(child, "close"); clearTimeout(killer);
      for (const row of await rows()) { try { process.kill(row.pid, "SIGKILL"); } catch {} }
      await rm(project, { recursive: true, force: true });
    }
  };
}

test("supervisor consumes an expired request without stopping or restarting its real child", async () => {
  const rig = await makeSupervisor();
  try {
    const before = await rig.rows(); assert.equal(before.length, 1);
    await writeFile(path.join(rig.dir, "ktx-reload.request"), JSON.stringify({ requestId: "expired-request", requestedDigest: "test", requestedAt: new Date().toISOString(), deadlineAt: Date.now() - 1 }));
    const receipt = await waitFor(async () => { const r = await json(path.join(rig.dir, "ktx-reload.result")); return r?.requestId === "expired-request" && r; });
    assert.equal(receipt.status, "failed"); assert.match(receipt.detail, /过期/);
    assert.deepEqual(await rig.rows(), before);
    assert.doesNotThrow(() => process.kill(before[0].pid, 0));
  } finally { await rig.cleanup(); }
});

test("supervisor kills an uncooperative real child using the request remaining deadline", async () => {
  const rig = await makeSupervisor(true);
  try {
    const before = await rig.rows(); const start = Date.now();
    await writeFile(path.join(rig.dir, "ktx-reload.request"), JSON.stringify({ requestId: "bounded-stop", requestedDigest: "test", requestedAt: new Date().toISOString(), deadlineAt: start + 1_500 }));
    const receipt = await waitFor(async () => { const r = await json(path.join(rig.dir, "ktx-reload.result")); return r?.requestId === "bounded-stop" && r; }, 5_000);
    assert.equal(receipt.status, "failed");
    assert.ok(Date.now() - start < 4_000, rig.log()); // Falsifies the old separate 10/60-second waits.
    assert.throws(() => process.kill(before[0].pid, 0)); // Actual child exited; not just a timed-out client.
    assert.equal((await rig.rows()).length, 1); // No expired replacement was started.
  } finally { await rig.cleanup(); }
});


test("legacy request without deadlineAt keeps its original requestedAt budget", async () => {
  const rig = await makeSupervisor();
  try {
    const before = await rig.rows();
    await writeFile(path.join(rig.dir, "ktx-reload.request"), JSON.stringify({ requestId: "legacy-expired", requestedDigest: "test", requestedAt: new Date(Date.now() - 120_000).toISOString() }));
    const receipt = await waitFor(async () => { const r = await json(path.join(rig.dir, "ktx-reload.result")); return r?.requestId === "legacy-expired" && r; });
    assert.equal(receipt.status, "failed"); assert.match(receipt.detail, /过期/);
    assert.deepEqual(await rig.rows(), before);
    assert.doesNotThrow(() => process.kill(before[0].pid, 0));
  } finally { await rig.cleanup(); }
});

test("receipt publication failure still publishes the exact completed owner only after real restart", async () => {
  const rig = await makeSupervisor();
  try {
    const before = await rig.rows();
    await mkdir(path.join(rig.dir, "ktx-reload.result")); // Receipt cannot be read as a JSON file.
    await writeFile(path.join(rig.dir, "ktx-reload.request"), JSON.stringify({
      requestId: "receipt-unreadable", requestedDigest: "test", requestedAt: new Date().toISOString(), deadlineAt: Date.now() + 4_000
    }));
    const capability = await waitFor(async () => {
      const c = await json(path.join(rig.dir, "ktx-reload.capability"));
      return c?.state === "idle" && c?.completedRequestId === "receipt-unreadable" && c;
    });
    assert.equal(capability.currentRequestId, "");
    assert.equal(await json(path.join(rig.dir, "ktx-reload.result")), null);
    const after = await rig.rows(); assert.equal(after.length, 2);
    assert.throws(() => process.kill(before[0].pid, 0));
    assert.doesNotThrow(() => process.kill(after[1].pid, 0));
  } finally { await rig.cleanup(); }
});


test("whole-instance drain rejects a pending reload without stopping the accepted dependency", async () => {
  const rig = await makeSupervisor();
  try {
    const before = await rig.rows();
    await writeFile(path.join(rig.dir, "lucy-process-drain.request"), "phase=DRAINING\n");
    await writeFile(path.join(rig.dir, "ktx-reload.request"), JSON.stringify({ requestId: "draining-pending", requestedDigest: "test", requestedAt: new Date().toISOString(), deadlineAt: Date.now() + 3_000 }));
    const receipt = await waitFor(async () => { const r = await json(path.join(rig.dir, "ktx-reload.result")); return r?.requestId === "draining-pending" && r; });
    assert.equal(receipt.status, "failed"); assert.match(receipt.detail, /停止/);
    assert.deepEqual(await rig.rows(), before);
    assert.doesNotThrow(() => process.kill(before[0].pid, 0));
  } finally { await rig.cleanup(); }
});

test("drain arriving during the real stop prevents replacement and BACKOFF restart", async () => {
  const rig = await makeSupervisor(false, true);
  try {
    const before = await rig.rows();
    await writeFile(path.join(rig.dir, "ktx-reload.request"), JSON.stringify({ requestId: "draining-after-stop", requestedDigest: "test", requestedAt: new Date().toISOString(), deadlineAt: Date.now() + 3_000 }));
    const receipt = await waitFor(async () => { const r = await json(path.join(rig.dir, "ktx-reload.result")); return r?.requestId === "draining-after-stop" && r; });
    assert.equal(receipt.status, "failed");
    assert.equal((await rig.rows()).length, 1);
    assert.throws(() => process.kill(before[0].pid, 0));
    assert.match(await readFile(path.join(rig.dir, "lucy-process-drain.request"), "utf8"), /DRAINING/);
  } finally { await rig.cleanup(); }
});
