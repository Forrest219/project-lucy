import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parse, stringify } from "yaml";
import { resolveProjectRoot } from "./project.js";
import { ForbiddenPathError, assertReadable, safeRemove, safeWrite, safeWriteBinary } from "./fs-safe.js";
import { auditedWriteFile } from "./admin/config-audit-write.js";
import { readRasterImageSize, sniffRasterImageMime } from "./image-raster.js";

export const BRANDING_YAML_REL = "webui/config/branding.yaml";
export const BRANDING_DIR_REL = "webui/config/branding";
export const DEFAULT_PRODUCT_TITLE = "Lucy WebUI";
export const DEFAULT_TAGLINE = "Data Agent MCP";
export const MAX_LOGO_BYTES = 512 * 1024;
export const MAX_BRAND_TEXT_CHARS = 64;
export const MIN_LOGO_PX = 32;
export const MAX_LOGO_PX = 160;

const LOGO_EXT_BY_MIME: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif"
};

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif"
};

export type BrandingLogoMeta = {
  filename: string;
  contentType: string;
  width: number;
  height: number;
  updatedAt: string;
};

export type BrandingConfig = {
  version: string;
  productTitle: string;
  tagline: string;
  logo: BrandingLogoMeta | null;
};

export type BrandingPublicView = {
  productTitle: string;
  tagline: string;
  productTitleOverride: string;
  taglineOverride: string;
  hasCustomLogo: boolean;
  logoUrl: string | null;
  logoContentType: string | null;
  logoWidth: number | null;
  logoHeight: number | null;
  updatedAt: string | null;
  defaults: {
    productTitle: string;
    tagline: string;
  };
};

export class BrandingValidationError extends Error {
  code = "BRANDING_INVALID";
  statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "BrandingValidationError";
  }
}

function emptyConfig(): BrandingConfig {
  return { version: "1", productTitle: "", tagline: "", logo: null };
}

function normalizeTextField(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") {
    throw new BrandingValidationError("产品名称与副标题必须是字符串");
  }
  const trimmed = raw.trim();
  if ([...trimmed].length > MAX_BRAND_TEXT_CHARS) {
    throw new BrandingValidationError(`文案最长 ${MAX_BRAND_TEXT_CHARS} 个字符`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) {
    throw new BrandingValidationError("文案含非法控制字符");
  }
  return trimmed;
}

function normalizeLogo(raw: unknown): BrandingLogoMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.filename !== "string" || !row.filename.trim()) return null;
  if (typeof row.contentType !== "string" || !row.contentType.trim()) return null;
  const ext = path.extname(row.filename).toLowerCase();
  if (!MIME_BY_EXT[ext]) return null;
  const width = typeof row.width === "number" ? row.width : 0;
  const height = typeof row.height === "number" ? row.height : 0;
  return {
    filename: path.basename(row.filename.trim()),
    contentType: row.contentType.trim(),
    width,
    height,
    updatedAt: typeof row.updatedAt === "string" && row.updatedAt ? row.updatedAt : new Date().toISOString()
  };
}

function normalizeConfig(raw: unknown): BrandingConfig {
  if (!raw || typeof raw !== "object") return emptyConfig();
  const doc = raw as Record<string, unknown>;
  return {
    version: typeof doc.version === "string" && doc.version.trim() ? doc.version.trim() : "1",
    productTitle: typeof doc.productTitle === "string" ? doc.productTitle.trim() : "",
    tagline: typeof doc.tagline === "string" ? doc.tagline.trim() : "",
    logo: normalizeLogo(doc.logo)
  };
}

function serializeConfig(config: BrandingConfig): string {
  const doc: Record<string, unknown> = {
    version: config.version || "1",
    productTitle: config.productTitle,
    tagline: config.tagline
  };
  if (config.logo) {
    doc.logo = {
      filename: config.logo.filename,
      contentType: config.logo.contentType,
      width: config.logo.width,
      height: config.logo.height,
      updatedAt: config.logo.updatedAt
    };
  }
  return stringify(doc);
}

