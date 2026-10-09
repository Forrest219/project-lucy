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

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);

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
  const result = run("bash", ["scripts/gates/verify-k8s-package.sh", "--dir", pkg, "--skip-docker-load"]);
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

  const result = run("bash", ["scripts/gates/verify-k8s-package.sh", "--dir", pkg, "--skip-docker-load"]);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /digest empty|K6-2/i);
  await rm(dir, { recursive: true, force: true });
});

test("G8 script asserts UID 10001 and /home/lucy runtime path", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(path.join(repoRoot, "scripts/gates/g8-image-k8s-contract-gate.sh"), "utf8");
  assert.match(src, /10001/);
  assert.match(src, /\/home\/lucy\/\.ktx\/runtime/);
  assert.match(src, /LUCY_ENTRYPOINT_SEED_ONLY/);
});

test("assert-image-elf-arch checks python runtime path", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(path.join(repoRoot, "scripts/release/assert-image-elf-arch.sh"), "utf8");
  assert.match(src, /runtime\/\$\{KTX_VERSION\}\/\.venv\/bin\/python/);
  assert.match(src, /runtime-python/);
});

test("kind H3 gate requires distinct N-1 and N config IDs", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(path.join(repoRoot, "scripts/gates/k8s-kind-h3-gate.sh"), "utf8");
  assert.match(src, /n1-baseline\.txt/);
  assert.match(src, /config IDs must differ/);
  assert.match(src, /K8S_GATE_N1_REF/);
});

test("upgrade gate records Pod imageID not only Deployment image string", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(path.join(repoRoot, "scripts/gates/k8s-upgrade-gate.sh"), "utf8");
  assert.match(src, /pod_image_id/);
  assert.match(src, /imageid-pre\.txt/);
  assert.match(src, /lucy-gate-does-not-exist/);
  assert.match(src, /seed_upgrade_sentinels/);
});

// ---------------------------------------------------------------------------
// Chart 0.2.3: Secret sync, content root, resource names, package-root scripts
// ---------------------------------------------------------------------------

const chartDir = path.join(repoRoot, "deploy/k8s/helm/lucy");

