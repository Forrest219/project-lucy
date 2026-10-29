// @vitest-environment jsdom
//
// 局部状态镜像的页面级回归（Spec §5.2 / §5.3，SC-01–SC-07、SC-22、SC-23 的
// Audit 一半）。
//
// jsdom 没有真实 IME，本文件**不**用来证明组合不被打断（那是 SC-17 的真浏览器
// 探针）。这里断言的是「value 源、URL 同步、回声协议、清除动作归零」这些
// 逻辑契约。

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, NavigationType, Route, Routes, Router, createPath, parsePath, type To } from "react-router-dom";
import { useReducer, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Audit } from "../pages/admin/Audit";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() }
}));

function stubEmptyAuditApis() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/agents")) {
        return new Response(JSON.stringify({ ok: true, data: { agents: [], version: 1, summary: {} } }));
      }
      if (url.includes("/api/admin/audit/turns")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              total: 0,
              entries: [],
              summary: { reportedCount: 0, inferredCount: 0, reportedShare: 0 },
              referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 }
            }
          })
        );
      }
      if (url.startsWith("/api/admin/audit")) {
        return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [] } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    })
  );
}

// ─── 可控延迟的 router 替身 ──────────────────────────────────────────────────
//
// SC-22 需要「较早的 URL 值晚到」这种时序。真实 router 的导航要么立刻落地、
// 要么被后一次导航打断，没法稳定复现「旧值晚到」。这里用 React Router 的底层
// `<Router>` 组件自己掌握 location / navigationType，把导航先排队、由测试决定
// 何时、按什么顺序落地。

interface QueuedNav {
  search: string;
  replace: boolean;
}

interface ControlledRouter {
  search: string;
  navigationType: NavigationType;
  queue: QueuedNav[];
  commit(order?: number[]): void;
  pop(search: string): void;
  notify: (() => void) | null;
}

function createControlledRouter(initialSearch = ""): ControlledRouter {
  return {
    search: initialSearch,
    navigationType: NavigationType.Pop,
    queue: [],
    notify: null,
    commit(order?: number[]) {
      const picks = order ?? this.queue.map((_, index) => index);
      const items = picks.map((index) => this.queue[index]).filter(Boolean);
      this.queue = this.queue.filter((item) => !items.includes(item));
      for (const item of items) {
        this.search = item.search;
        this.navigationType = item.replace ? NavigationType.Replace : NavigationType.Push;
      }
      this.notify?.();
    },
    pop(search: string) {
      this.search = search;
      this.navigationType = NavigationType.Pop;
      this.notify?.();
    }
  };
}

function searchOf(to: To): string {
  if (typeof to === "string") return parsePath(to).search ?? "";
  return to.search ?? "";
}

function ControlledRouterProvider({
  router,
  children
}: {
  router: ControlledRouter;
  children: ReactNode;
}) {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  router.notify = bump;

  const navigator = {
    createHref: (to: To) => (typeof to === "string" ? to : createPath(to)),
    go: () => {},
    push: (to: To) => {
      router.queue.push({ search: searchOf(to), replace: false });
    },
    replace: (to: To) => {
      router.queue.push({ search: searchOf(to), replace: true });
    }
  };

  return (
    <Router
      location={{ pathname: "/admin/audit", search: router.search, hash: "", state: null, key: "controlled" }}
      navigationType={router.navigationType}
      navigator={navigator}
    >
      {children}
    </Router>
  );
}

function renderAuditControlled(router: ControlledRouter) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ControlledRouterProvider router={router}>
        <Audit />
      </ControlledRouterProvider>
    </QueryClientProvider>
  );
}

function renderAuditMemory(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/admin/audit" element={<Audit />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function userInput(): HTMLInputElement {
  return screen.getByPlaceholderText("Agent 名称或 ID") as HTMLInputElement;
}

