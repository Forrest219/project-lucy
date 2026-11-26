#!/usr/bin/env node
/**
 * seed-customer-stability.mjs 单测：全内存替身 deps，按 Lucy 真实契约验证
 * ktx.yaml（driver/username/schemas/enabled_tables）、_schema/*.yaml 布局、
 * 幂等防覆盖（N4）、dry-run 与缺容器退出码 2。
 */
import assert from "node:assert/strict";
import test from "node:test";
import YAML from "yaml";
import {
  buildSchemaManifestYaml,
  mergeKtxConnections,
  parseArgs,
  planCustomerStabilitySeed,
  runSeed,
} from "../seed-customer-stability.mjs";

test("parseArgs：支持 --dry-run/--force/--skip-restart，拒绝未知参数", () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, force: false, skipRestart: false });
  assert.deepEqual(parseArgs(["--dry-run", "--skip-restart"]), { dryRun: true, force: false, skipRestart: true });
  assert.ok(parseArgs(["--bogus"]).error);
});

test("planCustomerStabilitySeed：从默认 2 连接 / 2 Schema / 1200 表补齐到 10 / 30 / 3500 并跳过已有同名 Schema", () => {
  const plan = planCustomerStabilitySeed({
    existingConnections: ["demo-mysql", "lucy-ops"],
    existingSchemaKeys: ["demo-mysql/dataforai", "uat_cs_conn_01/cs_schema_01"],
    existingTables: 1200,
  });
  assert.equal(plan.connectionsToAdd.length, 8);
  assert.equal(plan.connectionsToAdd[0], "uat_cs_conn_01");
  assert.equal(plan.connectionsToAdd[7], "uat_cs_conn_08");
  assert.equal(plan.schemasToCreate.length, 28);
  assert.ok(!plan.schemasToCreate.some((s) => s.conn === "uat_cs_conn_01" && s.schema === "cs_schema_01"));
  assert.equal(plan.tablesNeeded, 2300);
});

test("planCustomerStabilitySeed：已达标时全部为 0（幂等）", () => {
  const plan = planCustomerStabilitySeed({
    existingConnections: Array.from({ length: 10 }, (_, i) => `c${i}`),
    existingSchemas: 32,
    existingTables: 3600,
  });
  assert.equal(plan.connectionsToAdd.length, 0);
  assert.equal(plan.schemasToCreate.length, 0);
  assert.equal(plan.tablesNeeded, 0);
});

test("mergeKtxConnections（B2）：按真实 ktx.yaml 契约写入 driver/username/schemas/enabled_tables 并保留既有连接", () => {
  const raw = YAML.stringify({
    connections: { "demo-mysql": { driver: "mysql", host: "demo-db", database: "dataforai", username: "lucy" } },
  });
  const { text, added } = mergeKtxConnections(raw, ["uat_cs_conn_01", "uat_cs_conn_02"], {
    schemasByConn: { uat_cs_conn_01: ["cs_schema_01", "cs_schema_09"] },
  });
  assert.equal(added, 2);
  const parsed = YAML.parse(text);
  assert.equal(parsed.connections["demo-mysql"].database, "dataforai");
  assert.equal(parsed.connections["uat_cs_conn_01"].driver, "mysql");
  assert.equal(parsed.connections["uat_cs_conn_01"].username, "lucy");
  assert.equal(parsed.connections["uat_cs_conn_01"].type, undefined);
  assert.equal(parsed.connections["uat_cs_conn_01"].user, undefined);
  assert.deepEqual(parsed.connections["uat_cs_conn_01"].schemas, ["cs_schema_01", "cs_schema_09"]);
  assert.deepEqual(parsed.connections["uat_cs_conn_01"].enabled_tables, ["uat_scale_mysql.t_00001"]);
});

test("buildSchemaManifestYaml（B3）：输出符合 _schema/<schema>.yaml 契约的顶层 tables 结构", () => {
  const parsed = YAML.parse(buildSchemaManifestYaml());
  assert.deepEqual(Object.keys(parsed), ["tables"]);
  assert.equal(parsed.tables.t_00001.table, "uat_scale_mysql.t_00001");
  assert.ok(Array.isArray(parsed.tables.t_00001.columns));
});

test("runSeed：dry-run 不写入；真实模式按需写入、校验连接并重启一次；容器未起返回 2", async () => {
  const calls = { writeKtx: 0, writeSchemas: 0, seedMysql: 0, restart: 0, verify: 0 };
  let tableCount = 1200;
  const makeDeps = (running = true) => ({
    lucyContainer: "compose-lucy-1",
    dbContainer: "compose-demo-db-1",
    running: () => running,
    readKtxYaml: () => YAML.stringify({ connections: { "demo-mysql": { driver: "mysql" }, "lucy-ops": { driver: "sqlite" } } }),
    writeKtxYaml: () => { calls.writeKtx += 1; },
    detectSemanticLayerRoot: () => "/data/lucy/config/semantic-layer",
    listSchemaKeys: () => ["demo-mysql/dataforai"],
    writeSchemaManifests: (_root, entries) => {
      calls.writeSchemas += entries.length;
      return { written: entries.length, skipped: 0 };
    },
    countMysqlTables: () => tableCount,
    seedMysqlTables: (_db, target) => { calls.seedMysql += 1; tableCount = target + 1; },
    verifyKtxConnectionsLoaded: () => { calls.verify += 1; return { total: 10, invalid: [] }; },
    restartLucy: () => { calls.restart += 1; },
  });
  const io = { log: () => {}, error: () => {} };

  assert.equal(await runSeed([], makeDeps(false), io), 2);
  assert.equal(await runSeed(["--dry-run"], makeDeps(true), io), 0);
  assert.equal(calls.writeKtx, 0);
  assert.equal(calls.writeSchemas, 0);

  assert.equal(await runSeed([], makeDeps(true), io), 0);
  assert.equal(calls.writeKtx, 1);
  assert.equal(calls.writeSchemas, 29);
  assert.equal(calls.seedMysql, 1);
  assert.equal(calls.verify, 1);
  assert.equal(calls.restart, 1);
});