function renderChart(args) {
  const result = run("helm", ["template", ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

/** Return the `- |` shell script of a named init container from a rendered manifest. */
function extractInitScript(manifest, initName) {
  const lines = manifest.split("\n");
  const start = lines.findIndex((line) => line.trim() === `- name: ${initName}`);
  assert.notEqual(start, -1, `init container ${initName} not rendered`);
  const bar = lines.findIndex((line, i) => i > start && /^\s+- \|$/.test(line));
  assert.notEqual(bar, -1, `no script block in ${initName}`);
  const base = lines[bar].search(/\S/);
  const body = [];
  for (let i = bar + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "") {
      body.push("");
      continue;
    }
    if (lines[i].search(/\S/) <= base) break;
    body.push(lines[i].slice(base + 2));
  }
  return body.join("\n");
}

/** Make an init script runnable unprivileged against temp dirs. */
function localize(script, { data, secrets }) {
  const uid = process.getuid();
  const gid = process.getgid();
  return script
    .replaceAll("/mnt/lucy-secrets", secrets)
    .replaceAll("/data/lucy", data)
    .replaceAll("10001:10001", `${uid}:${gid}`)
    .replaceAll("-user 10001", `-user ${uid}`)
    .replaceAll("-group 10001", `-group ${gid}`);
}

test("Secret is never mounted over .ktx/secrets; secrets-sync copies it into the PVC", () => {
  const manifest = renderChart(["lucy", chartDir, "--set", "existingSecret=customer-db"]);
  assert.doesNotMatch(manifest, /mountPath: \/data\/lucy\/\.ktx\/secrets/);
  assert.match(manifest, /mountPath: \/mnt\/lucy-secrets\n\s+readOnly: true/);
  assert.match(manifest, /name: secrets-sync/);
  // The lucy container only sees the PVC.
  const lucy = manifest.slice(manifest.indexOf("- name: lucy\n"));
  assert.doesNotMatch(lucy.slice(0, lucy.indexOf("volumes:")), /secrets/);
});

test("secrets-sync: adds/overwrites Secret keys, keeps WebUI-created files, sets 0700/0600", async () => {
  const manifest = renderChart(["lucy", chartDir, "--set", "existingSecret=customer-db"]);
  const script = extractInitScript(manifest, "secrets-sync");
  const dir = await mkdtemp(path.join(tmpdir(), "lucy-secrets-sync-"));
  const data = path.join(dir, "data");
  const secrets = path.join(dir, "secrets");
  const dst = path.join(data, ".ktx/secrets");
  const { readFile, symlink, stat, chmod, readdir } = await import("node:fs/promises");

  // Kubernetes-style projected Secret: keys are symlinks into ..data/.
  await mkdir(path.join(secrets, "..data"), { recursive: true });
  await writeFile(path.join(secrets, "..data/db-password"), "from-secret-v2");
  await symlink("..data/db-password", path.join(secrets, "db-password"));
  await writeFile(path.join(secrets, "other-password"), "other");
  await chmod(path.join(secrets, "other-password"), 0o400);

  // Pre-existing PVC state: stale rotated key + a password created via the WebUI.
  await mkdir(dst, { recursive: true, mode: 0o755 });
  await writeFile(path.join(dst, "db-password"), "stale");
  await writeFile(path.join(dst, "webui-conn-password"), "keep-me");

  const result = run("sh", ["-ec", localize(script, { data, secrets })]);
  assert.equal(result.status, 0, result.stderr);

  assert.equal(await readFile(path.join(dst, "db-password"), "utf8"), "from-secret-v2");
  assert.equal(await readFile(path.join(dst, "other-password"), "utf8"), "other");
  assert.equal(
    await readFile(path.join(dst, "webui-conn-password"), "utf8"),
    "keep-me",
    "files absent from the Secret must not be pruned"
  );
  assert.equal((await stat(dst)).mode & 0o777, 0o700);
  for (const name of await readdir(dst)) {
    assert.ok(!name.startsWith("."), `temp file left behind: ${name}`);
    assert.equal((await stat(path.join(dst, name))).mode & 0o777, 0o600, name);
  }
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /from-secret|keep-me|other/);
  await rm(dir, { recursive: true, force: true });
});

test("secrets-sync tolerates an empty Secret and a missing destination", async () => {
  const manifest = renderChart(["lucy", chartDir, "--set", "existingSecret=customer-db"]);
  const script = extractInitScript(manifest, "secrets-sync");
  const dir = await mkdtemp(path.join(tmpdir(), "lucy-secrets-empty-"));
  const secrets = path.join(dir, "secrets");
  await mkdir(secrets, { recursive: true });
  const result = run("sh", ["-ec", localize(script, { data: path.join(dir, "data"), secrets })]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /synced 0 file/);
  await rm(dir, { recursive: true, force: true });
});

test("project-migrate only chowns, never deletes or runs git", () => {
  const manifest = renderChart(["lucy", chartDir]);
  const script = extractInitScript(manifest, "project-migrate");
  assert.match(script, /chown -h 10001:10001/);
  assert.doesNotMatch(script, /git init|rm -/);
  assert.doesNotMatch(script, /chown -R/);
});

test("LUCY_CONTENT_ROOT is injected only when set, and fullnameOverride pins resource names", () => {
  const defaults = renderChart(["lucy-starrocks", chartDir]);
  assert.doesNotMatch(defaults, /LUCY_CONTENT_ROOT/);

  const pinned = renderChart([
    "lucy-starrocks",
    chartDir,
    "--set-string", "env.LUCY_CONTENT_ROOT=.",
    "--set", "fullnameOverride=lucy"
  ]);
  assert.match(pinned, /- name: LUCY_CONTENT_ROOT\n\s+value: "\."/);
  assert.match(pinned, /kind: Deployment\nmetadata:\n  name: lucy\n/);
  assert.match(pinned, /kind: Service\nmetadata:\n  name: lucy\n/);
  assert.doesNotMatch(pinned, /name: lucy-starrocks\n/);
});

test("Service never exposes 7878 in any shipped profile", async () => {
  for (const profile of ["values.k3s-test.yaml", "values.local-test.yaml"]) {
    const manifest = renderChart(["lucy-starrocks", chartDir, "-f", path.join(chartDir, "examples", profile)]);
    assert.doesNotMatch(manifest, /(port|targetPort): 7878/, profile);
  }
});

async function buildFakePackage() {
  const dir = await mkdtemp(path.join(tmpdir(), "lucy-pkg-layout-"));
  const pkg = path.join(dir, "lucy-k8s-integration-delivery-test");
  const { readFile, copyFile } = await import("node:fs/promises");
  await mkdir(path.join(pkg, "helm"), { recursive: true });
  await mkdir(path.join(pkg, "examples"), { recursive: true });
  await mkdir(path.join(pkg, "image"), { recursive: true });
  await mkdir(path.join(pkg, "scripts"), { recursive: true });
  await cp(chartDir, path.join(pkg, "helm/lucy"), { recursive: true });

  const values = (await readFile(path.join(chartDir, "examples/values.k3s-test.yaml"), "utf8")).replace(
    "REPLACE-ME-at-pack-time",
    "customer-amd64-0.17.0-20261008-abcdef0"
  );
  await writeFile(path.join(pkg, "examples/values.k3s-test.yaml"), values);
  await writeFile(path.join(pkg, "image/image-tag.txt"), "customer-amd64-0.17.0-20261008-abcdef0\n");
  await writeFile(path.join(pkg, "image/image-repository.txt"), "project-lucy\n");
  await writeFile(path.join(pkg, "image/delivery-mode.txt"), "offline\n");
  await copyFile(path.join(repoRoot, "scripts/gates/helm-lucy-gate.sh"), path.join(pkg, "scripts/preflight-helm.sh"));
  await copyFile(path.join(repoRoot, "scripts/gates/k8s-acceptance.sh"), path.join(pkg, "scripts/acceptance.sh"));
  await copyFile(path.join(repoRoot, "scripts/gates/k8s-gate-lib.sh"), path.join(pkg, "scripts/k8s-gate-lib.sh"));
  return { dir, pkg };
}

test("package layout: preflight-helm.sh passes when run from the package root", async () => {
  const { dir, pkg } = await buildFakePackage();
  const result = spawnSync("bash", ["scripts/preflight-helm.sh", "--k3s-only"], { cwd: pkg, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /helm\/lucy/);
  assert.match(result.stdout, /ok image project-lucy:customer-amd64-0\.17\.0-20261008-abcdef0/);
  await rm(dir, { recursive: true, force: true });
});

test("package layout: preflight fails when the Secret is mounted over .ktx/secrets again", async () => {
  const { dir, pkg } = await buildFakePackage();
  const deployment = path.join(pkg, "helm/lucy/templates/deployment.yaml");
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(deployment, "utf8");
  await writeFile(
    deployment,
    src.replace(
      "{{- /* Secret is intentionally NOT mounted here: see secrets-sync init. */}}",
      "- name: secrets\n              mountPath: /data/lucy/.ktx/secrets\n              readOnly: false"
    )
  );
  const result = spawnSync("bash", ["scripts/preflight-helm.sh", "--k3s-only"], { cwd: pkg, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\.ktx\/secrets/);
  await rm(dir, { recursive: true, force: true });
});

test("package layout: preflight fails when fullnameOverride is dropped from the k3s profile", async () => {
  const { dir, pkg } = await buildFakePackage();
  const valuesPath = path.join(pkg, "examples/values.k3s-test.yaml");
  const { readFile } = await import("node:fs/promises");
  await writeFile(valuesPath, (await readFile(valuesPath, "utf8")).replace(/^fullnameOverride: lucy$/m, ""));
  const result = spawnSync("bash", ["scripts/preflight-helm.sh", "--k3s-only"], { cwd: pkg, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be named 'lucy'/);
  await rm(dir, { recursive: true, force: true });
});

test("package layout: acceptance.sh runs standalone, separates names, and refuses --token", async () => {
  const { dir, pkg } = await buildFakePackage();
  const help = spawnSync("bash", [path.join(pkg, "scripts/acceptance.sh"), "--help"], { cwd: "/", encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--deployment/);
  assert.match(help.stdout, /--service/);
  assert.match(help.stdout, /LUCY_MCP_TOKEN/);

  const tokenArg = spawnSync(
    "bash",
    [path.join(pkg, "scripts/acceptance.sh"), "--namespace", "x", "--release", "y", "--token", "SECRET-TOKEN-VALUE"],
    { cwd: "/", encoding: "utf8" }
  );
  assert.notEqual(tokenArg.status, 0);
  assert.match(tokenArg.stderr, /LUCY_MCP_TOKEN/);
  assert.doesNotMatch(`${tokenArg.stdout}${tokenArg.stderr}`, /SECRET-TOKEN-VALUE/);
  await rm(dir, { recursive: true, force: true });
});

const gateLib = path.join(repoRoot, "scripts/gates/k8s-gate-lib.sh");

function gate(snippet, stdin = "") {
  return spawnSync("bash", ["-c", `source "${gateLib}"; ${snippet}`], {
    cwd: repoRoot,
    encoding: "utf8",
    input: stdin
  });
}

test("secrets dir mode accepts 0700 and fsGroup setgid 2700, owned by 10001", () => {
  for (const stat of ["2700 10001:10001", "700 10001:10001", "0700 10001:10001"]) {
    const result = gate(`secrets_dir_stat_ok ${JSON.stringify(stat)}`);
    assert.equal(result.status, 0, `${stat}: ${result.stderr}`);
  }
});

test("secrets dir mode rejects group access, setuid, and a non-runtime owner", () => {
  for (const stat of ["770 10001:10001", "750 10001:10001", "4700 10001:10001", "2700 0:0"]) {
    const result = gate(`secrets_dir_stat_ok ${JSON.stringify(stat)}`);
    assert.notEqual(result.status, 0, stat);
  }
});

test("secrets file modes accept 0600 and setgid 2600 for uid 10001 only", () => {
  const ok = gate("secrets_file_stats_ok", "600 10001\n2600 10001\n");
  assert.equal(ok.status, 0, ok.stderr);
  const bad = gate("secrets_file_stats_ok", "644 10001\n600 0\n");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /0600/);
  assert.doesNotMatch(bad.stderr, /644|password/);
});

test("MCP initialize accepts upstream serverInfo name ktx and the local-fallback name", () => {
  const ktx = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "ktx", version: "0.16.0" },
      instructions: "VISIBLE-SCOPE-MUST-NOT-LEAK"
    }
  };
  const ok = gate("mcp_initialize_ok", JSON.stringify(ktx));
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(`${ok.stdout}${ok.stderr}`, /VISIBLE-SCOPE-MUST-NOT-LEAK/);

  const fallback = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "lucy-mcp-proxy", version: "local-fallback" }
    }
  };
  const named = gate("mcp_initialize_ok", JSON.stringify(fallback));
  assert.equal(named.status, 0, named.stderr);
});

