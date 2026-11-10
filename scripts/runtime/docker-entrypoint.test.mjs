#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("../..", import.meta.url).pathname);
const require = createRequire(path.join(repoRoot, "webui/package.json"));
const { parse: parseYaml } = require("yaml");

const entrypoint = path.join(repoRoot, "scripts/runtime/docker-entrypoint.sh");

async function makeRoot(prefix) {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

function runSeedOnly(templateRoot, projectRoot, extraEnv = {}) {
  return spawnSync("bash", [entrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LUCY_APP_ROOT: repoRoot,
      LUCY_TEMPLATE_ROOT: templateRoot,
      KTX_PROJECT_ROOT: projectRoot,
      LUCY_BUNDLED_KTX_VERSION: "test-version",
      LUCY_ENTRYPOINT_SEED_ONLY: "1",
      ...extraEnv
    },
    encoding: "utf8"
  });
}

function runSeedOnlyAllowingPlaceholders(templateRoot, projectRoot) {
  return spawnSync("bash", [entrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LUCY_APP_ROOT: repoRoot,
      LUCY_TEMPLATE_ROOT: templateRoot,
      KTX_PROJECT_ROOT: projectRoot,
      LUCY_BUNDLED_KTX_VERSION: "test-version",
      LUCY_ENTRYPOINT_SEED_ONLY: "1",
      LUCY_ALLOW_PLACEHOLDER_KTX: "1"
    },
    encoding: "utf8"
  });
}

test("entrypoint refuses placeholder ktx.yaml by default", async () => {
  const root = await makeRoot("lucy-entrypoint-placeholder-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections:\n  mysql-aliyun:\n    host: <CHANGE-ME-MYSQL-HOST>\n");

  const result = runSeedOnly(templateRoot, projectRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ktx.yaml contains CHANGE-ME placeholders/);

  await rm(root, { recursive: true, force: true });
});

test("entrypoint can explicitly allow placeholder ktx.yaml for template-only demos", async () => {
  const root = await makeRoot("lucy-entrypoint-placeholder-allow-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections:\n  mysql-aliyun:\n    host: <CHANGE-ME-MYSQL-HOST>\n");

  const result = runSeedOnlyAllowingPlaceholders(templateRoot, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /still contains CHANGE-ME placeholders/);

  await rm(root, { recursive: true, force: true });
});

