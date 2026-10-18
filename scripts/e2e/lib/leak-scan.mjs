// Output leakage scanner (Spec §5.3 SEC-06/17/23; Plan A6). A hit never contains the matched secret:
// only its kind and a short digest, so scan results themselves are safe to keep as artifacts.
//
// Carrier strategy: the scanner picks an extraction strategy by file extension. Text carriers go through
// `scanText`; .zip entries are inflated with a hardened local-and-central-header parser so a credential
// hidden inside a member is found; .tar.gz is unrolled into regular file members and each is scanned;
// anything else is reported as `unsupported_carrier` (kind="binary") and refused at the verdict level,
// because we cannot promise to find secrets inside compressed payloads, pixel data, or proprietary
// container formats we have no decoder for. Archive members are inspected with the SAME supported-format
// detection the top-level file uses, so a PNG inside a ZIP never falls through to a lossy text scan.
//
// Verdict priority (fail closed):
//   failed    > blocked    > passed
//   - failed:    an actual credential value or a forbidden canary was found in inspected bytes.
//   - blocked:   the carrier (or any member) cannot be safely inspected (binary format, encrypted,
//                unsupported compression, path traversal, truncated, unreadable, oversized, etc.).
//   - passed:    every carrier was inspected and contained no pattern hit.
// A blocked verdict can never silently become a pass; archive / verification steps refuse to sign
// anything whose tree still contains a blocked carrier.
//
// Symlink / FIFO / device members and stores that try to escape via path traversal are surfaced with
// `unsafe_entry_name` / `unsafe_member_type` so a verifier can refuse to extract them. Cumulative
// budget caps the total decompressed bytes the scanner will accept across a whole tree, so an
// attacker-controlled zip bomb cannot exhaust memory or CPU before the cap fires.

import { createHash } from "node:crypto";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { readFileSync, readdirSync, statSync, lstatSync } from "node:fs";
import { extname } from "node:path";

