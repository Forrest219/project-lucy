/**
 * P1-37 U1 — 描述索引缓存：命中不读内容；任何文件变化下一次调用即生效；缓存与未缓存读取逐项等价。
 */
import { mkdir, mkdtemp, rm, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  descriptionIndexCacheStats,
  loadDescriptionIndexes,
  loadDescriptionIndexesUncached,
  resetDescriptionIndexCacheForTests
} from "../proxy/source-descriptions";

const CONN = "conn-a";
let root: string;
let layer: string;

const manifest = (desc: string) => [
  "tables:",
  "  orders:",
  "    table: dataforai.orders",
  "    descriptions:",
  `      db: ${desc}`
].join("\n") + "\n";

const overlay = (grain: string) => `name: orders\ntable: dataforai.orders\ngrain:\n  - ${grain}\n`;

async function writeManifest(desc: string): Promise<string> {
  const file = path.join(layer, CONN, "_schema", "dataforai.yaml");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, manifest(desc));
  return file;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-desc-cache-"));
  layer = path.join(root, "semantic-layer");
  resetDescriptionIndexCacheForTests();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const descOf = async (scope = [CONN]) => (await loadDescriptionIndexes(layer, scope)).manifestIndex.get("conn-a.dataforai.orders")?.descriptionDb;

describe("描述索引缓存", () => {
  it("第二次调用命中缓存；结果与未缓存读取逐项等价", async () => {
    await writeManifest("订单");
    await writeFile(path.join(layer, CONN, "orders.yaml"), overlay("order_id"));
    const first = await loadDescriptionIndexes(layer, [CONN]);
    const second = await loadDescriptionIndexes(layer, [CONN]);
    expect(descriptionIndexCacheStats()).toMatchObject({ hits: 1, misses: 1 });
    const fresh = await loadDescriptionIndexesUncached(layer, [CONN]);
    for (const got of [first, second]) {
      expect([...got.manifestIndex]).toEqual([...fresh.manifestIndex]);
      expect([...got.overlayIndex]).toEqual([...fresh.overlayIndex]);
      expect([...got.failedConnections]).toEqual([...fresh.failedConnections]);
    }
  });

  it("文件内容变化（大小不同）下一次调用即读到新内容", async () => {
    await writeManifest("订单");
    expect(await descOf()).toBe("订单");
    await writeManifest("订单明细（新口径）");
    expect(await descOf()).toBe("订单明细（新口径）");
    expect(descriptionIndexCacheStats().misses).toBe(2);
  });

  it("同样大小的原地改写（只有 mtime 变）也会失效", async () => {
    const file = await writeManifest("AAAA");
    expect(await descOf()).toBe("AAAA");
    await writeFile(file, manifest("BBBB"));
    const future = new Date(Date.now() + 5000);
    await utimes(file, future, future);
    expect(await descOf()).toBe("BBBB");
  });

  it("新增、删除 overlay 立即反映", async () => {
    await writeManifest("订单");
    const before = await loadDescriptionIndexes(layer, [CONN]);
    expect(before.overlayIndex.size).toBe(0);
    const overlayFile = path.join(layer, CONN, "orders.yaml");
    await writeFile(overlayFile, overlay("order_id"));
    expect((await loadDescriptionIndexes(layer, [CONN])).overlayIndex.size).toBe(1);
    await unlink(overlayFile);
    expect((await loadDescriptionIndexes(layer, [CONN])).overlayIndex.size).toBe(0);
  });

  it("删除 manifest 后不会回放旧缓存", async () => {
    const file = await writeManifest("订单");
    expect(await descOf()).toBe("订单");
    await unlink(file);
    expect(await descOf()).toBeUndefined();
  });

  it("不同连接范围各自缓存，互不串用", async () => {
    await writeManifest("订单");
    await loadDescriptionIndexes(layer, [CONN]);
    await loadDescriptionIndexes(layer, ["conn-b"]);
    expect(descriptionIndexCacheStats().entries).toBe(2);
    expect(await descOf(["conn-b"])).toBeUndefined();
  });

  it("调用方改动返回的索引不会污染缓存", async () => {
    await writeManifest("订单");
    const first = await loadDescriptionIndexes(layer, [CONN]);
    first.manifestIndex.clear();
    first.failedConnections.add("x");
    const second = await loadDescriptionIndexes(layer, [CONN]);
    expect(second.manifestIndex.size).toBe(1);
    expect(second.failedConnections.size).toBe(0);
  });
});
