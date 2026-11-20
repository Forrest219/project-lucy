// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectAclField } from "../components/ObjectAclField";
import { WikiAccessDrawer } from "../components/WikiAccessDrawer";
import { WikiAccessEditor } from "../components/WikiAccessEditor";
import { WikiAccessEffectList } from "../components/WikiAccessEffectList";
import { WikiAccessStatusBadge, WikiAccessSummary } from "../components/WikiAccessSummary";
import { WikiUploadPreflight } from "../components/WikiUploadPreflight";
import type { WikiUploadPreflightProps } from "../components/WikiUploadPreflight";
import type {
  WikiAccessListEntry,
  WikiAccessRoleEffect,
  WikiAclState,
  WikiUploadPreview
} from "../lib/types";
import {
  wikiAclDeclarationKey,
  wikiUploadCommitGuard,
  wikiUploadNeedsExplicitChoice
} from "../lib/wikiAccess";

const ROLES = ["analyst", "finance_reader"];

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** Role list endpoint: resolves, fails, or never settles. */
function roleEndpoint(mode: "ready" | "error" | "pending") {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/admin/roles?includeTemplates=false") {
      if (mode === "pending") {
        return new Promise<Response>(() => undefined);
      }
      if (mode === "error") {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "UPSTREAM", message: "角色服务不可用" } }),
          { status: 503 }
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: { roles: ROLES.map((id) => ({ id })) }
        })
      );
    }
    return new Response(
      JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
      { status: 404 }
    );
  });
}

function effect(overrides: Partial<WikiAccessRoleEffect>): WikiAccessRoleEffect {
  return {
    role_id: "analyst",
    known: true,
    discover_enabled: true,
    read_enabled: true,
    assigned_agent_count: 2,
    assigned_agent_ids: ["agent-a", "agent-b"],
    ...overrides
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ObjectAclField role query status (Spec 193 §11)", () => {
  it("shows a distinct loading state while the Role list is in flight", async () => {
    vi.stubGlobal("fetch", roleEndpoint("pending"));
    renderWithClient(
      <ObjectAclField onChange={() => undefined} testId="acl" value={[]} />
    );

    expect(await screen.findByTestId("acl-roles-loading")).toHaveTextContent(
      "正在加载可授权角色…"
    );
    expect(screen.queryByTestId("acl-roles-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("acl-roles-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("acl")).toHaveAttribute("data-role-status", "loading");
  });

  it("shows a distinct error state when the Role list cannot be read", async () => {
    vi.stubGlobal("fetch", roleEndpoint("error"));
    renderWithClient(
      <ObjectAclField onChange={() => undefined} testId="acl" value={[]} />
    );

    expect(await screen.findByTestId("acl-roles-error")).toHaveTextContent(
      "可授权角色加载失败"
    );
    expect(screen.queryByTestId("acl-roles-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("acl-roles-loading")).not.toBeInTheDocument();
    expect(screen.getByTestId("acl")).toHaveAttribute("data-role-status", "error");
  });

  it("shows the empty state only after a successful empty Role list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/admin/roles?includeTemplates=false") {
          return new Response(JSON.stringify({ ok: true, data: { roles: [] } }));
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "X", message: "x" } }), {
          status: 404
        });
      })
    );
    renderWithClient(
      <ObjectAclField onChange={() => undefined} testId="acl" value={[]} />
    );

    expect(await screen.findByTestId("acl-roles-empty")).toHaveTextContent(
      "暂无可授权的正式 Role。"
    );
    expect(screen.queryByTestId("acl-roles-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("acl-roles-error")).not.toBeInTheDocument();
  });

  it("keeps an unknown Role visible and removable", async () => {
    vi.stubGlobal("fetch", roleEndpoint("ready"));
    const onChange = vi.fn();
    renderWithClient(
      <ObjectAclField onChange={onChange} testId="acl" value={["analyst", "ghost-role"]} />
    );

    const unknown = await screen.findByText("ghost-role");
    expect(unknown).toHaveClass("notranslate");
    expect(unknown).toHaveAttribute("translate", "no");
    expect(screen.getByText(/未知角色/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /ghost-role/ }));
    expect(onChange).toHaveBeenCalledWith(["analyst"]);
  });
});