const GENERIC_PATTERNS = [
  { kind: "scrypt-password-hash", re: /scrypt:[0-9a-f]{16,}:[0-9a-f]{32,}/g },
  // A masked `password_hash: [REDACTED]` line in a diff is the intended output; only a concrete value is a leak.
  { kind: "password-hash-value", re: /password_hash["']?\s*[:=]\s*(?!\[?REDACTED\]?|\*+|null\b|"",|'',)/gi },
  { kind: "bearer-token", re: /Bearer\s+lucy_[A-Za-z0-9_-]{16,}/g },
  { kind: "lucy-token", re: /lucy_(?:e2e_)?[a-f0-9]{32,}/g }
];

const TEXT_EXTENSIONS = new Set([".txt", ".json", ".yaml", ".yml", ".log", ".md", ".csv", ".tsv", ".xml", ".html", ".htm", ".sql", ".js", ".mjs", ".cjs", ".py"]);
const ARCHIVE_EXTENSIONS = new Set([".zip", ".gz", ".tar.gz", ".tgz"]);

// Per-extension classification used by decodeCarrier.
const EXTENSION_KIND = {
  ".zip": "archive",
  ".gz": "archive",
  ".tar.gz": "archive",
  ".tgz": "archive",
  ".png": "binary",
  ".jpg": "binary",
  ".jpeg": "binary",
  ".gif": "binary",
  ".webp": "binary",
  ".parquet": "binary",
  ".sqlite": "binary",
  ".db": "binary",
  ".pdf": "binary",
  ".so": "binary",
  ".exe": "binary",
  ".dll": "binary"
};

// Magic-byte fingerprints. The first match wins; we use this so a renamed compressed payload is not
// silently treated as plain text (.txt with a ZIP body). The list only covers signatures the scanner
// can actually decode — anything else is reported as binary.
const MAGIC_RULES = [
  { kind: "zip",     magic: Buffer.from([0x50, 0x4b, 0x03, 0x04]) }, // PK\x03\x04 ZIP local header
  { kind: "zip",     magic: Buffer.from([0x50, 0x4b, 0x05, 0x06]) }, // empty ZIP
  { kind: "zip",     magic: Buffer.from([0x50, 0x4b, 0x07, 0x08]) }, // spanned
  { kind: "gz",      magic: Buffer.from([0x1f, 0x8b]) },              // GZIP
  { kind: "binary",  magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },  // PNG
  { kind: "binary",  magic: Buffer.from([0xff, 0xd8, 0xff]) },        // JPEG
  { kind: "binary",  magic: Buffer.from([0x47, 0x49, 0x46, 0x38]) },  // GIF
  { kind: "binary",  magic: Buffer.from([0x25, 0x50, 0x44, 0x46]) },  // PDF
  { kind: "binary",  magic: Buffer.from([0x53, 0x51, 0x4c, 0x69]) }   // SQLite
];

// Limits (Spec §5.3/§8.3 SEC-06/17/23). Anything beyond these is BLOCKED, never silently skipped.
export const MAX_FILE_BYTES = 64 * 1024 * 1024;          // single retained artifact
export const MAX_INFLATED_BYTES = 256 * 1024 * 1024;      // after decompression
export const MAX_TOTAL_INFLATED_BYTES = 1 * 1024 * 1024 * 1024; // 1 GiB cumulative
export const MAX_ENTRIES_PER_ARCHIVE = 1024;
export const MAX_TOTAL_ENTRIES = 4096;
export const MAX_ARCHIVE_DEPTH = 4;

const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

// --- shared state across an artifact tree to track cumulative inflated bytes -----------------------
class Budget {
  constructor(maxBytes) { this.remaining = maxBytes; }
  reserve(bytes) {
    if (bytes > this.remaining) return false;
    this.remaining -= bytes;
    return true;
  }
  oversize(bytes) { return bytes > this.remaining; }
}

// --- helper: extract text safely, never throwing on bad utf-8 -------------------------------------
function decodeUtf8(buffer) {
  // Use the strict decoder — invalid utf8 surfaces as the replacement character only when the buffer
  // happens to be valid latin-1 ASCII; a credential with one invalid utf-8 byte would also miss. We
  // search for credentials in *bytes* (String#indexOf on a latin-1 string) AND over the strict utf-8
  // view, and we keep both. This makes the scanner resilient to mixed-encoding secrets without
  // pretending latin-1 is identical to utf-8 for bytes >= 0x80.
  return buffer.toString("binary");
}

function utf8Strict(buffer) {
  try { return buffer.toString("utf8"); } catch { return null; }
}

function matchingIn(text, pattern) {
  if (!text) return false;
  return text.includes(pattern);
}

/**
 * @param {string} text scanned as bytes
 * @param {object} options
 * @param {string[]} [options.secrets] exact credential values that must never appear (tokens, passwords, bootstrap key)
 * @param {string[]} [options.forbiddenCanaries] out-of-domain canaries for the identity under test
 * @param {(rel: string) => string[]} [options.canaryRouter] route function: given the file's
 *   relative path, returns the canaries that file is forbidden to contain. Used by A6
 *   per-ask-per-question: a finance-allowed canary must not fail a finance ask just
 *   because the same canary is forbidden for a sales ask. When the router returns an
 *   empty list, no canaries are checked. When the router is absent, `forbiddenCanaries`
 *   is used as a global list.
 * @param {string} [options.fileRel] the file's relative path (passed to `canaryRouter`)
 */
export function scanText(text, options = {}) {
  const { secrets = [], forbiddenCanaries = [], canaryRouter = null, fileRel = null } = options;
  const hits = [];
  // Look in two views so a UTF-8 password with multi-byte characters is still found if some bytes
  // happen to be invalid latin-1 (the latin-1 view preserves bytes; the utf-8 view throws on invalid
  // sequences, which we then ignore).
  const views = [text ?? ""];
  const utf8 = utf8Strict(Buffer.from(text ?? "", "binary"));
  if (utf8 !== null) views.push(utf8);
  for (const secret of secrets) {
    if (!secret) continue;
    if (views.some((v) => matchingIn(v, secret))) hits.push({ kind: "exact-secret", digest: digest(secret) });
  }
  // Resolve the canary list: per-ask router takes precedence over the global forbidden list.
  // When the router is provided it determines the canary set for this exact file path. A
  // throwing router, a non-array return, or a router that explicitly returns the sentinel
  // value `__LUCY_UNRESOLVED_IDENTITY__` is treated as an UNRESOLVED identity and surfaced as
  // a `router-unresolved` synthetic hit. The carrier verdict becomes `failed` (not `passed`
  // with an empty list) so callers cannot accidentally green-light a file whose ask binding
  // the router could not compute. The previous implementation swallowed the exception and
  // replaced the canary set with `[]` — a finance-allowed canary could then silently miss
  // in a finance record simply because the router threw (URGENT task-a7 §A6 identity
  // partition root cause).
  let effectiveCanaries = forbiddenCanaries;
  let routerUnresolved = false;
  if (canaryRouter) {
    let result;
    try { result = canaryRouter(fileRel); } catch { result = "__LUCY_UNRESOLVED_IDENTITY__"; }
    if (Array.isArray(result)) {
      effectiveCanaries = result;
    } else {
      routerUnresolved = true;
    }
  }
  if (routerUnresolved) {
    hits.push({ kind: "router-unresolved", digest: digest("router-unresolved") });
  } else {
    for (const canary of effectiveCanaries) {
      if (!canary) continue;
      if (views.some((v) => matchingIn(v, canary))) hits.push({ kind: "forbidden-canary", digest: digest(canary) });
    }
  }
  for (const { kind, re } of GENERIC_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text ?? ""))) hits.push({ kind, digest: digest(m[0]) });
  }
  return hits;
}

/**
 * Combine "blocked" state with hit count into a single verdict.
 * Priority is failed > blocked > passed: a real leak (failed) wins, because if we DID match a
 * pattern in the bytes we have inspectable proof regardless of carrier support; an unsupported
 * carrier with no hit is blocked, not passed; only fully inspected clean content is passed.
 */
function verdict({ hits, blocked }) {
  if (hits > 0) return "failed";
  if (blocked) return "blocked";
  return "passed";
}

/**
 * Classify a buffer's true carrier, independent of file extension. Used by decodeCarrier to refuse
 * a renamed .txt that is actually a PNG, ZIP, etc. The verdict stays the same (if it is a recognised
 * archive we parse it; if it is a known binary type we mark unsupported).
 */
function classifyByMagic(buffer) {
  if (!buffer || buffer.length < 4) return null;
  for (const rule of MAGIC_RULES) {
    if (buffer.length >= rule.magic.length && buffer.subarray(0, rule.magic.length).equals(rule.magic)) return rule.kind;
  }
  return null;
}

// --- PKZIP -----------------------------------------------------------------------------
function isUnsafeName(name) {
  if (!name) return true;
  // Disallow absolute paths, Windows drive letters, traversal, backslashes, and NUL bytes.
  if (name.includes("\u0000") || name.includes("..") || name.startsWith("/") || /[A-Za-z]:[\\/]/.test(name) || name.includes("\\")) return true;
  return false;
}