export async function loadBrandingConfig(projectRoot?: string): Promise<BrandingConfig> {
  const root = projectRoot ?? (await resolveProjectRoot());
  try {
    const abs = await assertReadable(root, BRANDING_YAML_REL);
    const text = await readFile(abs, "utf8");
    return normalizeConfig(parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig();
    if (error instanceof ForbiddenPathError) return emptyConfig();
    throw error;
  }
}

export function effectiveProductTitle(config: BrandingConfig): string {
  return config.productTitle.trim() || DEFAULT_PRODUCT_TITLE;
}

export function effectiveTagline(config: BrandingConfig): string {
  return config.tagline.trim() || DEFAULT_TAGLINE;
}

export function toPublicView(config: BrandingConfig): BrandingPublicView {
  const hasCustomLogo = Boolean(config.logo);
  const updatedAt = config.logo?.updatedAt ?? null;
  return {
    productTitle: effectiveProductTitle(config),
    tagline: effectiveTagline(config),
    productTitleOverride: config.productTitle,
    taglineOverride: config.tagline,
    hasCustomLogo,
    logoUrl: hasCustomLogo
      ? `/api/branding/logo?v=${encodeURIComponent(updatedAt ?? "1")}`
      : null,
    logoContentType: config.logo?.contentType ?? null,
    logoWidth: config.logo?.width ?? null,
    logoHeight: config.logo?.height ?? null,
    updatedAt,
    defaults: {
      productTitle: DEFAULT_PRODUCT_TITLE,
      tagline: DEFAULT_TAGLINE
    }
  };
}

function logoRelPath(filename: string): string {
  return `${BRANDING_DIR_REL}/${path.basename(filename)}`;
}

async function listLogoFiles(projectRoot: string): Promise<string[]> {
  try {
    const abs = await assertReadable(projectRoot, BRANDING_DIR_REL);
    const entries = await readdir(abs);
    return entries
      .filter((name) => Boolean(MIME_BY_EXT[path.extname(name).toLowerCase()]))
      .map((name) => logoRelPath(name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (error instanceof ForbiddenPathError) return [];
    throw error;
  }
}

async function removeAllLogoFiles(projectRoot: string): Promise<void> {
  const files = await listLogoFiles(projectRoot);
  for (const rel of files) {
    await safeRemove(projectRoot, rel);
  }
}

function expectedMimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".svg") || lower.endsWith(".webp")) {
    throw new BrandingValidationError("仅支持 PNG、JPEG、GIF 格式的客户 Logo（不支持 SVG / WebP）");
  }
  const ext = path.extname(lower);
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new BrandingValidationError("仅支持 PNG、JPEG、GIF 格式的客户 Logo");
  }
  return mime;
}

