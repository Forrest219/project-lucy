/**
 * WO-202610-13 T9 / SC-19 — 单模板试点.
 *
 * The pilot registers exactly one template id, `public_cloud_pnl_quarterly`.
 * The result carries its source and the adopted version. A second template id
 * is refused until a before/after comparison is recorded, and the repository
 * ships no customer measure YAML.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  listReportTemplates,
  lookupReportTemplate,
  PILOT_TEMPLATE_ID,
  pilotTemplateEnabled,
  recordTemplateComparison,
  registerReportTemplate,
  resetCertifiedRoutesForTests,
  templateComparisonRecorded,
} from "../proxy/certified-route.js";

const TEMPLATE = {
  templateId: "public_cloud_pnl_quarterly",
  source: "demo.public_cloud_pnl",
  version: "2026Q3"
};

beforeEach(() => {
  resetCertifiedRoutesForTests();
});

describe("single report template pilot (SC-19)", () => {
  it("registers only public_cloud_pnl_quarterly", () => {
    registerReportTemplate(TEMPLATE);
    const templates = listReportTemplates();
    expect(templates.length).toBe(1);
    expect(templates[0].templateId).toBe("public_cloud_pnl_quarterly");
    expect(PILOT_TEMPLATE_ID).toBe("public_cloud_pnl_quarterly");
  });

  it("carries the source and the adopted version on the template", () => {
    registerReportTemplate(TEMPLATE);
    const found = lookupReportTemplate("public_cloud_pnl_quarterly");
    expect(found?.source).toBe("demo.public_cloud_pnl");
    expect(found?.version).toBe("2026Q3");
  });

  it("refuses to register a second template id before a comparison exists", () => {
    registerReportTemplate(TEMPLATE);
    expect(() => registerReportTemplate({
      templateId: "cdn_pnl_quarterly",
      source: "demo.cdn_pnl",
      version: "2026Q3"
    })).toThrow(/pilot_template_scope_violation/);
    expect(listReportTemplates().length).toBe(1);
    expect(templateComparisonRecorded()).toBe(false);
  });

  it("refuses a duplicate re-registration of the pilot id too", () => {
    registerReportTemplate(TEMPLATE);
    expect(() => registerReportTemplate(TEMPLATE)).toThrow(/pilot_template_already_registered/);
  });

  it("allows the next template only after a before/after comparison is recorded", () => {
    registerReportTemplate(TEMPLATE);
    expect(() => recordTemplateComparison("")).toThrow(/template_comparison_reference_required/);
    recordTemplateComparison("inbox/2026-10-11-pilot-comparison.md");
    expect(templateComparisonRecorded()).toBe(true);
    // The pilot scope itself still admits only its own id.
    expect(() => registerReportTemplate({
      templateId: "cdn_pnl_quarterly",
      source: "demo.cdn_pnl"
    })).toThrow(/pilot_template_scope_violation/);
  });

  it("can be switched off, returning callers to plain lucy_query", () => {
    const previous = process.env.LUCY_PILOT_TEMPLATE;
    process.env.LUCY_PILOT_TEMPLATE = "off";
    expect(pilotTemplateEnabled()).toBe(false);
    registerReportTemplate(TEMPLATE);
    expect(listReportTemplates()).toEqual([]);
    if (previous === undefined) delete process.env.LUCY_PILOT_TEMPLATE;
    else process.env.LUCY_PILOT_TEMPLATE = previous;
  });

  it("ships no customer measure YAML in the repository", async () => {
    const semanticRoot = path.join(process.cwd(), "..", "semantic-layer");
    const entries = await readdir(semanticRoot, { withFileTypes: true }).catch(() => []);
    // Only the tracked demo stub is allowed; no per-customer connection dir.
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      expect(entry.name).toBe("demo-mysql");
    }
    // No pilot measure definition is committed alongside the template id.
    const serverDir = path.join(process.cwd(), "server", "proxy");
    const files = await readdir(serverDir);
    expect(files.some((file) => /public-cloud-pnl|public_cloud_pnl\.ya?ml/i.test(file))).toBe(false);
    const routeSource = await readFile(path.join(serverDir, "certified-route.ts"), "utf8");
    // The registry holds metadata and a hook, not customer measure definitions.
    expect(routeSource).not.toMatch(/measures:\s*\[/);
  });
});