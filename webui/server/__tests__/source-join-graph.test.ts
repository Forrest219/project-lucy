/**
 * P1-35 v0.4 D12／SC-E21／E22／E30 — 语义层已声明 join 的连通判定。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateContentPathsCache } from "../paths";
import {
  joinConnected,
  loadDeclaredJoinEdges,
  type DeclaredJoinEdge
} from "../proxy/source-join-graph";

const CONN = "demo-mysql";
const key = (sourceName: string, schema = "dataforai") => ({
  connectionId: CONN,
  schema,
  sourceName,
  physicalTable: `${schema}.${sourceName}`
});

describe("joinConnected (pure)", () => {
  const edge = (from: string, to: string): DeclaredJoinEdge => ({ connectionId: CONN, from, to });

  it("single key is trivially connected", () => {
    expect(joinConnected([key("a")], [])).toBe(true);
  });

  it("direct edge in either direction connects two keys", () => {
    expect(joinConnected([key("a"), key("b")], [edge("a", "b")])).toBe(true);
    expect(joinConnected([key("a"), key("b")], [edge("b", "a")])).toBe(true);
  });

  it("star via hub is transitively connected; two spokes alone are not", () => {
    const edges = [edge("orders", "returns"), edge("orders", "people")];
    expect(joinConnected([key("orders"), key("returns"), key("people")], edges)).toBe(true);
    expect(joinConnected([key("returns"), key("people")], edges)).toBe(false);
  });

  it("edge to a non-requested table does not bridge keys", () => {
    const edges = [edge("a", "hub"), edge("hub", "b")];
    expect(joinConnected([key("a"), key("b")], edges)).toBe(false);
  });

  it("CR-03: same sourceName in two schemas are distinct nodes; no edge means not connected", () => {
    expect(joinConnected([key("orders", "sales"), key("orders", "archive")], [])).toBe(false);
    // 无限定的 `to` 视作与声明方同 schema，不得跨 schema 搭桥。
    const edges: DeclaredJoinEdge[] = [{ connectionId: CONN, from: "orders", to: "customers", fromSchema: "sales" }];
    expect(joinConnected([key("orders", "sales"), key("customers", "sales")], edges)).toBe(true);
    expect(joinConnected([key("orders", "sales"), key("customers", "archive")], edges)).toBe(false);
    // 显式 schema 限定可以指向另一个 schema。
    const cross: DeclaredJoinEdge[] = [{ connectionId: CONN, from: "orders", to: "archive.orders", fromSchema: "sales" }];
    expect(joinConnected([key("orders", "sales"), key("orders", "archive")], cross)).toBe(true);
  });

  it("schema-qualified `to` matches by last segment on the same connection only", () => {
    expect(
      joinConnected([key("a"), key("b")], [{ connectionId: CONN, from: "a", to: "dataforai.b" }])
    ).toBe(true);
    expect(
      joinConnected([key("a"), key("b")], [{ connectionId: "other", from: "a", to: "b" }])
    ).toBe(false);
  });
});

describe("loadDeclaredJoinEdges (semantic layer on disk)", () => {
  let tmpRoot: string;
  let prevRoot: string | undefined;
  let prevContent: string | undefined;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "sjg-"));
    prevRoot = process.env.KTX_PROJECT_ROOT;
    prevContent = process.env.LUCY_CONTENT_ROOT;
    process.env.KTX_PROJECT_ROOT = tmpRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    invalidateContentPathsCache();
    await writeFile(path.join(tmpRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await mkdir(path.join(tmpRoot, "semantic-layer", CONN, "_schema"), { recursive: true });
  });

  afterEach(async () => {
    if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = prevRoot;
    if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = prevContent;
    invalidateContentPathsCache();
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("reads overlay joins; excludes candidate; counts one-sided declaration", async () => {
    await writeFile(
      path.join(tmpRoot, "semantic-layer", CONN, "orders.yaml"),
      [
        "name: orders",
        "joins:",
        "  - to: returns",
        "    on: orders.id = returns.id",
        "    relationship: many_to_one",
        "    source: formal",
        "  - to: people",
        "    on: orders.r = people.r",
        "    source: candidate",
        ""
      ].join("\n"),
      "utf8"
    );
    const edges = await loadDeclaredJoinEdges([key("orders"), key("returns"), key("people")]);
    expect(edges).toEqual([{ connectionId: CONN, from: "orders", to: "returns", fromSchema: "dataforai" }]);
    expect(joinConnected([key("orders"), key("returns")], edges)).toBe(true);
    expect(joinConnected([key("orders"), key("people")], edges)).toBe(false);
  });

  it("reads manifest _schema joins too", async () => {
    await writeFile(
      path.join(tmpRoot, "semantic-layer", CONN, "_schema", "dataforai.yaml"),
      [
        "tables:",
        "  fact:",
        "    table: dataforai.fact",
        "    joins:",
        "      - to: dim",
        "        on: fact.k = dim.k",
        "  dim:",
        "    table: dataforai.dim",
        ""
      ].join("\n"),
      "utf8"
    );
    const edges = await loadDeclaredJoinEdges([key("fact"), key("dim")]);
    expect(joinConnected([key("fact"), key("dim")], edges)).toBe(true);
  });

  it("missing semantic layer yields no edges (not an error)", async () => {
    const edges = await loadDeclaredJoinEdges([key("x"), key("y")]);
    expect(edges).toEqual([]);
  });
});