function decodeLogoBase64(contentBase64: string): Buffer {
  if (typeof contentBase64 !== "string" || !contentBase64.trim()) {
    throw new BrandingValidationError("缺少 Logo 内容");
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(contentBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
  } catch {
    throw new BrandingValidationError("Logo 不是合法 base64 内容");
  }
  if (buffer.length === 0) {
    throw new BrandingValidationError("Logo 内容为空");
  }
  if (buffer.length > MAX_LOGO_BYTES) {
    throw new BrandingValidationError(`客户 Logo 不得超过 ${MAX_LOGO_BYTES / 1024} KB`);
  }
  return buffer;
}

function validateLogoBuffer(buffer: Buffer, filenameHint: string): {
  contentType: string;
  ext: string;
  width: number;
  height: number;
} {
  expectedMimeFromFilename(filenameHint);
  const sniffed = sniffRasterImageMime(buffer);
  if (!sniffed) {
    throw new BrandingValidationError("无法识别为 PNG、JPEG 或 GIF 图像");
  }
  const size = readRasterImageSize(buffer);
  if (!size || size.width < 1 || size.height < 1) {
    throw new BrandingValidationError("无法读取 Logo 宽高");
  }
  if (
    size.width < MIN_LOGO_PX ||
    size.height < MIN_LOGO_PX ||
    size.width > MAX_LOGO_PX ||
    size.height > MAX_LOGO_PX
  ) {
    throw new BrandingValidationError(
      `客户 Logo 宽高须在 ${MIN_LOGO_PX}–${MAX_LOGO_PX} 像素（推荐 48×48）；当前为 ${size.width}×${size.height}`
    );
  }
  const ext = LOGO_EXT_BY_MIME[sniffed];
  if (!ext) {
    throw new BrandingValidationError("不支持的 Logo 类型");
  }
  return { contentType: sniffed, ext, width: size.width, height: size.height };
}

function auditActor(request: FastifyRequest): {
  actor?: string;
  actorType: "ui_admin";
  actorIp?: string;
} {
  const adminId = request.lucyAdmin?.admin?.id;
  return {
    actor: adminId,
    actorType: "ui_admin",
    actorIp: request.ip
  };
}

export async function updateBrandingText(
  projectRoot: string,
  input: { productTitle?: string; tagline?: string },
  request: FastifyRequest
): Promise<BrandingPublicView> {
  const current = await loadBrandingConfig(projectRoot);
  const next: BrandingConfig = {
    ...current,
    productTitle:
      input.productTitle !== undefined ? normalizeTextField(input.productTitle) : current.productTitle,
    tagline: input.tagline !== undefined ? normalizeTextField(input.tagline) : current.tagline
  };
  const actor = auditActor(request);
  await auditedWriteFile(projectRoot, BRANDING_YAML_REL, serializeConfig(next), {
    enabled: true,
    changeType: "branding.update",
    assetKind: "governance",
    operation: "update",
    targetId: "branding",
    oldSummary: { productTitle: current.productTitle, tagline: current.tagline },
    newSummary: { productTitle: next.productTitle, tagline: next.tagline },
    ...actor,
    source: "webui"
  });
  return toPublicView(next);
}

export async function uploadBrandingLogo(
  projectRoot: string,
  input: { filename: string; contentBase64: string },
  request: FastifyRequest
): Promise<BrandingPublicView> {
  if (typeof input.filename !== "string" || !input.filename.trim()) {
    throw new BrandingValidationError("缺少 Logo 文件名");
  }
  const buffer = decodeLogoBase64(input.contentBase64);
  const validated = validateLogoBuffer(buffer, input.filename.trim());
  const filename = `logo${validated.ext}`;
  const relPath = logoRelPath(filename);
  const updatedAt = new Date().toISOString();
  const current = await loadBrandingConfig(projectRoot);
  await removeAllLogoFiles(projectRoot);
  await safeWriteBinary(projectRoot, relPath, buffer);

  const next: BrandingConfig = {
    ...current,
    logo: {
      filename,
      contentType: validated.contentType,
      width: validated.width,
      height: validated.height,
      updatedAt
    }
  };
  const actor = auditActor(request);
  await auditedWriteFile(projectRoot, BRANDING_YAML_REL, serializeConfig(next), {
    enabled: true,
    changeType: "branding.logo.upload",
    assetKind: "governance",
    operation: "upload",
    targetId: "branding-logo",
    oldSummary: current.logo,
    newSummary: next.logo,
    ...actor,
    source: "webui"
  });
  return toPublicView(next);
}

export async function deleteBrandingLogo(
  projectRoot: string,
  request: FastifyRequest
): Promise<BrandingPublicView> {
  const current = await loadBrandingConfig(projectRoot);
  await removeAllLogoFiles(projectRoot);
  const next: BrandingConfig = { ...current, logo: null };
  const actor = auditActor(request);
  await auditedWriteFile(projectRoot, BRANDING_YAML_REL, serializeConfig(next), {
    enabled: true,
    changeType: "branding.logo.delete",
    assetKind: "governance",
    operation: "delete",
    targetId: "branding-logo",
    oldSummary: current.logo,
    newSummary: null,
    ...actor,
    source: "webui"
  });
  return toPublicView(next);
}

export async function readBrandingLogoBytes(
  projectRoot: string
): Promise<{ buffer: Buffer; contentType: string; updatedAt: string } | null> {
  const config = await loadBrandingConfig(projectRoot);
  if (!config.logo) return null;
  try {
    const abs = await assertReadable(projectRoot, logoRelPath(config.logo.filename));
    const buffer = await readFile(abs);
    return {
      buffer,
      contentType: config.logo.contentType,
      updatedAt: config.logo.updatedAt
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof ForbiddenPathError) return null;
    throw error;
  }
}

function sendBrandingError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof BrandingValidationError) {
    return reply.status(error.statusCode).send({
      ok: false,
      error: { code: error.code, message: error.message }
    });
  }
  throw error;
}

export function registerBrandingRoutes(app: FastifyInstance): void {
  app.get("/api/branding", async () => {
    const projectRoot = await resolveProjectRoot();
    const config = await loadBrandingConfig(projectRoot);
    return { ok: true, data: toPublicView(config) };
  });

  app.get("/api/branding/logo", async (_request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const logo = await readBrandingLogoBytes(projectRoot);
    if (!logo) {
      return reply.status(404).send({
        ok: false,
        error: { code: "BRANDING_LOGO_NOT_FOUND", message: "尚未配置客户 Logo" }
      });
    }
    reply.header("Cache-Control", "private, max-age=60");
    reply.header("Content-Type", logo.contentType);
    return reply.send(logo.buffer);
  });

  app.put<{
    Body: { productTitle?: string; tagline?: string };
  }>("/api/branding", async (request, reply) => {
    try {
      const projectRoot = await resolveProjectRoot();
      const data = await updateBrandingText(projectRoot, request.body ?? {}, request);
      return reply.send({ ok: true, data });
    } catch (error) {
      return sendBrandingError(reply, error);
    }
  });

  app.put<{
    Body: { filename?: string; contentBase64?: string };
  }>("/api/branding/logo", async (request, reply) => {
    try {
      const projectRoot = await resolveProjectRoot();
      const data = await uploadBrandingLogo(
        projectRoot,
        {
          filename: request.body?.filename ?? "",
          contentBase64: request.body?.contentBase64 ?? ""
        },
        request
      );
      return reply.send({ ok: true, data });
    } catch (error) {
      return sendBrandingError(reply, error);
    }
  });

  app.delete("/api/branding/logo", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const data = await deleteBrandingLogo(projectRoot, request);
    return reply.send({ ok: true, data });
  });
}