test("MCP initialize rejects JSON-RPC errors and a result without serverInfo", () => {
  const errored = gate(
    "mcp_initialize_ok",
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "upstream down" },
      result: { instructions: "VISIBLE-SCOPE-MUST-NOT-LEAK" }
    })
  );
  assert.notEqual(errored.status, 0);
  assert.match(errored.stderr, /upstream down/);
  assert.doesNotMatch(`${errored.stdout}${errored.stderr}`, /VISIBLE-SCOPE-MUST-NOT-LEAK/);

  const missing = gate(
    "mcp_initialize_ok",
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2024-11-05", instructions: "VISIBLE-SCOPE-MUST-NOT-LEAK" }
    })
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /serverInfo/);
  assert.doesNotMatch(`${missing.stdout}${missing.stderr}`, /VISIBLE-SCOPE-MUST-NOT-LEAK/);
});

test("MCP tools/list requires result.tools to be an array", () => {
  const ok = gate(
    "mcp_tools_list_ok",
    JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "lucy_query" }] } })
  );
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(`${ok.stdout}${ok.stderr}`, /lucy_query/);

  const bad = gate(
    "mcp_tools_list_ok",
    JSON.stringify({ jsonrpc: "2.0", id: 2, error: { message: "no session" }, result: { tools: "nope" } })
  );
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /no session/);
});

