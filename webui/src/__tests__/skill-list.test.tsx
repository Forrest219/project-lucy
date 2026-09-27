// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SkillList } from "../pages/skills/SkillList";
import type { SkillAsset, SkillWritePreview } from "../lib/skills";

const skill: SkillAsset = {
  name: "profit-check",
  domain: "kx_financial",
  title: "Profit Check",
  version: "1.0.0",
  status: "draft",
  roles_allowed: ["analyst"],
  prerequisites: { sources: ["orders"], measures: [], wiki_docs: [] },
  triggers: ["profit"],
  eval_cases: [],
  description: "Check profit",
  uri: "lucy-skill://kx_financial/profit-check",
  relativePath: "skills/kx_financial/SKILL.md",
  file_version: "version-1",
  content: "# Body\n\n## First\nText\n\n## Second\nText",
  validation: { valid: true, issues: [] }
};

function previewFor(body: Record<string, unknown>, operation: "create" | "update" = "update"): SkillWritePreview {
  const roles = (body.roles_allowed as string[]) ?? [];
  return {
    operation,
    uri: `lucy-skill://${body.domain}/${body.name}`,
    relativePath: `skills/${body.domain}/${body.name}.md`,
    proposedMarkdown: "---\n---\n",
    diff: "+ proposed",
    validation: { valid: true, issues: [] },
    impact: {
      status: { from: operation === "create" ? null : "draft", to: (body.status as "draft") ?? "draft" },
      rolesAllowed: { from: operation === "create" ? [] : ["analyst"], to: roles },
      enteredWildcard: roles.includes("*"),
      exitedWildcard: false,
      affectedRoleIds: roles.includes("*") ? ["analyst", "finance_reader"] : roles,
      affectedAgentCount: roles.length
    },
    expectedVersion: operation === "create" ? null : "version-1"
  };
}

function renderPage(path = "/skills?skill=kx_financial/profit-check") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/skills" element={<SkillList />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function stubApis() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/skills?includeContent=false" && method === "GET") {
      const { content: _content, ...summary } = skill;
      return new Response(JSON.stringify({ ok: true, count: 1, skills: [summary] }));
    }
    if (url === "/api/skills/kx_financial/profit-check" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, skill }));
    }
    if (url === "/api/admin/roles?includeTemplates=false") {
      return new Response(JSON.stringify({
        ok: true,
        data: {
          roles: [
            { id: "analyst", tools: [], connections: [], sourceNames: [], sourceCount: 0, invalid: false, warnings: [] },
            { id: "finance_reader", tools: [], connections: [], sourceNames: [], sourceCount: 0, invalid: false, warnings: [] }
          ]
        }
      }));
    }
    if (url.endsWith("/preview") && method === "POST") {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, preview: previewFor(body) }));
    }
    if (url === "/api/skills/preview" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, preview: previewFor(body, "create") }));
    }
    if (url === "/api/skills/kx_financial/profit-check" && method === "PUT") {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, skill: { ...skill, ...body, file_version: "version-2" } }));
    }
    return new Response(JSON.stringify({ ok: false, error: `not found: ${url}` }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("unified Skill workbench", () => {
  it("loads summaries first and lazily loads the selected Skill into the main read view", async () => {
    const fetchMock = stubApis();
    renderPage();
    expect(await screen.findByTestId("skills-explorer")).toBeInTheDocument();
    expect(await screen.findByTestId("skill-detail")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-detail-drawer")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Skill 页内目录" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/skills?includeContent=false", expect.anything());
    expect(fetchMock).toHaveBeenCalledWith("/api/skills/kx_financial/profit-check", expect.anything());
  });

  it("shows the all-domain governance overview by default", async () => {
    stubApis();
    renderPage("/skills");
    expect(await screen.findByText("Skill 治理总览")).toBeInTheDocument();
    expect(screen.getByTestId("skills-all")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("skills-open-detail")).toHaveTextContent("profit-check");
  });

  it("locks identity, protects dirty edits, and only writes after a successful preflight", async () => {
    const fetchMock = stubApis();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByTestId("skill-edit"));
    expect(screen.getByTestId("skill-metadata-toggle")).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByTestId("skill-metadata-toggle"));
    expect(screen.getByTestId("skill-field-name")).toBeDisabled();
    expect(screen.getByTestId("skill-field-domain")).toBeDisabled();
    fireEvent.change(screen.getByTestId("skill-field-content"), { target: { value: "# Changed" } });
    expect(screen.getByTestId("skill-dirty")).toHaveTextContent("有未保存修改");

    fireEvent.click(screen.getByTestId("skill-cancel-edit"));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByTestId("skill-editor-form")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("skill-save"));
    expect(await screen.findByTestId("skill-preflight")).toBeInTheDocument();
    expect(screen.getByTestId("skill-preflight-diff")).toHaveTextContent("proposed");
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/preview") && init?.method === "POST")).toBe(true);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    fireEvent.click(screen.getByTestId("skill-preflight-confirm"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
  });

  it("requires preflight acknowledgement before granting all roles", async () => {
    const fetchMock = stubApis();
    renderPage();
    fireEvent.click(await screen.findByTestId("skill-edit"));
    fireEvent.click(screen.getByTestId("skill-metadata-toggle"));
    fireEvent.click(screen.getByTestId("skill-role-all"));
    expect(screen.getByTestId("skill-role-all")).toBeChecked();
    fireEvent.click(screen.getByTestId("skill-save"));
    const dialog = await screen.findByTestId("skill-preflight");
    const confirmButton = within(dialog).getByTestId("skill-preflight-confirm");
    expect(confirmButton).toBeDisabled();
    fireEvent.click(within(dialog).getByTestId("skill-wildcard-ack"));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put![1]?.body));
      expect(body.roles_allowed).toEqual(["*"]);
      expect(body.expected_version).toBe("version-1");
    });
  });

  it("creates with the selected domain prefilled and metadata expanded", async () => {
    stubApis();
    renderPage("/skills?new=1&domain=kx_financial");
    expect(await screen.findByTestId("skill-editor-form")).toBeInTheDocument();
    expect(screen.getByTestId("skill-metadata-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("skill-field-domain")).toHaveValue("kx_financial");
    expect(screen.getByTestId("skill-role-none")).toHaveTextContent("无人可见");
  });
});
