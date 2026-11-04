#!/usr/bin/env node
/**
 * Tests for `scripts/gates/handbook-tool-surface.mjs`.
 *
 * The gate's whole reason to exist is that the handbook's §4.4 tool table and
 * the runtime tool registry must stay the **same set**. These tests pin the
 * two parsers (runtime TS literals / handbook markdown) and the parity check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ToolSurfaceError,
  extractObjectArrayNames,
  extractStringArray,
  readHandbookToolNames,
  readRuntimeToolNames,
  assertToolSurfaceParity,
  runToolSurfaceCheck
} from "./handbook-tool-surface.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("extractStringArray reads a bare string-literal array", () => {
  const src = `export const DATA_PLANE_TOOLS = [\n  "lucy_query",\n  "sl_validate"\n] as const;`;
  assert.deepEqual(extractStringArray(src, "DATA_PLANE_TOOLS", "fixture.ts"), [
    "lucy_query",
    "sl_validate"
  ]);
});

test("extractStringArray skips the array bracket inside a type annotation", () => {
  // `readonly OpsToolSpec[]` contains a `[` before the real array literal.
  const src = `export const TOOLS: readonly OpsToolSpec[] = [\n  "alpha"\n];`;
  assert.deepEqual(extractStringArray(src, "TOOLS", "fixture.ts"), ["alpha"]);
});

test("extractStringArray is not fooled by an apostrophe inside a line comment", () => {
  // `lucy's ACL.` must not open a fake string literal and swallow the
  // closing bracket of the array.
  const src = [
    "export const META_TOOLS = [",
    '  // Spec 162 — run through lucy\'s ACL.',
    '  "lucy_catalog",',
    '  "wiki_search"',
    "] as const;"
  ].join("\n");
  assert.deepEqual(extractStringArray(src, "META_TOOLS", "fixture.ts"), [
    "lucy_catalog",
    "wiki_search"
  ]);
});

test("extractObjectArrayNames reads the name field of tool-spec objects", () => {
  const src = [
    "export const CONTROL_PLANE_TOOLS: readonly OpsToolSpec[] = [",
    "  {",
    '    name: "lucy_ops_connection_tables",',
    '    title: "批量维护连接的启用表范围"',
    "  },",
    "  {",
    '    name: "lucy_ops_source_import",',
    '    title: "批量导入源表语义"',
    "  }",
    "];"
  ].join("\n");
  assert.deepEqual(
    extractObjectArrayNames(src, "CONTROL_PLANE_TOOLS", "fixture.ts"),
    ["lucy_ops_connection_tables", "lucy_ops_source_import"]
  );
});

test("readRuntimeToolNames resolves the real repo registry to 21 grantable tools", () => {
  const names = readRuntimeToolNames(ROOT);
  assert.equal(names.size, 21);
  for (const expected of [
    "lucy_query",
    "lucy_read_source",
    "lucy_explain_query",
    "lucy_freshness",
    "entity_details",
    "sl_validate",
    "lucy_catalog",
    "lucy_begin_question",
    "lucy_continue_question",
    "dictionary_search",
    "discover_data",
    "kx_catalog",
    "connection_list",
    "wiki_search",
    "wiki_read",
    "lucy_skill_search",
    "lucy_skill_read",
    "lucy_certified_route",
    "lucy_report_template",
    "lucy_ops_connection_tables",
    "lucy_ops_source_import"
  ]) {
    assert.ok(names.has(expected), `runtime registry should contain ${expected}`);
  }
});

test("readRuntimeToolNames does not include absolutely-denied tools", () => {
  const names = readRuntimeToolNames(ROOT);
  for (const denied of ["sl_query", "sl_read_source", "sql_execution", "memory_ingest"]) {
    assert.ok(!names.has(denied), `${denied} is denied and must not be grantable`);
  }
});

test("readHandbookToolNames reads the canonical tool table", () => {
  const markdown = [
    "### 4.4 可用工具面",
    "",
    "| 工具 | 类别 | 用途 |",
    "| --- | --- | --- |",
    "| `lucy_query` | 数据面 | 运行授权语义查询 |",
    "| `wiki_search` / `wiki_read` | 上下文面 | 检索与读取 wiki |",
    "| `lucy_skill_search` | 上下文面 | 检索业务 Skill |",
    "",
    "## 5. 配置与环境变量速查"
  ].join("\n");
  const names = readHandbookToolNames(markdown);
  assert.deepEqual(
    [...names].sort(),
    ["lucy_query", "lucy_skill_search", "wiki_read", "wiki_search"]
  );
});

test("readHandbookToolNames ignores tables that are not the canonical tool table", () => {
  const markdown = [
    "### 4.4 可用工具面",
    "",
    "| 规则 | 原因 |",
    "| --- | --- |",
    "| 使用 source-qualified key | ACL 需要显式表归属 |",
    "| `dimensions` / `order_by` 用对象数组 | Proxy 会校验 shape |",
    "| `limit` 默认 `LUCY_QUERY_DEFAULT_LIMIT` | 防止过大结果 |",
    "",
    "| 工具 | 类别 | 用途 |",
    "| --- | --- | --- |",
    "| `lucy_query` | 数据面 | 运行授权语义查询 |",
    "",
    "## 5. 配置与环境变量速查"
  ].join("\n");
  assert.deepEqual([...readHandbookToolNames(markdown)], ["lucy_query"]);
});

test("readHandbookToolNames ignores tool-like rows inside a code fence", () => {
  const markdown = [
    "### 4.4 可用工具面",
    "",
    "```json",
    "| 工具 | 类别 |",
    "| --- | --- |",
    "| `fake_tool` | 假工具 |",
    "```",
    "",
    "| 工具 | 类别 | 用途 |",
    "| --- | --- | --- |",
    "| `lucy_query` | 数据面 | 运行授权语义查询 |",
    "",
    "## 5. 配置与环境变量速查"
  ].join("\n");
  assert.deepEqual([...readHandbookToolNames(markdown)], ["lucy_query"]);
});

test("readHandbookToolNames stops at the next H2 but keeps H3/H4 subsections", () => {
  const markdown = [
    "### 4.4 可用工具面",
    "",
    "| 工具 | 类别 | 用途 |",
    "| --- | --- | --- |",
    "| `lucy_query` | 数据面 | 运行授权语义查询 |",
    "",
    "#### 子节说明",
    "",
    "正文。",
    "",
    "## 5. 配置与环境变量速查",
    "",
    "| 工具 | 类别 | 用途 |",
    "| --- | --- | --- |",
    "| `leaked_tool` | 不该被读到 | 越过 H2 |"
  ].join("\n");
  assert.deepEqual([...readHandbookToolNames(markdown)], ["lucy_query"]);
});

test("assertToolSurfaceParity passes on equal sets", () => {
  const a = new Set(["lucy_query", "lucy_catalog"]);
  const b = new Set(["lucy_catalog", "lucy_query"]);
  assert.equal(assertToolSurfaceParity(a, b), 2);
});

test("assertToolSurfaceParity reports tools missing from the handbook", () => {
  const runtime = new Set(["lucy_query", "lucy_skill_read"]);
  const handbook = new Set(["lucy_query"]);
  assert.throws(
    () => assertToolSurfaceParity(runtime, handbook),
    (error) => {
      assert.ok(error instanceof ToolSurfaceError);
      assert.equal(error.name, "ToolSurfaceError");
      assert.match(error.message, /missing-in-handbook/);
      assert.match(error.message, /lucy_skill_read/);
      return true;
    }
  );
});

test("assertToolSurfaceParity reports tools documented but not registered", () => {
  const runtime = new Set(["lucy_query"]);
  const handbook = new Set(["lucy_query", "lucy_ghost"]);
  assert.throws(
    () => assertToolSurfaceParity(runtime, handbook),
    (error) => {
      assert.ok(error instanceof ToolSurfaceError);
      assert.match(error.message, /unknown-in-runtime/);
      assert.match(error.message, /lucy_ghost/);
      return true;
    }
  );
});

test("runToolSurfaceCheck passes on the real repo", () => {
  const result = runToolSurfaceCheck(ROOT);
  assert.equal(result.count, 21);
});
