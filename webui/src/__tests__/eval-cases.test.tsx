// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaseList } from "../pages/eval/CaseList";
import { RunList } from "../pages/eval/RunList";

function renderCaseList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/eval/cases"]}>
        <Routes>
          <Route path="/eval/cases" element={<CaseList />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderRunList() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/eval/runs"]}>
        <Routes>
          <Route path="/eval/runs" element={<RunList />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CaseList M34 IA", () => {
  it("renders the renamed PageHeader title and breadcrumbs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/eval/domains") {
          return new Response(JSON.stringify({ ok: true, data: { domains: [] } }));
        }
        return new Response(JSON.stringify({ ok: true, data: {} }));
      })
    );

    renderCaseList();

    expect(await screen.findByRole("heading", { name: "评测用例" })).toBeInTheDocument();
    // M40: 一级根页面不再渲染面包屑
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Case 管理" })).not.toBeInTheDocument();
  });
});

describe("CaseList M43 Eval YAML exchange", () => {
  it("keeps one primary CTA and exposes suite actions from the YAML menu", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/eval/domains") {
        return new Response(JSON.stringify({
          ok: true,
          data: { domains: [{ domain: "kx_financial", filePath: "evals/kx_financial/eval/kx_financial-eval-cases.yaml", caseCount: 1 }] }
        }));
      }
      if (url === "/api/eval/cases/kx_financial") {
        return new Response(JSON.stringify({
          ok: true,
          data: { cases: [{ id: "kx-income-001", case_type: "single_turn", question: "查询收入", expected_measures: ["operating_revenue"] }] }
        }));
      }
      if (url === "/api/eval/runs?domain=kx_financial&limit=1") {
        return new Response(JSON.stringify({ ok: true, data: { total: 0, runs: [] } }));
      }
      if (url === "/api/eval/suites/kx_financial/download") {
        return new Response("lucy_eval_schema_version: 1\n", {
          headers: {
            "Content-Type": "text/yaml",
            "Content-Disposition": "attachment; filename=\"kx_financial-eval-suite.yaml\"",
            "X-Lucy-Runner-Command": "node scripts/lucy-eval-runner.mjs --suite kx_financial-eval-suite.yaml --output result.json"
          }
        });
      }
      return new Response(JSON.stringify({ ok: true, data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });

    renderCaseList();

    expect(await screen.findByRole("button", { name: /下载\s*Eval YAML/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /评测套件/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /上传\s*Eval YAML/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /评测套件/ }));
    expect(screen.getByRole("button", { name: /上传\s*Eval YAML/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /上传运行结果/ }));
    expect(screen.getByPlaceholderText("粘贴 Result JSON 内容...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /评测套件/ }));

    fireEvent.click(screen.getAllByRole("button", { name: /下载\s*Eval YAML/ })[0]);
    await waitFor(() => {
      expect(screen.getByText(/本地运行命令/)).toBeInTheDocument();
    });
    expect(screen.getByText(/lucy-eval-runner\.mjs/)).toBeInTheDocument();
    expect(downloads).toContain("kx_financial-eval-suite.yaml");
  });

  it("offers explicit actions when imported result hash does not match", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/eval/domains") {
        return new Response(JSON.stringify({
          ok: true,
          data: { domains: [{ domain: "kx_financial", filePath: "evals/kx_financial/eval/kx_financial-eval-cases.yaml", caseCount: 1 }] }
        }));
      }
      if (url === "/api/eval/cases/kx_financial") {
        return new Response(JSON.stringify({
          ok: true,
          data: { cases: [{ id: "kx-income-001", case_type: "single_turn", question: "查询收入", expected_measures: ["operating_revenue"] }] }
        }));
      }
      if (url === "/api/eval/runs?domain=kx_financial&limit=1") {
        return new Response(JSON.stringify({ ok: true, data: { total: 0, runs: [] } }));
      }
      if (url === "/api/eval/results/import") {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          ok: true,
          data: {
            domain: "kx_financial",
            suiteId: "kx_financial_v1",
            suiteHash: "sha256:" + "b".repeat(64),
            currentSuiteHash: "sha256:" + "a".repeat(64),
            totalCases: 1,
            passCount: 1,
            failCount: 0,
            skippedCount: 0,
            errorCount: 0,
            suiteHashMatched: false,
            hashStatus: "mismatch",
            warnings: [],
            written: body.dryRun === false ? true : undefined,
            runId: body.dryRun === false ? 88 : undefined
          }
        }), { status: body.dryRun === false ? 201 : 200 });
      }
      return new Response(JSON.stringify({ ok: true, data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCaseList();

    expect(await screen.findByRole("button", { name: /评测套件/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /评测套件/ }));
    fireEvent.click(screen.getByRole("button", { name: /上传运行结果/ }));

    const resultJson = JSON.stringify({
      lucy_eval_result_version: 1,
      suite_id: "kx_financial_v1",
      suite_hash: "sha256:" + "b".repeat(64),
      domain: "kx_financial",
      runner: { kind: "hermes", version: "test" },
      started_at: "2026-08-01T10:00:00.000Z",
      finished_at: "2026-08-01T10:01:00.000Z",
      results: [{ case_id: "kx-income-001", status: "PASS" }]
    });
    fireEvent.change(screen.getByPlaceholderText("粘贴 Result JSON 内容..."), { target: { value: resultJson } });
    fireEvent.click(screen.getByRole("button", { name: "预检" }));

    expect(await screen.findByRole("button", { name: "归档为本地变体" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /同步本地\s*Eval YAML\s*后归档/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消导入" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认归档" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /同步本地\s*Eval YAML\s*后归档/ }));
    expect(screen.getByText(/正在同步本地/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("粘贴 Eval YAML 内容...")).toBeInTheDocument();
  });
});

describe("RunList M43 server runtime downgrade", () => {
  it("keeps server-side eval as an advanced action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/eval/domains") {
          return new Response(JSON.stringify({
            ok: true,
            data: { domains: [{ domain: "kx_financial", filePath: "evals/kx_financial/eval/kx_financial-eval-cases.yaml", caseCount: 1 }] }
          }));
        }
        if (url === "/api/eval/runs") {
          return new Response(JSON.stringify({ ok: true, data: { total: 0, runs: [] } }));
        }
        return new Response(JSON.stringify({ ok: true, data: {} }));
      })
    );

    renderRunList();

    expect(await screen.findByRole("heading", { name: "运行历史" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "服务器运行" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /触发新 Run/ })).not.toBeInTheDocument();
  });
});
