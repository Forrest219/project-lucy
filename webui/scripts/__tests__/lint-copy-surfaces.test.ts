// @vitest-environment node
//
// Unit tests for the copy-surfaces gate (P1-40 / UAT-SUITE-COPY-FAKE-SUCCESS).
//
// The gate does not prove a copy works — the real-browser UAT does. It keeps the
// inventory honest: a new copy button cannot ship without being registered.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkManifest,
  collectSourceFiles,
  countHelperCalls,
  usesRawClipboardApi
} from "../lint-copy-surfaces.mjs";

const webuiRoot = path.resolve(import.meta.dirname, "..", "..");

const surface = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  label: "标签",
  route: "/x",
  coverage: "click",
  ...over
});
const manifest = (files: Record<string, unknown>) => ({ files }) as never;

describe("countHelperCalls", () => {
  it("counts calls but not imports or comments", () => {
    const src = [
      'import { copyTextWithToast } from "../lib/clipboard";',
      "// copyTextWithToast(old)",
      "/* copyTextToClipboard(x) */",
      "void copyTextWithToast(a, {});",
      "const r = await copyTextToClipboard(\n  b\n);"
    ].join("\n");
    expect(countHelperCalls(src)).toBe(2);
  });
});

describe("usesRawClipboardApi", () => {
  it.each([
    "await navigator.clipboard.writeText(x)",
    "document.execCommand('copy')",
    "new ClipboardItem({})"
  ])("flags %s", (src) => {
    expect(usesRawClipboardApi(src)).toBe(true);
  });

  it("ignores comments and unrelated code", () => {
    expect(usesRawClipboardApi("// navigator.clipboard is undefined on http\nconst a = 1;")).toBe(false);
  });
});

describe("checkManifest", () => {
  const call = "void copyTextWithToast(v, {});";

  it("passes when the manifest matches the source", () => {
    const problems = checkManifest(
      manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface()] } }),
      { "src/a.tsx": call }
    );
    expect(problems).toEqual([]);
  });

  it("fails on an unregistered copy call", () => {
    const problems = checkManifest(manifest({}), { "src/new.tsx": call });
    expect(problems.join("\n")).toMatch(/R2 src\/new\.tsx.*未登记/);
  });

  it("fails when the call-site count drifts", () => {
    const problems = checkManifest(
      manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface()] } }),
      { "src/a.tsx": `${call}\n${call}` }
    );
    expect(problems.join("\n")).toMatch(/callSites=1，源码实有 2/);
  });

  it("fails on a stale manifest entry", () => {
    const problems = checkManifest(
      manifest({ "src/gone.tsx": { callSites: 1, surfaces: [surface()] } }),
      { "src/gone.tsx": "export const a = 1;" }
    );
    expect(problems.join("\n")).toMatch(/R2 src\/gone\.tsx.*不再调用/);
  });

  it("fails when a surface bypasses the shared helper", () => {
    const problems = checkManifest(manifest({}), {
      "src/raw.tsx": "navigator.clipboard?.writeText(token)"
    });
    expect(problems.join("\n")).toMatch(/R1 src\/raw\.tsx/);
  });

  it("allows the helper file itself to use the raw API", () => {
    expect(checkManifest(manifest({}), { "src/lib/clipboard.ts": "document.execCommand('copy')" })).toEqual([]);
  });

  it("requires helper-only surfaces to explain why they were not clicked", () => {
    const problems = checkManifest(
      manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface({ coverage: "helper-only" })] } }),
      { "src/a.tsx": call }
    );
    expect(problems.join("\n")).toMatch(/helper-only 必须写 reason/);
  });

  it("rejects an unknown coverage value", () => {
    const problems = checkManifest(
      manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface({ coverage: "mock" })] } }),
      { "src/a.tsx": call }
    );
    expect(problems.join("\n")).toMatch(/coverage 必须是 click 或 helper-only/);
  });
});

describe("repository inventory", () => {
  it("registers every production copy call site", () => {
    const sources = Object.fromEntries(
      collectSourceFiles(webuiRoot).map((rel) => [rel, readFileSync(path.join(webuiRoot, rel), "utf8")])
    );
    const registered = JSON.parse(readFileSync(path.join(webuiRoot, "scripts/copy-surfaces.manifest.json"), "utf8"));
    expect(checkManifest(registered, sources)).toEqual([]);
  });
});