function unifiedInput(): HTMLInputElement {
  return screen.getByTestId("audit-key-search") as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("Audit 局部状态镜像（Spec §5.2 / §5.3）", () => {
  it("深链初值：输入框显示 URL 里的原文", async () => {
    stubEmptyAuditApis();
    const router = createControlledRouter("?user=analyst_zhang");
    renderAuditControlled(router);
    await waitFor(() => {
      expect(userInput()).toHaveValue("analyst_zhang");
    });
  });

  it("输入后 URL 立即等于原文（末尾空格保留在输入框与 URL）", async () => {
    stubEmptyAuditApis();
    const router = createControlledRouter("");
    renderAuditControlled(router);
    await waitFor(() => expect(userInput()).toHaveValue(""));

    fireEvent.change(userInput(), { target: { value: "abc " } });
    expect(userInput()).toHaveValue("abc ");
    act(() => router.commit());
    expect(router.search).toBe("?user=abc+");
    expect(new URLSearchParams(router.search).get("user")).toBe("abc ");
  });

  it("统一搜索：末尾空格保留在输入框与 URL，消费值再 trim", async () => {
    stubEmptyAuditApis();
    const router = createControlledRouter("");
    renderAuditControlled(router);
    await waitFor(() => expect(unifiedInput()).toHaveValue(""));

    fireEvent.change(unifiedInput(), { target: { value: "报表 " } });
    expect(unifiedInput()).toHaveValue("报表 ");
    act(() => router.commit());
    // turns tab 下自由文本写进 turnSearch，且**保留原文**（不再写前 trim）。
    expect(new URLSearchParams(router.search).get("turnSearch")).toBe("报表 ");
  });

  it("浏览器后退（POP）后输入框回到历史条目的值", async () => {
    stubEmptyAuditApis();
    const router = createControlledRouter("?user=first");
    renderAuditControlled(router);
    await waitFor(() => expect(userInput()).toHaveValue("first"));

    fireEvent.change(userInput(), { target: { value: "second" } });
    act(() => router.commit());
    expect(userInput()).toHaveValue("second");

    // 后退到上一条历史：POP 必须采用 URL，即使草稿与焦点都在输入框里。
    act(() => router.pop("?user=first"));
    await waitFor(() => {
      expect(userInput()).toHaveValue("first");
    });
  });

  it("清除筛选清空输入框并移除 URL 参数", async () => {
    stubEmptyAuditApis();
    const router = createControlledRouter("?user=analyst_zhang");
    renderAuditControlled(router);
    await waitFor(() => expect(userInput()).toHaveValue("analyst_zhang"));

    fireEvent.change(userInput(), { target: { value: "someone" } });
    act(() => router.commit());
    expect(new URLSearchParams(router.search).get("user")).toBe("someone");

    fireEvent.click(screen.getByTestId("audit-clear-filters"));
    await waitFor(() => {
      expect(userInput()).toHaveValue("");
    });
    act(() => router.commit());
    expect(new URLSearchParams(router.search).get("user")).toBeNull();
  });

  it("清除筛选时参数本来就是空的，输入框也必须清空（reset 生效）", async () => {
    stubEmptyAuditApis();
    // `tool` 让「清除筛选」按钮出现；`user` 参数保持为空。
    const router = createControlledRouter("?tool=x");
    renderAuditControlled(router);
    await waitFor(() => expect(screen.getByTestId("audit-clear-filters")).toBeInTheDocument());

    // 键入但**不提交导航**：URL 里 `user` 仍是空的，草稿里却有文本。
    fireEvent.change(userInput(), { target: { value: "abc" } });
    expect(userInput()).toHaveValue("abc");
    expect(new URLSearchParams(router.search).get("user")).toBeNull();

    // 只改 URL 是不够的：urlValue 没变，反向同步不会跑。必须靠 reset 归零。
    fireEvent.click(screen.getByTestId("audit-clear-filters"));
    await waitFor(() => {
      expect(userInput()).toHaveValue("");
    });
  });

  it("SC-22：较早的 URL 值晚到时不覆盖草稿", async () => {
    stubEmptyAuditApis();
    const router = createControlledRouter("");
    renderAuditControlled(router);
    await waitFor(() => expect(userInput()).toHaveValue(""));

    fireEvent.change(userInput(), { target: { value: "z" } });
    fireEvent.change(userInput(), { target: { value: "zh" } });
    expect(userInput()).toHaveValue("zh");
    expect(router.queue).toHaveLength(2);

    // 旧值「z」先落地。
    act(() => router.commit([0]));
    expect(router.search).toBe("?user=z");
    expect(userInput()).toHaveValue("zh");

    // 新值「zh」后落地。
    act(() => router.commit([0]));
    expect(router.search).toBe("?user=zh");
    expect(userInput()).toHaveValue("zh");
  });

  it("SC-22：新值先确认、旧值后到时也不覆盖草稿", async () => {
    stubEmptyAuditApis();
    const router = createControlledRouter("");
    renderAuditControlled(router);
    await waitFor(() => expect(userInput()).toHaveValue(""));

    fireEvent.change(userInput(), { target: { value: "z" } });
    fireEvent.change(userInput(), { target: { value: "zh" } });
    expect(router.queue).toHaveLength(2);

    // 新值「zh」先落地并被确认为最新提交。
    act(() => router.commit([1]));
    expect(router.search).toBe("?user=zh");
    expect(userInput()).toHaveValue("zh");

    // 旧值「z」后到 —— 必须被忽略。
    act(() => router.commit([0]));
    expect(router.search).toBe("?user=z");
    expect(userInput()).toHaveValue("zh");
  });
});

describe("Audit 局部状态镜像：请求消费点", () => {
  it("统一搜索的末尾空格不会进入请求参数", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/agents")) {
        return new Response(JSON.stringify({ ok: true, data: { agents: [], version: 1, summary: {} } }));
      }
      if (url.includes("/api/admin/audit/turns")) {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              total: 0,
              entries: [],
              summary: { reportedCount: 0, inferredCount: 0, reportedShare: 0 },
              referenceLatency: { windowHours: 168, p95Ms: 0, totalCallsInWindow: 0, slowCallsInFilter: 0 }
            }
          })
        );
      }
      return new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [] } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const router = createControlledRouter("");
    renderAuditControlled(router);
    await waitFor(() => expect(unifiedInput()).toHaveValue(""));

    fireEvent.change(unifiedInput(), { target: { value: "报表 " } });
    act(() => router.commit());

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((call) => String(call[0]));
      const turnsCalls = calls.filter((url) => url.includes("/api/admin/audit/turns?"));
      const turnsCall = turnsCalls[turnsCalls.length - 1];
      expect(turnsCall).toBeDefined();
      expect(turnsCall).toContain("q=%E6%8A%A5%E8%A1%A8");
      expect(turnsCall).not.toContain("q=%E6%8A%A5%E8%A1%A8+");
    });
  });

  it("标准 MemoryRouter 下深链初值与本地草稿仍然同步", async () => {
    stubEmptyAuditApis();
    renderAuditMemory("/admin/audit?user=analyst_zhang");
    await waitFor(() => {
      expect(userInput()).toHaveValue("analyst_zhang");
    });
    fireEvent.change(userInput(), { target: { value: "next" } });
    expect(userInput()).toHaveValue("next");
  });
});
