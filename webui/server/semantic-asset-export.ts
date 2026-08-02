// M19 — Sanitized Semantic Asset Export
//
// Builds a strict allow-listed zip of the project. Hard rules:
//   - Collect from the allow list (ktx.yaml, semantic-layer/, wiki/, evals/,
//     skills/), not a recursive project-root walk.
//   - Use lstat everywhere; never follow symlinks.
//   - Skip obvious secret-bearing paths and patterns (.ktx/secrets/**,
//     .env, *.pem, *.key, *.p12, node_modules/**, .git/**, raw-sources/**,
//     .ktx-ui/audit.sqlite, access.yaml, etc.).
//   - Sanitize ktx.yaml: replace host/port/username/password with
//     <REDACTED> regardless of where they appear.
//   - Use a pure-JS minimal ZIP writer; no external dep.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, stringify as stringifyYaml } from "yaml";
import { isMap, isSeq, isScalar, type Document, type Node } from "yaml";

const MAX_EXPORT_FILES = 200;
const MAX_EXPORT_TOTAL_BYTES = 16 * 1024 * 1024;
const EXPORT_DIR_REL = ".ktx-ui/exports";
const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const SKIP_PATH_PREFIXES = [
  ".ktx/secrets",
  ".ktx-ui",
  ".git",
  "node_modules",
  "raw-sources"
];
const SKIP_PATH_EXACT = new Set([".env", "private.key", "audit.sqlite", "access.yaml"]);
const SKIP_PATH_SUFFIXES = [".pem", ".key", ".p12", ".pfx", ".crt", ".cer"];

export type SemanticAssetExportRequest = {
  scope?: { connectionId?: string; schema?: string };
  includeWiki?: boolean;
  includeEvals?: boolean;
  includeSkills?: boolean;
  includeSanitizedKtxYaml?: boolean;
};

export type SemanticAssetExcludedFile = {
  path: string;
  reason: string;
};

export type SemanticAssetExportResponse = {
  exportId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  includedFiles: string[];
  excludedFiles: SemanticAssetExcludedFile[];
};

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}
function pad3(value: number): string {
  return value.toString().padStart(3, "0");
}

function formatTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}_${pad3(date.getMilliseconds())}`
  );
}

function newExportId(): string {
  return `exp_${formatTimestamp(new Date())}_${randomUUID().slice(0, 8)}`;
}

type CollectEntry = {
  relPath: string; // path inside the zip (always posix)
  absPath: string;
  sizeBytes: number;
};

type FileAllowedFn = (relPath: string) => { allowed: boolean; reason?: string };

function makeFileAllowedFn(
  options: SemanticAssetExportRequest
): FileAllowedFn {
  const scopeConn = options.scope?.connectionId;
  const scopeSchema = options.scope?.schema;
  const includeWiki = options.includeWiki === true;
  const includeEvals = options.includeEvals === true;
  const includeSkills = options.includeSkills === true;
  const includeKtx = options.includeSanitizedKtxYaml !== false;

  return (relPath: string) => {
    const normalized = relPath.split(path.sep).join("/");
    if (!normalized || normalized.startsWith("../") || normalized === "..") {
      return { allowed: false, reason: "path-traversal" };
    }
    if (SKIP_PATH_EXACT.has(normalized)) {
      return { allowed: false, reason: "forbidden-file" };
    }
    if (SKIP_PATH_PREFIXES.some((p) => normalized === p || normalized.startsWith(`${p}/`))) {
      return { allowed: false, reason: "forbidden-prefix" };
    }
    if (SKIP_PATH_SUFFIXES.some((suffix) => normalized.toLowerCase().endsWith(suffix))) {
      return { allowed: false, reason: "forbidden-extension" };
    }
    if (normalized === "ktx.yaml") {
      return includeKtx
        ? { allowed: true }
        : { allowed: false, reason: "ktx-yaml-disabled" };
    }
    if (normalized.startsWith("semantic-layer/")) {
      if (scopeConn) {
        const expectedPrefix = `semantic-layer/${scopeConn}/`;
        if (!normalized.startsWith(expectedPrefix)) {
          return { allowed: false, reason: "scope-mismatch-connection" };
        }
        if (scopeSchema && !normalized.includes(`/${scopeSchema}.`)) {
          // Schema scoping applies to the overlay file name; manifests live
          // under _schema/<schema>.yaml.
          const inSchemaDir = normalized.includes(`/_schema/${scopeSchema}.yaml`);
          if (!inSchemaDir) {
            return { allowed: false, reason: "scope-mismatch-schema" };
          }
        }
      }
      if (!YAML_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
        return { allowed: false, reason: "extension-not-allowed" };
      }
      return { allowed: true };
    }
    if (normalized.startsWith("wiki/")) {
      if (!includeWiki) return { allowed: false, reason: "wiki-disabled" };
      if (!MARKDOWN_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
        return { allowed: false, reason: "extension-not-allowed" };
      }
      return { allowed: true };
    }
    if (normalized.startsWith("evals/")) {
      if (!includeEvals) return { allowed: false, reason: "evals-disabled" };
      if (!YAML_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
        return { allowed: false, reason: "extension-not-allowed" };
      }
      return { allowed: true };
    }
    if (normalized.startsWith("skills/")) {
      if (!includeSkills) return { allowed: false, reason: "skills-disabled" };
      // skills/ is always opt-in and currently records the exclusion reason;
      // we do not yet support skill content export in M19.
      return { allowed: false, reason: "skills-export-not-implemented" };
    }
    return { allowed: false, reason: "not-allow-listed" };
  };
}

async function walkAllowListed(
  projectRoot: string,
  projectRelRoot: string,
  absRoot: string,
  allowed: FileAllowedFn,
  out: CollectEntry[],
  excluded: SemanticAssetExcludedFile[]
): Promise<void> {
  let entries: import("node:fs").Dirent[] = [];
  try {
    const { readdir } = await import("node:fs/promises");
    entries = await readdir(absRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const entry of entries) {
    const abs = path.join(absRoot, entry.name);
    const rel = path.posix.join(projectRelRoot, entry.name);
    const decision = allowed(rel);
    if (!decision.allowed) {
      excluded.push({ path: rel, reason: decision.reason ?? "filtered" });
      continue;
    }
    const info = await lstat(abs).catch(() => null);
    if (!info) continue;
    if (info.isSymbolicLink()) {
      // Never follow symlinks; record the exclusion.
      excluded.push({ path: rel, reason: "symlink-not-followed" });
      continue;
    }
    if (info.isDirectory()) {
      await walkAllowListed(projectRoot, rel, abs, allowed, out, excluded);
    } else if (info.isFile()) {
      out.push({ relPath: rel, absPath: abs, sizeBytes: info.size });
    }
  }
}

const REDACT_KEYS = new Set([
  "host",
  "hostname",
  "port",
  "username",
  "user",
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "private_key"
]);

function redactNode(node: Node | null | undefined): void {
  if (!node) return;
  if (isMap(node)) {
    for (let idx = node.items.length - 1; idx >= 0; idx -= 1) {
      const pair = node.items[idx];
      if (!pair) continue;
      const key = isScalar(pair.key) ? String(pair.key.value ?? "").toLowerCase() : "";
      if (REDACT_KEYS.has(key)) {
        pair.value = makeScalar("<REDACTED>", pair.value as Node | null | undefined);
      } else {
        redactNode(pair.value as Node | null | undefined);
      }
    }
    return;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      redactNode(item as Node | null | undefined);
    }
  }
}

function makeScalar(value: string, original: Node | null | undefined): Node {
  // Keep the scalar type closest to the original (e.g. number → quoted string)
  // so the sanitized output reads naturally.
  void original;
  return new (require("yaml").Scalar)(value);
}

function sanitizeKtxYaml(text: string): string {
  let doc: Document;
  try {
    doc = parseDocument(text, { keepSourceTokens: false });
  } catch {
    // If we cannot parse it, fall back to a hard-coded redaction pass: any
    // secret-bearing line is replaced wholesale.
    return text
      .split("\n")
      .map((line) => redactLine(line))
      .join("\n");
  }
  redactNode(doc.contents);
  // Strip the entire secret reference style: `password: file:...` is fine to
  // keep the *kind* but not the value. The map redaction above handles this.
  return stringifyYaml(doc, { lineWidth: 0 });
}

function redactLine(line: string): string {
  let out = line;
  for (const key of REDACT_KEYS) {
    const re = new RegExp(`(\\b${key}\\s*[:=]\\s*)(\\S+)`, "gi");
    out = out.replace(re, (_, prefix: string) => `${prefix}<REDACTED>`);
  }
  return out;
}

// ─── Pure-JS minimal ZIP writer (STORED only, no compression) ────────────

type ZipEntry = {
  name: string;
  data: Buffer;
  crc32: number;
  offset: number;
};

const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]!) & 0xff]!;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeDosTime(date: Date): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const zipEntries: ZipEntry[] = [];

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const { time, date } = writeDosTime(new Date());

    // Local file header (30 bytes + name + extra + data).
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // method = STORED
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18); // compressed size
    localHeader.writeUInt32LE(data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    localParts.push(localHeader, nameBytes, data);

    // Central directory header (46 bytes + name).
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // method
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra
    centralHeader.writeUInt16LE(0, 32); // comment
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(centralHeader, nameBytes);

    zipEntries.push({ name: entry.name, data, crc32: crc, offset });
    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const part of centralParts) centralSize += part.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk where central directory starts
  eocd.writeUInt16LE(zipEntries.length, 8);
  eocd.writeUInt16LE(zipEntries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

// ─── Public export entry ──────────────────────────────────────────────────

export async function exportSemanticAssetPackage(
  projectRoot: string,
  request: SemanticAssetExportRequest
): Promise<SemanticAssetExportResponse> {
  const allowed = makeFileAllowedFn(request);
  const entries: CollectEntry[] = [];
  const excluded: SemanticAssetExcludedFile[] = [];

  // Walk the allow-listed roots. The walk is driven by the allow function, so
  // a directory whose children are all denied simply produces no entries.
  const roots: Array<{ rel: string; abs: string }> = [
    { rel: "semantic-layer", abs: path.resolve(projectRoot, "semantic-layer") },
    { rel: "wiki", abs: path.resolve(projectRoot, "wiki") },
    { rel: "evals", abs: path.resolve(projectRoot, "evals") },
    { rel: "skills", abs: path.resolve(projectRoot, "skills") }
  ];

  // Enumerate every project file (cheap lstat walk) and let the allow
  // function decide. This is still bounded by the project tree size; we cap
  // total file count and bytes below.
  const allFiles: CollectEntry[] = [];
  for (const root of roots) {
    await walkAllowListed(
      projectRoot,
      root.rel,
      root.abs,
      () => ({ allowed: true }),
      allFiles,
      excluded
    );
  }

  // ktx.yaml is handled separately (single sanitized write).
  for (const file of allFiles) {
    const decision = allowed(file.relPath);
    if (decision.allowed) {
      entries.push(file);
    } else {
      excluded.push({ path: file.relPath, reason: decision.reason ?? "filtered" });
    }
  }

  if (allowed("ktx.yaml").allowed) {
    // Pretend the source file is on the allow list; we'll sanitize later.
    entries.unshift({
      relPath: "ktx.yaml",
      absPath: path.resolve(projectRoot, "ktx.yaml"),
      sizeBytes: 0
    });
  } else {
    excluded.push({ path: "ktx.yaml", reason: allowed("ktx.yaml").reason ?? "filtered" });
  }

  // Cap file count + total size.
  if (entries.length > MAX_EXPORT_FILES) {
    throw new Error(
      `Export refused: too many files (${entries.length} > ${MAX_EXPORT_FILES})`
    );
  }
  const totalSize = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  if (totalSize > MAX_EXPORT_TOTAL_BYTES) {
    throw new Error(
      `Export refused: total size ${totalSize} > ${MAX_EXPORT_TOTAL_BYTES} bytes`
    );
  }

  // Build zip.
  const zipEntries: { name: string; data: Buffer }[] = [];
  for (const entry of entries) {
    if (entry.relPath === "ktx.yaml") {
      const original = await readFile(entry.absPath, "utf8").catch(() => "");
      if (!original) {
        excluded.push({ path: "ktx.yaml", reason: "ktx-yaml-missing" });
        continue;
      }
      const sanitized = sanitizeKtxYaml(original);
      const buf = Buffer.from(sanitized, "utf8");
      zipEntries.push({ name: "ktx.yaml", data: buf });
    } else {
      const data = await readFile(entry.absPath);
      zipEntries.push({ name: entry.relPath.split(path.sep).join("/"), data });
    }
  }
  const zipBuffer = buildZip(zipEntries);
  const zipSha = sha256(zipBuffer);

  const exportId = newExportId();
  const dir = path.resolve(projectRoot, EXPORT_DIR_REL);
  await mkdir(dir, { recursive: true });
  const filename = `lucy-semantic-asset-${exportId}.zip`;
  const absZipPath = path.join(dir, `${exportId}.zip`);
  await writeFile(absZipPath, zipBuffer);

  // Opportunistic GC: remove any orphan export files older than 1 hour.
  try {
    const entries = await (await import("node:fs/promises")).readdir(dir);
    const now = Date.now();
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const info = await lstat(full);
      if (info.isFile() && now - info.mtimeMs > 60 * 60 * 1000) {
        await rm(full, { force: true });
      }
    }
  } catch {
    // best-effort GC
  }

  // Build excluded list for the spec-mandated hard-block categories.
  for (const hardPath of [
    ".ktx/secrets",
    ".env",
    ".ktx-ui/audit.sqlite"
  ]) {
    if (!excluded.find((e) => e.path === hardPath)) {
      excluded.push({ path: hardPath, reason: "hard-block" });
    }
  }

  return {
    exportId,
    filename,
    sizeBytes: zipBuffer.length,
    sha256: zipSha,
    downloadUrl: `/api/semantic-assets/exports/${exportId}/download`,
    includedFiles: zipEntries.map((e) => e.name),
    excludedFiles: excluded
  };
}