describe("WikiAccessEffectList (Spec 193 §4.2)", () => {
  it("renders exactly one fixed channel state per declared Role", () => {
    renderWithClient(
      <WikiAccessEffectList
        effects={[
          effect({ role_id: "both" }),
          effect({ role_id: "search", read_enabled: false }),
          effect({ role_id: "read", discover_enabled: false }),
          effect({ role_id: "none", discover_enabled: false, read_enabled: false }),
          effect({ role_id: "ghost", known: false })
        ]}
      />
    );

    expect(screen.getByTestId("wiki-access-effects-state-both")).toHaveTextContent(
      "可搜索、可读取"
    );
    expect(screen.getByTestId("wiki-access-effects-state-search")).toHaveTextContent(
      "可搜索摘要、无法读取正文"
    );
    expect(screen.getByTestId("wiki-access-effects-state-read")).toHaveTextContent(
      "可按已知路径读取、无法搜索发现"
    );
    expect(screen.getByTestId("wiki-access-effects-state-none")).toHaveTextContent(
      "已授权，缺少 Wiki 访问通道"
    );
    expect(screen.getByTestId("wiki-access-effects-state-ghost")).toHaveTextContent(
      "未知角色，不匹配任何 Agent"
    );
  });

  it("labels the declared Role count and the affected Agent count separately", () => {
    renderWithClient(
      <WikiAccessEffectList
        effects={[
          effect({ role_id: "a", assigned_agent_ids: ["agent-1"] }),
          effect({ role_id: "b", assigned_agent_ids: ["agent-1", "agent-2"] })
        ]}
      />
    );

    expect(screen.getByTestId("wiki-access-effects-declared-count")).toHaveTextContent(
      "2 个角色"
    );
    expect(screen.getByTestId("wiki-access-effects-agent-count")).toHaveTextContent(
      "受影响 Agent 数 2"
    );
  });

  it("never degrades a failed effect read into an empty Role list", () => {
    renderWithClient(
      <WikiAccessEffectList effects={[]} error="通道服务不可用" status="error" />
    );

    expect(screen.getByTestId("wiki-access-effects-error")).toHaveTextContent(
      "通道服务不可用"
    );
    expect(screen.queryByTestId("wiki-access-effects-empty")).not.toBeInTheDocument();
  });
});

describe("WikiAccessEditor (Spec 193 §5 / §6.2)", () => {
  it("shows the authorization source badge and the independent all-roles confirmation", async () => {
    vi.stubGlobal("fetch", roleEndpoint("ready"));
    const onAllConfirmedChange = vi.fn();
    renderWithClient(
      <WikiAccessEditor
        allConfirmed={false}
        onAllConfirmedChange={onAllConfirmedChange}
        onChange={() => undefined}
        source="uploaded"
        testId="editor"
        value={["*"]}
      />
    );

    expect(screen.getByTestId("editor-source")).toHaveTextContent("来自上传文件");
    const confirm = await screen.findByRole("checkbox", { name: "我确认所有角色可见" });
    expect(confirm).not.toBeChecked();
    fireEvent.click(confirm);
    expect(onAllConfirmedChange).toHaveBeenCalledWith(true);
  });

  it("requires an explicit re-set for a corrupt stored declaration", async () => {
    vi.stubGlobal("fetch", roleEndpoint("ready"));
    renderWithClient(
      <WikiAccessEditor
        corrupt
        onChange={() => undefined}
        source="reset"
        testId="editor"
        value={[]}
      />
    );

    expect(await screen.findByTestId("editor-field-corrupt")).toBeInTheDocument();
    // No choice is pre-selected: the owner has to pick one explicitly.
    expect(screen.getByLabelText("无人可见")).not.toBeChecked();
    expect(screen.getByLabelText("指定角色")).not.toBeChecked();
    expect(screen.getByLabelText("所有角色可见")).not.toBeChecked();
  });

  it("shows the empty (无人可见) confirmation only when the caller asks for it", async () => {
    vi.stubGlobal("fetch", roleEndpoint("ready"));
    renderWithClient(
      <WikiAccessEditor
        emptyConfirmed={false}
        onChange={() => undefined}
        onEmptyConfirmedChange={() => undefined}
        requireEmptyConfirmation
        source="reset"
        testId="editor"
        value={[]}
      />
    );

    expect(await screen.findByTestId("editor-empty-confirm")).toBeInTheDocument();
  });
});

