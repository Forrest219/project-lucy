#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const entrypoint = path.join(repoRoot, "scripts/docker-entrypoint.sh");

async function makeRoot(prefix) {
  return await mkdtemp(path.join(tmpdir(), prefix));
}

function runSeedOnly(templateRoot, projectRoot) {
  return spawnSync("bash", [entrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LUCY_APP_ROOT: repoRoot,
      LUCY_TEMPLATE_ROOT: templateRoot,
      KTX_PROJECT_ROOT: projectRoot,
      LUCY_BUNDLED_KTX_VERSION: "test-version",
      LUCY_ENTRYPOINT_SEED_ONLY: "1"
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
  assert.match(result.stdout, /synced 2 missing semantic-layer file/);
  await assert.doesNotReject(readFile(path.join(projectRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "utf8"));
  await assert.doesNotReject(readFile(path.join(projectRoot, "semantic-layer/mysql-aliyun/orders.yaml"), "utf8"));
  assert.equal(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8"), "connections: {}\n");

  await rm(root, { recursive: true, force: true });
});

test("entrypoint refreshes changed semantic context for an existing volume", async () => {
  const root = await makeRoot("lucy-entrypoint-refresh-");
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  await mkdir(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer/mysql-aliyun/_schema"), { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables:\n  orders: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer/mysql-aliyun/orders.yaml"), "grain: order\nmeasures:\n  - name: new_metric\n");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(projectRoot, "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"), "tables: {}\n");
  await writeFile(path.join(projectRoot, "semantic-layer/mysql-aliyun/orders.yaml"), "grain: order\n");

  const result = runSeedOnly(templateRoot, projectRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /refreshed 2 changed semantic-layer file/);
  assert.equal(
    await readFile(path.join(projectRoot, "semantic-layer/mysql-aliyun/orders.yaml"), "utf8"),
    "grain: order\nmeasures:\n  - name: new_metric\n"
  );
  assert.equal(await readFile(path.join(projectRoot, "ktx.yaml"), "utf8"), "connections: {}\n");

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
