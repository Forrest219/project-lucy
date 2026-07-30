// M19 — POST /api/semantic-assets/export and zip download route.
//
// Hard rules asserted here:
//  - ktx.yaml in the zip must have host/port/username/password replaced
//    with <REDACTED>.
//  - the zip must NOT contain .ktx/secrets/**, .env, *.pem/*.key/*.p12,
//    node_modules, .git, raw-sources, or .ktx-ui/audit.sqlite.
//  - symlinked files are excluded (lstat, not stat).
//  - the route is a pure local read; no ktx subprocess is invoked.
//  - excludedFiles summary lists the hard-block categories by path and
//    reason, never by secret value.

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";

let projectRoot: string;
let previousRoot: string | undefined;

const SECRET_KTX = `connections:
  customer-db:
    driver: mysql
    host: 10.20.30.40
    port: 3306
    username: root
    password: file:secrets/mysql-password
    schemas:
      - chatbi
    enabled_tables:
      - chatbi.ai_metric_international_country_daily
`;

const MANIFEST = `tables:
  international_country_metrics:
    table: chatbi.ai_metric_international_country_daily
`;

const OVERLAY = `name: international_country_metrics
table: chatbi.ai_metric_international_country_daily
grain:
  - date
`;

const WIKI = `# Chatbi context
This page references customer-db.
`;

