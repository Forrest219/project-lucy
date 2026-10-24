/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet } from "../lib/apiClient";
import { VersionInfo } from "../pages/admin/VersionInfo";

vi.mock("../lib/apiClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/apiClient")>("../lib/apiClient");
  return { ...actual, apiGet: vi.fn() };
});

const SHA = "135b2a8a".padEnd(40, "b");

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

describe("VersionInfo", () => {
  afterEach(() => {
    vi.mocked(apiGet).mockReset();
  });

  it("shows the four health fields and copies the full commit", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      lucyVersion: "0.20.0",
      gitSha: SHA,
      gitDirty: true,
      bundledKtxVersion: "0.16.0"
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    renderPage();

    expect(await screen.findByTestId("version-info-product")).toHaveTextContent("v0.20.0");
    expect(screen.getByTestId("version-info-sha")).toHaveTextContent(SHA);
    expect(screen.getByTestId("version-info-workspace")).toHaveTextContent("构建时工作区有未提交改动");
    expect(screen.getByTestId("version-info-ktx")).toHaveTextContent("0.16.0");
    expect(screen.getByTestId("version-info").textContent).not.toMatch(/dirty/i);
    expect(screen.getByRole("heading", { name: "版本信息" })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("version-info-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SHA));
  });

  it("shows the workspace row only when the recorded build had uncommitted changes", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      lucyVersion: "0.20.0",
      gitSha: SHA,
      gitDirty: false,
      bundledKtxVersion: "0.16.0"
    });

    renderPage();

    expect(await screen.findByTestId("version-info-product")).toHaveTextContent("v0.20.0");
    expect(screen.getByTestId("version-info-sha")).toHaveTextContent(SHA);
    expect(screen.getByTestId("version-info-ktx")).toHaveTextContent("0.16.0");
    expect(screen.queryByTestId("version-info-workspace")).not.toBeInTheDocument();
  });

  it("shows unknown for a missing commit and does not offer copy", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      lucyVersion: "0.20.0",
      gitSha: "unknown",
      gitDirty: false,
      bundledKtxVersion: ""
    });

    renderPage();

    expect(await screen.findByTestId("version-info-sha")).toHaveTextContent("unknown");
    expect(screen.getByTestId("version-info-ktx")).toHaveTextContent("unknown");
    expect(screen.queryByTestId("version-info-workspace")).not.toBeInTheDocument();
    expect(screen.queryByTestId("version-info-copy")).not.toBeInTheDocument();
  });

  it("shows the request error and does not invent a commit", async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError({ code: "unavailable", message: "健康检查失败" }));

    renderPage();

    expect(await screen.findByTestId("version-info-error")).toHaveTextContent("健康检查失败");
    expect(screen.queryByTestId("version-info")).not.toBeInTheDocument();
  });
});
