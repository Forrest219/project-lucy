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
  countUncheckedResults,
  usesRawClipboardApi
} from "../lint-copy-surfaces.mjs";

const webuiRoot = path.resolve(import.meta.dirname, "..", "..");

const surface = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  label: "标签",
  route: "/x",
  coverage: "click",
  case: "UAT-COPY-02a",
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

describe("countUncheckedResults", () => {
  it("flags treating the result object as a boolean", () => {
    const src = "const copiedOk = await copyTextToClipboard(cfg);\nif (!copiedOk) { toast.error('x'); return false; }\nreturn true;";
    expect(countUncheckedResults(src)).toBe(1);
  });

  it("flags a fire-and-forget call that ignores the result", () => {
    expect(countUncheckedResults("void copyTextToClipboard(id);\nsetCopied(true);")).toBe(1);
  });

  it("accepts calls that read .ok", () => {
    const src = [
      "const result = await copyTextToClipboard(a);",
      "if (!result.ok) return;",
      "void copyTextToClipboard(b).then((r) => { if (!r.ok) toast.error('x'); });"
    ].join("\n");
    expect(countUncheckedResults(src)).toBe(0);
  });

  it("ignores copyTextWithToast, which reports through its own Toast", () => {
    expect(countUncheckedResults("void copyTextWithToast(a, {});")).toBe(0);
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

  it("fails when a call site treats the result as a boolean (dead failure branch)", () => {
    const bad = "const copiedOk = await copyTextToClipboard(cfg);\nif (!copiedOk) return false;\nreturn true;";
    const problems = checkManifest(
      manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface()] } }),
      { "src/a.tsx": bad }
    );
    expect(problems.join("\n")).toMatch(/R5 src\/a\.tsx.*\.ok/);
  });

  it("rejects an unknown coverage value", () => {
    const problems = checkManifest(
      manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface({ coverage: "mock" })] } }),
      { "src/a.tsx": call }
    );
    expect(problems.join("\n")).toMatch(/coverage 必须是 click 或 helper-only/);
  });

  it("requires a stable sub-case id on click surfaces", () => {
    const problems = checkManifest(
      manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface({ case: undefined })] } }),
      { "src/a.tsx": call }
    );
    expect(problems.join("\n")).toMatch(/R4 src\/a\.tsx#s1.*子用例编号/);
  });

  it("rejects a malformed or duplicated sub-case id", () => {
    const malformed = checkManifest(
      manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface({ case: "UAT-COPY-2" })] } }),
      { "src/a.tsx": call }
    );
    expect(malformed.join("\n")).toMatch(/R4/);

    const duplicated = checkManifest(
      manifest({ "src/a.tsx": { callSites: 2, surfaces: [surface({ id: "s1" }), surface({ id: "s2" })] } }),
      { "src/a.tsx": `${call}\n${call}` }
    );
    expect(duplicated.join("\n")).toMatch(/R4 src\/a\.tsx#s2.*重复/);
  });

  it("requires the sub-case id to be written in cases.md", () => {
    const m = manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface()] } });
    expect(checkManifest(m, { "src/a.tsx": call }, "| UAT-COPY-02a | x |")).toEqual([]);
    expect(checkManifest(m, { "src/a.tsx": call }, "| UAT-COPY-02b | x |").join("\n")).toMatch(/R4.*未写入.*cases\.md/);
  });

  it("does not demand a sub-case id from helper-only surfaces", () => {
    const problems = checkManifest(
      manifest({ "src/a.tsx": { callSites: 1, surfaces: [surface({ coverage: "helper-only", case: undefined, reason: "不可达" })] } }),
      { "src/a.tsx": call }
    );
    expect(problems).toEqual([]);
  });
});

describe("repository inventory", () => {
  it("registers every production copy call site", () => {
    const sources = Object.fromEntries(
      collectSourceFiles(webuiRoot).map((rel) => [rel, readFileSync(path.join(webuiRoot, rel), "utf8")])
    );
    const registered = JSON.parse(readFileSync(path.join(webuiRoot, "scripts/copy-surfaces.manifest.json"), "utf8"));
    const casesDoc = readFileSync(path.join(webuiRoot, "..", "docs/qa/uat/suites/copy-fake-success/cases.md"), "utf8");
    expect(checkManifest(registered, sources, casesDoc)).toEqual([]);
  });
});