describe("WikiAccessSummary / status badge (Spec 193 §6.1)", () => {
  const entry = (overrides: Partial<WikiAccessListEntry>): WikiAccessListEntry => ({
    file_version: "sha256:1",
    acl: { state: "missing" },
    declared_role_count: 0,
    declared_without_discover: 0,
    declared_without_read: 0,
    ...overrides
  });

  it("renders the compact read-view summary", () => {
    renderWithClient(
      <WikiAccessSummary
        access={entry({
          acl: { state: "roles", roles: ["finance", "test-fc"] },
          declared_role_count: 2,
          declared_without_read: 1
        })}
      />
    );

    const summary = screen.getByTestId("wiki-access-summary");
    expect(summary).toHaveTextContent("可访问角色：");
    expect(summary).toHaveTextContent("finance、test-fc");
    expect(summary).toHaveTextContent("1 个角色缺少读取通道");
  });

  it("renders exactly one primary status per list row", () => {
    const { rerender } = renderWithClient(
      <WikiAccessStatusBadge access={entry({ acl: { state: "missing" } })} />
    );
    expect(screen.getByTestId("wiki-access-status-primary")).toHaveTextContent("无人可见");

    rerender(
      <WikiAccessStatusBadge
        access={entry({
          acl: { state: "roles", roles: ["finance", "test-fc"] },
          declared_role_count: 2
        })}
      />
    );
    expect(screen.getByTestId("wiki-access-status-primary")).toHaveTextContent("2 个角色");

    rerender(
      <WikiAccessStatusBadge access={entry({ acl: { state: "all" }, declared_role_count: null })} />
    );
    expect(screen.getByTestId("wiki-access-status-primary")).toHaveTextContent("所有角色可见");

    rerender(
      <WikiAccessStatusBadge
        access={entry({ acl: { state: "corrupt", detail: "broken" }, declared_role_count: null })}
      />
    );
    expect(screen.getByTestId("wiki-access-status-primary")).toHaveTextContent("授权异常");
  });
});