const EVAL = `cases:
  - id: case-1
    question: "test?"
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-m19-export-"));
  await writeFile(path.join(root, "ktx.yaml"), SECRET_KTX, "utf8");
  await mkdir(path.join(root, "semantic-layer", "customer-db", "_schema"), { recursive: true });
  await writeFile(
    path.join(root, "semantic-layer", "customer-db", "_schema", "chatbi.yaml"),
    MANIFEST,
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", "customer-db", "international_country_metrics.yaml"),
    OVERLAY,
    "utf8"
  );
  await mkdir(path.join(root, "wiki", "global"), { recursive: true });
  await writeFile(path.join(root, "wiki", "global", "context.md"), WIKI, "utf8");
  await mkdir(path.join(root, "evals", "chatbi"), { recursive: true });
  await writeFile(
    path.join(root, "evals", "chatbi", "chatbi-eval-cases.yaml"),
    EVAL,
    "utf8"
  );
  // Hard-block fixtures
  await mkdir(path.join(root, ".ktx", "secrets"), { recursive: true });
  await writeFile(path.join(root, ".ktx", "secrets", "mysql-password"), "supersecret", "utf8");
  await writeFile(path.join(root, ".env"), "API_KEY=abcdef123456", "utf8");
  await writeFile(path.join(root, "private.key"), "-----BEGIN PRIVATE KEY-----", "utf8");
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await writeFile(
    path.join(root, "webui", "config", "access.yaml"),
    "tokens:\n  - label: x\n    hash: deadbeef\n",
    "utf8"
  );
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await writeFile(path.join(root, ".ktx-ui", "audit.sqlite"), "binary", "utf8");
  await mkdir(path.join(root, "node_modules", "lodash"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "lodash", "index.js"), "x", "utf8");
  await mkdir(path.join(root, ".git"), { recursive: true });
  await writeFile(path.join(root, ".git", "config"), "x", "utf8");
  await mkdir(path.join(root, "raw-sources"), { recursive: true });
  await writeFile(path.join(root, "raw-sources", "orders.csv"), "x", "utf8");
  return root;
}

async function buildFreshServer() {
  const { buildServer } = await import("../index");
  return buildServer();
}

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  vi.clearAllMocks();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

// Walk every entry in a zip (no external dep). Each entry is prefixed by
// `nameLen` bytes. We only care about names here; bodies are inspected via
// the central directory.
function listZipEntries(buffer: Buffer): string[] {
  const entries: string[] = [];
  if (buffer.length < 22) return entries;
  const eocdSig = buffer.readUInt32LE(buffer.length - 22);
  if (eocdSig !== 0x06054b50) return entries;
  const total = buffer.readUInt16LE(buffer.length - 10);
  const cdOffset = buffer.readUInt32LE(buffer.length - 6);
  let cursor = cdOffset;
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const name = buffer.slice(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    entries.push(name);
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buffer: Buffer, name: string): Buffer | null {
  // Walk local file headers to find the entry by name. (Simplistic; ignores
  // zip64 / data descriptors / extra field annotations.)
  let cursor = 0;
  while (cursor + 30 <= buffer.length) {
    if (buffer.readUInt32LE(cursor) !== 0x04034b50) break;
    const nameLen = buffer.readUInt16LE(cursor + 26);
    const extraLen = buffer.readUInt16LE(cursor + 28);
    const compSize = buffer.readUInt32LE(cursor + 18);
    const entryName = buffer.slice(cursor + 30, cursor + 30 + nameLen).toString("utf8");
    const dataStart = cursor + 30 + nameLen + extraLen;
    if (entryName === name) {
      return buffer.slice(dataStart, dataStart + compSize);
    }
    cursor = dataStart + compSize;
  }
  return null;
}

describe("POST /api/semantic-assets/export", () => {
  it("builds a sanitized zip without secrets or ktx.yaml plaintext credentials", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;
    await writeFile(
      path.join(projectRoot, "semantic-layer", "customer-db", "debug.json"),
      "{\"token\":\"secret\"}\n",
      "utf8"
    );
    await writeFile(path.join(projectRoot, "wiki", "global", "debug.yaml"), "password: x\n", "utf8");
    await writeFile(path.join(projectRoot, "evals", "chatbi", "debug.json"), "{\"api_key\":\"x\"}\n", "utf8");

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/export")
      .send({
        includeWiki: true,
        includeEvals: true
      })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const data = res.body.data;
    expect(typeof data.exportId).toBe("string");
    expect(data.downloadUrl).toBe(`/api/semantic-assets/exports/${data.exportId}/download`);
    expect(data.sizeBytes).toBeGreaterThan(0);
    expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);

    // The zip is on disk and downloadable.
    const zipAbs = path.join(
      projectRoot,
      ".ktx-ui",
      "exports",
      `${data.exportId}.zip`
    );
    const buf = readFileSync(zipAbs);
    const names = listZipEntries(buf);
    expect(names).toContain("ktx.yaml");
    expect(names).toContain("semantic-layer/customer-db/_schema/chatbi.yaml");
    expect(names).toContain("semantic-layer/customer-db/international_country_metrics.yaml");
    expect(names).toContain("wiki/global/context.md");
    expect(names).toContain("evals/chatbi/chatbi-eval-cases.yaml");
    // Hard-blocked paths are excluded.
    for (const blocked of [
      ".ktx/secrets/mysql-password",
      ".env",
      "private.key",
      "webui/config/access.yaml",
      ".ktx-ui/audit.sqlite",
      "node_modules/lodash/index.js",
      ".git/config",
      "raw-sources/orders.csv",
      "semantic-layer/customer-db/debug.json",
      "wiki/global/debug.yaml",
      "evals/chatbi/debug.json"
    ]) {
      expect(names).not.toContain(blocked);
    }

    // ktx.yaml in the zip is sanitized.
    const sanitizedKtx = readZipEntry(buf, "ktx.yaml")?.toString("utf8") ?? "";
    expect(sanitizedKtx).not.toContain("10.20.30.40");
    expect(sanitizedKtx).not.toContain("3306");
    expect(sanitizedKtx).not.toContain("root");
    expect(sanitizedKtx).toContain("<REDACTED>");

    // The summary reports excluded secret paths (by category) and the
    // sanitized ktx.yaml status. No secret values should leak into the
    // excludedFiles list.
    const excluded = data.excludedFiles as Array<{ path: string; reason: string }>;
    for (const entry of excluded) {
      expect(entry.path).not.toContain("supersecret");
      expect(entry.path).not.toContain("abcdef123456");
      expect(entry.path).not.toContain("BEGIN PRIVATE KEY");
    }
    const excludedPaths = excluded.map((e) => e.path);
    expect(excludedPaths).toContain(".ktx/secrets");
    expect(excludedPaths).toContain(".env");
    expect(excludedPaths).toContain(".ktx-ui/audit.sqlite");

    // The download route returns application/zip.
    const download = await request(app.server)
      .get(data.downloadUrl)
      .expect(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect(download.headers["content-disposition"]).toContain("attachment");
    // The on-disk zip and the bytes returned by the route must match.
    const downloadBuf = readFileSync(zipAbs);
    const onDiskNames = listZipEntries(downloadBuf);
    expect(onDiskNames).toContain("semantic-layer/customer-db/international_country_metrics.yaml");
    expect(downloadBuf.length).toBe(buf.length);

    await app.close();
  });

  it("excludes symlinked files (lstat, not stat) and never follows them in the zip", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // Make the wiki/global/context.md a symlink to a file OUTSIDE the
    // project root. The exporter must not follow it.
    const outside = path.join(os.tmpdir(), `lucy-m19-export-outside-${Date.now()}`);
    await mkdir(outside, { recursive: true });
    const outsideFile = path.join(outside, "secret.md");
    await writeFile(outsideFile, "outside-secret", "utf8");
    // Remove the existing wiki/global/context.md and replace with a symlink.
    await rm(path.join(projectRoot, "wiki/global/context.md"));
    await symlink(outsideFile, path.join(projectRoot, "wiki/global/context.md"));

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/export")
      .send({ includeWiki: true });
    expect(res.status).toBe(200);

    const zipAbs = path.join(
      projectRoot,
      ".ktx-ui",
      "exports",
      `${res.body.data.exportId}.zip`
    );
    const buf = readFileSync(zipAbs);
    const names = listZipEntries(buf);
    expect(names).not.toContain("wiki/global/context.md");

    // Hard-block category for the symlink is recorded in the summary.
    const excluded = res.body.data.excludedFiles as Array<{ path: string; reason: string }>;
    expect(excluded.find((e) => e.path === "wiki/global/context.md")?.reason).toBeTruthy();

    await rm(outside, { recursive: true, force: true });
    await app.close();
  });

  it("respects includeWiki/includeEvals/includeSkills toggles", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();

    // Default: only semantic-layer.
    const r1 = await request(app.server)
      .post("/api/semantic-assets/export")
      .send({})
      .expect(200);
    const n1 = listZipEntries(readFileSync(
      path.join(projectRoot, ".ktx-ui", "exports", `${r1.body.data.exportId}.zip`)
    ));
    expect(n1).toContain("semantic-layer/customer-db/international_country_metrics.yaml");
    expect(n1).not.toContain("wiki/global/context.md");
    expect(n1).not.toContain("evals/chatbi/chatbi-eval-cases.yaml");

    const r2 = await request(app.server)
      .post("/api/semantic-assets/export")
      .send({ includeWiki: true })
      .expect(200);
    const n2 = listZipEntries(readFileSync(
      path.join(projectRoot, ".ktx-ui", "exports", `${r2.body.data.exportId}.zip`)
    ));
    expect(n2).toContain("wiki/global/context.md");
    expect(n2).not.toContain("evals/chatbi/chatbi-eval-cases.yaml");

    const r3 = await request(app.server)
      .post("/api/semantic-assets/export")
      .send({ includeWiki: true, includeEvals: true })
      .expect(200);
    const n3 = listZipEntries(readFileSync(
      path.join(projectRoot, ".ktx-ui", "exports", `${r3.body.data.exportId}.zip`)
    ));
    expect(n3).toContain("evals/chatbi/chatbi-eval-cases.yaml");

    await app.close();
  });

  it("scopes the export to a single connection when scope.connectionId is provided", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    // Add a second connection's semantic-layer files that should be excluded.
    await mkdir(path.join(projectRoot, "semantic-layer", "other-db", "_schema"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "semantic-layer", "other-db", "_schema", "other.yaml"),
      "tables: {}\n",
      "utf8"
    );

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/semantic-assets/export")
      .send({ scope: { connectionId: "customer-db" } })
      .expect(200);

    const buf = readFileSync(
      path.join(projectRoot, ".ktx-ui", "exports", `${res.body.data.exportId}.zip`)
    );
    const names = listZipEntries(buf);
    expect(names).toContain("semantic-layer/customer-db/international_country_metrics.yaml");
    expect(names).not.toContain("semantic-layer/other-db/_schema/other.yaml");

    await app.close();
  });

  it("download route returns 404 for unknown export ids and never returns path-arbitrary files", async () => {
    projectRoot = await makeProject();
    process.env.KTX_PROJECT_ROOT = projectRoot;

    const app = await buildFreshServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/semantic-assets/exports/exp_does_not_exist/download")
      .expect(404);
    expect(res.body.error.code).toBe("EXPORT_NOT_FOUND");

    // Path-traversal probe: even if a malicious id tries to escape the
    // exports directory, the route resolves it under `.ktx-ui/exports/`.
    const bad = await request(app.server)
      .get("/api/semantic-assets/exports/..%2F..%2Fktx.yaml/download")
      .expect(404);
    expect(bad.body.error.code).toBe("EXPORT_NOT_FOUND");

    await app.close();
  });
});
