// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillList } from "../pages/skills/SkillList";
import type { SkillAsset } from "../lib/skills";

const skill: SkillAsset = {
  name: "profit-check",
  domain: "kx_financial",
  title: "Profit Check",
  version: "1.0.0",
  status: "draft",
  roles_allowed: ["analyst"],
  prerequisites: {},
  triggers: [],
  eval_cases: [],
  description: "Check profit",
  uri: "lucy-skill://kx_financial/profit-check",
  relativePath: "skills/kx_financial/SKILL.md",
  file_version: "version-1",
  content: "# Body",
  validation: { valid: true, issues: [] }
};

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
    if (url === "/api/skills" && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify({ ok: true, count: 1, skills: [skill] }));
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
    if (url === "/api/skills/kx_financial/profit-check" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        ok: true,
        skill: { ...skill, roles_allowed: body.roles_allowed, file_version: "version-2" }
      }));
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

describe("SkillList role authorization editor", () => {
  it("locks identity fields and persists an empty role selection as deny-all", async () => {
    const fetchMock = stubApis();
    renderPage();
    fireEvent.click(await screen.findByTestId("skill-edit"));

    expect(screen.getByTestId("skill-field-name")).toBeDisabled();
    expect(screen.getByTestId("skill-field-domain")).toBeDisabled();
    const analyst = await screen.findByRole("checkbox", { name: "analyst" });
    expect(analyst).toBeChecked();
    fireEvent.click(analyst);
    expect(screen.getByTestId("skill-role-none")).toHaveTextContent("无人可见");
    fireEvent.click(screen.getByTestId("skill-save"));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put![1]?.body));
      expect(body.roles_allowed).toEqual([]);
      expect(body.expected_version).toBe("version-1");
      expect(body.name).toBe("profit-check");
      expect(body.domain).toBe("kx_financial");
    });
  });

  it("requires explicit confirmation before granting all roles", async () => {
    stubApis();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByTestId("skill-edit"));
    const allRoles = screen.getByTestId("skill-role-all");
    fireEvent.click(allRoles);
    expect(confirm).toHaveBeenCalled();
    expect(allRoles).not.toBeChecked();
    confirm.mockReturnValue(true);
    fireEvent.click(allRoles);
    expect(allRoles).toBeChecked();
  });
});