describe("WikiAccessDrawer (Spec 193 §6.2)", () => {
  function drawerFetch(options: { roleMode?: "ready" | "error" | "pending"; saveStatus?: number } = {}) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/admin/roles?includeTemplates=false") {
        if (options.roleMode === "pending") {
          return new Promise<Response>(() => undefined);
        }
        if (options.roleMode === "error") {
          return new Response(
            JSON.stringify({ ok: false, error: { code: "UPSTREAM", message: "角色服务不可用" } }),
            { status: 503 }
          );
        }
        return new Response(
          JSON.stringify({ ok: true, data: { roles: ROLES.map((id) => ({ id })) } })
        );
      }
      if (url === "/api/wiki/global%2Fa.md/access" && method === "GET") {
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              key: "global/a.md",
              file_version: "sha256:v1",
              acl: { state: "roles", roles: ["analyst"] },
              declared_role_count: 1,
              role_effects: [effect({ role_id: "analyst" })],
              declared_without_discover: 0,
              declared_without_read: 0,
              role_channel_version: "rcv-1"
            }
          })
        );
      }
      if (url === "/api/wiki/global%2Fa.md/access/preview" && method === "POST") {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              key: "global/a.md",
              file_version: "sha256:v1",
              current_acl: { state: "roles", roles: ["analyst"] },
              next_acl: { state: "roles", roles: body.allowed_roles },
              direction: body.allowed_roles.includes("finance_reader") ? "widen" : "neutral",
              noop: false,
              role_effects: body.allowed_roles.map((roleId: string) => effect({ role_id: roleId })),
              declared_role_count: body.allowed_roles.length,
              declared_without_discover: 0,
              declared_without_read: 0,
              role_channel_version: "rcv-1",
              preview_digest: `digest-${body.allowed_roles.join("+")}`
            }
          })
        );
      }
      if (url === "/api/wiki/global%2Fa.md/access" && method === "PUT") {
        const status = options.saveStatus ?? 200;
        if (status !== 200) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: { code: "wiki_write_conflict", message: "文档已被其他人更新" }
            }),
            { status }
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              status: "applied",
              key: "global/a.md",
              file_version: "sha256:v2",
              acl: { state: "roles", roles: ["analyst"] },
              direction: "widen",
              role_effects: [],
              role_channel_version: "rcv-1"
            }
          })
        );
      }
      return new Response(
        JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }),
        { status: 404 }
      );
    });
  }

  it("shows the document facts and saves with the bound digest", async () => {
    const fetchMock = drawerFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderWithClient(
      <WikiAccessDrawer
        onClose={() => undefined}
        open
        title="A 文档"
        wikiKey="global/a.md"
      />
    );

    const drawer = await screen.findByTestId("wiki-access-drawer");
    expect(within(drawer).getByText("A 文档")).toBeInTheDocument();
    expect(within(drawer).getByText("wiki/global/a.md")).toBeInTheDocument();
    expect(await within(drawer).findByText("sha256:v1")).toBeInTheDocument();
    await waitFor(() => {
      expect(within(drawer).getByTestId("wiki-access-current")).toHaveTextContent("analyst");
    });

    fireEvent.click(await within(drawer).findByLabelText("finance_reader"));
    await waitFor(() => {
      expect(within(drawer).getByTestId("wiki-access-next")).toHaveTextContent(
        "analyst、finance_reader"
      );
    });
    expect(within(drawer).getByTestId("wiki-access-direction")).toHaveTextContent("扩权");

    fireEvent.click(within(drawer).getByTestId("wiki-access-save"));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find((call) => call[1]?.method === "PUT");
      expect(put).toBeTruthy();
      const body = JSON.parse(String(put?.[1]?.body));
      expect(body.allowed_roles).toEqual(["analyst", "finance_reader"]);
      expect(body.expected_version).toBe("sha256:v1");
      expect(body.preview_digest).toBe("digest-analyst+finance_reader");
    });
    expect(await within(drawer).findByTestId("wiki-access-result")).toHaveTextContent(
      "访问权限已保存。"
    );
  });

  it("blocks the commit while the Role list is still loading", async () => {
    vi.stubGlobal("fetch", drawerFetch({ roleMode: "pending" }));
    renderWithClient(
      <WikiAccessDrawer
        onClose={() => undefined}
        open
        title="A 文档"
        wikiKey="global/a.md"
      />
    );

    const drawer = await screen.findByTestId("wiki-access-drawer");
    await waitFor(() => {
      expect(within(drawer).getByTestId("wiki-access-save")).toBeDisabled();
    });
  });

  it("blocks the commit and shows the error when the Role list fails", async () => {
    vi.stubGlobal("fetch", drawerFetch({ roleMode: "error" }));
    renderWithClient(
      <WikiAccessDrawer
        onClose={() => undefined}
        open
        title="A 文档"
        wikiKey="global/a.md"
      />
    );

    const drawer = await screen.findByTestId("wiki-access-drawer");
    expect(
      await within(drawer).findByTestId("wiki-access-drawer-editor-field-roles-error")
    ).toHaveTextContent("可授权角色加载失败");
    expect(within(drawer).getByTestId("wiki-access-save")).toBeDisabled();
  });

  it("keeps the selection on a conflict and requires a new confirmation", async () => {
    const fetchMock = drawerFetch({ saveStatus: 409 });
    vi.stubGlobal("fetch", fetchMock);
    renderWithClient(
      <WikiAccessDrawer
        onClose={() => undefined}
        open
        title="A 文档"
        wikiKey="global/a.md"
      />
    );

    const drawer = await screen.findByTestId("wiki-access-drawer");
    fireEvent.click(await within(drawer).findByLabelText("finance_reader"));
    await waitFor(() => {
      expect(within(drawer).getByTestId("wiki-access-save")).not.toBeDisabled();
    });

    fireEvent.click(within(drawer).getByTestId("wiki-access-save"));
    expect(await within(drawer).findByTestId("wiki-access-conflict")).toHaveTextContent(
      "已保留你的角色选择"
    );
    // The Role selection survives the conflict.
    expect(within(drawer).getByLabelText("finance_reader")).toBeChecked();
    expect(within(drawer).getByTestId("wiki-access-save")).toBeDisabled();

    // A new preview plus an explicit confirmation is required before the next
    // commit.
    fireEvent.click(within(drawer).getByTestId("wiki-access-reconfirm"));
    await waitFor(() => {
      expect(within(drawer).getByTestId("wiki-access-save")).not.toBeDisabled();
    });
    expect(within(drawer).getByLabelText("finance_reader")).toBeChecked();
  });
});

