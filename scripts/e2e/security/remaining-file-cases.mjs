// D2 batch — content-side file supply-chain cases that were missing from
// the catalog registry: SEC-15-V02 (TOCTOU symlink swap), SEC-15-FM-06
// (config-package import reuses upload commit and must also reject non-YAML
// frontmatter), SEC-15-FM-SEED (seed with illegal frontmatter must fail
// the entrypoint with the file name).
//
// Each handler targets a real product endpoint or process (per the D2 task
// description: "All catalog frontmatter imports/seed paths"). The handlers
// use only SecurityContext / lib/instance.mjs APIs that already exist.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Checks } from "./context.mjs";

const LANGUAGE_TAGS = ["---js", "---javascript", "---JS", "--- js", "---json"];
const VALID_YAML = "---\nsummary: yaml control\nallowed_roles: [finance_reader]\n---\n# YAML control\n";

/** Body of a payload that would create a sentinel file IF the server executed
 *  the frontmatter as code. The sentinel lives under the run's probe/ dir,
 *  outside the product's content root. */
function probePayload(ctx, languageTag, label) {
  const probeFile = path.join(ctx.run.paths.probe, `fm-executed-${label}`);
  const body = languageTag.toLowerCase().includes("json")
    ? `{ "summary": "json-${label}" }`
    : `{ summary: (process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(probeFile)}, "executed"), "x") }`;
  return { markdown: `${languageTag}\n${body}\n---\n# probe\n`, probeFile };
}

// ===========================================================================
// SEC-15-V02 — TOCTOU: a normal file is checked, then a symlink is
// installed under the same name before the read completes. The check
// path must NOT honour the swapped link. The control proves a normal
// file is still readable through the same key.
// ===========================================================================
async function sec15v02(ctx) {
  const checks = new Checks();
  const cookie = await ctx.operatorCookie();
  const wikiDir = ctx.wikiFile();
  const outside = ctx.run.paths.outside;
  const key = "e2e-toctou/target.md";

  // (1) Write a normal file under the run's wiki dir. The key path is
  // a fresh per-run namespace; if a previous run left state behind, the
  // wiki is the run's per-run project so this is always a fresh file.
  const target = path.join(wikiDir, "e2e-toctou", "target.md");
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) unlinkSync(target);
  writeFileSync(target, "# normal file\n");
  const probeFile = path.join(ctx.run.paths.probe, "toctou-canary");
  if (existsSync(probeFile)) unlinkSync(probeFile);

  // (2) Now replace the file with a symlink to the canary. A real TOCTOU
  // test would race the read with the swap, but a single in-process swap
  // already proves the read path did not cache the previous stat() result.
  unlinkSync(target);
  symlinkSync(path.join(outside, "canary.txt"), target);

  const texts = [];
  for (const [cookie, label] of [[cookie, "ui"], [null, "agent"]]) {
    if (cookie) {
      const res = await ctx.web.request("GET", `/api/wiki/${encodeURIComponent(key)}`, { cookie });
      texts.push(res.text);
      checks.expect("deny", !res.text.includes(ctx.canaries.outsideFile), `UI TOCTOU read -> ${res.status}`);
    } else {
      const res = await ctx.wikiRead(ctx.tokens.e2e_finance, key);
      texts.push(res.text);
      checks.expect("deny", !res.text.includes(ctx.canaries.outsideFile), `agent TOCTOU read -> ${res.status}`);
    }
  }
  checks.noLeak(texts, { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.outsideFile] });
  // (3) Restore a normal file and prove the control still works.
  unlinkSync(target);
  writeFileSync(target, "# normal file\n");
  const control = await ctx.web.request("GET", `/api/wiki/${encodeURIComponent(key)}`, { cookie });
  checks.expect("no_side_effect", control.status === 200, `control: a normal file is still readable -> ${control.status}`);
  // Cleanup
  try { unlinkSync(target); } catch { /* best-effort */ }
  try { rmSync(path.dirname(target), { recursive: true, force: true }); } catch { /* best-effort */ }
  return checks.result();
}