test("entrypoint restores missing semantic context for an existing volume", async () => {
  const root = await makeRoot("lucy-entrypoint-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(templateRoot, { recursive: true });
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/orders.yaml"), "grain: order\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");

  const result = runSeedOnly(templateRoot, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /synced 2 missing semantic-layer \(config\) file/);
  await assert.doesNotReject(readFile(path.join(projectRoot, "config/semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(projectRoot, "config/semantic-layer/mysql-aliyun/orders.yaml"), "utf8"));
  // Spec 149：客户自己的 ktx.yaml 不被改写；唯一的新增是运维问数连接块。
  const seededYaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
  assert.match(seededYaml, /lucy-ops:/);
  assert.doesNotMatch(seededYaml, /mysql-aliyun:/);

  await rm(root, { recursive: true, force: true });
});

test("entrypoint does not overwrite existing customer semantic context", async () => {
  const root = await makeRoot("lucy-entrypoint-preserve-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "config/semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables:\n  orders: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/orders.yaml"), "grain: order\nmeasures:\n  - name: new_metric\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(projectRoot, "config/semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(projectRoot, "config/semantic-layer/mysql-aliyun/orders.yaml"), "grain: order\n");

  const result = runSeedOnly(templateRoot, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preserved 2 existing semantic-layer \(config\) file/);
  assert.doesNotMatch(result.stdout, /refreshed .* changed/);
  assert.equal(
    await readFile(path.join(projectRoot, "config/semantic-layer/mysql-aliyun/orders.yaml"), "utf8"),
    "grain: order\n"
  );
  assert.equal(
    await readFile(path.join(projectRoot, "config/semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "utf8"),
    "tables: {}\n"
  );
  // Spec 149：客户的连接块不被改写；唯一的新增是运维问数连接块。
  const preservedYaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
  assert.match(preservedYaml, /lucy-ops:/);
  assert.doesNotMatch(preservedYaml, /mysql-aliyun:/);

  await rm(root, { recursive: true, force: true });
});

test("entrypoint skips template sync when LUCY_DISABLE_TEMPLATE_SYNC=1", async () => {
  const root = await makeRoot("lucy-entrypoint-nosync-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/customer-db/_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "config/semantic-layer/customer-db/_schema"), { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/customer-db/_schema/analytics.yaml"), "tables: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/customer-db/extra.yaml"), "grain: row\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(projectRoot, "config/semantic-layer/customer-db/_schema/analytics.yaml"), "tables: {}\n");

  const result = spawnSync("bash", [entrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LUCY_APP_ROOT: repoRoot,
      LUCY_TEMPLATE_ROOT: templateRoot,
      KTX_PROJECT_ROOT: projectRoot,
      LUCY_BUNDLED_KTX_VERSION: "test-version",
      LUCY_ENTRYPOINT_SEED_ONLY: "1",
      LUCY_DISABLE_TEMPLATE_SYNC: "1"
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /template sync disabled/);
  await assert.rejects(readFile(path.join(projectRoot, "config/semantic-layer/customer-db/extra.yaml"), "utf8"));

  await rm(root, { recursive: true, force: true });
});

test("entrypoint refuses to start when the template and project have no schema files", async () => {
  const root = await makeRoot("lucy-entrypoint-empty-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(templateRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");

  const result = runSeedOnly(templateRoot, projectRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /semantic-layer has no YAML files/);

  await rm(root, { recursive: true, force: true });
});

test("entrypoint initializes git repository on empty project volume", async () => {
  const root = await makeRoot("lucy-entrypoint-git-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");

  const result = runSeedOnly(templateRoot, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /initialized git repository/);
  await assert.doesNotReject(readFile(path.join(projectRoot, ".git", "HEAD"), "utf8"));

  await rm(root, { recursive: true, force: true });
});

test("entrypoint does not re-init when .git already exists", async () => {
  const root = await makeRoot("lucy-entrypoint-git-existing-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(projectRoot, { recursive: true });
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, ".git"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(projectRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");

  const result = runSeedOnly(templateRoot, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /initialized git repository/);
  assert.equal(await readFile(path.join(projectRoot, ".git", "HEAD"), "utf8"), "ref: refs/heads/main\n");

  await rm(root, { recursive: true, force: true });
});

test("entrypoint keeps historical access.yaml tokens when ktx.yaml is missing", async () => {
  const root = await makeRoot("lucy-entrypoint-tokens-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(path.join(templateRoot, "webui/config"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui/config"), { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(templateRoot, "webui/config/access.yaml"), "users:\n  - id: demo\n    tokens: []\n");
  const historical = "users:\n  - id: alice\n    tokens:\n      - hash: sha256:historical\n        label: laptop\n";
  await writeFile(path.join(projectRoot, "webui/config/access.yaml"), historical);

  const result = runSeedOnly(templateRoot, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  const doc = parseYaml(await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8"));
  assert.equal(doc.users.length, 1);
  assert.equal(doc.users[0].id, "alice");
  assert.deepEqual(doc.users[0].tokens, [{ hash: "sha256:historical", label: "laptop" }]);
  assert.equal(doc.users.some((user) => user.id === "demo"), false);
  assert.equal(doc.roles.lucy_admin.allow.source_scope, "catalog_bound");

  await rm(root, { recursive: true, force: true });
});

test("entrypoint reuses the persistent KTX internal token across starts", async () => {
  const root = await makeRoot("lucy-entrypoint-internal-token-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");

  const first = runSeedOnly(templateRoot, projectRoot);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /created persistent KTX internal token/);
  const tokenPath = path.join(projectRoot, ".ktx-ui/ktx-internal-token");
  const persisted = (await readFile(tokenPath, "utf8")).trim();
  assert.match(persisted, /^[a-f0-9]{64}$/);

  const second = runSeedOnly(templateRoot, projectRoot);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /reused persistent KTX internal token/);
  assert.equal((await readFile(tokenPath, "utf8")).trim(), persisted);

  await rm(root, { recursive: true, force: true });
});

function writeMinimalTemplate(templateRoot, projectRoot) {
  return Promise.all([
    mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true }),
    mkdir(projectRoot, { recursive: true })
  ]).then(async () => {
    await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
    await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  });
}

function runSeedOnlyWithEnv(templateRoot, projectRoot, extraEnv) {
  const env = { ...process.env };
  for (const key of [
    "LUCY_DEPLOYMENT_MODE",
    "LUCY_WEBUI_AUTH",
    "LUCY_WEBUI_COOKIE_SECURE",
    "LUCY_WEBUI_TEST_PROFILE",
    "LUCY_WEBUI_ACCESS",
    "LUCY_CHART_DEPLOYMENT_MODE"
  ]) {
    delete env[key];
  }
  return spawnSync("bash", [entrypoint], {
    cwd: repoRoot,
    env: {
      ...env,
      LUCY_APP_ROOT: repoRoot,
      LUCY_TEMPLATE_ROOT: templateRoot,
      KTX_PROJECT_ROOT: projectRoot,
      LUCY_BUNDLED_KTX_VERSION: "test-version",
      LUCY_ENTRYPOINT_SEED_ONLY: "1",
      ...extraEnv
    },
    encoding: "utf8"
  });
}

test("entrypoint refuses to start in customer mode with LUCY_WEBUI_AUTH=off (explicit and default mode)", async () => {
  for (const extraEnv of [
    { LUCY_DEPLOYMENT_MODE: "customer", LUCY_WEBUI_AUTH: "off" },
    { LUCY_WEBUI_AUTH: "off" },
    { LUCY_DEPLOYMENT_MODE: " Customer ", LUCY_WEBUI_AUTH: " OFF " }
  ]) {
    const root = await makeRoot("lucy-entrypoint-customer-off-");
    const templateRoot = path.join(root, "template");
    const projectRoot = path.join(root, "project");
    await writeMinimalTemplate(templateRoot, projectRoot);

    const result = runSeedOnlyWithEnv(templateRoot, projectRoot, extraEnv);
    assert.notEqual(result.status, 0, JSON.stringify(extraEnv));
    assert.match(result.stderr, /LUCY_WEBUI_AUTH=off is not allowed when LUCY_DEPLOYMENT_MODE=customer/);
    // Preflight runs before any seeding.
    await assert.rejects(readFile(path.join(projectRoot, "ktx.yaml"), "utf8"));

    await rm(root, { recursive: true, force: true });
  }
});

test("entrypoint allows development mode with LUCY_WEBUI_AUTH=off and customer mode with auth required/unset", async () => {
  for (const extraEnv of [
    { LUCY_DEPLOYMENT_MODE: "development", LUCY_WEBUI_AUTH: "off" },
    { LUCY_DEPLOYMENT_MODE: "customer", LUCY_WEBUI_AUTH: "required" },
    { LUCY_DEPLOYMENT_MODE: "customer" },
    {}
  ]) {
    const root = await makeRoot("lucy-entrypoint-mode-ok-");
    const templateRoot = path.join(root, "template");
    const projectRoot = path.join(root, "project");
    await writeMinimalTemplate(templateRoot, projectRoot);

    const result = runSeedOnlyWithEnv(templateRoot, projectRoot, extraEnv);
    assert.equal(result.status, 0, `${JSON.stringify(extraEnv)}: ${result.stderr}`);

    await rm(root, { recursive: true, force: true });
  }
});

test("entrypoint refuses an invalid LUCY_DEPLOYMENT_MODE", async () => {
  const root = await makeRoot("lucy-entrypoint-mode-invalid-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await writeMinimalTemplate(templateRoot, projectRoot);

  const result = runSeedOnlyWithEnv(templateRoot, projectRoot, { LUCY_DEPLOYMENT_MODE: "prod" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid LUCY_DEPLOYMENT_MODE/);

  await rm(root, { recursive: true, force: true });
});

test("entrypoint refuses customer mode with LUCY_WEBUI_COOKIE_SECURE=0 unless the explicit test profile is set", async () => {
  for (const extraEnv of [
    { LUCY_DEPLOYMENT_MODE: "customer", LUCY_WEBUI_COOKIE_SECURE: "0" },
    { LUCY_WEBUI_COOKIE_SECURE: " false " },
    { LUCY_DEPLOYMENT_MODE: "customer", LUCY_WEBUI_COOKIE_SECURE: "0", LUCY_WEBUI_TEST_PROFILE: "0" }
  ]) {
    const root = await makeRoot("lucy-entrypoint-cookie-");
    const templateRoot = path.join(root, "template");
    const projectRoot = path.join(root, "project");
    await writeMinimalTemplate(templateRoot, projectRoot);

    const result = runSeedOnlyWithEnv(templateRoot, projectRoot, extraEnv);
    assert.notEqual(result.status, 0, JSON.stringify(extraEnv));
    assert.match(result.stderr, /LUCY_WEBUI_COOKIE_SECURE=0 is not allowed when LUCY_DEPLOYMENT_MODE=customer/);
    await assert.rejects(readFile(path.join(projectRoot, "ktx.yaml"), "utf8"));

    await rm(root, { recursive: true, force: true });
  }
});

test("entrypoint allows insecure cookies only for the test profile or development, and Secure in customer", async () => {
  for (const extraEnv of [
    { LUCY_DEPLOYMENT_MODE: "customer", LUCY_WEBUI_COOKIE_SECURE: "0", LUCY_WEBUI_TEST_PROFILE: "1" },
    { LUCY_DEPLOYMENT_MODE: "customer", LUCY_WEBUI_COOKIE_SECURE: "0", LUCY_WEBUI_ACCESS: "http" },
    { LUCY_DEPLOYMENT_MODE: "customer", LUCY_WEBUI_COOKIE_SECURE: "1" },
    { LUCY_DEPLOYMENT_MODE: "development", LUCY_WEBUI_COOKIE_SECURE: "0" }
  ]) {
    const root = await makeRoot("lucy-entrypoint-cookie-ok-");
    const templateRoot = path.join(root, "template");
    const projectRoot = path.join(root, "project");
    await writeMinimalTemplate(templateRoot, projectRoot);

    const result = runSeedOnlyWithEnv(templateRoot, projectRoot, extraEnv);
    assert.equal(result.status, 0, `${JSON.stringify(extraEnv)}: ${result.stderr}`);

    await rm(root, { recursive: true, force: true });
  }
});

test("entrypoint refuses a deployment mode that contradicts the Chart-pinned mode (extraEnvFrom override)", async () => {
  for (const extraEnv of [
    { LUCY_CHART_DEPLOYMENT_MODE: "customer", LUCY_DEPLOYMENT_MODE: "development" },
    { LUCY_CHART_DEPLOYMENT_MODE: " Customer ", LUCY_DEPLOYMENT_MODE: "development", LUCY_WEBUI_AUTH: "off" }
  ]) {
    const root = await makeRoot("lucy-entrypoint-chart-pin-");
    const templateRoot = path.join(root, "template");
    const projectRoot = path.join(root, "project");
    await writeMinimalTemplate(templateRoot, projectRoot);

    const result = runSeedOnlyWithEnv(templateRoot, projectRoot, extraEnv);
    assert.notEqual(result.status, 0, JSON.stringify(extraEnv));
    assert.match(result.stderr, /contradicts the Chart-pinned mode customer/);
    await assert.rejects(readFile(path.join(projectRoot, "ktx.yaml"), "utf8"));

    await rm(root, { recursive: true, force: true });
  }

  const root = await makeRoot("lucy-entrypoint-chart-pin-ok-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await writeMinimalTemplate(templateRoot, projectRoot);
  const ok = runSeedOnlyWithEnv(templateRoot, projectRoot, {
    LUCY_CHART_DEPLOYMENT_MODE: "customer",
    LUCY_DEPLOYMENT_MODE: "customer"
  });
  assert.equal(ok.status, 0, ok.stderr);
  await rm(root, { recursive: true, force: true });
});

// Spec 149 §8 / WO T7 — 启动顺序：运维问数连接必须在 KTX daemon 启动之前就位。
test("entrypoint seeds the ops evidence connection before the daemon starts (SC-19)", async () => {
  const root = await makeRoot("lucy-entrypoint-ops-evidence-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");

  const result = runSeedOnly(templateRoot, projectRoot);
  assert.equal(result.status, 0, result.stderr);

  // 连接块：只读、sqlite、启用表用冻结的 physicalTable。
  const yaml = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
  assert.match(yaml, /lucy-ops:/);
  assert.match(yaml, /driver: sqlite/);
  assert.match(yaml, /readonly: true/);
  assert.match(yaml, /- ops_calls/);
  assert.match(yaml, /- ops_call_tables/);
  // Goal 5 — 不进 setup.database_connection_ids。
  const setupSection = yaml.split("setup:")[1] ?? "";
  assert.ok(!setupSection.includes("lucy-ops"), setupSection);

  // 项目根同级目录（KTX 读取的位置）已有语义、Skill 与 Wiki。
  await access(path.join(projectRoot, "semantic-layer/lucy-ops/_schema/main.yaml"));
  await access(path.join(projectRoot, "semantic-layer/lucy-ops/ops_calls.yaml"));
  await access(path.join(projectRoot, "skills/lucy-ops/ops-questioning.md"));
  await access(path.join(projectRoot, "wiki/lucy-ops/ops-questioning.md"));

  // 内容根是事实源：资产先落在内容根，再镜像到项目根。
  await access(path.join(projectRoot, "config/semantic-layer/lucy-ops/_schema/main.yaml"));

  // 摘要戳存在且等于当前 ktx.yaml 的摘要 → 就绪为 current。
  const stamp = (await readFile(path.join(projectRoot, ".lucy-seed/ops-evidence-ktx-digest"), "utf8")).trim();
  assert.match(stamp, /^[0-9a-f]{64}$/);
  const digest = createHash("sha256").update(await readFile(path.join(projectRoot, "ktx.yaml"))).digest("hex");
  assert.equal(stamp, digest);

  // 没有发出 Spec 191 的重载请求（自动重载被明确排除）。
  await assert.rejects(access(path.join(projectRoot, ".ktx-ui/ktx-reload.request")));

  await rm(root, { recursive: true, force: true });
});

test("entrypoint ensures lucy_admin for every template instead of the demo-only patch", async () => {
  const source = await readFile(entrypoint, "utf8");
  assert.match(source, /ensure_system_formal_role lucy_admin/);
  assert.match(source, /patch_demo_skill_tools/);
  assert.doesNotMatch(source, /patch_lucy_admin_tools/);
});

test("entrypoint appends missing lucy_admin tools without rewriting an existing role", async () => {
  const root = await makeRoot("lucy-entrypoint-admin-continue-");
  const templateRoot = path.join(root, "examples/docker-demo/project-template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui/config"), { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
  const accessYaml = `roles:
  lucy_admin:
    description: 平台运维数据面
    permission_model_version: 2
    allow:
      connections:
        - demo-mysql
      source_scope: catalog_bound
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_begin_question
        - sl_validate
        - lucy_skill_search
        - lucy_skill_read
        - lucy_certified_route
        - lucy_report_template
  chatbi-analyst:
    description: 业务只读
    allow:
      tools:
        - lucy_begin_question
users:
  - id: customer_agent
    name: Customer Agent
    enabled: true
    note: keep
    role: chatbi-analyst
    tokens: []
`;
  await writeFile(path.join(projectRoot, "webui/config/access.yaml"), accessYaml);
  const auditDb = path.join(projectRoot, ".ktx-ui", "audit.sqlite");

  const first = runSeedOnly(templateRoot, projectRoot, { LUCY_AUDIT_DB: auditDb });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /lucy_admin wrote=true branch=B/);
  const patched = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
  const doc = parseYaml(patched);
  assert.equal(doc.roles.lucy_admin.description, "平台运维数据面");
  assert.deepEqual(doc.roles.lucy_admin.allow.connections, ["demo-mysql"]);
  assert.equal(doc.roles.lucy_admin.allow.source_scope, "catalog_bound");
  assert.deepEqual(doc.roles.lucy_admin.allow.tools.slice(0, 8), [
    "lucy_catalog",
    "lucy_query",
    "lucy_begin_question",
    "sl_validate",
    "lucy_skill_search",
    "lucy_skill_read",
    "lucy_certified_route",
    "lucy_report_template"
  ]);
  assert.equal(doc.roles.lucy_admin.allow.tools.filter((tool) => tool === "lucy_continue_question").length, 1);
  assert.ok(doc.roles.lucy_admin.allow.tools.includes("lucy_read_source"));
  assert.deepEqual(doc.roles["chatbi-analyst"].allow.tools, ["lucy_begin_question"]);
  assert.equal(doc.users.length, 1);
  assert.equal(doc.users[0].id, "customer_agent");
  assert.equal(doc.users[0].role, "chatbi-analyst");
  assert.equal(doc.users.some((user) => user.id === "demo_ops"), false);
  assert.doesNotMatch(patched, /lucy_ops_connection_tables|lucy_ops_source_import/);

  const second = runSeedOnly(templateRoot, projectRoot, { LUCY_AUDIT_DB: auditDb });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /lucy_admin wrote=false/);
  assert.equal(await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8"), patched);

  await rm(root, { recursive: true, force: true });
});

test("entrypoint creates a missing lucy_admin on a non-demo template", async () => {
  const root = await makeRoot("lucy-entrypoint-admin-create-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui/config"), { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
  const accessYaml = `roles:
  customer_readonly:
    description: example
    allow:
      tools:
        - lucy_query
users:
  - id: customer_agent
    name: Customer Agent
    enabled: true
    note: keep
    role: customer_readonly
    tokens: []
`;
  await writeFile(path.join(projectRoot, "webui/config/access.yaml"), accessYaml);
  const auditDb = path.join(projectRoot, ".ktx-ui", "audit.sqlite");

  const first = runSeedOnly(templateRoot, projectRoot, { LUCY_AUDIT_DB: auditDb });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /lucy_admin wrote=true branch=A/);
  const patched = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
  const doc = parseYaml(patched);
  assert.equal(doc.roles.lucy_admin.permission_model_version, 2);
  assert.equal(doc.roles.lucy_admin.allow.source_scope, "catalog_bound");
  assert.deepEqual(doc.roles.lucy_admin.allow.connections, ["*"]);
  assert.equal(doc.users.length, 1);
  assert.equal(doc.users[0].role, "customer_readonly");
  assert.equal(doc.users.some((user) => user.id === "demo_ops"), false);

  const second = runSeedOnly(templateRoot, projectRoot, { LUCY_AUDIT_DB: auditDb });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8"), patched);

  await rm(root, { recursive: true, force: true });
});

// Spec 191 — supervisor owns the KTX MCP daemon (foreground process, backgrounded
// with &) so WebUI can request reload after ktx.yaml writes without tearing down
// the container. Start lives in ktx_start_daemon; lifecycle is supervise_ktx.
test("entrypoint supervises a KTX MCP daemon for reload", async () => {
  const source = await readFile(entrypoint, "utf8");
  const startBlock = source.match(/ktx_start_daemon\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(startBlock, /ktx mcp start \\/);
  assert.match(startBlock, /--foreground &/);
  assert.match(source, /supervise_ktx\(\)/);
  assert.match(source, /wait -n /);
  assert.match(source, /KTX_RELOAD_REQUEST_FILE/);
  assert.match(source, /KTX_SUPERVISOR_SELF_PID="\$\{BASHPID:-\$\$\}"/);
});

test("supervisor pid published from a command substitution stays alive", () => {
  const result = spawnSync("bash", ["-c", `
    set -euo pipefail
    KTX_SUPERVISOR_SELF_PID="\${BASHPID:-\$\$}"
    eval "$(awk '/^ktx_supervisor_pid\\(\\) \\{/,/^}/' "$1")"
    published="$(printf '%s' "$(ktx_supervisor_pid)")"
    test "$published" = "$KTX_SUPERVISOR_SELF_PID"
    kill -0 "$published"
  `, "bash", entrypoint], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