describe("P1-65 declaration keys and explicit-choice gate", () => {
  const roles = (...ids: string[]): WikiAclState => ({ state: "roles", roles: ids });
  const corrupt = (detail = "bad"): WikiAclState => ({ state: "corrupt", detail });

  it("wikiAclDeclarationKey mirrors the server canonical key semantics", () => {
    expect(wikiAclDeclarationKey({ state: "missing" })).toBe("missing");
    expect(wikiAclDeclarationKey({ state: "empty" })).toBe("empty");
    expect(wikiAclDeclarationKey({ state: "all" })).toBe("all");
    expect(wikiAclDeclarationKey(roles("b", "a"))).toBe("roles:a,b");
    expect(wikiAclDeclarationKey(roles("a", "b", "a"))).toBe("roles:a,b");
    expect(wikiAclDeclarationKey(corrupt("x"))).toBe("corrupt:x");
    // missing, empty and all are three different declarations.
    const keys = new Set(
      ([{ state: "missing" }, { state: "empty" }, { state: "all" }] as WikiAclState[]).map(
        wikiAclDeclarationKey
      )
    );
    expect(keys.size).toBe(3);
  });

  it("wikiUploadNeedsExplicitChoice: replace requires a choice on any key mismatch or corrupt", () => {
    expect(wikiUploadNeedsExplicitChoice("replace", roles("a"), roles("a", "b"))).toBe(true);
    expect(wikiUploadNeedsExplicitChoice("replace", { state: "missing" }, { state: "empty" })).toBe(
      true
    );
    expect(wikiUploadNeedsExplicitChoice("replace", roles("a"), corrupt())).toBe(true);
    expect(wikiUploadNeedsExplicitChoice("replace", corrupt(), roles("a"))).toBe(true);
    expect(wikiUploadNeedsExplicitChoice("replace", corrupt("x"), corrupt("x"))).toBe(true);
    expect(wikiUploadNeedsExplicitChoice("replace", roles("b", "a"), roles("a", "b"))).toBe(false);
    expect(wikiUploadNeedsExplicitChoice("replace", { state: "all" }, { state: "all" })).toBe(
      false
    );
  });

  it("wikiUploadNeedsExplicitChoice: create only needs a choice for a corrupt upload", () => {
    expect(wikiUploadNeedsExplicitChoice("create", null, corrupt())).toBe(true);
    expect(wikiUploadNeedsExplicitChoice("create", null, roles("a"))).toBe(false);
    expect(wikiUploadNeedsExplicitChoice("create", null, { state: "empty" })).toBe(false);
  });

  const baseGuard = {
    mode: "replace" as const,
    currentAcl: roles("a") as WikiAclState,
    uploadedAcl: roles("a", "b") as WikiAclState,
    previewReady: true,
    previewLoading: false,
    previewError: null,
    previewDigest: "digest",
    roleReady: true,
    emptyConfirmed: false,
    allConfirmed: false,
    corruptBlocked: false
  };

  it("commit guard blocks a replace without selection and adopting a corrupt upload", () => {
    expect(wikiUploadCommitGuard({ ...baseGuard, selection: null }).blocked).toBe(true);
    expect(
      wikiUploadCommitGuard({
        ...baseGuard,
        selection: { mode: "use_uploaded" },
        uploadedAcl: corrupt()
      }).blocked
    ).toBe(true);
    expect(
      wikiUploadCommitGuard({ ...baseGuard, selection: { mode: "preserve_current" } }).blocked
    ).toBe(false);
  });
});

