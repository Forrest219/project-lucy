import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { stringifySafe } from "../yaml-safe";

describe("stringifySafe（P1-76 统一 YAML 写出口）", () => {
  it("共享引用对象序列化不产生 anchor/alias，且默认 parse 可读回（SC-01）", () => {
    const shared = { name: "c1", type: "int", nullable: true, comment: "repeat me" };
    const doc = { version: 1, columns: Array.from({ length: 150 }, () => shared) };
    const out = stringifySafe(doc);
    expect(out).not.toMatch(/(^|[\s:,\-[\]{}])&[A-Za-z0-9_]/);
    expect(out).not.toMatch(/(^|[\s:,\-[\]{}])\*[A-Za-z0-9_]/);
    const rt = parse(out);
    expect(rt).toEqual(doc);
    expect(rt.columns).toHaveLength(150);
  });

  it("保留既有 stringify 选项（lineWidth 透传）", () => {
    const doc = { a: "x".repeat(120) };
    const out = stringifySafe(doc, { lineWidth: 0 });
    expect(out).toContain("x".repeat(120));
  });

  it("无共享引用时输出与默认 stringify 语义一致", () => {
    const doc = { connections: { demo: { driver: "mysql", host: "h" } }, tools: ["a", "b"] };
    const rt = parse(stringifySafe(doc));
    expect(rt).toEqual(doc);
  });

  it("显式传入 aliasDuplicateObjects 也不会被启用（写出口不可被绕过）", () => {
    const shared = { k: 1 };
    const out = stringifySafe({ a: shared, b: shared }, { aliasDuplicateObjects: true } as never);
    expect(out).not.toContain("&");
    expect(out).not.toContain("*");
  });
});
