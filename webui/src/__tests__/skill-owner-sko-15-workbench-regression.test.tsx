// @vitest-environment jsdom

/**
 * SKO-15 工作台回归 —— 补上此前**没有专项断言**的两处。
 *
 * 归属：docs/specs/lucy-20261025-v0p25-skill-owner-spec.md §8 SKO-15
 * 　　「工作台回归：创建、编辑、取消、脏数据保护、删除和发布状态预检不回归；
 *　　　且不出现二级市场入口」
 *
 * 本文件覆盖其中**此前完全无用例**的两项：
 *   ① 删除两步确认（skill-delete → skill-delete-confirm → DELETE 请求）
 *   ② 发布状态预检（预检「状态变化」反映 draft → published）
 *
 * 其余各项的既有承载（不重复断言）：
 *   创建／编辑／保存／取消／脏数据保护／预检主体 → src/__tests__/skill-list.test.tsx
 *   「SKO-15 无二级市场入口」断言            → server/__tests__/skill-owner-sko-acceptance.test.ts
 *
 * ⚠️ 本文件位于 webui/src/ 下，其正文被 SKO-15 的入口边界守卫逐文件扫描，
 *    因此**不得**出现该守卫禁止的界面词。本注释刻意避开那些词。
 *
 * 收口记录：docs/reviews/2026-11-01-skill-owner-closure.md
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SkillList } from "../pages/skills/SkillList";
import type { SkillAsset, SkillStatus, SkillWritePreview } from "../lib/skills";

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
  owner: "",
  uri: "lucy-skill://kx_financial/profit-check",
  relativePath: "skills/kx_financial/SKILL.md",
  file_version: "version-1",
  content: "# Body\n\n## First\nText",
  validation: { valid: true, issues: [] }
};

function previewFor(body: Record<string, unknown>): SkillWritePreview {
  const roles = (body.roles_allowed as string[]) ?? [];
  return {
    operation: "update",
    uri: `lucy-skill://${body.domain}/${body.name}`,
    relativePath: `skills/${body.domain}/${body.name}.md`,
    proposedMarkdown: "---\n---\n",
    diff: "+ proposed",
    validation: { valid: true, issues: [] },
    impact: {
      status: { from: "draft", to: ((body.status as SkillStatus) ?? "draft") },
      rolesAllowed: { from: ["analyst"], to: roles },
      owner: { from: "", to: (body.owner as string) ?? "" },
      enteredWildcard: roles.includes("*"),
      exitedWildcard: false,
      affectedRoleIds: roles,
      affectedAgentCount: roles.length
    },
    expectedVersion: "version-1"
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
    if (url === "/api/skills/kx_financial/profit-check" && method === "DELETE") {
      return new Response(JSON.stringify({ ok: true, uri: skill.uri }));
    }
    return new Response(JSON.stringify({ ok: false, error: `not found: ${url}` }), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function deleteCalls(fetchMock: ReturnType<typeof stubApis>) {
  return fetchMock.mock.calls.filter(([url, init]) => (init as RequestInit | undefined)?.method === "DELETE");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SKO-15 工作台回归 —— 删除与发布状态预检", () => {
  it("删除是两步确认：第一步只武装删除、不发请求，确认后才发 DELETE", async () => {
    const fetchMock = stubApis();
    renderPage();
    expect(await screen.findByTestId("skill-detail")).toBeInTheDocument();

    // 第一步：点「删除 Skill」只把按钮换成确认态。
    expect(screen.queryByTestId("skill-delete-confirm")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("skill-delete"));
    expect(screen.getByTestId("skill-delete-confirm")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-delete")).not.toBeInTheDocument();
    // 武装阶段不得发出任何删除请求。
    expect(deleteCalls(fetchMock)).toHaveLength(0);

    // 第二步：确认删除后才发 DELETE，且带 file_version。
    fireEvent.click(screen.getByTestId("skill-delete-confirm"));
    await waitFor(() => expect(deleteCalls(fetchMock)).toHaveLength(1));
    const [url, init] = deleteCalls(fetchMock)[0];
    expect(String(url)).toBe("/api/skills/kx_financial/profit-check");
    expect((init as RequestInit).method).toBe("DELETE");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ expected_version: "version-1" });
  });

  it("发布状态进入预检：「状态变化」反映 草稿 → 已发布，且未确认前不写盘", async () => {
    const fetchMock = stubApis();
    renderPage();
    expect(await screen.findByTestId("skill-detail")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("skill-edit"));
    fireEvent.click(screen.getByTestId("skill-metadata-toggle"));
    fireEvent.change(screen.getByTestId("skill-field-status"), { target: { value: "published" } });

    fireEvent.click(screen.getByTestId("skill-save"));
    const dialog = await screen.findByTestId("skill-preflight");

    // 预检里的「状态变化」行由 SKILL_STATUS_LABELS 渲染；该行没有独立 testid，
    // 按语义标签定位：<dt>状态变化</dt> 的同一个 <div> 里的 <dd>。
    const statusRow = within(dialog).getByText("状态变化").closest("div");
    expect(statusRow).not.toBeNull();
    expect(statusRow?.textContent).toContain("草稿 → 已发布");

    // 预检确认前不得写入。
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(false);
  });
});
