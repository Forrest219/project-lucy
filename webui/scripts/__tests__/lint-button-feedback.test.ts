// @vitest-environment node
//
// Unit tests for the button-feedback gate (P1-42 / UAT-SUITE-BUTTON-FEEDBACK).
//
// The gate does not prove a download works — the real-browser UAT does. It keeps
// the inventory honest and blocks the code shapes that produced the defects.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkManifest,
  checkSources,
  collectFiles,
  countDownloadTriggers,
  findRawApiAnchors,
  findUnguardedFetches,
  findUnhandledWrites,
  stripComments
} from "../lint-button-feedback.mjs";

const webuiRoot = path.resolve(import.meta.dirname, "..", "..");
const src = (rel: string, text: string) => ({ rel, text });
const entry = (triggers: number, surfaces: Array<Record<string, unknown>>) => ({ triggers, surfaces });
const click = (id: string, kase: string) => ({ id, label: id, route: "/x", coverage: "click", case: kase });

describe("download trigger inventory (B1/B2)", () => {
  it("counts blob anchors and <ApiDownloadLink>, not plain comparisons", () => {
    const text = `a.download = "x.csv"; if (b.download === c) {} <ApiDownloadLink href="/api/x" />`;
    expect(countDownloadTriggers(text)).toBe(2);
  });

  it("fails when a file triggers a download but is not registered", () => {
    const errors = checkManifest({ files: {} } as never, [src("src/p.tsx", `a.download = "x"`)]);
    expect(errors.join("\n")).toContain("B1 src/p.tsx");
  });

  it("fails when the manifest count drifts from the source", () => {
    const manifest = { files: { "src/p.tsx": entry(2, [click("a", "UAT-BTN-01"), click("b", "UAT-BTN-02")]) } };
    const errors = checkManifest(manifest as never, [src("src/p.tsx", `a.download = "x"`)]);
    expect(errors.join("\n")).toContain("manifest says 2");
  });

  it("fails on a stale manifest file", () => {
    const manifest = { files: { "src/gone.tsx": entry(1, [click("a", "UAT-BTN-01")]) } };
    expect(checkManifest(manifest as never, []).join("\n")).toContain("no longer exists");
  });

  it("requires a reason for not-run and a unique case id for click", () => {
    const manifest = {
      files: {
        "src/p.tsx": entry(3, [
          { id: "n", label: "n", route: "/x", coverage: "not-run" },
          click("a", "UAT-BTN-01"),
          click("b", "UAT-BTN-01")
        ])
      }
    };
    const errors = checkManifest(manifest as never, [src("src/p.tsx", `a.download="1"; b.download="2"; c.download="3"`)]).join("\n");
    expect(errors).toContain('"not-run" needs a reason');
    expect(errors).toContain("already used");
  });

  it("requires every click case to be written in the suite's cases.md", () => {
    const manifest = { files: { "src/p.tsx": entry(1, [click("a", "UAT-BTN-07")]) } };
    const errors = checkManifest(manifest as never, [src("src/p.tsx", `a.download="x"`)], "UAT-BTN-01 only");
    expect(errors.join("\n")).toContain("not written in the suite's cases.md");
  });
});

describe("raw API download anchors (B5)", () => {
  it("flags a plain <a> that points at an API path (the reconciliation export shape)", () => {
    const text = `<a\n  href={exportHref}\n  download\n>导出</a>\n<a href={\`/api/x\`}>y</a>`;
    expect(findRawApiAnchors(text)).toEqual([1, 5]);
  });

  it("does not flag ordinary navigation links", () => {
    expect(findRawApiAnchors(`<a href="/admin/audit">审计</a><a href={docsUrl}>文档</a>`)).toEqual([]);
  });
});

describe("raw fetch without reading .ok (B3)", () => {
  it("flags a fetch whose result status is never read", () => {
    expect(findUnguardedFetches(`const r = await fetch("/x"); const t = await r.text(); toast.success("ok");`)).toEqual([1]);
  });

  it("accepts a fetch that checks response.ok", () => {
    expect(findUnguardedFetches(`const r = await fetch("/x"); if (!r.ok) throw new Error("x");`)).toEqual([]);
  });

  it("ignores method calls named fetch", () => {
    expect(findUnguardedFetches(`queryClient.fetch("/x"); window.refetch();`)).toEqual([]);
  });
});

describe("server writes must handle non-committed states (B4)", () => {
  // The exact shape of DELETE /api/admin/agents/:userId before P1-42.
  const original = `
    const writeResult = await writeAccessYaml(projectRoot, newConfig, { enabled: true });
    invalidateAccessConfigCache();
    return { ok: true, data: { written: true, runtimeAck: writeResult.runtimeAck } };
  `;

  it("flags a write whose result is answered as success without checking status", () => {
    expect(findUnhandledWrites(original)).toEqual([2]);
  });

  it("accepts the fixed shape", () => {
    const fixed = `${original}\n if (writeResult.status !== "committed") { return accessWriteResponseBody(writeResult); }`;
    expect(findUnhandledWrites(fixed)).toEqual([]);
  });

  it("does not treat the function definition as a call", () => {
    expect(findUnhandledWrites(`async function writeAccessYaml(projectRoot: string) { return 1; }`)).toEqual([]);
  });

  it("checkSources reports B4 with the file name", () => {
    const errors = checkSources([], [src("server/a.ts", original)]);
    expect(errors.join("\n")).toContain("B4 server/a.ts:2");
  });
});

describe("comments are ignored", () => {
  it("does not count a download written inside a comment", () => {
    expect(countDownloadTriggers(stripComments(`// a.download = "x"\n/* b.download = "y" */`))).toBe(0);
  });
});

describe("this repository", () => {
  it("passes its own gate", () => {
    const ui = collectFiles(webuiRoot, "src");
    const server = collectFiles(webuiRoot, "server");
    const manifest = JSON.parse(readFileSync(path.join(webuiRoot, "scripts/download-surfaces.manifest.json"), "utf8"));
    expect([...checkManifest(manifest, ui), ...checkSources(ui, server)]).toEqual([]);
  });
});
