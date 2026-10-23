/**
 * Spec 174 §6 — production static assets.
 *
 * - `/assets/*` serves only existing files: precompressed `.br` / `.gz`
 *   variants negotiated by Accept-Encoding q-values (q=0 honoured, identity
 *   fallback), `Vary: Accept-Encoding`, original Content-Type, a per-variant
 *   strong ETag + 304, and `immutable` caching only for hashed JS/CSS.
 *   Missing, escaping or badly encoded asset paths return 4xx and never fall
 *   back to the SPA HTML.
 * - Everything else falls back to `index.html` with `Cache-Control: no-cache`.
 * API routes and uploaded branding assets are not served here.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};

const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.(js|css)$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache";

export type Encoding = "br" | "gzip" | "identity";

function contentTypeFor(filePath: string): string {
  return MIME[path.extname(filePath)] ?? "application/octet-stream";
}

/** Parse Accept-Encoding into q-values; `*` applies to unlisted codings. */
export function parseAcceptEncoding(header: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!header) return out;
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName?.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const param of params) {
      const [key, value] = param.trim().split("=");
      if (key?.trim() === "q") {
        const parsed = Number(value);
        q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
      }
    }
    out.set(name, q);
  }
  return out;
}

/** Choose the best available coding; null means no acceptable representation (identity;q=0 and nothing else). */
export function negotiateEncoding(header: string | undefined, available: Encoding[]): Encoding | null {
  const accepted = parseAcceptEncoding(header);
  const star = accepted.get("*");
  const qFor = (encoding: Encoding): number => {
    if (accepted.has(encoding)) return accepted.get(encoding)!;
    if (encoding === "identity") return star === 0 ? 0 : 1;
    return star ?? 0;
  };
  const ranked = (["br", "gzip", "identity"] as Encoding[])
    .filter((encoding) => available.includes(encoding))
    .map((encoding, index) => ({ encoding, q: qFor(encoding), index }))
    .filter((candidate) => candidate.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked[0]?.encoding ?? null;
}

type Variant = { file: string; size: number; etag: string };
const etagCache = new Map<string, { mtimeMs: number; size: number; etag: string }>();

async function variant(file: string, encoding: Encoding): Promise<Variant | null> {
  try {
    const info = await stat(file);
    if (!info.isFile()) return null;
    const cached = etagCache.get(file);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return { file, size: info.size, etag: cached.etag };
    }
    const digest = createHash("sha256").update(await readFile(file)).digest("base64url").slice(0, 22);
    const etag = `"${digest}-${encoding}"`;
    etagCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, etag });
    return { file, size: info.size, etag };
  } catch {
    return null;
  }
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function sendNotFound(reply: FastifyReply, status = 404): FastifyReply {
  return reply
    .status(status)
    .header("Cache-Control", "no-store")
    .type("text/plain; charset=utf-8")
    .send(status === 400 ? "Bad Request" : "Not Found");
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((value) => {
    const candidate = value.trim().replace(/^W\//, "");
    return candidate === etag || candidate === "*";
  });
}

async function sendFile(
  request: FastifyRequest,
  reply: FastifyReply,
  original: string,
  cacheControl: string,
  allowCompressed: boolean
): Promise<FastifyReply> {
  const available: Encoding[] = ["identity"];
  const variants = new Map<Encoding, Variant>();
  const identity = await variant(original, "identity");
  if (!identity) return sendNotFound(reply);
  variants.set("identity", identity);
  if (allowCompressed) {
    for (const [encoding, suffix] of [["br", ".br"], ["gzip", ".gz"]] as const) {
      const found = await variant(`${original}${suffix}`, encoding);
      if (found) {
        variants.set(encoding, found);
        available.push(encoding);
      }
    }
  }
  const encoding = negotiateEncoding(request.headers["accept-encoding"], available);
  reply.header("Vary", "Accept-Encoding");
  reply.header("Cache-Control", cacheControl);
  if (!encoding) {
    return reply.status(406).header("Cache-Control", "no-store").type("text/plain; charset=utf-8").send("Not Acceptable");
  }
  const chosen = variants.get(encoding)!;
  reply.header("ETag", chosen.etag);
  if (etagMatches(request.headers["if-none-match"], chosen.etag)) {
    return reply.status(304).send();
  }
  reply.type(contentTypeFor(original));
  if (encoding !== "identity") reply.header("Content-Encoding", encoding);
  reply.header("Content-Length", String(chosen.size));
  if (request.method === "HEAD") return reply.send();
  return reply.send(createReadStream(chosen.file));
}

export async function serveStaticAsset(request: FastifyRequest, reply: FastifyReply, distDir: string): Promise<FastifyReply> {
  const root = path.resolve(distDir);
  let pathname: string;
  try {
    pathname = decodeURIComponent((request.url.split("?")[0] ?? "/"));
  } catch {
    return sendNotFound(reply, 400);
  }
  if (pathname.includes("\0")) return sendNotFound(reply, 400);

  if (pathname.startsWith("/assets/")) {
    const assetsRoot = path.join(root, "assets");
    const candidate = path.resolve(root, pathname.replace(/^\/+/, ""));
    if (!inside(candidate, assetsRoot)) return sendNotFound(reply);
    if (/\.(gz|br)$/.test(candidate)) return sendNotFound(reply);
    const cacheControl = HASHED_ASSET.test(candidate) ? IMMUTABLE : NO_CACHE;
    return sendFile(request, reply, candidate, cacheControl, /\.(js|css)$/.test(candidate));
  }

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = path.resolve(root, relative);
  if (candidate !== path.join(root, "index.html") && inside(candidate, root) && !/\.(gz|br)$/.test(candidate)) {
    try {
      if ((await stat(candidate)).isFile()) return sendFile(request, reply, candidate, NO_CACHE, false);
    } catch {
      // SPA deep link: fall through to index.html.
    }
  }
  return sendFile(request, reply, path.join(root, "index.html"), NO_CACHE, false);
}
