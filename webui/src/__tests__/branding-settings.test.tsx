/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandingSettings } from "../pages/admin/BrandingSettings";
import type { BrandingInfo } from "../lib/branding";

const baseBranding: BrandingInfo = {
  productTitle: "Lucy WebUI",
  tagline: "Data Agent MCP",
  productTitleOverride: "",
  taglineOverride: "",
  hasCustomLogo: false,
  logoUrl: null,
  logoContentType: null,
  logoWidth: null,
  logoHeight: null,
  updatedAt: null,
  defaults: {
    productTitle: "Lucy WebUI",
    tagline: "Data Agent MCP"
  }
};

function renderPage(initial: BrandingInfo = baseBranding) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/branding") && (!init || init.method === undefined || init.method === "GET")) {
      return new Response(JSON.stringify({ ok: true, data: initial }), { status: 200 });
    }
    if (url.includes("/api/branding") && init?.method === "PUT" && !url.includes("/logo")) {
      const body = JSON.parse(String(init.body ?? "{}")) as { productTitle?: string; tagline?: string };
      const next: BrandingInfo = {
        ...initial,
        productTitle: body.productTitle?.trim() || initial.defaults.productTitle,
        tagline: body.tagline?.trim() || initial.defaults.tagline,
        productTitleOverride: body.productTitle?.trim() ?? "",
        taglineOverride: body.tagline?.trim() ?? ""
      };
      return new Response(JSON.stringify({ ok: true, data: next }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "X", message: "unexpected" } }), {
      status: 500
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BrandingSettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { fetchMock };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BrandingSettings", () => {
  it("renders logo and text sections with preview", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "品牌外观" })).toBeInTheDocument();
    expect(await screen.findByText("当前使用默认字母标识")).toBeInTheDocument();
    expect(screen.getByText("系统设置")).toBeInTheDocument();
    expect(screen.getByTestId("branding-logo-section")).toBeInTheDocument();
    expect(screen.getByTestId("branding-text-section")).toBeInTheDocument();
    expect(screen.getByTestId("branding-preview")).toBeInTheDocument();
    expect(screen.getByTestId("branding-sidebar-preview")).toBeInTheDocument();
    expect(screen.getByTestId("branding-login-preview")).toBeInTheDocument();
    expect(screen.getAllByTestId("brand-mark-letter")[0]).toHaveTextContent("L");
    expect(screen.getByLabelText("选择客户 Logo 文件")).toHaveAttribute(
      "accept",
      "image/png,image/jpeg,image/gif,.png,.jpg,.jpeg,.gif"
    );
    expect(screen.getByRole("button", { name: "上传 Logo" }).className).toMatch(/pl-btn--primary/);
    expect(screen.getByRole("button", { name: "恢复默认 Logo" }).className).toMatch(/pl-btn--secondary/);
    expect(screen.getByTestId("branding-product-title-help")).toHaveTextContent(
      "默认值：Lucy WebUI"
    );
    expect(screen.getByTestId("branding-tagline-help")).toHaveTextContent(
      "默认值：Data Agent MCP"
    );
    const saveButton = screen.getByRole("button", { name: "保存更改" });
    expect(saveButton.className).toMatch(/pl-btn--primary/);
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAccessibleDescription("当前没有待保存的更改");
  });

  it("keeps the editor and preview in the default desktop two-column layout", () => {
    const source = readFileSync("src/pages/admin/BrandingSettings.tsx", "utf8");
    expect(source).toContain("grid-cols-[minmax(0,1fr)_minmax(280px,360px)]");
    expect(source).not.toContain("lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]");
  });

  it("enables save only while text overrides are dirty", async () => {
    renderPage();
    await screen.findByText("当前使用默认字母标识");
    const title = await screen.findByTestId("branding-product-title");
    const saveButton = screen.getByRole("button", { name: "保存更改" });

    expect(title).toHaveValue("");
    expect(saveButton).toBeDisabled();
    fireEvent.change(title, { target: { value: "Acme Data" } });
    expect(saveButton).toBeEnabled();
    expect(saveButton).toHaveAccessibleDescription("有未保存的更改");
    fireEvent.change(title, { target: { value: "" } });
    expect(saveButton).toBeDisabled();
  });

  it("uses maintenance copy when a custom Logo exists", async () => {
    renderPage({
      ...baseBranding,
      hasCustomLogo: true,
      logoUrl: "/api/branding/logo?v=1",
      logoContentType: "image/png",
      logoWidth: 48,
      logoHeight: 48
    });

    expect(await screen.findByRole("button", { name: "更换 Logo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复默认 Logo" })).toBeEnabled();
    expect(screen.getByText("自定义 Logo · 48 × 48 像素")).toBeInTheDocument();
  });

  it("saves product title override", async () => {
    const { fetchMock } = renderPage();
    await screen.findByText("当前使用默认字母标识");
    const title = await screen.findByTestId("branding-product-title");
    fireEvent.change(title, { target: { value: "Acme Data" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/branding",
        expect.objectContaining({ method: "PUT" })
      );
    });
  });
});