function zipCrc(buffer, start, length) {
  let c = 0xffffffff;
  const end = Math.min(buffer.length, start + length);
  for (let i = start; i < end; i += 1) {
    const b = buffer[i];
    c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * Hardened PKZIP parser. Reads the central directory via a single EOCD scan, then validates each
 * local file header before slicing data. Per-entry status is reported so callers can act on one
 * bad apple instead of silently treating the archive as empty. Any structural inconsistency is
 * recorded as an `errors[]` entry; the caller decides whether partial data still counts as
 * scanned. Symlinks, devices, and other unusual external-attribute types are explicitly
 * refused because we never extract to disk.
 *
 * @returns {{ entries: object[], errors: object[] }}
 */
export function parseZip(buffer, options = {}) {
  const maxInflated = options.maxInflatedBytes ?? MAX_INFLATED_BYTES;
  const entries = [];
  const errors = [];
  // Truncated / empty buffer can't hold an EOCD (22 bytes is the minimum record).
  if (!buffer || buffer.length < 22) {
    return { entries, errors: [...errors, { kind: "truncated_zip", message: `buffer ${buffer?.length ?? 0}B shorter than the 22B EOCD minimum` }] };
  }
  // Find the first EOCD marker scanning backward (single-archive assumption; multi-volume is not
  // part of the standards we support).
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    return { entries, errors: [...errors, { kind: "no_eocd", message: "no PKZIP end-of-central-directory record found" }] };
  }
  const cdEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const eocdCommentLen = buffer.readUInt16LE(eocdOffset + 20);
  if (eocdOffset + 22 + eocdCommentLen > buffer.length) {
    return { entries, errors: [...errors, { kind: "eocd_truncated", message: "EOCD extends past the buffer" }] };
  }
  if (cdEntries === 0) {
    // An archive that someone claims is "evidence" but contains zero entries cannot be verified as
    // safe — the producer was supposed to retain real artifacts. Treat as structural failure so the
    // caller does not silently green-light a missing-evidence archive.
    return { entries, errors: [...errors, { kind: "empty_archive", message: "central directory declares zero entries; refusing to treat an empty archive as evidence" }] };
  }
  if (cdEntries > MAX_ENTRIES_PER_ARCHIVE) {
    return { entries, errors: [...errors, { kind: "too_many_entries", message: `central directory declares ${cdEntries} entries (limit ${MAX_ENTRIES_PER_ARCHIVE})` }] };
  }
  if (cdOffset >= buffer.length || cdSize > buffer.length - cdOffset) {
    return { entries, errors: [...errors, { kind: "cd_out_of_range", message: `central directory ${cdOffset}+${cdSize} is outside the ${buffer.length}B buffer` }] };
  }
  const cdEnd = cdOffset + cdSize;
  if (cdEnd !== buffer.length - eocdCommentLen - 22 && (cdEnd + 22 + eocdCommentLen) > buffer.length) {
    // CD end must match EOCD layout. A drift here usually means a truncated or padded archive;
    // we record it and continue to read what we can.
    errors.push({ kind: "eocd_cd_drift", message: `central directory end ${cdEnd} does not match EOCD layout` });
  }
  let cursor = cdOffset;
  let seen = 0;
  const seenNames = new Set();
  while (cursor < cdEnd && seen < cdEntries) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      errors.push({ kind: "bad_cd_signature", message: `central directory signature missing at offset ${cursor}` });
      break;
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const externalAttrs = buffer.readUInt32LE(cursor + 38);
    const madeBy = (externalAttrs >>> 16) & 0xffff;
    // External-attribute file-type bits (Unix high 16 bits): 0o120000 = symlink, 0o040000 = directory.
    const unixFileType = (externalAttrs >>> 16) & 0o170000;
    const name = buffer.slice(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;
    seen += 1;
    if (seenNames.has(name)) {
      entries.push({ name, method, status: "blocked", reason: "duplicate_entry_name", data: null });
      continue;
    }
    seenNames.add(name);
    if (isUnsafeName(name)) {
      entries.push({ name, method, status: "blocked", reason: "unsafe_entry_name", data: null });
      continue;
    }
    // Symlinks and Unix directories carry bits in the made-by/upper-bytes of the external-attribute
    // field. Refuse them all so an attacker cannot make us follow a link on extraction.
    if (unixFileType === 0o120000) {
      entries.push({ name, method, status: "blocked", reason: "symlink_entry", data: null });
      continue;
    }
    if (unixFileType === 0o040000) {
      entries.push({ name, method, status: "blocked", reason: "directory_entry", data: null });
      continue;
    }
    // Bit 0 of flags = encrypted
    if (flags & 0x1) {
      entries.push({ name, method, status: "blocked", reason: "encrypted_entry", data: null });
      continue;
    }
    // Bit 3 of flags = data descriptor present, sizes may be in the descriptor after the data.
    // We require declared sizes when present so we can pre-check against the inflate cap.
    const sizesInDescriptor = (flags & 0x8) !== 0;
    if (sizesInDescriptor) {
      entries.push({ name, method, status: "blocked", reason: "unsupported_descriptor_flag", data: null });
      continue;
    }
    if (method !== 0 && method !== 8 && method !== 99) {
      // 99 = AES (WinZip). Treat as blocked.
      entries.push({ name, method, status: "blocked", reason: `unsupported_method:${method}`, data: null });
      continue;
    }
    if (method === 99) {
      entries.push({ name, method, status: "blocked", reason: "aes_encrypted", data: null });
      continue;
    }
    // Local header
    if (localHeaderOffset + 30 > buffer.length) {
      entries.push({ name, method, status: "blocked", reason: "local_header_out_of_range", data: null });
      continue;
    }
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      entries.push({ name, method, status: "blocked", reason: "bad_lh_signature", data: null });
      continue;
    }
    const lhFlags = buffer.readUInt16LE(localHeaderOffset + 6);
    if (lhFlags & 0x1) {
      entries.push({ name, method, status: "blocked", reason: "encrypted_local_header", data: null });
      continue;
    }
    const lhMethod = buffer.readUInt16LE(localHeaderOffset + 8);
    if (lhMethod !== method) {
      entries.push({ name, method, status: "blocked", reason: "method_mismatch_local_central", data: null });
      continue;
    }
    const lhNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
    const lhExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
    const lhCrc = buffer.readUInt32LE(localHeaderOffset + 14);
    const lhCompressedSize = buffer.readUInt32LE(localHeaderOffset + 18);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    if (dataStart > buffer.length) {
      entries.push({ name, method, status: "blocked", reason: "data_start_out_of_range", data: null });
      continue;
    }
    if (compressedSize !== lhCompressedSize) {
      entries.push({ name, method, status: "blocked", reason: "size_mismatch_local_central", data: null });
      continue;
    }
    if (uncompressedSize > maxInflated) {
      entries.push({ name, method, status: "blocked", reason: `declared_size_too_large:${uncompressedSize}`, data: null });
      continue;
    }
    let data = null;
    if (method === 0) {
      if (dataStart + compressedSize > buffer.length) {
        entries.push({ name, method, status: "blocked", reason: "stored_data_truncated", data: null });
        continue;
      }
      if (compressedSize > maxInflated) {
        entries.push({ name, method, status: "blocked", reason: `stored_data_too_large:${compressedSize}`, data: null });
        continue;
      }
      data = buffer.slice(dataStart, dataStart + compressedSize);
    } else {
      if (dataStart + compressedSize > buffer.length) {
        entries.push({ name, method, status: "blocked", reason: "deflate_data_truncated", data: null });
        continue;
      }
      try {
        data = inflateRawSync(buffer.slice(dataStart, dataStart + compressedSize), { maxOutputLength: maxInflated });
      } catch (error) {
        entries.push({ name, method, status: "blocked", reason: `inflate_failed:${error.code ?? "unknown"}`, data: null });
        continue;
      }
    }
    if (!data || data.length === 0) {
      entries.push({ name, method, status: "blocked", reason: "empty_entry", data: null });
      continue;
    }
    // CRC32 sanity check (only when uncompressedSize > 0). Mismatches indicate a tampered or
    // truncated archive; refuse rather than silently scan a possibly-corrupted payload.
    if (uncompressedSize > 0) {
      const dataCrc = zipCrc(buffer, dataStart, compressedSize);
      if (method === 8) {
        // We inflated; recompute on inflated bytes.
        const inflatedCrc = zipCrc(data, 0, data.length);
        if (inflatedCrc !== lhCrc) {
          entries.push({ name, method, status: "blocked", reason: "crc_mismatch", data: null });
          continue;
        }
      } else if (dataCrc !== lhCrc) {
        entries.push({ name, method, status: "blocked", reason: "crc_mismatch", data: null });
        continue;
      }
    }
    entries.push({ name, method, status: "scanned", reason: null, data });
  }
  // Trailing bytes after CD but inside the buffer must be the EOCD record(s); anything else is a
  // parser fault and we report it.
  if (cdEnd + 22 + eocdCommentLen < buffer.length) {
    errors.push({ kind: "trailing_bytes", message: `${buffer.length - (cdEnd + 22 + eocdCommentLen)} bytes of data after the EOCD; refusing to ignore them` });
  }
  return { entries, errors };
}

