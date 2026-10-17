/**
 * WO-202610-13 T2 / SC-11, SC-12 — `wiki_search` accepts natural language.
 *
 * SC-11: a non-empty `q` returns hits or an empty list, never
 * `unparseable_text`. SC-12: injected articles belong to the role's readable
 * set, and the audit carries each article id plus its Wiki version. The
 * negative case uses an article outside the role (Spec §4: default deny).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ projectRoot: "" }));

vi.mock("../project.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../project.js")>(),
  resolveProjectRoot: vi.fn(() => testState.projectRoot)
}));

let projectRoot: string;
let previousContentRoot: string | undefined;
let previousProjectRoot: string | undefined;

const ACCESS_YAML = `roles:
  analyst_role:
    description: Analyst wiki reader
    allow:
      tools: [wiki_search, wiki_read]
  finance_role:
    description: Finance wiki reader
    allow:
      tools: [wiki_search, wiki_read]
users:
  - id: analyst
    name: Analyst
    enabled: true
    role: analyst_role
    tokens:
      - hash: "sha256:placeholder"
        label: analyst-token
        created: 2026-10-11
  - id: finance_admin
    name: Finance Admin
    enabled: true
    role: finance_role
    tokens:
      - hash: "sha256:placeholder-finance"
        label: finance-token
        created: 2026-10-11
defaults:
  deny_tools: []
`;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-wiki-nl-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(
    path.join(projectRoot, "wiki", "global", "revenue.md"),
    "---\nvisibility: public\nallowed_roles: [\"*\"]\nversion: v3\n---\n# 收入口径\n\n公有云收入按季度确认，实际与预测分列。\n",
    "utf8"
  );
  await writeFile(
    path.join(projectRoot, "wiki", "global", "payroll.md"),
    "---\nvisibility: private\nallowed_roles:\n  - finance_role\nversion: v1\n---\n# 薪酬\n\n仅财务管理员可见的薪酬条目。\n",
    "utf8"
  );
  testState.projectRoot = projectRoot;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousProjectRoot = process.env.KTX_PROJECT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousProjectRoot;
  await rm(projectRoot, { recursive: true, force: true });
  testState.projectRoot = "";
});

async function freshWikiModule() {
  const { invalidateAccessConfigCache } = await import("../proxy/identity");
  const { invalidateContentPathsCache } = await import("../paths");
  invalidateAccessConfigCache();
  invalidateContentPathsCache();
  return import("../proxy/wiki-acl");
}

const analystIdentity = () => ({
  userId: "analyst",
  tokenLabel: "analyst-token",
  tokenHashPrefix: "sha256:abc"
} as never);

describe("wiki natural-language search", () => {
  it("returns hits for a plain Chinese q and never unparseable_text (SC-11)", async () => {
    const { searchAccessibleWikiPages } = await freshWikiModule();
    const hits = await searchAccessibleWikiPages(analystIdentity(), "收入", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.key.includes("revenue"))).toBe(true);
    expect(JSON.stringify(hits)).not.toContain("unparseable_text");
  });

  it("returns an empty list rather than an error when nothing matches (SC-11)", async () => {
    const { searchAccessibleWikiPages } = await freshWikiModule();
    const hits = await searchAccessibleWikiPages(analystIdentity(), "完全不存在的主题", 10);
    expect(Array.isArray(hits)).toBe(true);
    expect(hits).toEqual([]);
  });

  it("hides an article whose allowed_roles excludes the caller's role (Spec §4.1)", async () => {
    const { searchAccessibleWikiPages } = await freshWikiModule();
    const analystHits = await searchAccessibleWikiPages(analystIdentity(), "薪酬", 10);
    expect(analystHits.some((hit) => hit.key.includes("payroll.md"))).toBe(false);
    const financeHits = await searchAccessibleWikiPages(
      { userId: "finance_admin", tokenLabel: "finance-token", tokenHashPrefix: "sha256:def" } as never,
      "薪酬",
      10
    );
    expect(financeHits.some((hit) => hit.key.includes("payroll.md"))).toBe(true);
  });

  it("audits each injected article with its id and Wiki version (SC-12)", async () => {
    const { resolveWikiPage, searchAccessibleWikiPages, wikiInjectionRefs } = await freshWikiModule();
    const hits = await searchAccessibleWikiPages(analystIdentity(), "收入", 10);
    expect(hits.length).toBeGreaterThan(0);

    const pages = [];
    for (const hit of hits) {
      const page = await resolveWikiPage(hit.key);
      expect(page).toBeDefined();
      pages.push(page!);
    }
    const refs = wikiInjectionRefs(pages);
    expect(refs.length).toBe(hits.length);
    for (const ref of refs) {
      expect(ref.key).toMatch(/\.md$/);
      expect(ref.version).toBeTruthy();
      expect(ref.version).not.toBe("");
    }
    // The public revenue article declares version v3 in its frontmatter.
    expect(refs.find((ref) => ref.key.includes("revenue"))?.version).toBe("v3");
  });
});