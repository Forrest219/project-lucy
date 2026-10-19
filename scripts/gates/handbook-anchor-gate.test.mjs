import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertNoDeadAnchors,
  assertTocReachable,
  checkHandbookAnchors,
  cleanSectionTitle,
  collectAnchorLinks,
  collectHeadingAnchors,
  ensureUniqueHeadingId,
  extractSectionIdContract,
  HandbookAnchorError,
  parseHelpToc,
  runHandbookAnchorGate,
  slugifyHeading,
  splitIntoSections,
  stableSlug,
  stripLeadingHandbookPreface
} from "./handbook-anchor-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HANDBOOK_REL = "docs/SYSTEM_HANDBOOK.md";
const HELP_SERVER_REL = "webui/server/help.ts";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/**
 * Minimal `webui/server/help.ts` stand-in: the contract literal is extracted
 * from the *source* by the gate, so a fixture only needs the same shape.
 */
const FIXTURE_HELP_TS = `export const SECTION_ID_CONTRACT = new Map<string, string>([
  // ---- H2 ----
  ["概述", "sample-overview"],

  // ---- H3 ----
  ["示例章节", "sample-contract"]
]);
`;

/**
 * Healthy fixture: one contract hit (`示例章节` → `sample-contract`) and one
 * `stableSlug()` fallback (`Sample Section` → `sample-section`). Line 11
 * carries the two `](#…)` links.
 */
const FIXTURE_OK = `# Fixture Handbook

| 项 | 内容 |
| --- | --- |
| 文档类型 | Fixture |

## 1. 概述

### 1.1 示例章节

参见 [示例章节](#sample-contract) 与 [Sample Section](#sample-section)。

### 1.2 Sample Section

正文段落。
`;

/** Same fixture plus one dead link — it sits on line 13. */
const FIXTURE_DEAD_LINK = `# Fixture Handbook

| 项 | 内容 |
| --- | --- |
| 文档类型 | Fixture |

## 1. 概述

### 1.1 示例章节

参见 [示例章节](#sample-contract) 与 [Sample Section](#sample-section)。

这个链接是死的：[死链](#does-not-exist)。

### 1.2 Sample Section

正文段落。
`;

/**
 * The TOC holds an entry whose heading only exists inside the hand-authored
 * 「目录」 block — the article strips that block, so the sidebar entry can
 * never be reached.
 */
const FIXTURE_UNREACHABLE_TOC = `# Fixture Handbook

| 项 | 内容 |
| --- | --- |
| 文档类型 | Fixture |

## 目录

#### 目录内幽灵小节

## 1. 概述

### 1.1 示例章节

正文段落。
`;