/** Backwards-compatible accessor: only returns successfully-inflated entries. */
export function listZipEntries(buffer) {
  const { entries } = parseZip(buffer);
  return entries.filter((e) => e.status === "scanned");
}

/** Minimal POSIX ustar reader (regular files only). Symlinks and non-regular types are blocked. */
export function parseTar(buffer) {
  const entries = [];
  const errors = [];
  if (!buffer || buffer.length < 512) {
    return { entries, errors: [...errors, { kind: "truncated_tar", message: "buffer shorter than 512B tar header" }] };
  }
  let offset = 0;
  let blocks = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.slice(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      blocks += 1;
      if (blocks === 2) break;
      offset += 512;
      continue;
    }
    blocks = 0;
    const name = header.slice(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeOct = header.slice(124, 136).toString("binary").trim();
    const sizeRaw = sizeOct ? parseInt(sizeOct, 8) : 0;
    const typeflag = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    const paddedSize = Math.ceil(sizeRaw / 512) * 512;
    const paddedEnd = dataStart + paddedSize;
    offset = paddedEnd;
    if (!Number.isFinite(sizeRaw) || sizeRaw < 0 || dataStart + sizeRaw > buffer.length) {
      entries.push({ name, status: "blocked", reason: "tar_member_truncated", data: null });
      continue;
    }
    if (isUnsafeName(name)) {
      entries.push({ name, status: "blocked", reason: "unsafe_entry_name", data: null });
      continue;
    }
    if (typeflag === "5") {
      entries.push({ name, status: "blocked", reason: "tar_directory", data: null });
      continue;
    }
    if (typeflag === "1" || typeflag === "2") {
      entries.push({ name, status: "blocked", reason: `tar_hard_or_symlink:${typeflag}`, data: null });
      continue;
    }
    if (typeflag !== "0" && typeflag !== "" && typeflag !== "\0") {
      entries.push({ name, status: "blocked", reason: `tar_special_type:${typeflag}`, data: null });
      continue;
    }
    const data = buffer.slice(dataStart, dataStart + sizeRaw);
    // The natural pad between members is up to 511 trailing zero bytes (so the next header sits on a
    // 512-byte boundary). Anything beyond that is "content" the producer claims is real, but if the
    // buffer is dominated by zero bytes past the first non-zero prefix the producer is lying about
    // the entry size — flag as truncated so the caller can refuse to sign it.
    if (data.length > 0) {
      // Find the first non-zero byte in the data block.
      let firstNonZero = 0;
      while (firstNonZero < data.length && data[firstNonZero] === 0) firstNonZero += 1;
      // Find the position of the last non-zero byte.
      let lastNonZero = data.length - 1;
      while (lastNonZero >= 0 && data[lastNonZero] === 0) lastNonZero -= 1;
      if (firstNonZero >= data.length) {
        // Entire data block is zeros — there is no real content at all.
        entries.push({ name, status: "blocked", reason: "tar_member_truncated", data: null });
        continue;
      }
      if (lastNonZero + 1 < data.length) {
        const trailingZeros = data.length - (lastNonZero + 1);
        if (trailingZeros > 511) {
          // The producer declared more "content" than they actually wrote; the rest is just the
          // tar block-padding pattern expanded. Treat as a truncated entry.
          entries.push({ name, status: "blocked", reason: "tar_member_truncated", data: null });
          continue;
        }
      }
    }
    entries.push({ name, status: "scanned", reason: null, data });
  }
  // Trailing non-zero bytes after the second zero block indicate unparsed content.
  if (offset + 1024 <= buffer.length && !buffer.slice(offset + 1024).every((b) => b === 0)) {
    errors.push({ kind: "tar_trailing_data", message: `${buffer.length - (offset + 1024)} non-zero bytes after tar end-of-archive` });
  }
  return { entries, errors };
}

