import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicApi } from "../auth/guard.js";
import {
  DEFAULT_PRODUCT_TITLE,
  DEFAULT_TAGLINE,
  loadBrandingConfig,
  toPublicView,
  uploadBrandingLogo,
  updateBrandingText,
  deleteBrandingLogo,
  BrandingValidationError
} from "../branding.js";
import { readRasterImageSize, sniffRasterImageMime } from "../image-raster.js";
import { buildServer } from "../index.js";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAuditRoutes: vi.fn()
}));

function pngBuffer(width: number, height: number): Buffer {
  // Minimal valid-enough PNG: signature + IHDR with dimensions. Decoder only
  // needs signature + IHDR width/height for our size reader.
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  const chunkType = Buffer.from("IHDR");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const crc = Buffer.alloc(4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    len,
    chunkType,
    ihdrData,
    crc
  ]);
}

describe("image-raster", () => {
  it("reads PNG dimensions and sniffs mime", () => {
    const buf = pngBuffer(48, 48);
    expect(sniffRasterImageMime(buf)).toBe("image/png");
    expect(readRasterImageSize(buf)).toEqual({ width: 48, height: 48 });
  });
});

describe("isPublicApi branding", () => {
  it("allows GET branding endpoints without a session", () => {
    expect(isPublicApi("GET", "/api/branding")).toBe(true);
    expect(isPublicApi("GET", "/api/branding/logo")).toBe(true);
    expect(isPublicApi("PUT", "/api/branding")).toBe(false);
    expect(isPublicApi("PUT", "/api/branding/logo")).toBe(false);
    expect(isPublicApi("DELETE", "/api/branding/logo")).toBe(false);
  });
});

describe("branding store + API", () => {
  let projectRoot: string;
  let previousRoot: string | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-branding-"));
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    previousRoot = process.env.KTX_PROJECT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("defaults product title and tagline when unset", async () => {
    const config = await loadBrandingConfig(projectRoot);
    const view = toPublicView(config);
    expect(view.productTitle).toBe(DEFAULT_PRODUCT_TITLE);
    expect(view.tagline).toBe(DEFAULT_TAGLINE);
    expect(view.hasCustomLogo).toBe(false);
    expect(view.logoUrl).toBeNull();
  });

  it("uploads a compliant PNG logo and serves it", async () => {
    const fakeRequest = { lucyAdmin: { admin: { id: "ops" } }, ip: "127.0.0.1" } as never;
    const view = await uploadBrandingLogo(
      projectRoot,
      {
        filename: "acme.png",
        contentBase64: pngBuffer(48, 48).toString("base64")
      },
      fakeRequest
    );
    expect(view.hasCustomLogo).toBe(true);
    expect(view.logoWidth).toBe(48);
    expect(view.logoHeight).toBe(48);
    const stored = await readFile(path.join(projectRoot, "webui/config/branding/logo.png"));
    expect(stored.length).toBeGreaterThan(0);

    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/branding/logo" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/image\/png/);
    await app.close();
  });

  it("rejects oversized dimensions, svg, and webp filenames", async () => {
    const fakeRequest = { lucyAdmin: null, ip: "127.0.0.1" } as never;
    await expect(
      uploadBrandingLogo(
        projectRoot,
        { filename: "big.png", contentBase64: pngBuffer(200, 200).toString("base64") },
        fakeRequest
      )
    ).rejects.toBeInstanceOf(BrandingValidationError);

    await expect(
      uploadBrandingLogo(
        projectRoot,
        { filename: "x.svg", contentBase64: Buffer.from("<svg></svg>").toString("base64") },
        fakeRequest
      )
    ).rejects.toThrow(/SVG/);

    await expect(
      uploadBrandingLogo(
        projectRoot,
        { filename: "x.webp", contentBase64: pngBuffer(48, 48).toString("base64") },
        fakeRequest
      )
    ).rejects.toThrow(/WebP/);
  });

  it("updates text overrides and deletes logo", async () => {
    const fakeRequest = { lucyAdmin: { admin: { id: "ops" } }, ip: "127.0.0.1" } as never;
    await uploadBrandingLogo(
      projectRoot,
      { filename: "a.png", contentBase64: pngBuffer(64, 64).toString("base64") },
      fakeRequest
    );
    const text = await updateBrandingText(
      projectRoot,
      { productTitle: "Acme Data", tagline: "Ops Console" },
      fakeRequest
    );
    expect(text.productTitle).toBe("Acme Data");
    expect(text.tagline).toBe("Ops Console");
    expect(text.productTitleOverride).toBe("Acme Data");

    const cleared = await updateBrandingText(projectRoot, { productTitle: "", tagline: "" }, fakeRequest);
    expect(cleared.productTitle).toBe(DEFAULT_PRODUCT_TITLE);
    expect(cleared.tagline).toBe(DEFAULT_TAGLINE);

    const deleted = await deleteBrandingLogo(projectRoot, fakeRequest);
    expect(deleted.hasCustomLogo).toBe(false);

    const app = buildServer();
    const getMeta = await app.inject({ method: "GET", url: "/api/branding" });
    expect(getMeta.statusCode).toBe(200);
    expect(getMeta.json().data.hasCustomLogo).toBe(false);
    await app.close();
  });
});