test("deployment drift flags extra command and hotfix mounts and prints a remove patch", async () => {
  const { writeFile, rm, mkdtemp, readFile } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "lucy-drift-"));
  const desired = {
    spec: {
      template: {
        spec: {
          initContainers: [{ name: "project-migrate" }, { name: "secrets-sync" }],
          containers: [{ name: "lucy", volumeMounts: [{ name: "data", mountPath: "/data/lucy" }] }],
          volumes: [{ name: "data" }, { name: "secrets" }]
        }
      }
    }
  };
  const live = {
    spec: {
      template: {
        spec: {
          initContainers: [
            { name: "project-migrate" },
            { name: "secrets-sync" },
            { name: "hotfix-init" }
          ],
          containers: [{
            name: "lucy",
            command: ["/opt/old-entrypoint.sh"],
            args: ["--legacy"],
            volumeMounts: [
              { name: "data", mountPath: "/data/lucy" },
              { name: "hotfix-config", mountPath: "/opt/hotfix" }
            ]
          }],
          volumes: [{ name: "data" }, { name: "secrets" }, { name: "hotfix-config" }]
        }
      }
    }
  };
  const desiredPath = path.join(root, "desired.json");
  const livePath = path.join(root, "live.json");
  await writeFile(desiredPath, JSON.stringify(desired));
  await writeFile(livePath, JSON.stringify(live));
  const result = run("python3", [
    "scripts/gates/preflight_upgrade_drift.py",
    desiredPath,
    livePath
  ]);
  assert.notEqual(result.status, 0);
  const out = `${result.stdout}${result.stderr}`;
  assert.match(out, /DRIFT command/);
  assert.match(out, /hotfix-config/);
  assert.match(out, /hotfix-init/);
  assert.doesNotMatch(out, /DRIFT initContainer project-migrate/);
  assert.doesNotMatch(out, /DRIFT initContainer secrets-sync/);
  const patch = JSON.parse(out.slice(out.indexOf("[")));
  const paths = patch.map((op) => op.path);
  assert.ok(paths.some((item) => item.endsWith("/command") && patch.find((op) => op.path === item).op === "remove"));
  assert.ok(paths.some((item) => item.includes("hotfix") || item.endsWith("/volumes/2") || item.endsWith("/volumeMounts/1") || item.endsWith("/initContainers/2")));
  assert.ok(patch.some((op) => op.op === "remove" && op.path.endsWith("/volumeMounts/1")));
  assert.ok(patch.some((op) => op.op === "remove" && op.path.endsWith("/volumes/2")));
  await readFile(desiredPath, "utf8");
  await rm(root, { recursive: true, force: true });
});