function makeFixtureRepo(files) {
  const tmp = mkdtempSync(path.join(tmpdir(), "handbook-anchor-gate-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(tmp, relPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return tmp;
}

function withFixture(files, fn) {
  const tmp = makeFixtureRepo(files);
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function fixtureRepo(handbook) {
  return {
    [HANDBOOK_REL]: handbook,
    [HELP_SERVER_REL]: FIXTURE_HELP_TS
  };
}

/* ------------------------------------------------------------------ *
 * 1. Positive: the real handbook is healthy
 * ------------------------------------------------------------------ */

test("the real handbook passes both checks (no dead anchor, every TOC entry reachable)", () => {
  const result = runHandbookAnchorGate(ROOT);
  assert.deepEqual(result.issues, [], "expected no issues for the real handbook");
  assert.equal(result.deadLinks.length, 0);
  assert.equal(result.unreachableEntries.length, 0);
  // The sidebar TOC, the heading anchors and the contract table must agree.
  assert.equal(result.toc.length, result.sections.length);
  assert.equal(new Set(result.toc.map((item) => item.id)).size, result.toc.length);
  assert.equal(result.contractSize, result.toc.length);
  // Every link target resolves to either a section id or a heading anchor.
  for (const link of result.links) {
    assert.ok(
      result.validTargets.has(link.target),
      `expected link target #${link.target} (line ${link.line}) to resolve`
    );
  }
  // Every TOC entry is reachable by title *and* by rendered section id.
  for (const item of result.toc) {
    assert.ok(
      result.sections.some((section) => section.id === item.id),
      `expected TOC entry "${item.title}" to have a rendered section`
    );
  }
});

test("the real handbook is scanned for links and headings outside code fences", () => {
  const markdown = readFileSync(path.join(ROOT, HANDBOOK_REL), "utf8");
  const links = collectAnchorLinks(markdown);
  const headings = collectHeadingAnchors(markdown);
  assert.ok(links.length > 0, "expected the handbook to contain [](#…) links");
  assert.ok(headings.length > 0, "expected the handbook to contain headings");
  // A `#` inside a fence is not a heading.
  const fenceHeadings = headings.filter((h) => h.text.startsWith("1. 启动") || h.text === "验证连通");
  assert.deepEqual(fenceHeadings, [], "fenced `#` lines must not be treated as headings");
});

/* ------------------------------------------------------------------ *
 * 2. Negative: dead link
 * ------------------------------------------------------------------ */

test("a dead ](#…) link fails the gate and reports the target and its line", () => {
  withFixture(fixtureRepo(FIXTURE_DEAD_LINK), (tmp) => {
    assert.throws(
      () => runHandbookAnchorGate(tmp),
      (err) => {
        assert.ok(err instanceof HandbookAnchorError, `expected HandbookAnchorError, got ${err?.name}`);
        assert.equal(err.name, "HandbookAnchorError");
        assert.match(err.message, /dead-anchor/);
        assert.match(err.message, /does-not-exist/);
        // The dead link sits on line 13 of the fixture.
        assert.match(err.message, /line 13/);
        return true;
      }
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. Negative: unreachable TOC entry
 * ------------------------------------------------------------------ */

test("a TOC entry without a matching body heading fails the gate as unreachable", () => {
  withFixture(fixtureRepo(FIXTURE_UNREACHABLE_TOC), (tmp) => {
    assert.throws(
      () => runHandbookAnchorGate(tmp),
      (err) => {
        assert.ok(err instanceof HandbookAnchorError, `expected HandbookAnchorError, got ${err?.name}`);
        assert.match(err.message, /unreachable-toc/);
        // The 「目录」 block heading and the H4 inside it are both stripped.
        assert.match(err.message, /目录内幽灵小节/);
        assert.match(err.message, /目录/);
        return true;
      }
    );
  });
});

test("assertTocReachable and assertNoDeadAnchors report their own failure kind", () => {
  withFixture(fixtureRepo(FIXTURE_UNREACHABLE_TOC), (tmp) => {
    const markdown = readFileSync(path.join(tmp, HANDBOOK_REL), "utf8");
    const contract = extractSectionIdContract(readFileSync(path.join(tmp, HELP_SERVER_REL), "utf8"));
    const result = checkHandbookAnchors({ markdown, contract, handbookPath: HANDBOOK_REL });
    assert.equal(result.deadLinks.length, 0, "fixture has no dead link");
    assert.ok(result.unreachableEntries.length > 0);
    // A clean dead-link list is a no-op …
    assert.equal(assertNoDeadAnchors(result.deadLinks), 0);
    // … while the unreachable entries fail with their own marker.
    assert.throws(() => assertTocReachable(result.unreachableEntries), /unreachable-toc/);
  });
  withFixture(fixtureRepo(FIXTURE_DEAD_LINK), (tmp) => {
    const markdown = readFileSync(path.join(tmp, HANDBOOK_REL), "utf8");
    const contract = extractSectionIdContract(readFileSync(path.join(tmp, HELP_SERVER_REL), "utf8"));
    const result = checkHandbookAnchors({ markdown, contract, handbookPath: HANDBOOK_REL });
    assert.ok(result.deadLinks.length > 0, "fixture has one dead link");
    assert.throws(() => assertNoDeadAnchors(result.deadLinks), /dead-anchor/);
    // The dead link is the only issue of the unreachable fixture kind.
    assert.equal(result.unreachableEntries.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Positive: contract hit and stableSlug fallback
 * ------------------------------------------------------------------ */

test("contract hit and stableSlug fallback both resolve to a usable id", () => {
  withFixture(fixtureRepo(FIXTURE_OK), (tmp) => {
    const markdown = readFileSync(path.join(tmp, HANDBOOK_REL), "utf8");
    const contract = extractSectionIdContract(readFileSync(path.join(tmp, HELP_SERVER_REL), "utf8"));
    const toc = parseHelpToc(markdown, contract);

    const contractHit = toc.find((item) => item.title === "1.1 示例章节");
    assert.ok(contractHit, "expected the 示例章节 entry in the TOC");
    assert.equal(contractHit.id, "sample-contract", "contract table must win");

    const fallback = toc.find((item) => item.title === "1.2 Sample Section");
    assert.ok(fallback, "expected the Sample Section entry in the TOC");
    assert.equal(fallback.id, "sample-section", "stableSlug fallback must apply");
    assert.equal(contract.has("Sample Section"), false, "the fallback title is not in the contract");

    // Both ids are valid link targets.
    const result = checkHandbookAnchors({ markdown, contract, handbookPath: HANDBOOK_REL });
    assert.ok(result.validTargets.has("sample-contract"));
    assert.ok(result.validTargets.has("sample-section"));
    assert.equal(result.deadLinks.length, 0);
    assert.equal(result.unreachableEntries.length, 0);
  });
});

test("stableSlug falls back to a sha1 prefix when the title has no ascii slug", () => {
  // Mirrors `webui/server/help.ts` → `stableSlug()`.
  assert.equal(stableSlug("Sample Section"), "sample-section");
  assert.equal(stableSlug("`ktx.yaml`"), "ktx-yaml");
  assert.equal(stableSlug("概述").length, 10);
  assert.match(stableSlug("概述"), /^[0-9a-f]{10}$/);
});

/* ------------------------------------------------------------------ *
 * 5. Consistency: the replicas must match the real TypeScript sources
 * ------------------------------------------------------------------ */

/** Edge cases the replicas must agree on with the real implementations. */
const EDGE_TITLES = [
  "",
  "   ",
  "!!!",
  "---",
  "###",
  "中文标题",
  "中文 with English 混排",
  "`ktx.yaml` 配置",
  "3.7.1 YAML 类型总览",
  "0.0 文档基线（自动同步）",
  "重复标题",
  "重复标题",
  "WebUI 与 ktx.yaml 的职责边界",
  "A  B",
  "  前后空格  ",
  "Tab\t标题",
  "emoji 🎉 标题",
  "«» 引号",
  "#### 井号开头"
];

/** Fixture that exercises fences, `toc:exclude`, duplicates and deep levels. */
const PROBE_FIXTURE = `# Probe Handbook

<!-- toc:exclude -->
## Excluded Section

## 1. Overview

### 1.1 Sample Section

\`\`\`bash
# not a heading
## not a heading either
\`\`\`

### 1.1 Sample Section

#### 1.1.1 Nested

##### 1.1.1.1 Too Deep
`;

/**
 * Run the *real* TypeScript implementations through `npx tsx` and return
 * their raw output. The probe lives in a temp dir (never in the repo) and
 * imports the real `webui/src/lib/wiki.ts` + `webui/server/help.ts`.
 */
function runRealImplementations(input) {
  const tmp = mkdtempSync(path.join(tmpdir(), "handbook-anchor-gate-probe-"));
  try {
    const probePath = path.join(tmp, "probe.ts");
    const inputPath = path.join(tmp, "input.json");
    const wikiUrl = pathToFileURL(path.join(ROOT, "webui/src/lib/wiki.ts")).href;
    const helpUrl = pathToFileURL(path.join(ROOT, HELP_SERVER_REL)).href;
    writeFileSync(
      probePath,
      [
        'import { readFileSync } from "node:fs";',
        `import { slugifyHeading } from "${wikiUrl}";`,
        `import { parseHelpToc, cleanSectionTitle, SECTION_ID_CONTRACT } from "${helpUrl}";`,
        'const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"));',
        "const tocOf = (markdown: string) =>",
        "  parseHelpToc(markdown).map((item) => ({ id: item.id, level: item.level, title: item.title }));",
        "const out = {",
        "  slugifyHeading: input.titles.map((t: string) => slugifyHeading(t)),",
        "  cleanSectionTitle: input.titles.map((t: string) => cleanSectionTitle(t)),",
        "  parseHelpTocHandbook: tocOf(input.handbook),",
        "  parseHelpTocFixture: tocOf(input.fixture),",
        "  contract: [...SECTION_ID_CONTRACT.entries()]",
        "};",
        "process.stdout.write(JSON.stringify(out));",
        ""
      ].join("\n")
    );
    writeFileSync(inputPath, JSON.stringify(input));
    const stdout = execFileSync("npx", ["tsx", probePath, inputPath], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 180000,
      maxBuffer: 32 * 1024 * 1024
    });
    return JSON.parse(stdout);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("the replicated slug / toc rules match the real TypeScript implementations", () => {
  const handbookMarkdown = readFileSync(path.join(ROOT, HANDBOOK_REL), "utf8");
  const helpSource = readFileSync(path.join(ROOT, HELP_SERVER_REL), "utf8");
  const contract = extractSectionIdContract(helpSource);
  const handbookTitles = collectHeadingAnchors(handbookMarkdown).map((h) => h.text);
  const titles = [...handbookTitles, ...EDGE_TITLES];

  const real = runRealImplementations({
    titles,
    handbook: handbookMarkdown,
    fixture: PROBE_FIXTURE
  });

  // 5.1 `slugifyHeading` (wiki.ts) — every real heading plus the edge cases.
  const replicaSlugs = titles.map((title) => slugifyHeading(title));
  assert.deepEqual(
    replicaSlugs,
    real.slugifyHeading,
    "slugifyHeading replica drifted from webui/src/lib/wiki.ts"
  );

  // 5.2 `cleanSectionTitle` (help.ts).
  const replicaClean = titles.map((title) => cleanSectionTitle(title));
  assert.deepEqual(
    replicaClean,
    real.cleanSectionTitle,
    "cleanSectionTitle replica drifted from webui/server/help.ts"
  );

  // 5.3 `SECTION_ID_CONTRACT` — the source extraction must match the real map.
  assert.deepEqual(
    [...contract.entries()],
    real.contract,
    "the SECTION_ID_CONTRACT extraction drifted from webui/server/help.ts"
  );

  // 5.4 `parseHelpToc` (help.ts) — real handbook + a fixture that exercises
  //     fences, `toc:exclude`, duplicate titles and deep heading levels.
  const replicaToc = (markdown) =>
    parseHelpToc(markdown, contract).map((item) => ({
      id: item.id,
      level: item.level,
      title: item.title
    }));
  assert.deepEqual(
    replicaToc(handbookMarkdown),
    real.parseHelpTocHandbook,
    "parseHelpToc replica drifted from webui/server/help.ts (real handbook)"
  );
  assert.deepEqual(
    replicaToc(PROBE_FIXTURE),
    real.parseHelpTocFixture,
    "parseHelpToc replica drifted from webui/server/help.ts (probe fixture)"
  );
});

/* ------------------------------------------------------------------ *
 * 6. The strip / split pipeline mirrors the front end
 * ------------------------------------------------------------------ */

test("stripLeadingHandbookPreface drops the H1, the metadata table and a 目录 block", () => {
  const stripped = stripLeadingHandbookPreface(FIXTURE_UNREACHABLE_TOC);
  assert.ok(!stripped.includes("Fixture Handbook"), "the H1 must be stripped");
  assert.ok(!stripped.includes("| 文档类型 |"), "the metadata table must be stripped");
  assert.ok(!stripped.includes("目录"), "the 目录 block must be stripped");
  assert.ok(stripped.startsWith("## 1. 概述"), "the body must start at the first H2");
});

test("splitIntoSections mirrors the front-end section split", () => {
  const contract = extractSectionIdContract(FIXTURE_HELP_TS);
  const toc = parseHelpToc(FIXTURE_OK, contract);
  const sections = splitIntoSections(stripLeadingHandbookPreface(FIXTURE_OK), toc);
  assert.deepEqual(
    sections.map((section) => section.id),
    ["sample-overview", "sample-contract", "sample-section"]
  );
  assert.equal(sections[1].markdown.startsWith("### 1.1 示例章节"), true);
});

test("ensureUniqueHeadingId appends -2 / -3 for repeated headings", () => {
  const taken = new Set();
  assert.equal(ensureUniqueHeadingId("foo", taken), "foo");
  assert.equal(ensureUniqueHeadingId("foo", taken), "foo-2");
  assert.equal(ensureUniqueHeadingId("foo", taken), "foo-3");
  assert.equal(ensureUniqueHeadingId("", taken), "section");
});

test("collectAnchorLinks skips links inside code fences", () => {
  const markdown = "# Title\n\n```bash\n[dead](#does-not-exist)\n```\n\n[live](#live)\n";
  const links = collectAnchorLinks(markdown);
  assert.deepEqual(links.map((link) => link.target), ["live"]);
  assert.equal(links[0].line, 7);
});
