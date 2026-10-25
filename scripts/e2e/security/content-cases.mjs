// SEC-15 (file supply chain, frontmatter), SEC-22 (network / origin), SEC-02 related control-plane reads.
// Frontmatter probes use a file the payload would create if it executed; the file lives in the run's probe/
// directory, outside the product's content root, so only server-side execution can create it.
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Checks, explicitDeny, isRefusal } from "./context.mjs";
import { scanRetainedArtifacts } from "../lib/leak-scan.mjs";

const LANGUAGE_TAGS = ["---js", "---javascript", "---JS", "--- js", "---json"];

// --- A6 carrier-aware leakage helpers (SEC-06 / SEC-17) -----------------------------------------
// The pre-A6 code only ran scanText over each file's raw bytes, which silently missed every non-text
// carrier (compressed payloads, screenshots, ZIP / tar.gz, renamed binary blobs). These helpers
// expose the carrier-aware scan as a content-case primitive so SEC-06-V04 (screenshots / trace),
// SEC-17-V09 (zip export), and SEC-17-V10 (test artifacts) can reuse the same verdict logic that
// archive-evidence.mjs uses before it signs the manifest.
export async function carrierScan({ checks, dir, secrets, forbiddenCanaries = [], label = "carrier_scan" }) {
  const tree = scanRetainedArtifacts(dir, { secrets, forbiddenCanaries });
  checks.expect("carrier_no_leak", tree.totals.failed === 0, `${label}: ${tree.totals.failed} file(s) carry an exact credential — ${JSON.stringify(tree.failures)}`);
  checks.expect("carrier_no_unsupported", tree.totals.blocked === 0, `${label}: ${tree.totals.blocked} carrier(s) could not be safely inspected — ${JSON.stringify(tree.blockedEntries)}`);
  return tree;
}

function probePayload(ctx, languageTag, label) {
  const probeFile = path.join(ctx.run.paths.probe, `fm-executed-${label}`);
  const body = languageTag.toLowerCase().includes("json")
    ? `{ "summary": "json-${label}" }`
    : `{ summary: (process.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(probeFile)}, "executed"), "x") }`;
  return { markdown: `${languageTag}\n${body}\n---\n# probe\n`, probeFile };
}

const VALID_YAML = "---\nsummary: yaml control\nallowed_roles: [finance_reader]\n---\n# YAML control\n";

async function frontmatterCase(ctx, { name, send, expectStatus = 400 }) {
  const checks = new Checks();
  const cookie = await ctx.operatorCookie();
  const before = ctx.digest();
  const statuses = [];
  for (const [index, tag] of LANGUAGE_TAGS.entries()) {
    const label = `${name}-${index}`;
    const { markdown, probeFile } = probePayload(ctx, tag, label);
    const res = await send({ cookie, markdown, key: `e2e-fm/${label}.md`, label });
    statuses.push(res.status);
    checks.expect("deny", res.status === expectStatus && res.json?.error?.code === "WIKI_FRONTMATTER_UNSUPPORTED", `${JSON.stringify(tag)} -> ${res.status} ${res.json?.error?.code ?? ""}`);
    checks.expect("no_side_effect", !existsSync(probeFile), `${JSON.stringify(tag)}: server-side execution probe file ${existsSync(probeFile) ? "CREATED" : "absent"}`);
  }
  checks.expect("no_side_effect", ctx.digest() === before, "no content was written by any rejected payload");
  const control = await send({ cookie, markdown: VALID_YAML, key: `e2e-fm/${name}-control.md`, label: `${name}-control`, control: true });
  checks.expect("allow_control", control.status === 200, `valid YAML control -> ${control.status}`);
  return { ...checks.result(), denyReason: "WIKI_FRONTMATTER_UNSUPPORTED" };
}

const uploadSender = (ctx, action) => ({ cookie, markdown, key }) =>
  ctx.web.request("POST", `/api/wiki/upload/${action}`, { cookie, body: { key, markdown } });

