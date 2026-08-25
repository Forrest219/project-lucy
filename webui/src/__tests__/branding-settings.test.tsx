/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
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
    expect(screen.getByTestId("branding-logo-section")).toBeInTheDocument();
    expect(screen.getByTestId("branding-text-section")).toBeInTheDocument();
    expect(screen.getByTestId("branding-preview")).toBeInTheDocument();
    expect(screen.getAllByTestId("brand-mark-letter")[0]).toHaveTextContent("L");
  });

  it("saves product title override", async () => {
    const { fetchMock } = renderPage();
    const title = await screen.findByTestId("branding-product-title");
    fireEvent.change(title, { target: { value: "Acme Data" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/branding",
        expect.objectContaining({ method: "PUT" })
      );
    });
  });
});