test("deployment drift is clean when the live pod matches the chart", () => {
  const body = {
    spec: {
      template: {
        spec: {
          initContainers: [{ name: "project-migrate" }, { name: "secrets-sync" }],
          containers: [{ name: "lucy", volumeMounts: [{ name: "data" }] }],
          volumes: [{ name: "data" }]
        }
      }
    }
  };
  const dir = spawnSync("mktemp", ["-d"], { encoding: "utf8" }).stdout.trim();
  const file = path.join(dir, "d.json");
  spawnSync("python3", ["-c", `import json,sys; json.dump(json.loads(sys.argv[1]), open(sys.argv[2],'w'))`, JSON.stringify(body), file]);
  const result = run("python3", ["scripts/gates/preflight_upgrade_drift.py", file, file]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK drift/);
  spawnSync("rm", ["-rf", dir]);
});

test("semantic type scan names varchar and leaves string alone; geometry survives apply-types", async () => {
  const { writeFile, rm, mkdtemp, readFile } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "lucy-types-"));
  const schema = path.join(root, "BIDM.yaml");
  await writeFile(schema, [
    "columns:",
    "  - name: amount",
    "    type: varchar",
    "  - name: note",
    "    type: string",
    "  - name: shape",
    "    type: geometry",
    ""
  ].join("\n"));
  const lib = path.join(repoRoot, "scripts/gates/preflight-upgrade-lib.mjs");
  const scan = run("node", [lib, "scan-types", root]);
  assert.notEqual(scan.status, 0);
  assert.match(scan.stdout, /varchar/);
  assert.match(scan.stdout, /geometry/);
  assert.doesNotMatch(scan.stdout, /note/);
  const applied = run("node", [lib, "apply-types", root, "20261009T000000Z"]);
  assert.notEqual(applied.status, 0);
  assert.match(applied.stdout, /geometry/);
  const body = await readFile(schema, "utf8");
  assert.match(body, /type: string/);
  assert.match(body, /type: geometry/);
  assert.doesNotMatch(body, /type: varchar/);
  const backup = await readFile(`${schema}.backup.20261009T000000Z`, "utf8");
  assert.match(backup, /type: varchar/);
  await rm(root, { recursive: true, force: true });
});