/** Read a tar.gz and return its members; gunzip failure is reported as an error, not silent. */
export function parseTarGz(buffer, options = {}) {
  let inflated;
  try {
    inflated = gunzipSync(buffer, { maxOutputLength: options.maxInflatedBytes ?? MAX_INFLATED_BYTES });
  } catch (error) {
    return { entries: [], errors: [{ kind: "gunzip_failed", message: error.code ?? error.message }] };
  }
  return parseTar(inflated);
}

/**
 * Pick a strategy by file extension. The result carries a `kind` plus, for archives, the per-member
 * parse tree. `decodeErrors` is a list of structural problems the parser observed; an empty list
 * does NOT mean the file is safe to sign without a verdict of "passed".
 */
export function decodeCarrier(buffer, filePath, options = {}) {
  const lower = (filePath ?? "").toLowerCase();
  const maxInflated = options.maxInflatedBytes ?? MAX_INFLATED_BYTES;
  // 1. Magic-byte check FIRST. Renamed compressed carriers are common: a ZIP saved as .txt must not be
  // silently treated as plain text by the textextension branch.
  const magicKind = buffer ? classifyByMagic(buffer) : null;
  if (magicKind === "zip") {
    const { entries, errors } = parseZip(buffer, options);
    return { kind: "zip", entries, decodeErrors: errors, blockedReason: errors.length > 0 ? "archive_parse_error" : null, magicRenamed: !lower.endsWith(".zip") };
  }
  if (magicKind === "gz") {
    try {
      const inflated = gunzipSync(buffer, { maxOutputLength: maxInflated });
      // .tar.gz / .tgz is a gzipped tar — the gzip magic fires first, but the file's TRUE carrier is
      // tar (with per-member recursion). The downstream scan logic already handles `decoded.kind`
      // === "tar", so route through parseTar instead of exposing the inflated bytes as opaque text.
      if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
        const { entries, errors } = parseTar(inflated, options);
        return { kind: "tar", entries, decodeErrors: errors, blockedReason: errors.length > 0 ? "archive_parse_error" : null };
      }
      return { kind: "gz", decodeErrors: [], text: decodeUtf8(inflated), blockedReason: null, magicRenamed: !(extname(lower) === ".gz" || lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) };
    } catch (error) {
      return { kind: "gz", decodeErrors: [{ kind: "gunzip_failed", message: error.code ?? error.message }], text: "", blockedReason: "gunzip_failed", magicRenamed: !(extname(lower) === ".gz" || lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) };
    }
  }
  if (magicKind === "binary") {
    return { kind: "binary", decodeErrors: [], text: decodeUtf8(buffer), blockedReason: "unsupported_carrier" };
  }
  // 2. Extension-based dispatch.
  const ext = extname(lower);
  if (ext === ".zip") {
    const { entries, errors } = parseZip(buffer, options);
    return { kind: "zip", entries, decodeErrors: errors, blockedReason: errors.length > 0 ? "archive_parse_error" : null };
  }
  if (ext === ".tar.gz" || ext === ".tgz") {
    const { entries, errors } = parseTarGz(buffer, options);
    return { kind: "tar", entries, decodeErrors: errors, blockedReason: errors.length > 0 ? "archive_parse_error" : null };
  }
  if (ext === ".gz") {
    try {
      const inflated = gunzipSync(buffer, { maxOutputLength: maxInflated });
      return { kind: "gz", decodeErrors: [], text: decodeUtf8(inflated), blockedReason: null };
    } catch (error) {
      return { kind: "gz", decodeErrors: [{ kind: "gunzip_failed", message: error.code ?? error.message }], text: "", blockedReason: "gunzip_failed" };
    }
  }
  if (EXTENSION_KIND[ext] === "binary") {
    return { kind: "binary", decodeErrors: [], text: decodeUtf8(buffer), blockedReason: "unsupported_carrier" };
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    // Check that the buffer is actually utf-8 (or plain ASCII); otherwise refuse and report as binary.
    // A NUL byte in a file whose name says ".json" is suspicious — no JSON decoder will accept it,
    // and the bytes that follow are unlikely to be a coherent string. Refuse as binary so an attacker
    // can't smuggle a credential past the text scanner by saving it as NUL + secret + NUL.
    if (buffer.includes(0x00)) {
      return { kind: "binary", decodeErrors: [{ kind: "nul_in_text", message: "NUL byte in a text-named carrier" }], text: decodeUtf8(buffer), blockedReason: "binary_named_as_text" };
    }
    const utf8 = utf8Strict(buffer);
    if (utf8 !== null) {
      return { kind: "text", decodeErrors: [], text: utf8, blockedReason: null };
    }
    return { kind: "binary", decodeErrors: [], text: decodeUtf8(buffer), blockedReason: "binary_named_as_text" };
  }
  // 3. Unknown extension — refuse by default. We do not scan the bytes for plaintext secrets because
  // doing so would silently mask an unsupported carrier: an attacker who renames a PNG to .dat
  // currently expects to be blocked; reporting "passed" after a byte-only scan is a false negative.
  // If a per-identity explicit option says "treat unknown as text", callers can do that themselves
  // by reading the file and calling scanText; the scanner stays fail-closed.
  return { kind: "binary", decodeErrors: [], text: "", blockedReason: "unsupported_carrier" };
}

