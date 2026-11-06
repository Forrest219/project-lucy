import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCKER_MYSQL_CLIENT_CNF_PATH,
  REGION_ASSERT_SHAPE,
  buildDockerMysqlRunArgs,
  buildGoldFromCounts,
  buildLocalMysqlCliArgs,
  normalizeRegionCounts,
  parseRegionCountBatchOutput
} from "../../../examples/row-policy-e2e/gold/compute-readonly-gold.mjs";
import { REGIONS } from "../lib/row-policy-pack.mjs";

test("assertShape eastOnly is 华东 and union is 华东+西南", () => {
  assert.deepEqual(REGION_ASSERT_SHAPE.eastOnly, ["华东"]);
  assert.deepEqual(REGION_ASSERT_SHAPE.union, ["华东", "西南"]);
});

test("buildGoldFromCounts from fake query rows", () => {
  const gold = buildGoldFromCounts([
    { Region: REGIONS.A, c: 10194 },
    { Region: REGIONS.B, c: 512 },
    { Region: "华北", c: 0 }
  ]);
  assert.equal(gold.regions[REGIONS.A], 10194);
  assert.equal(gold.regions[REGIONS.B], 512);
  assert.equal(gold.regions["华北"], 0);
  assert.deepEqual(gold.assertShape.eastOnly, ["华东"]);
  assert.deepEqual(gold.assertShape.union, ["华东", "西南"]);
  assert.deepEqual(gold.readonlyGold.assertShape, gold.assertShape);
  assert.deepEqual(gold.readonlyGold.regions, gold.regions);
});

test("buildGoldFromCounts from region count map", () => {
  const gold = buildGoldFromCounts({ [REGIONS.A]: 42, [REGIONS.B]: 24 });
  assert.deepEqual(gold.regions, { [REGIONS.A]: 42, [REGIONS.B]: 24 });
});

test("normalizeRegionCounts rejects invalid map values", () => {
  assert.throws(() => normalizeRegionCounts({ 华东: -1 }), /invalid count/);
});

test("parseRegionCountBatchOutput parses mysql batch lines", () => {
  const rows = parseRegionCountBatchOutput("华东\t10194\n西南\t512\n");
  assert.deepEqual(rows, [
    { Region: "华东", c: 10194 },
    { Region: "西南", c: 512 }
  ]);
  assert.deepEqual(buildGoldFromCounts(rows).assertShape.union, ["华东", "西南"]);
});

test("buildLocalMysqlCliArgs uses host defaults-extra-file path", () => {
  assert.deepEqual(buildLocalMysqlCliArgs("/tmp/client.cnf", "SELECT 1"), [
    "--defaults-extra-file=/tmp/client.cnf",
    "-N",
    "-B",
    "-e",
    "SELECT 1"
  ]);
});

test("buildDockerMysqlRunArgs mounts host cnf for container defaults-extra-file", () => {
  const hostCnf = "/var/folders/xx/client.cnf";
  const sql = "SELECT `Region`, COUNT(*) AS c FROM `dataforai`.`superstore_orders` GROUP BY `Region`";
  assert.deepEqual(buildDockerMysqlRunArgs(hostCnf, sql), [
    "run",
    "--rm",
    "-v",
    `${hostCnf}:${DOCKER_MYSQL_CLIENT_CNF_PATH}:ro`,
    "mysql:8.4",
    "mysql",
    `--defaults-extra-file=${DOCKER_MYSQL_CLIENT_CNF_PATH}`,
    "-N",
    "-B",
    "-e",
    sql
  ]);
});
