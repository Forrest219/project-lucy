import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadClientRevision,
  loadRuntimeRevision,
  parseStampText,
  revisionFromBuildArgs
} from "./lucy-build-revision.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(ROOT, "scripts/release/lucy-build-revision.mjs");
const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

test("stamp text accepts a full sha, a dirty sha, and unknown", () => {
  assert.deepEqual(parseStampText(`${SHA}\n`), { gitSha: SHA, gitDirty: false });
  assert.deepEqual(parseStampText(`${SHA}-dirty`), { gitSha: SHA, gitDirty: true });
  assert.deepEqual(parseStampText("unknown\n"), { gitSha: "unknown", gitDirty: false });
  assert.equal(parseStampText("v0.2.0"), null);
  assert.equal(parseStampText(`${SHA.toUpperCase()}\n`), null);
});

test("build args never invent a sha", () => {
  assert.deepEqual(revisionFromBuildArgs("", "1"), { gitSha: "unknown", gitDirty: false });
  assert.deepEqual(revisionFromBuildArgs("deadbeef", "1"), { gitSha: "unknown", gitDirty: false });
  assert.deepEqual(revisionFromBuildArgs(SHA, "1"), { gitSha: SHA, gitDirty: true });
  assert.deepEqual(revisionFromBuildArgs(SHA, "true"), { gitSha: SHA, gitDirty: false });
});

test("runtime stamp is final and ignores LUCY_GIT_SHA", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lucy-rev-"));
  const stampPath = path.join(dir, "BUILD_REVISION");
  const previous = process.env.LUCY_GIT_SHA;
  process.env.LUCY_GIT_SHA = OTHER;
  try {
    writeFileSync(stampPath, `${SHA}-dirty\n`);
    assert.deepEqual(loadRuntimeRevision({ stampPath, repoRoot: ROOT }), { gitSha: SHA, gitDirty: true });

    writeFileSync(stampPath, "not-a-commit\n");
    assert.deepEqual(loadRuntimeRevision({ stampPath, repoRoot: ROOT }), { gitSha: "unknown", gitDirty: false });
  } finally {
    if (previous === undefined) delete process.env.LUCY_GIT_SHA;
    else process.env.LUCY_GIT_SHA = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime without a stamp uses the Lucy checkout, not LUCY_GIT_SHA", () => {
  const previous = process.env.LUCY_GIT_SHA;
  process.env.LUCY_GIT_SHA = OTHER;
  try {
    const revision = loadRuntimeRevision({
      stampPath: path.join(tmpdir(), "lucy-rev-missing-stamp"),
      repoRoot: ROOT
    });
    assert.match(revision.gitSha, /^[0-9a-f]{40}$/);
    assert.notEqual(revision.gitSha, OTHER);
  } finally {
    if (previous === undefined) delete process.env.LUCY_GIT_SHA;
    else process.env.LUCY_GIT_SHA = previous;
  }
});

test("client build prefers the checkout over a build arg", () => {
  const previousSha = process.env.LUCY_GIT_SHA;
  const previousDirty = process.env.LUCY_GIT_DIRTY;
  process.env.LUCY_GIT_SHA = OTHER;
  process.env.LUCY_GIT_DIRTY = "1";
  try {
    const revision = loadClientRevision({
      stampPath: path.join(tmpdir(), "lucy-rev-missing-stamp"),
      repoRoot: ROOT
    });
    assert.notEqual(revision.gitSha, OTHER);
    assert.match(revision.gitSha, /^[0-9a-f]{40}$/);
  } finally {
    if (previousSha === undefined) delete process.env.LUCY_GIT_SHA;
    else process.env.LUCY_GIT_SHA = previousSha;
    if (previousDirty === undefined) delete process.env.LUCY_GIT_DIRTY;
    else process.env.LUCY_GIT_DIRTY = previousDirty;
  }
});

test("client build uses a valid build arg only when no checkout and no stamp exist", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lucy-rev-empty-"));
  const previousSha = process.env.LUCY_GIT_SHA;
  const previousDirty = process.env.LUCY_GIT_DIRTY;
  process.env.LUCY_GIT_SHA = SHA;
  process.env.LUCY_GIT_DIRTY = "1";
  try {
    assert.deepEqual(
      loadClientRevision({ stampPath: path.join(dir, "missing"), repoRoot: dir }),
      { gitSha: SHA, gitDirty: true }
    );
  } finally {
    if (previousSha === undefined) delete process.env.LUCY_GIT_SHA;
    else process.env.LUCY_GIT_SHA = previousSha;
    if (previousDirty === undefined) delete process.env.LUCY_GIT_DIRTY;
    else process.env.LUCY_GIT_DIRTY = previousDirty;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stamp writer records the build arg and rejects a fake sha", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lucy-rev-write-"));
  const out = path.join(dir, "BUILD_REVISION");
  try {
    const ok = spawnSync(process.execPath, [SCRIPT, out], {
      env: { ...process.env, LUCY_GIT_SHA: SHA, LUCY_GIT_DIRTY: "1" },
      encoding: "utf8"
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(readFileSync(out, "utf8"), `${SHA}-dirty\n`);

    const bad = spawnSync(process.execPath, [SCRIPT, out], {
      env: { ...process.env, LUCY_GIT_SHA: "0.2.0", LUCY_GIT_DIRTY: "0" },
      encoding: "utf8"
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /40 lowercase hex/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("health uses the runtime revision helper and does not read LUCY_GIT_SHA", () => {
  const src = readFileSync(path.join(ROOT, "webui/server/index.ts"), "utf8");
  assert.match(src, /loadRuntimeRevision\(\)/);
  assert.equal(/process\.env\.LUCY_GIT_SHA/.test(src), false);
});

test("runtime resolver source does not read LUCY_GIT_SHA", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const start = src.indexOf("export function loadRuntimeRevision");
  const end = src.indexOf("export function loadClientRevision");
  assert.ok(start !== -1 && end > start);
  assert.equal(src.slice(start, end).includes("LUCY_GIT_SHA"), false);
});