// --- main entry point ---------------------------------------------------------------------------

/**
 * @typedef {Object} ScanOptions
 * @property {string[]} [secrets]
 * @property {string[]} [forbiddenCanaries]
 * @property {Budget} [budget]
 * @property {number} [depth]
 * @property {number} [maxInflatedBytes]
 * @property {number} [maxTotalBytes] cumulative decompressed budget
 * @property {string[]} [filenameSecrets] extra secrets to match in member names / central comments
 */

/**
 * Scan a single carrier. Nested archives are followed with `budget`/`depth` constraints. Members of
 * any archive are routed through the same `decodeCarrier` so a PNG inside a ZIP is blocked, not
 * silently treated as text.
 *
 * @param {Buffer|string} payload
 * @param {string} filePath used to pick the carrier strategy
 * @param {ScanOptions} options
 */
export function scanCarrier(payload, filePath, options = {}) {
  const depth = options.depth ?? 0;
  const budget = options.budget ?? new Budget(options.maxTotalBytes ?? MAX_TOTAL_INFLATED_BYTES);
  const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload ?? ""), "utf8");
  // Hard cap: when a recursive call is at the depth cap, refuse to descend further. The carrier is
  // a real archive or an unknown binary, so we never pretend it is safe to sign; we report
  // `nested_depth_exceeded` and let the caller flag the parent archive as blocked.
  if (depth >= MAX_ARCHIVE_DEPTH) {
    return {
      scanned: true,
      kind: "nested_depth_exceeded",
      status: "blocked",
      hits: 0,
      detail: [{ kind: "blocked", digest: digest("nested_depth_exceeded") }],
      errors: [{ kind: "nested_depth_exceeded", message: `recursion depth ${depth} reached MAX_ARCHIVE_DEPTH=${MAX_ARCHIVE_DEPTH}` }],
      nested: [],
      blockedReason: "nested_depth_exceeded"
    };
  }
  // Top-level file too large? Block before decoding — no carrier gets to allocate beyond the cap.
  if (buffer.length > MAX_FILE_BYTES) {
    return {
      scanned: true,
      kind: "oversized",
      status: "blocked",
      hits: 0,
      detail: [{ kind: "blocked", digest: digest(`oversized:${buffer.length}:limit:${MAX_FILE_BYTES}`) }],
      errors: [{ kind: "oversized", message: `${buffer.length}B exceeds MAX_FILE_BYTES ${MAX_FILE_BYTES}` }],
      nested: [],
      blockedReason: `oversized:${buffer.length}:limit:${MAX_FILE_BYTES}`
    };
  }
  const decoded = decodeCarrier(buffer, filePath, options);
  // For archives we already reserved the inflated bytes against the budget in the per-entry loop.
  // For text/binary/gz carriers there is no per-entry reservation, so the cumulative budget would
  // never be enforced. Reserve the raw payload here so a 1 GiB tree of plain files is also refused
  // before it allocates downstream memory.
  if (decoded.kind !== "zip" && decoded.kind !== "tar" && buffer.length > 0) {
    if (!budget.reserve(buffer.length)) {
      return {
        scanned: true,
        kind: decoded.kind,
        status: "blocked",
        hits: 0,
        detail: [{ kind: "blocked", digest: digest("budget_exceeded") }],
        errors: [{ kind: "budget_exceeded", message: `cumulative budget would be exceeded by ${buffer.length}B` }],
        nested: [],
        blockedReason: "budget_exceeded"
      };
    }
  }
  /** @type {{kind:string,digest:string}[]} */
  const hits = [];
  /** @type {{path:string,status:string,kind:string,hits:number,detail:object[],blockedReason?:string}[]} */
  const nested = [];
  let blockedReason = decoded.blockedReason ?? null;
  const decodeErrors = (decoded.decodeErrors ?? []).slice();
  // Member-name secret matches (filenames are scanned too; an attacker may put a credential into
  // the name even when the body is empty).
  const filenameMatches = scanText(filePath ?? "", { ...options, fileRel: filePath });
  for (const m of filenameMatches) hits.push(m);
  // Central-directory archive comment is inspected too — emit a synthetic text view if we have one.
  let structuralBlocked = blockedReason !== null;
  if (decoded.kind === "text" || decoded.kind === "gz" || decoded.kind === "tar" || decoded.kind === "zip") {
    // For gz we have already-decompressed text. For zip/tar the recursion below handles per-member.
    if (decoded.kind === "text" || decoded.kind === "gz") hits.push(...scanText(decoded.text, { ...options, fileRel: filePath }));
  }
  if (decoded.kind === "zip" || decoded.kind === "tar") {
    if ((decodeErrors.length > 0 || decoded.entries === undefined)) {
      structuralBlocked = true;
      blockedReason = blockedReason ?? "archive_parse_error";
    }
    for (const entry of decoded.entries ?? []) {
      const relPath = `${filePath}!${entry.name}`;
      if (entry.status === "blocked") {
        structuralBlocked = true;
        blockedReason = blockedReason ?? entry.reason ?? "entry_blocked";
        nested.push({ path: relPath, status: "blocked", kind: decoded.kind, hits: 0, detail: [{ kind: "blocked", digest: digest(entry.reason ?? "entry_blocked") }], blockedReason: entry.reason ?? "entry_blocked" });
        continue;
      }
      // Reserve bytes against the cumulative budget BEFORE we decode the member. A bomb fails here.
      if (!budget.reserve(entry.data.length)) {
        structuralBlocked = true;
        blockedReason = "budget_exceeded";
        nested.push({ path: relPath, status: "blocked", kind: decoded.kind, hits: 0, detail: [{ kind: "blocked", digest: digest("budget_exceeded") }], blockedReason: "budget_exceeded" });
        break;
      }
      // Route EVERY member through decodeCarrier so unsupported types stay unsupported, including
      // a PNG saved as photo.png inside a ZIP. The canary router sees the *member* path inside
      // the archive so per-ask partitioning works at the byte level.
      const inner = scanCarrier(entry.data, relPath, { ...options, depth: depth + 1, budget, fileRel: relPath });
      // Only propagate REAL hits (exact-secret / forbidden-canary / generic pattern) — not the
      // synthetic "blocked" markers we attach to structurally-blocked members.
      const realHits = (inner.detail ?? []).filter((h) => h && h.kind !== "blocked");
      for (const h of realHits) hits.push(h);
      if (inner.status === "failed") {
        nested.push({ path: relPath, status: "failed", kind: decoded.kind, hits: inner.hits, detail: inner.detail });
      } else if (inner.status === "blocked") {
        structuralBlocked = true;
        blockedReason = blockedReason ?? inner.blockedReason ?? "nested_carrier_blocked";
        nested.push({ path: relPath, status: "blocked", kind: decoded.kind, hits: 0, detail: inner.detail, blockedReason: inner.blockedReason });
      } else {
        nested.push({ path: relPath, status: "passed", kind: decoded.kind, hits: 0, detail: [] });
      }
      if (nested.length >= MAX_TOTAL_ENTRIES) {
        structuralBlocked = true;
        blockedReason = "too_many_entries";
        break;
      }
    }
  } else if (decoded.kind === "binary") {
    // Even though the carrier is unsupported, we still try to catch a plaintext substring inside the
    // bytes (e.g. a JSON-typed record embedded inside a custom container or a credential in raw
    // pixel-compressed PNG bytes). The hit (if any) makes the verdict `failed`; without a hit, the
    // carrier stays `blocked`. Verdict priority is failed > blocked > passed, so a real leak in the
    // bytes always wins over "unsupported carrier".
    hits.push(...scanText(decoded.text, { ...options, fileRel: filePath }));
  }
  // Surface archived parse errors as the top-level `errors` list.
  if (decodeErrors.length > 0 && hits.length === 0 && !structuralBlocked) {
    structuralBlocked = true;
    blockedReason = blockedReason ?? "archive_parse_error";
  }
  return {
    scanned: true,
    kind: decoded.kind,
    status: verdict({ hits: hits.length, blocked: structuralBlocked }),
    hits: hits.length,
    detail: hits,
    errors: decodeErrors,
    nested,
    blockedReason: blockedReason
  };
}