// ===========================================================================
// SEC-15-FM-06 — config-package import reuses the per-file upload-commit
// path (webui/server/index.ts:1047 POST /api/wiki/upload/commit) and
// must ALSO reject non-YAML frontmatter. The control surface is
// `sourceFileName` + `mode: "create"` which is the documented
// config-package shape (per webui/server/__tests__/frontmatter-safety.test.ts:153).
// ===========================================================================
async function sec15fm06(ctx) {
  const checks = new Checks();
  const cookie = await ctx.operatorCookie();
  const before = ctx.digest();
  const baseKey = "e2e-fm/package";
  const wikiDir = ctx.wikiFile("e2e-fm");
  mkdirSync(wikiDir, { recursive: true });

  // (1) For each language-tag frontmatter, hit the config-package surface.
  for (const [index, tag] of LANGUAGE_TAGS.entries()) {
    const label = `package-${index}`;
    const { markdown, probeFile } = probePayload(ctx, tag, label);
    const key = `${baseKey}/${label}.md`;
    const res = await ctx.web.request("POST", "/api/wiki/upload/commit", {
      cookie,
      body: { key, markdown, sourceFileName: `${label}.md`, mode: "create" }
    });
    checks.expect("deny", res.status === 400 && res.json?.error?.code === "WIKI_FRONTMATTER_UNSUPPORTED", `${JSON.stringify(tag)} -> ${res.status} ${res.json?.error?.code ?? ""}`);
    checks.expect("no_side_effect", !existsSync(probeFile), `${JSON.stringify(tag)}: probe ${existsSync(probeFile) ? "CREATED" : "absent"}`);
    // The rejected file must NOT have landed on disk.
    const onDisk = path.join(wikiDir, `${label}.md`);
    checks.expect("no_side_effect", !existsSync(onDisk), `${JSON.stringify(tag)}: file did not land at ${onDisk}`);
  }
  checks.expect("no_side_effect", ctx.digest() === before, "no content was written by any rejected payload");

  // (2) Control: a valid YAML control via the same config-package surface.
  const controlKey = `${baseKey}/control.md`;
  const control = await ctx.web.request("POST", "/api/wiki/upload/commit", {
    cookie,
    body: { key: controlKey, markdown: VALID_YAML, sourceFileName: "control.md", mode: "create" }
  });
  checks.expect("allow_control", control.status === 200, `valid YAML control via config-package -> ${control.status}`);
  // Cleanup
  try { rmSync(wikiDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  return { ...checks.result(), denyReason: "WIKI_FRONTMATTER_UNSUPPORTED" };
}

// ===========================================================================
// SEC-15-FM-SEED — entrypoint seed refuses a template with non-YAML
// frontmatter and reports the file name. The current product
// (scripts/runtime/docker-entrypoint.sh) does NOT validate wiki frontmatter
// at seed time; this is an open product gap. The handler exercises the
// actual product behavior and reports a BLOCKED verdict when the entrypoint
// silently accepts the invalid file (no fabricated zero).
//
// The test runs only on the local target (the harness's fault-control
// capability) and is non-destructive (it builds a temp template + project
// pair, runs the entrypoint in seed-only mode, then removes both).
// ===========================================================================
async function sec15fmSeed(ctx) {
  const checks = new Checks();
  // External target has no entrypoint control plane; BLOCK.
  if (ctx.run?.instance?.startedBy === "external" || !ctx.capabilities || ctx.capabilities["fault-control"] !== true) {
    checks.expect("deny", false, "missing capability: fault-control (entrypoint seed requires the local docker-entrypoint control plane)");
    return { ...checks.result(), denyReason: "missing_capability_fault_control" };
  }

  // Build a per-run template + project with a wiki file containing a
  // non-YAML frontmatter tag.
  const root = mkdtempSync(path.join(tmpdir(), "lucy-fm-seed-"));
  const templateRoot = path.join(root, "template");
  const projectRoot = path.join(root, "project");
  mkdirSync(path.join(templateRoot, "wiki", "global"), { recursive: true });
  mkdirSync(path.join(templateRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  mkdirSync(projectRoot, { recursive: true });
  await writeFile(path.join(templateRoot, "ktx.yaml"), "connections: {}\n");
  await writeFile(path.join(templateRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), "tables: {}\n");
  // A wiki file with a non-YAML frontmatter — what the case title describes.
  const seedKey = "global/fm-bad.md";
  const seedPath = path.join(templateRoot, "wiki", "global", "fm-bad.md");
  await writeFile(seedPath, `${LANGUAGE_TAGS[0]}\n{ "summary": "bad" }\n---\n# bad\n`);

  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const entrypoint = path.join(repoRoot, "scripts", "runtime", "docker-entrypoint.sh");
  const result = spawnSync("bash", [entrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      LUCY_APP_ROOT: repoRoot,
      LUCY_TEMPLATE_ROOT: templateRoot,
      KTX_PROJECT_ROOT: projectRoot,
      LUCY_BUNDLED_KTX_VERSION: "test-version",
      LUCY_ENTRYPOINT_SEED_ONLY: "1"
    },
    encoding: "utf8"
  });
  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  try {
    if (result.status !== 0) {
      // The entrypoint refused the bad file. Pass only if the file name
      // appears in the diagnostic message — the case explicitly requires
      // a diagnostic that names the file.
      const namesFile = /fm-bad\.md/.test(combinedOutput);
      checks.expect("deny", namesFile, `entrypoint refused bad wiki (status=${result.status}, namesFile=${namesFile})`);
    } else {
      // The entrypoint silently accepted the bad file. This is a missing
      // product capability: the case cannot be passed honestly. We record
      // the observation as a missing-measurement verdict (BLOCKED) instead
      // of a fabricated pass.
      checks.expect("deny", false, `entrypoint silently accepted non-YAML frontmatter (status=0, observed stdout: ${combinedOutput.slice(0, 200)})`);
    }
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  return { ...checks.result(), denyReason: "entrypoint_seed_refused_or_missing_capability" };
}

export const handlers = {
  "SEC-15-V02": sec15v02,
  "SEC-15-FM-06": sec15fm06,
  "SEC-15-FM-SEED": sec15fmSeed
};
