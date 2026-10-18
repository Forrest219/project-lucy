// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyDegradeNotice } from "../components/PolicyDegradeBanner";
import { policyDegradeCopy } from "../lib/policyDegradeCopy";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderNotice(status: Record<string, unknown>, scope?: { agentId?: string; agentNames?: Record<string, string> }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: status })));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PolicyDegradeNotice scope={scope} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return fetchMock;
}

describe("policy degrade notice", () => {
  it("turns a role compile failure into a repair step", () => {
    expect(policyDegradeCopy("role_resolution_failed:chatbi-analyst")).toEqual({
      roleId: "chatbi-analyst",
      text: "角色 {{role}} 没有对应到已发布的数据表。打开该角色，把连接和表改成语义资产里仍然存在的对象，然后保存。"
    });
  });

  it("names the affected Agent and links to the role, without a policy fingerprint", async () => {
    renderNotice({
      policyVersion: "285e19003a4ffb6233c9a5a7fb8cf68b",
      degradedGlobal: false,
      degradedAgents: ["zhangxingchen"],
      issues: [{ agentId: "zhangxingchen", reason: "role_resolution_failed:chatbi-analyst" }],
      healthy: false,
      accessConfigDigest: "a",
      sourceMapVersion: "b"
    }, { agentNames: { zhangxingchen: "张星辰" } });

    const notice = await screen.findByTestId("policy-degrade-banner");
    expect(notice).toHaveTextContent("有 Agent 暂时不能查数");
    expect(notice).toHaveTextContent("张星辰");
    expect(notice).toHaveTextContent("角色 chatbi-analyst 没有对应到已发布的数据表");
    expect(notice).toHaveTextContent("保存成功后，这条提示会消失。");
    expect(screen.getByRole("link", { name: "去修改角色" })).toHaveAttribute("href", "/admin/roles/chatbi-analyst");
    expect(screen.getByRole("link", { name: "打开这个 Agent" })).toHaveAttribute("href", "/admin/agents/zhangxingchen");
    expect(notice).not.toHaveTextContent("policyVersion");
    expect(notice).not.toHaveTextContent("285e19003a4f");
    expect(notice).not.toHaveTextContent("runbook");
  });

  it("stays hidden when this page's Agent is not affected", async () => {
    const fetchMock = renderNotice({
      policyVersion: "abc",
      degradedGlobal: false,
      degradedAgents: ["zhangxingchen"],
      issues: [{ agentId: "zhangxingchen", reason: "role_resolution_failed:chatbi-analyst" }],
      healthy: false,
      accessConfigDigest: "a",
      sourceMapVersion: "b"
    }, { agentId: "other" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {
      await fetchMock.mock.results[0]?.value;
    });
    expect(screen.queryByTestId("policy-degrade-banner")).not.toBeInTheDocument();
  });

  it("stays hidden while the policy is healthy", async () => {
    const fetchMock = renderNotice({
      policyVersion: "abc",
      degradedGlobal: false,
      degradedAgents: [],
      issues: [],
      healthy: true,
      accessConfigDigest: "a",
      sourceMapVersion: "b"
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {
      await fetchMock.mock.results[0]?.value;
    });
    expect(screen.queryByTestId("policy-degrade-banner")).not.toBeInTheDocument();
  });
});