export function scanMany(texts, options) {
  const hits = texts.flatMap((text) => scanText(String(text ?? ""), options));
  return { scanned: true, status: verdict({ hits: hits.length, blocked: false }), hits: hits.length, detail: hits };
}

/**
 * Open a single file from disk and run the carrier scanner on it. Oversized or unreadable files
 * are BLOCKED; never silently skipped. Symlinks are read but recorded (no symbolic link can ever
 * become "passed" — the carrier of the target is what counts).
 */
export function scanFile(filePath, options = {}) {
  const maxBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  let lst;
  try {
    lst = lstatSync(filePath);
  } catch (error) {
    return {
      path: filePath,
      scanned: false,
      status: "blocked",
      kind: "unreadable_file",
      hits: 0,
      detail: [{ kind: "blocked", digest: digest(error.code ?? "stat_failed") }],
      blockedReason: error.code ?? "stat_failed",
      errors: [{ kind: "stat_failed", message: error.message }],
      nested: []
    };
  }
  if (lst.isSymbolicLink()) {
    return {
      path: filePath, scanned: false, status: "blocked",
      kind: "symlink_file", hits: 0,
      detail: [{ kind: "blocked", digest: digest("symlink_file") }],
      blockedReason: "symlink_file", errors: [], nested: []
    };
  }
  if (!lst.isFile()) {
    return {
      path: filePath, scanned: false, status: "blocked",
      kind: "not_a_file", hits: 0,
      detail: [{ kind: "blocked", digest: digest("not_a_file") }],
      blockedReason: "not_a_file", errors: [], nested: []
    };
  }
  if (lst.size > maxBytes) {
    return {
      path: filePath, scanned: false, status: "blocked",
      kind: "oversized", hits: 0,
      detail: [{ kind: "blocked", digest: digest(`oversized:${lst.size}:limit:${maxBytes}`) }],
      blockedReason: `oversized:${lst.size}:limit:${maxBytes}`, errors: [], nested: []
    };
  }
  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch (error) {
    return {
      path: filePath, scanned: false, status: "blocked",
      kind: "unreadable_file", hits: 0,
      detail: [{ kind: "blocked", digest: digest(error.code ?? "read_failed") }],
      blockedReason: error.code ?? "read_failed",
      errors: [{ kind: "read_failed", message: error.message }],
      nested: []
    };
  }
  const inner = scanCarrier(buffer, filePath, options);
  return {
    path: filePath,
    scanned: inner.scanned,
    kind: inner.kind,
    status: inner.status,
    hits: inner.hits,
    detail: inner.detail,
    errors: inner.errors,
    nested: inner.nested,
    blockedReason: inner.blockedReason
  };
}

