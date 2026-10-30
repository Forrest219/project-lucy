/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet } from "../lib/apiClient";
import { VersionInfo } from "../pages/admin/VersionInfo";

vi.mock("../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/apiClient")>("../lib/apiClient");
  return { ...actual, apiGet: vi.fn() };
});

const SHA = "135b2a8a".padEnd(40, "b");
const UPPER_SHA = SHA.toUpperCase();
const NON_HEX_SHA = "z".repeat(40);
const SHORT_SHA = "135b2a8";
const REMOVED_DESCRIPTION = "核对这次运行对应的产品版本和构建提交。";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_CSS = readFileSync(path.join(SRC_DIR, "../app/app.css"), "utf8");
const VERSION_INFO_SOURCE = readFileSync(path.join(SRC_DIR, "../pages/admin/VersionInfo.tsx"), "utf8");

type Health = {
  lucyVersion?: string;
  gitSha?: string;
  gitDirty?: boolean;
  bundledKtxVersion?: string;
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <VersionInfo />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function mockHealth(health: Health) {
  vi.mocked(apiGet).mockResolvedValue(health);
}

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText }
  });
  return writeText;
}

/** Render the page with a dirty build and return the commit node. */
async function renderWithSha(gitSha: string | undefined) {
  mockHealth({
    lucyVersion: "0.20.0",
    ...(gitSha === undefined ? {} : { gitSha }),
    gitDirty: true,
    bundledKtxVersion: "0.16.0"
  });
  renderPage();
  return screen.findByTestId("version-info-sha");
}