test("access scan reports role tools only, not defaults.known_tools", async () => {
  const { writeFile, rm, mkdtemp, readFile } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "lucy-access-"));
  const file = path.join(root, "access.yaml");
  await writeFile(file, [
    "defaults:",
    "  known_tools:",
    "    - sl_query",
    "    - sl_read_source",
    "  table_touching_tools:",
    "    - sl_query",
    "roles:",
    "  analyst:",
    "    allow:",
    "      tools:",
    "        - lucy_query",
    "        - sl_query",
    "        - sl_read_source",
    ""
  ].join("\n"));
  const lib = path.join(repoRoot, "scripts/gates/preflight-upgrade-lib.mjs");
  const scan = run("node", [lib, "scan-access", file]);
  assert.notEqual(scan.status, 0);
  assert.match(scan.stdout, /ROLE analyst sl_query/);
  assert.match(scan.stdout, /ROLE analyst sl_read_source/);
  assert.doesNotMatch(scan.stdout, /known_tools/);
  const applied = run("node", [lib, "apply-access", file, "20261009T000000Z"]);
  assert.equal(applied.status, 0, applied.stderr);
  const body = await readFile(file, "utf8");
  assert.match(body, /known_tools:[\s\S]*sl_query/);
  assert.match(body, /lucy_query/);
  const backup = await readFile(`${file}.backup.20261009T000000Z`, "utf8");
  assert.match(backup, /sl_query/);
  await rm(root, { recursive: true, force: true });
});

test("pack script ships the gate lib, cleans macOS leftovers and records build identity", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(path.join(repoRoot, "scripts/gates/build-k8s-delivery-package.sh"), "utf8");
  assert.match(src, /k8s-gate-lib\.sh.*scripts\/k8s-gate-lib\.sh/);
  assert.match(src, /COPYFILE_DISABLE=1 tar/);
  assert.match(src, /BUILD-INFO\.json/);
  assert.match(src, /k3s ctr images import/);
  assert.match(src, /--skip-ktx-exec/);
});
