#!/usr/bin/env node
/**
 * Negative contract tests for K8s delivery gates (F-10).
 * These do not require a live cluster or Docker daemon except where noted.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...opts
  });
}

test("H1 rejects https://127.0.0.1 MCP URL for customer registry", () => {
  const result = run("helm", [
    "template",
    "lucy",
    "deploy/k8s/helm/lucy",
    "--set",
    "image.repository=registry.example.com/data-team/project-lucy",
    "--set-string",
    "env.LUCY_PUBLIC_MCP_URL=https://127.0.0.1/mcp"
  ]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /loopback|LUCY_PUBLIC_MCP_URL|reject/i);
});

test("H1 accepts https://lucy.example.com/mcp for customer registry", () => {
  const result = run("helm", [
    "template",
    "lucy",
    "deploy/k8s/helm/lucy",
    "--set",
    "image.repository=registry.example.com/data-team/project-lucy",
    "--set-string",
    "env.LUCY_PUBLIC_MCP_URL=https://lucy.example.com/mcp"
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test("K6 rejects deprecated v1 package name", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lucy-k6-v1-"));
  const pkg = path.join(dir, "lucy-k8s-integration-delivery-20260902-v1");
  await mkdir(path.join(pkg, "image"), { recursive: true });
  await writeFile(path.join(pkg, "SHA256SUMS"), "");
  const result = run("bash", ["scripts/verify-k8s-package.sh", "--dir", pkg, "--skip-docker-load"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /deprecated|K6-1/i);
  await rm(dir, { recursive: true, force: true });
});

test("K6 rejects offline package that pins config ID as digest", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lucy-k6-digest-"));
  const pkg = path.join(dir, "lucy-k8s-integration-delivery-20260902-v3");
  await mkdir(path.join(pkg, "image"), { recursive: true });
  await mkdir(path.join(pkg, "examples"), { recursive: true });
  await mkdir(path.join(pkg, "helm/lucy"), { recursive: true });
  await cp(path.join(repoRoot, "deploy/k8s/helm/lucy"), path.join(pkg, "helm/lucy"), { recursive: true });
  const configId = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await writeFile(path.join(pkg, "image/image-config-id.txt"), `${configId}\n`);
  await writeFile(path.join(pkg, "image/delivery-mode.txt"), "offline\n");
  await writeFile(path.join(pkg, "image/image-repository.txt"), "project-lucy\n");
  await writeFile(path.join(pkg, "image/image-tag.txt"), "ci\n");
  await writeFile(path.join(pkg, "image/dummy.tar"), "not-a-real-tar\n");
  await writeFile(
    path.join(pkg, "examples/values.k3s-test.yaml"),
    [
      "image:",
      "  repository: project-lucy",
      '  tag: "ci"',
      `  digest: "${configId}"`,
      "  pullPolicy: Never",
      "env:",
      '  LUCY_PUBLIC_MCP_URL: "http://10.69.95.109:8277/mcp"',
      ""
    ].join("\n")
  );
  await writeFile(path.join(pkg, "SHA256SUMS"), "");
  // Inner checksums will fail first; create a valid SHA256SUMS for the files we care about.
  const sums = run("bash", ["-c", `cd "${pkg}" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum`]);
  await writeFile(path.join(pkg, "SHA256SUMS"), sums.stdout);

  const result = run("bash", ["scripts/verify-k8s-package.sh", "--dir", pkg, "--skip-docker-load"]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /digest empty|K6-2/i);
  await rm(dir, { recursive: true, force: true });
});

test("G8 script asserts UID 10001 and /home/lucy runtime path", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(path.join(repoRoot, "scripts/g8-image-k8s-contract-gate.sh"), "utf8");
  assert.match(src, /10001/);
  assert.match(src, /\/home\/lucy\/\.ktx\/runtime/);
  assert.match(src, /LUCY_ENTRYPOINT_SEED_ONLY/);
});

test("assert-image-elf-arch checks python runtime path", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(path.join(repoRoot, "scripts/assert-image-elf-arch.sh"), "utf8");
  assert.match(src, /runtime\/\$\{KTX_VERSION\}\/\.venv\/bin\/python/);
  assert.match(src, /runtime-python/);
});

test("kind H3 gate requires distinct N-1 and N config IDs", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(path.join(repoRoot, "scripts/k8s-kind-h3-gate.sh"), "utf8");
  assert.match(src, /n1-baseline\.txt/);
  assert.match(src, /config IDs must differ/);
  assert.match(src, /K8S_GATE_N1_REF/);
});

test("upgrade gate records Pod imageID not only Deployment image string", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(path.join(repoRoot, "scripts/k8s-upgrade-gate.sh"), "utf8");
  assert.match(src, /pod_image_id/);
  assert.match(src, /imageid-pre\.txt/);
  assert.match(src, /lucy-gate-does-not-exist/);
  assert.match(src, /seed_upgrade_sentinels/);
});
