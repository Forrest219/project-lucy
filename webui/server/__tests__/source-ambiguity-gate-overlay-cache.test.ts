/**
 * P1-82 — 门闩装配的 overlay 名字走带校验的解析缓存：
 * 重复装配不再重新解析全部 overlay，文件变化下一次调用即生效，并发装配结果一致。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMatchableSourcesForGate } from "../proxy/source-ambiguity-gate";
import { resetDescriptionIndexCacheForTests } from "../proxy/source-descriptions";
import { catalogYamlParseMsTotal } from "../catalog-yaml-cache";
import { readEntryPerfCounters } from "../entry-performance-timing";

const CONN = "conn-a";
let root: string;
let layer: string;

const overlay = (name: string, measure: string) =>
  `name: ${name}\ntable: dataforai.${name}\nmeasures:\n  - name: ${measure}\n`;

async function seed(count: number): Promise<Array<{ connectionId: string; schema: string; sourceName: string; table: string }>> {
  await mkdir(path.join(layer, CONN, "_schema"), { recursive: true });
  const sources = [];
  for (let i = 0; i < count; i += 1) {
    const sourceName = `t${i}`;
    await writeFile(path.join(layer, CONN, `${sourceName}.yaml`), overlay(sourceName, `m${i}`));
    sources.push({ connectionId: CONN, schema: "dataforai", sourceName, table: `dataforai.${sourceName}` });
  }
  return sources;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-gate-overlay-"));
  layer = path.join(root, "semantic-layer");
  resetDescriptionIndexCacheForTests();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("门闩 overlay 名字缓存（P1-82）", () => {
  it("第二次装配不重新解析 overlay，结果一致", async () => {
    const sources = await seed(40);
    const first = await buildMatchableSourcesForGate(sources as never, { semanticLayerRoot: layer });
    const parsesAfterFirst = readEntryPerfCounters().catalogYamlParses;
    const second = await buildMatchableSourcesForGate(sources as never, { semanticLayerRoot: layer });
    expect(readEntryPerfCounters().catalogYamlParses).toBe(parsesAfterFirst);
    expect(second.matchableSources.map((s) => s.measureNames)).toEqual(first.matchableSources.map((s) => s.measureNames));
    expect(first.matchableSources[3]?.measureNames).toEqual(["m3"]);
    expect(catalogYamlParseMsTotal()).toBeGreaterThanOrEqual(0);
  });

  it("overlay 变更后下一次装配立即读到新度量名（无陈旧窗口）", async () => {
    const sources = await seed(3);
    const before = await buildMatchableSourcesForGate(sources as never, { semanticLayerRoot: layer });
    expect(before.matchableSources[1]?.measureNames).toEqual(["m1"]);
    await writeFile(path.join(layer, CONN, "t1.yaml"), overlay("t1", "m1_renamed_longer"));
    const after = await buildMatchableSourcesForGate(sources as never, { semanticLayerRoot: layer });
    expect(after.matchableSources[1]?.measureNames).toEqual(["m1_renamed_longer"]);
  });

  it("缺 overlay 视为无度量且非部分读取", async () => {
    const sources = await seed(2);
    const extra = { connectionId: CONN, schema: "dataforai", sourceName: "ghost", table: "dataforai.ghost" };
    const built = await buildMatchableSourcesForGate([...sources, extra] as never, { semanticLayerRoot: layer });
    const byName = new Map(built.matchableSources.map((s) => [s.sourceName, s]));
    expect(byName.get("ghost")?.readPartial).toBe(false);
    expect(byName.get("ghost")?.measureNames).toEqual([]);
    expect(byName.get("t0")?.measureNames).toEqual(["m0"]);
  });

  it("损坏 overlay 标记部分读取（fail-closed 语义不变）", async () => {
    const sources = await seed(2);
    await writeFile(path.join(layer, CONN, "t1.yaml"), "name: [unclosed\n");
    const built = await buildMatchableSourcesForGate(sources as never, { semanticLayerRoot: layer });
    const byName = new Map(built.matchableSources.map((s) => [s.sourceName, s]));
    expect(byName.get("t1")?.readPartial).toBe(true);
  });

  it("20 路并发装配得到一致结果", async () => {
    const sources = await seed(60);
    const results = await Promise.all(Array.from({ length: 20 }, () => buildMatchableSourcesForGate(sources as never, { semanticLayerRoot: layer })));
    const expected = results[0]!.matchableSources.map((s) => s.measureNames);
    for (const result of results) expect(result.matchableSources.map((s) => s.measureNames)).toEqual(expected);
  });
});
