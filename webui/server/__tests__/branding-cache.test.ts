import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";
import { updateBrandingText } from "../branding.js";
import { createEmptyAuditDbStub } from "./helpers/audit-db-stub.js";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => createEmptyAuditDbStub()),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

// P1-84 §3.4 / UAT-PES-08：品牌缓存一致性（公开 GET 读路径的代次缓存）。
// 写前屏障（代次 bump）＋每次读 mtime/size 校验（外部修改首读即生效）。
describe("branding public cache consistency", () => {
  let projectRoot: string;
  let previousRoot: string | undefined;
  let previousContentRoot: string | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-branding-cache-"));
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await mkdir(path.join(projectRoot, "webui", "config", "branding"), { recursive: true });
    previousRoot = process.env.KTX_PROJECT_ROOT;
    previousContentRoot = process.env.LUCY_CONTENT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    delete process.env.LUCY_PUBLIC_ENTRY_FASTPATH;
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
    delete process.env.LUCY_PUBLIC_ENTRY_FASTPATH;
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("写后首读为新值（写屏障使缓存失效）", async () => {
    const yaml = path.join(projectRoot, "webui/config/branding.yaml");
    await writeFile(yaml, "version: \"1\"\nproductTitle: Before\ntagline: \"\"\n", "utf8");
    const app = buildServer();
    const first = await app.inject({ method: "GET", url: "/api/branding" });
    expect(first.json().data.productTitle).toBe("Before");

    // 管理写入路径（同进程，写屏障 bump 代次）。
    const fakeRequest = { lucyAdmin: { admin: { id: "ops" } }, ip: "127.0.0.1" } as never;
    await updateBrandingText(projectRoot, { productTitle: "After", tagline: "" }, fakeRequest);
    const second = await app.inject({ method: "GET", url: "/api/branding" });
    expect(second.json().data.productTitle).toBe("After");
    await app.close();
  });

  it("外部修改（绕过管理接口）后的首读即生效", async () => {
    const yaml = path.join(projectRoot, "webui/config/branding.yaml");
    await writeFile(yaml, "version: \"1\"\nproductTitle: Cold\ntagline: \"\"\n", "utf8");
    const app = buildServer();
    const cold = await app.inject({ method: "GET", url: "/api/branding" });
    expect(cold.json().data.productTitle).toBe("Cold");

    // 外部修改：不同字节数保证 mtime/size 校验必中。
    await writeFile(yaml, "version: \"1\"\nproductTitle: ExternallyEdited\ntagline: \"\"\n", "utf8");
    const after = await app.inject({ method: "GET", url: "/api/branding" });
    expect(after.json().data.productTitle).toBe("ExternallyEdited");
    await app.close();
  });

  it("LUCY_PUBLIC_ENTRY_FASTPATH=0 关闭缓存（feature-off 对照臂走旧路径）", async () => {
    process.env.LUCY_PUBLIC_ENTRY_FASTPATH = "0";
    const yaml = path.join(projectRoot, "webui/config/branding.yaml");
    await writeFile(yaml, "version: \"1\"\nproductTitle: Cold\ntagline: \"\"\n", "utf8");
    const app = buildServer();
    const cold = await app.inject({ method: "GET", url: "/api/branding" });
    expect(cold.json().data.productTitle).toBe("Cold");
    await writeFile(yaml, "version: \"1\"\nproductTitle: DirectRead\ntagline: \"\"\n", "utf8");
    const after = await app.inject({ method: "GET", url: "/api/branding" });
    expect(after.json().data.productTitle).toBe("DirectRead");
    await app.close();
  });
});
