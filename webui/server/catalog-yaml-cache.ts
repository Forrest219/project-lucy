import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { parse, parseDocument } from "yaml";
import { currentRevisionLedger, metaSignature } from "./display-revisions";
import { countEntryPerf } from "./entry-performance-timing";

// Keep the formal catalog's per-table overlays resident within the byte cap.
const MAX_FILES = 4096;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

type ParsedFile = { meta: string; digest: string; bytes: number; value: unknown };
type FileRead = { value: unknown } | { unsharedText: string };

const files = new Map<string, ParsedFile>();
const pending = new Map<string, Promise<FileRead | null>>();
let retainedBytes = 0;

function freezeValue(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return true;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  Object.freeze(value);
  return Object.values(value).every(freezeValue);
}

function forget(file: string): void {
  const prior = files.get(file);
  if (!prior) return;
  retainedBytes -= prior.bytes;
  files.delete(file);
}

function remember(file: string, entry: ParsedFile): void {
  forget(file);
  if (entry.bytes > MAX_SOURCE_BYTES) return;
  files.set(file, entry);
  retainedBytes += entry.bytes;
  while (files.size > MAX_FILES || retainedBytes > MAX_SOURCE_BYTES) {
    const oldest = files.keys().next().value;
    if (oldest === undefined) break;
    forget(oldest);
  }
}

function parseFile(file: string, text: string, json = false): unknown {
  countEntryPerf("catalogYamlParses");
  if (file.includes("/_schema/")) countEntryPerf("manifestParses");
  if (!json) return parse(text);
  const document = parseDocument(text, { prettyErrors: true });
  if (document.errors.length > 0) throw document.errors[0];
  return document.toJSON();
}

async function parseStableFile(file: string, meta: string): Promise<FileRead | null> {
  const content = await readFile(file);
  if (metaSignature(await stat(file)) !== meta) return null;
  const text = content.toString("utf8");
  const value = parseFile(file, text);
  // YAML 1.1 tags can construct mutable Date, Set and binary objects.
  // Fresh conversion preserves their types without sharing mutable state.
  if (!freezeValue(value)) return { unsharedText: text };
  const entry = { meta, digest: createHash("sha256").update(content).digest("hex"), bytes: content.length, value };
  remember(file, entry);
  return entry;
}

/** Reuse file facts only. Callers own path admission, validation and authorization. */
export async function readCatalogYaml(filePath: string, options: { json?: boolean } = {}): Promise<unknown> {
  const file = await realpath(filePath);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let meta: string;
    try {
      meta = metaSignature(await stat(file));
    } catch (error) {
      forget(file);
      throw error;
    }
    const accepted = currentRevisionLedger()?.get(file);
    const verifiedDigest = accepted?.meta === meta ? accepted.digest : undefined;
    const cached = files.get(file);
    if (cached?.meta === meta && (verifiedDigest === undefined || cached.digest === verifiedDigest)) {
      files.delete(file);
      files.set(file, cached);
      countEntryPerf("catalogYamlHits");
      return cached.value;
    }
    const key = JSON.stringify([file, meta, verifiedDigest]);
    let work = pending.get(key);
    if (work) {
      countEntryPerf("catalogYamlJoins");
    } else {
      work = parseStableFile(file, meta).finally(() => pending.delete(key));
      pending.set(key, work);
    }
    const fresh = await work;
    if (fresh) return "unsharedText" in fresh ? parseFile(file, fresh.unsharedText, options.json) : fresh.value;
  }
  throw new Error("File changed while reading catalog YAML");
}