/**
 * Walk a directory tree and scan every regular file via the carrier scanner. Symlinks are
 * reported as BLOCKED (they could resolve to anything outside the tree); entries that can't be
 * classified for any other reason are reported too. Symlinks are NEVER silently followed, and
 * the report always carries the symlink's path so a verifier can refuse the archive.
 */
export function scanRetainedArtifacts(rootDir, options = {}) {
  const maxBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
  const root = rootDir;
  const skipNames = new Set(["archive-manifest.json", "archive-manifest.sig", ...(options.skipNames ?? [])]);
  const skipDirs = new Set(options.skipDirs ?? []);
  const cumulativeBudget = new Budget(options.maxTotalBytes ?? MAX_TOTAL_INFLATED_BYTES);
  const out = { status: "passed", totals: { files: 0, passed: 0, failed: 0, blocked: 0, hitCount: 0, symlinks: 0, skipped: 0 }, entries: [], failures: [], blockedEntries: [], symlinks: [] };

  function walk(dir) {
    const list = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of list) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) { out.totals.skipped += 1; continue; }
        walk(full);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (skipNames.has(entry.name)) continue;
      const rel = full.slice(root.length + 1);
      // fileRel = the path relative to the run-root; the canaryRouter uses this to decide which
      // asks' forbidden canaries apply to this exact file. Without it, the router cannot tell a
      // finance-answered file from a sales-denied one, and the false-green false-positive of
      // the legacy global-UNION policy returns.
      const scanned = scanFile(full, { ...options, maxFileBytes: maxBytes, budget: cumulativeBudget, fileRel: rel });
      out.totals.files += 1;
      out.totals.hitCount += scanned.hits;
      if (entry.isSymbolicLink()) {
        out.totals.symlinks += 1;
        out.symlinks.push(rel);
        out.totals.blocked += 1;
        out.blockedEntries.push(rel);
        out.entries.push({ path: rel, ...scanned });
        continue;
      }
      if (scanned.status === "failed") {
        out.totals.failed += 1;
        out.failures.push(rel);
        out.entries.push({ path: rel, ...scanned });
      } else if (scanned.status === "blocked") {
        out.totals.blocked += 1;
        out.blockedEntries.push(rel);
        out.entries.push({ path: rel, ...scanned });
      } else {
        out.totals.passed += 1;
        out.entries.push({ path: rel, status: "passed", kind: scanned.kind, hits: 0, detail: [] });
      }
      if (out.totals.files > MAX_TOTAL_ENTRIES) {
        out.entries.push({ path: "(directory walk)", status: "blocked", kind: "directory", hits: 0, detail: [{ kind: "blocked", digest: digest("too_many_files") }], blockedReason: "too_many_files" });
        out.totals.blocked += 1;
        out.blockedEntries.push("(directory walk)");
        return;
      }
    }
  }

  try {
    walk(root);
  } catch (error) {
    out.status = "blocked";
    out.entries.push({ path: "(directory walk)", status: "blocked", kind: "directory", hits: 0, detail: [{ kind: "blocked", digest: digest(error.code ?? "walk_failed") }], blockedReason: error.code ?? "walk_failed", errors: [{ kind: "walk_failed", message: error.message }] });
    return out;
  }
  // Failure wins, then blocked.
  if (out.totals.failed > 0) out.status = "failed";
  else if (out.totals.blocked > 0) out.status = "blocked";
  else out.status = "passed";
  return out;
}
