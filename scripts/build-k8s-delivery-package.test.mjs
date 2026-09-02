#!/usr/bin/env node
/**
 * F-05 regression: packaging must not expand Markdown backticks as command substitution.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const packScript = path.join(repoRoot, "scripts/build-k8s-delivery-package.sh");

test("pack script uses quoted heredocs for README and RELEASE_NOTES", async () => {
  const src = await readFile(packScript, "utf8");
  assert.match(src, /cat <<'EOF'/);
  const notesBlock = src.slice(src.indexOf("Release Notes"));
  assert.doesNotMatch(notesBlock, /<<EOF\n[\s\S]*`git init`/);
  assert.match(src, /`git init`/);
});

test("quoted heredoc preserves literal backticks and does not run git init", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lucy-pack-heredoc-"));
  const out = path.join(dir, "RELEASE_NOTES.md");
  const helper = path.join(dir, "write-notes.sh");
  const before = spawnSync("git", ["-C", repoRoot, "status", "--porcelain=v1"], { encoding: "utf8" });
  assert.equal(before.status, 0);

  await writeFile(
    helper,
    [
      "#!/usr/bin/env bash",
      "set -Eeuo pipefail",
      'VERSION_SUFFIX="test-v3"',
      'OUT="$1"',
      "{",
      "  printf '%s\\n' \"# Release Notes — ${VERSION_SUFFIX}\"",
      "  cat <<'EOF'",
      "",
      "- Entrypoint idempotently runs `git init` on `/data/lucy` (**sole authority**)",
      "- `project-migrate` init: **chown only** (no git init)",
      "EOF",
      '} > "${OUT}"',
      ""
    ].join("\n")
  );

  const result = spawnSync("bash", [helper, out], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);

  const body = await readFile(out, "utf8");
  assert.match(body, /`git init`/);
  assert.match(body, /`project-migrate`/);
  assert.match(body, /`\/data\/lucy`/);
  assert.doesNotMatch(body, /Reinitialized existing Git repository/);

  const after = spawnSync("git", ["-C", repoRoot, "status", "--porcelain=v1"], { encoding: "utf8" });
  assert.equal(after.status, 0);
  assert.equal(after.stdout, before.stdout);

  await rm(dir, { recursive: true, force: true });
});

test("unquoted heredoc regression fixture still demonstrates the bug class", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lucy-pack-heredoc-bad-"));
  const out = path.join(dir, "bad.md");
  const helper = path.join(dir, "bad.sh");
  await writeFile(
    helper,
    [
      "#!/usr/bin/env bash",
      "set +e",
      `cat > "${out}" <<EOF`,
      "runs `printf HIT` here",
      "EOF",
      ""
    ].join("\n")
  );
  spawnSync("bash", [helper], { cwd: dir, encoding: "utf8" });
  const body = await readFile(out, "utf8");
  assert.match(body, /runs HIT here/);
  await rm(dir, { recursive: true, force: true });
});
