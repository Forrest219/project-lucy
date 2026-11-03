// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SkillList } from "../pages/skills/SkillList";
import type { SkillAsset, SkillWritePreview } from "../lib/skills";

/**
 * Lucy v0.25 — L25-04 / SKO-01–16 验收执行（工作台侧）。
 *
 * 这里断言的是 Spec §8 通过标准里的**用户可见结果**：负责人怎么显示、清除怎么提交、
 * 损坏声明怎么披露、以及注入型文本是否被当成纯文本渲染。实现级断言在
 * `server/__tests__/skill-owner-l25-04.test.ts`，本文件不重复。
 */

const baseSkill: SkillAsset = {
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
  owner: "",
  uri: "lucy-skill://kx_financial/profit-check",
  relativePath: "skills/kx_financial/SKILL.md",
  file_version: "version-1",
  content: "# Body\n\n## First\nText",
  validation: { valid: true, issues: [] }
};

const INJECTION = '<img src=x onerror="alert(1)"> **粗体** [链接](javascript:alert(1))';

function previewFor(
  body: Record<string, unknown>,
  operation: "create" | "update" = "update",
  currentOwner = ""
): SkillWritePreview {
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
      // The server computes `from` from the stored Skill; the mock must not fake it.
      owner: { from: operation === "create" ? null : currentOwner, to: (body.owner as string) ?? "" },
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

/**
 * `summary` drives the governance overview, `detail` drives the read view.
 * `putBodies` records every save payload so the acceptance can assert what the
 * workbench actually submits — not just what it renders.
 */
function stubApis(options: { summary?: SkillAsset; detail?: SkillAsset } = {}) {
  const summary = options.summary ?? baseSkill;
  const detail = options.detail ?? summary;
  const putBodies: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/skills?includeContent=false" && method === "GET") {
      const { content: _content, ...rest } = summary;
      return new Response(JSON.stringify({ ok: true, count: 1, skills: [rest] }));
    }
    if (url === "/api/skills/kx_financial/profit-check" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, skill: detail }));
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
      return new Response(JSON.stringify({ ok: true, preview: previewFor(body, "update", detail.owner) }));
    }
    if (url === "/api/skills/preview" && method === "POST") {
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, preview: previewFor(body, "create") }));
    }
    if (url === "/api/skills/kx_financial/profit-check" && method === "PUT") {
      const body = JSON.parse(String(init?.body));
      putBodies.push(body);
      return new Response(JSON.stringify({ ok: true, skill: { ...detail, ...body, file_version: "version-2" } }));
    }
    return new Response(JSON.stringify({ ok: false, error: `not found: ${url}` }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, putBodies };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("L25-04 负责人 验收（工作台）", () => {
  it("SKO-01 详情态在没有负责人时显示「未指定」", async () => {
    stubApis();
    renderPage();
    const detail = await screen.findByTestId("skill-detail");
    expect(within(detail).getByTestId("skill-detail-owner")).toHaveTextContent("未指定");
  });

  it("SKO-03 只改标题时载荷仍带原负责人，不会被静默清空", async () => {
    const owned: SkillAsset = { ...baseSkill, owner: "数据治理组" };
    const { putBodies } = stubApis({ summary: owned, detail: owned });
    renderPage();

    await screen.findByTestId("skill-detail");
    fireEvent.click(screen.getByTestId("skill-edit"));
    fireEvent.click(screen.getByTestId("skill-metadata-toggle"));
    fireEvent.change(screen.getByTestId("skill-field-title"), { target: { value: "只改了标题" } });
    fireEvent.click(screen.getByTestId("skill-save"));

    await screen.findByTestId("skill-preflight");
    fireEvent.click(screen.getByTestId("skill-preflight-confirm"));

    await waitFor(() => expect(putBodies.length).toBe(1));
    expect(putBodies[0].owner).toBe("数据治理组");
    expect(putBodies[0].title).toBe("只改了标题");
  });

  it("SKO-04 清除负责人：提交显式的空字符串，保存后总览显示「未指定」", async () => {
    const owned: SkillAsset = { ...baseSkill, owner: "数据治理组" };
    const { putBodies } = stubApis({ summary: owned, detail: owned });
    renderPage();

    await screen.findByTestId("skill-detail");
    fireEvent.click(screen.getByTestId("skill-edit"));
    fireEvent.click(screen.getByTestId("skill-metadata-toggle"));
    fireEvent.change(screen.getByTestId("skill-field-owner"), { target: { value: "" } });
    fireEvent.click(screen.getByTestId("skill-save"));

    await screen.findByTestId("skill-preflight");
    fireEvent.click(screen.getByTestId("skill-preflight-confirm"));

    await waitFor(() => expect(putBodies.length).toBe(1));
    expect(putBodies[0].owner).toBe("");
  });

  it("SKO-05 注入型负责人按纯文本显示：总览与详情都不产生真实元素", async () => {
    const injected: SkillAsset = { ...baseSkill, owner: INJECTION };
    stubApis({ summary: injected, detail: injected });
    renderPage();

    const detail = await screen.findByTestId("skill-detail");
    const ownerCell = within(detail).getByTestId("skill-detail-owner");
    expect(ownerCell).toHaveTextContent(INJECTION);
    // 纯文本渲染：没有真的 <img>，没有真的链接，没有 Markdown 强调。
    expect(ownerCell.querySelector("img")).toBeNull();
    expect(ownerCell.querySelector("a")).toBeNull();
    expect(ownerCell.querySelector("strong")).toBeNull();
    expect(ownerCell.textContent).toContain("<img src=x");
  });

  it("SKO-06 总览列对损坏声明显示「声明无效」，且不把损坏原文当负责人展示", async () => {
    const corrupt: SkillAsset = { ...baseSkill, owner: "", owner_invalid: true };
    stubApis({ summary: corrupt, detail: corrupt });
    renderPage("/skills");

    const overview = await screen.findByTestId("skills-table");
    const cell = within(overview).getByTestId("skill-owner");
    expect(cell).toHaveTextContent("声明无效");
    expect(cell).not.toHaveTextContent("team");
    expect(cell).not.toHaveTextContent("data governance");
  });

  it("SKO-09 预检披露负责人旧值 → 新值", async () => {
    const owned: SkillAsset = { ...baseSkill, owner: "数据治理组" };
    stubApis({ summary: owned, detail: owned });
    renderPage();

    await screen.findByTestId("skill-detail");
    fireEvent.click(screen.getByTestId("skill-edit"));
    fireEvent.click(screen.getByTestId("skill-metadata-toggle"));
    fireEvent.change(screen.getByTestId("skill-field-owner"), { target: { value: "财务 BP 团队" } });
    fireEvent.click(screen.getByTestId("skill-save"));

    const dialog = await screen.findByTestId("skill-preflight");
    expect(within(dialog).getByTestId("skill-preflight-owner")).toHaveTextContent("数据治理组 → 财务 BP 团队");
  });
});