describe("VersionInfo", () => {
  afterEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  it("SC-01 keeps the page header and its divider, and drops the description", async () => {
    mockHealth({
      lucyVersion: "0.20.0",
      gitSha: SHA,
      gitDirty: false,
      bundledKtxVersion: "0.16.0"
    });

    renderPage();

    expect(await screen.findByRole("heading", { name: "版本信息" })).toBeInTheDocument();
    expect(screen.getByText("系统设置")).toBeInTheDocument();
    expect(screen.queryByText(REMOVED_DESCRIPTION)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(REMOVED_DESCRIPTION);

    // The page must not hide or override the shared header divider.
    expect(VERSION_INFO_SOURCE).not.toMatch(/hideDivider/i);
    expect(VERSION_INFO_SOURCE).not.toContain("pl-page-header");

    const headerBlock = APP_CSS.match(/\.pl-page-header\s*\{[^}]*\}/);
    expect(headerBlock).not.toBeNull();
    expect(headerBlock?.[0] ?? "").toContain("border-b");
  });

  it("SC-02 presents the identity block with the product version as the focus", async () => {
    mockHealth({
      lucyVersion: "0.20.0",
      gitSha: SHA,
      gitDirty: false,
      bundledKtxVersion: "0.16.0"
    });

    renderPage();

    const product = await screen.findByTestId("version-info-product");
    expect(product).toHaveTextContent("v0.20.0");
    expect(product.className).toContain("text-2xl");
    expect(product).toHaveAttribute("translate", "no");
    expect(product.className).toContain("notranslate");

    const block = screen.getByTestId("version-info");
    expect(block.className).toContain("max-w-xl");
    expect(block.className).toContain("space-y-4");
    expect(block.className).not.toContain("mt-4");

    const productGroup = product.parentElement;
    expect(productGroup?.className ?? "").toContain("gap-1");

    const buildRow = screen.getByTestId("version-info-sha").parentElement;
    expect(buildRow?.className ?? "").not.toContain("mt-4");
    expect(screen.getByTestId("version-info-ktx").className).not.toContain("mt-4");
  });

  it("SC-03 shows the first 12 characters and copies the full commit", async () => {
    const writeText = mockClipboard();
    mockHealth({
      lucyVersion: "0.20.0",
      gitSha: SHA,
      gitDirty: false,
      bundledKtxVersion: "0.16.0"
    });

    renderPage();

    const sha = await screen.findByTestId("version-info-sha");
    expect(sha).toHaveTextContent(SHA.slice(0, 12));
    expect(sha.textContent).not.toContain(SHA);
    expect(sha).toHaveAttribute("title", SHA);

    fireEvent.click(screen.getByTestId("version-info-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHA));
  });

  it.each([
    ["a missing commit", undefined, "unknown"],
    ["an empty commit", "", "unknown"],
    ["the unknown placeholder", "unknown", "unknown"],
    ["a 40-character uppercase commit", UPPER_SHA, UPPER_SHA],
    ["a 40-character non-hex commit", NON_HEX_SHA, NON_HEX_SHA],
    ["a 7-character commit", SHORT_SHA, SHORT_SHA]
  ])("SC-04 shows %s as-is and offers no copy, title or workspace row", async (_label, gitSha, expected) => {
    const sha = await renderWithSha(gitSha);

    expect(sha).toHaveTextContent(expected);
    expect(sha).not.toHaveAttribute("title");
    expect(screen.queryByTestId("version-info-copy")).not.toBeInTheDocument();
    expect(screen.queryByTestId("version-info-workspace")).not.toBeInTheDocument();
  });

  it("SC-05 shows the workspace status in the build row", async () => {
    mockHealth({
      lucyVersion: "0.20.0",
      gitSha: SHA,
      gitDirty: true,
      bundledKtxVersion: "0.16.0"
    });

    renderPage();

    const sha = await screen.findByTestId("version-info-sha");
    const workspace = screen.getByTestId("version-info-workspace");
    expect(workspace).toHaveTextContent("构建时工作区有未提交改动");
    expect(workspace.className).toContain("text-warning-strong");
    expect(workspace.className).toContain("text-xs");
    // Same row as the short commit, not a definition list row of its own.
    expect(workspace.parentElement).toBe(sha.parentElement);
    expect(screen.getByTestId("version-info").querySelector("dl")).toBeNull();
  });

  it("SC-06 leaves the workspace status out of a clean build", async () => {
    mockHealth({
      lucyVersion: "0.20.0",
      gitSha: SHA,
      gitDirty: false,
      bundledKtxVersion: "0.16.0"
    });

    renderPage();

    expect(await screen.findByTestId("version-info-sha")).toHaveTextContent(SHA.slice(0, 12));
    expect(screen.queryByTestId("version-info-workspace")).not.toBeInTheDocument();
  });

  it("SC-07 keeps the bundled KTX version visible without a disclosure", async () => {
    mockHealth({
      lucyVersion: "0.20.0",
      gitSha: SHA,
      gitDirty: false,
      bundledKtxVersion: "0.16.0"
    });

    renderPage();

    const ktxRow = await screen.findByTestId("version-info-ktx");
    expect(ktxRow).toHaveTextContent("随包");
    expect(ktxRow).toHaveTextContent("KTX");
    expect(ktxRow).toHaveTextContent("版本");
    expect(ktxRow).toHaveTextContent("0.16.0");
    expect(ktxRow.className).toContain("text-xs");
    expect(ktxRow.className).toContain("text-fg-muted");
    expect(ktxRow.className).not.toContain("mt-4");

    const ktxVersion = within(ktxRow).getByText("0.16.0");
    expect(ktxVersion.className).toContain("font-mono");
    expect(ktxVersion).toHaveAttribute("translate", "no");

    expect(screen.queryByText("组件")).not.toBeInTheDocument();
    expect(document.querySelector("details")).toBeNull();
    expect(document.querySelector("[aria-expanded]")).toBeNull();
  });

  it("SC-08 never shows the word dirty and keeps the ghost copy button", async () => {
    mockHealth({
      lucyVersion: "0.20.0",
      gitSha: SHA,
      gitDirty: true,
      bundledKtxVersion: "0.16.0"
    });

    renderPage();

    await screen.findByTestId("version-info-sha");
    expect(document.body.textContent ?? "").not.toMatch(/dirty/i);
    expect(screen.getByTestId("version-info-copy").className).toContain("pl-btn--ghost");
  });

  it("SC-09 shows the request error and does not invent a commit", async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError({ code: "unavailable", message: "健康检查失败" }));

    renderPage();

    expect(await screen.findByTestId("version-info-error")).toHaveTextContent("健康检查失败");
    expect(screen.queryByTestId("version-info")).not.toBeInTheDocument();
    expect(screen.queryByTestId("version-info-sha")).not.toBeInTheDocument();
  });
});