describe("WikiUploadPreflight unselected replace (P1-65 D3)", () => {
  const preview = {
    key: "global/a.md",
    filePath: "wiki/global/a.md",
    diff: "@@\n+x\n",
    proposedMarkdown: "x",
    exists: true,
    mode: "replace",
    sourceFileName: "a.md",
    targetKey: "global/a.md",
    existingTitle: "A",
    targetTitle: "A",
    title: "A",
    slRefs: [],
    warnings: [],
    currentFileVersion: "sha256:1",
    access: {
      current_acl: { state: "roles", roles: ["analyst"] },
      uploaded_acl: { state: "roles", roles: ["analyst", "finance_reader"] },
      final_acl: { state: "roles", roles: ["analyst"] },
      suggested_selection: { mode: "preserve_current" },
      direction: "neutral",
      role_effects: [],
      declared_role_count: 1,
      declared_without_discover: 0,
      declared_without_read: 0,
      role_channel_version: "rcv",
      preview_digest: "digest-suggested",
      issues: []
    }
  } as unknown as WikiUploadPreview;

  function props(overrides: Partial<WikiUploadPreflightProps> = {}): WikiUploadPreflightProps {
    return {
      open: true,
      mode: "replace",
      preview,
      directories: [],
      targetDirectory: "global",
      error: null,
      isLoading: false,
      isCommitting: false,
      onCancel: () => undefined,
      onConfirm: vi.fn(),
      onTargetDirectoryChange: () => undefined,
      selection: null,
      onSelectionChange: vi.fn(),
      emptyConfirmed: false,
      onEmptyConfirmedChange: () => undefined,
      allConfirmed: false,
      onAllConfirmedChange: () => undefined,
      corruptBlocked: false,
      onIgnoreCorrupt: () => undefined,
      roleReady: true,
      ...overrides
    };
  }

  it("shows 待选择, never the server suggestion, and keeps commit disabled", async () => {
    vi.stubGlobal("fetch", roleEndpoint("ready"));
    const onConfirm = vi.fn();
    renderWithClient(<WikiUploadPreflight {...props({ onConfirm })} />);

    const final = await screen.findByTestId("wiki-upload-access-final");
    expect(final).toHaveTextContent("待选择（尚未确定）");
    expect(final).not.toHaveTextContent("保留现有授权");
    const confirm = screen.getByTestId("wiki-upload-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("wiki-upload-access-choice-required")).toBeInTheDocument();
  });

  it("offers explicit preserve and legal adopt actions that emit the selection", async () => {
    vi.stubGlobal("fetch", roleEndpoint("ready"));
    const onSelectionChange = vi.fn();
    renderWithClient(<WikiUploadPreflight {...props({ onSelectionChange })} />);

    fireEvent.click(await screen.findByTestId("wiki-upload-access-preserve"));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ mode: "preserve_current" });
    fireEvent.click(screen.getByTestId("wiki-upload-access-adopt"));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ mode: "use_uploaded" });
  });
});