export const handlers = {
  "SEC-15-FM-01": (ctx) => frontmatterCase(ctx, { name: "preview", send: uploadSender(ctx, "preview") }),
  "SEC-15-FM-02": (ctx) => frontmatterCase(ctx, { name: "commit", send: uploadSender(ctx, "commit") }),
  "SEC-15-FM-03": async (ctx) => {
    const put = (dryRun) => ({ cookie, markdown, key }) =>
      ctx.web.request("PUT", `/api/wiki/${encodeURIComponent(key)}`, { cookie, body: { dryRun, content: markdown } });
    const dry = await frontmatterCase(ctx, { name: "put-dry", send: put(true) });
    const real = await frontmatterCase(ctx, { name: "put", send: put(false) });
    return { assertions: [...dry.assertions, ...real.assertions], denyReason: "WIKI_FRONTMATTER_UNSUPPORTED" };
  },
  "SEC-15-FM-04": async (ctx) => {
    const checks = new Checks();
    const cookie = await ctx.operatorCookie();
    const dir = ctx.wikiFile("e2e-fm");
    mkdirSync(dir, { recursive: true });
    for (const [index, tag] of LANGUAGE_TAGS.entries()) {
      const label = `disk-${index}`;
      const { markdown, probeFile } = probePayload(ctx, tag, label);
      writeFileSync(path.join(dir, `${label}.md`), markdown);
      const afterWrite = ctx.digest();
      const res = await ctx.web.request("GET", `/api/wiki/${encodeURIComponent(`e2e-fm/${label}.md`)}`, { cookie });
      checks.expect("deny", res.status === 422 && res.json?.error?.code === "WIKI_FRONTMATTER_UNSUPPORTED", `${JSON.stringify(tag)} on disk -> ${res.status}`);
      checks.expect("no_side_effect", !existsSync(probeFile), `${JSON.stringify(tag)}: probe ${existsSync(probeFile) ? "CREATED" : "absent"}`);
      checks.expect("no_side_effect", ctx.digest() === afterWrite, "reading did not rewrite the file");
    }
    writeFileSync(path.join(dir, "control.md"), VALID_YAML);
    const control = await ctx.web.request("GET", `/api/wiki/${encodeURIComponent("e2e-fm/control.md")}`, { cookie });
    checks.expect("allow_control", control.status === 200, `valid YAML on disk -> ${control.status}`);
    return { ...checks.result(), denyReason: "WIKI_FRONTMATTER_UNSUPPORTED" };
  },
  "SEC-15-FM-05": async (ctx) => {
    const checks = new Checks();
    const cookie = await ctx.operatorCookie();
    const key = "e2e-fm/restore-target.md";
    const url = `/api/wiki/${encodeURIComponent(key)}`;
    const seeded = await ctx.web.request("PUT", url, { cookie, body: { dryRun: false, content: VALID_YAML } });
    checks.expect("allow_control", seeded.status === 200, `seed document -> ${seeded.status}`);
    const index = JSON.parse(readFileSync(ctx.wikiFile(".lucy-history", "index.json"), "utf8"));
    const version = index.documents[key].versions[0];
    for (const [i, tag] of LANGUAGE_TAGS.entries()) {
      const { markdown, probeFile } = probePayload(ctx, tag, `restore-${i}`);
      writeFileSync(path.join(ctx.run.paths.project, version.snapshotPath), markdown);
      const before = readFileSync(ctx.wikiFile(key), "utf8");
      const preview = await ctx.web.request("POST", `${url}/versions/${version.versionId}/restore/preview`, { cookie });
      const restore = await ctx.web.request("POST", `${url}/versions/${version.versionId}/restore`, { cookie });
      checks.expect("deny", preview.status === 400 && restore.status === 400, `${JSON.stringify(tag)} preview ${preview.status} / restore ${restore.status}`);
      checks.expect("no_side_effect", !existsSync(probeFile) && readFileSync(ctx.wikiFile(key), "utf8") === before, "probe absent and target unchanged");
    }
    writeFileSync(path.join(ctx.run.paths.project, version.snapshotPath), VALID_YAML);
    const control = await ctx.web.request("POST", `${url}/versions/${version.versionId}/restore`, { cookie });
    checks.expect("allow_control", control.status === 200, `valid snapshot restore -> ${control.status}`);
    return { ...checks.result(), denyReason: "WIKI_FRONTMATTER_UNSUPPORTED" };
  },

  "SEC-15-V01": async (ctx) => {
    const checks = new Checks();
    const cookie = await ctx.operatorCookie();
    const wikiDir = ctx.wikiFile();
    const outside = ctx.run.paths.outside;
    const fileLink = path.join(wikiDir, "e2e-link-file.md");
    const dirLink = path.join(wikiDir, "e2e-link-dir");
    symlinkSync(path.join(outside, "canary.txt"), fileLink);
    symlinkSync(outside, dirLink);
    const probes = [
      ctx.wikiRead(ctx.tokens.e2e_finance, "e2e-link-file.md"),
      ctx.wikiRead(ctx.tokens.e2e_finance, "e2e-link-dir/canary.txt"),
      ctx.web.request("GET", `/api/wiki/${encodeURIComponent("e2e-link-file.md")}`, { cookie }),
      ctx.web.request("GET", `/api/wiki/${encodeURIComponent("e2e-link-dir/canary.txt")}`, { cookie }),
      ctx.web.request("GET", `/api/wiki/${encodeURIComponent("e2e-link-file.md")}/raw`, { cookie })
    ];
    const responses = await Promise.all(probes);
    responses.forEach((res, i) => checks.expect("deny", !res.text.includes(ctx.canaries.outsideFile), `symlink probe ${i + 1} -> ${res.status}`));
    checks.noLeak(responses.map((r) => r.text), { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.outsideFile] });
    const control = await ctx.wikiRead(ctx.tokens.e2e_finance, "finance/cac-definition.md");
    checks.expect("no_side_effect", control.text.includes(ctx.canaries.financeWiki), "control: a regular file is still readable");
    return checks.result();
  },

  "SEC-15-V03": async (ctx) => {
    const checks = new Checks();
    const attempts = [
      "../../outside/canary.txt", "..%2f..%2foutside%2fcanary.txt", "%2e%2e/%2e%2e/outside/canary.txt",
      "....//....//outside/canary.txt", `${ctx.run.paths.outside}/canary.txt`, "finance/../../../outside/canary.txt", "finance\\..\\..\\outside\\canary.txt"
    ];
    const texts = [];
    for (const attempt of attempts) {
      const res = await ctx.wikiRead(ctx.tokens.e2e_finance, attempt);
      texts.push(res.text);
      checks.expect("deny", !res.text.includes(ctx.canaries.outsideFile), `${attempt.slice(0, 40)} -> ${res.status}`);
    }
    checks.noLeak(texts, { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.outsideFile] });
    const control = await ctx.wikiRead(ctx.tokens.e2e_finance, "finance/cac-definition.md");
    checks.expect("no_side_effect", control.text.includes(ctx.canaries.financeWiki), "control: legitimate key still readable");
    return checks.result();
  },

  "SEC-15-V04": async (ctx) => {
    const checks = new Checks();
    const cookie = await ctx.operatorCookie();
    const key = "e2e-fm/xss-case.md";
    const markdown = `---\nsummary: xss\nallowed_roles: [finance_reader]\n---\n# XSS\n\n<script>globalThis.__x=1</script>\n<img src=x onerror=alert(1)>\n`;
    const commit = await ctx.web.request("POST", "/api/wiki/upload/commit", { cookie, body: { key, markdown } });
    checks.expect("allow_control", commit.status === 200, `valid Markdown with inert payload is stored as text -> ${commit.status}`);
    const raw = await ctx.web.request("GET", `/api/wiki/${encodeURIComponent(key)}/raw`, { cookie });
    checks.expect("deny", /text\/markdown/.test(raw.headers["content-type"] ?? "") && /attachment/.test(raw.headers["content-disposition"] ?? ""), `raw is served as a markdown attachment (${raw.headers["content-type"]})`);
    const page = await ctx.web.request("GET", "/", {});
    const csp = page.headers["content-security-policy"] ?? "";
    checks.expect("deny", /script-src 'self'/.test(csp) && !/unsafe-inline[^;]*;?.*script-src/.test(csp) && !/script-src[^;]*unsafe-(inline|eval)/.test(csp), "CSP forbids inline script");
    return checks.result();
  },

  "SEC-15-V05": async (ctx) => {
    const checks = new Checks();
    const cookie = await ctx.operatorCookie();
    const before = ctx.digest();
    // Just over Fastify's default 1 MiB body limit: the server answers 413 without a connection reset, so the
    // refusal is an explicit HTTP status rather than a transport error.
    const huge = `---\nsummary: big\nallowed_roles: [finance_reader]\n---\n${"A".repeat(1_048_576 + 4096)}`;
    const res = await ctx.web.request("POST", "/api/wiki/upload/commit", { cookie, body: { key: "e2e-fm/oversize.md", markdown: huge }, timeoutMs: 60_000 });
    checks.expect("deny", isRefusal(res), `over-limit upload -> ${res.status}`);
    checks.expect("no_side_effect", ctx.digest() === before, "nothing was written");
    return checks.result();
  },

  "SEC-22-V03": async (ctx) => {
    const checks = new Checks();
    const owner = await ctx.ownerCookie();
    const before = ctx.digest();
    const cross = await ctx.web.request("PUT", "/api/wiki/shared%2Fglossary.md", {
      cookie: owner, headers: { origin: "http://evil.example", "sec-fetch-site": "cross-site" }, body: { dryRun: false, content: "# csrf\n" }
    });
    checks.expect("deny", cross.status === 403, `cross-site PUT with a valid Cookie -> ${cross.status}`);
    const nullOrigin = await ctx.web.request("POST", "/api/auth/logout", { cookie: owner, headers: { origin: "null" } });
    checks.expect("deny", nullOrigin.status === 403, `Origin: null -> ${nullOrigin.status}`);
    const still = await ctx.adminCall(owner, "GET", "/api/auth/me");
    checks.expect("deny", still.status === 200, `the blocked logout did not end the session -> ${still.status}`);
    checks.expect("no_side_effect", ctx.digest() === before, "no content changed");
    return checks.result();
  },

  "SEC-22-V06": async (ctx) => {
    const checks = new Checks();
    const texts = [];
    for (const pathname of ["/mcp/skills", "/mcp/skills/tools/list"]) {
      const res = await ctx.mcp(ctx.tokens.e2e_finance, ctx.rpc(1, "tools/list"), { pathname });
      texts.push(res.text);
      checks.expect("deny", isRefusal(res), `${pathname} -> ${res.status}`);
    }
    checks.noLeak(texts, { secrets: ctx.allSecrets, forbiddenCanaries: [ctx.canaries.publishedSkill, ctx.canaries.draftSkill] });
    return checks.result();
  },

  "SEC-22-V07": async (ctx) => {
    const checks = new Checks();
    const ok = await ctx.mcp(ctx.tokens.e2e_finance, ctx.rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "native", version: "1" } }));
    checks.expect("allow_control", ok.status === 200, `native client (no Origin) with a valid Token -> ${ok.status}`);
    const anon = await ctx.mcp("", ctx.rpc(2, "initialize", {}));
    checks.expect("deny", anon.status === 401, `no Origin does not mean no authentication -> ${anon.status}`);
    return checks.result();
  },

  // SEC-06-V04 / SEC-17-V09 / SEC-17-V10 are catalog `runner: gate` (or default) cases whose
  // canonical implementation lives in the gate runner and `archive-evidence.mjs`. The security
  // runner exposes `carrierScan` as a primitive so future catalog cases that DO get classified as
  // `runner: security` can reuse the carrier-aware verdict without re-implementing it.
};
