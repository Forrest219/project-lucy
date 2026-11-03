/**
 * WO-202610-13 T9 / SC-19 — 单模板试点.
 *
 * The pilot registers exactly one template id, `public_cloud_pnl_quarterly`.
 * The result carries its source and the adopted version. A second template id
 * is refused until a before/after comparison is recorded, and the repository
 * ships no customer measure YAML.
 */
import { execFileSync } from "node:child_process";
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
    expect(() => registerReportTemplate({
      templateId: "cdn_pnl_quarterly",
      source: "demo.cdn_pnl"
    })).toThrow(/pilot_template_scope_violation/);

    recordTemplateComparison("inbox/2026-10-11-pilot-comparison.md");
    expect(templateComparisonRecorded()).toBe(true);
    registerReportTemplate({
      templateId: "cdn_pnl_quarterly",
      source: "demo.cdn_pnl",
      version: "2026Q4"
    });
    const ids = listReportTemplates().map((template) => template.templateId).sort();
    expect(ids).toEqual(["cdn_pnl_quarterly", "public_cloud_pnl_quarterly"]);
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
    const repoRoot = path.resolve(process.cwd(), "..");
    const semanticRoot = path.join(repoRoot, "semantic-layer");
    // "In the repository" means the committed tree: a local gitignored connection directory
    // (semantic-layer/mysql-aliyun/, semantic-layer/poc-mysql-aliyun/) is a developer's own
    // working copy, not something the repository ships.
    const shippedConnectionDirs = new Set(
      execFileSync("git", ["ls-files", "--", "semantic-layer"], { cwd: repoRoot, encoding: "utf8" })
        .split("\n")
        .filter(Boolean)
        .map((file) => file.split("/"))
        // semantic-layer/<dir>/<file> — a two-segment path is a file at the root
        // (semantic-layer/.gitkeep), not a connection directory.
        .filter((parts) => parts.length >= 3)
        .map((parts) => parts[1])
        .filter(Boolean)
    );
    // The pilot template binds the demo connection by id — never by list position.
    expect([...shippedConnectionDirs]).toContain("demo-mysql");
    // Only the product's own connection semantic sources may be committed: the demo stub the
    // pilot binds to, and the lucy-ops ops-evidence source (Spec 149, b7a29f12). Any other
    // directory would be a per-customer connection dir, which SC-19 forbids.
    for (const dir of shippedConnectionDirs) {
      expect(["demo-mysql", "lucy-ops"], `${dir}: the repository ships no per-customer connection directory`).toContain(dir);
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