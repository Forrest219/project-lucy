// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { RoleDetail } from "../pages/admin/RoleDetail";
import type { RoleDetail as RoleDetailType } from "../lib/types";

/**
 * Lucy v0.25 (L25-14 §14.2.1 / §14.3.2) — the Role save is bound to the final-row
 * preview confirmation and shows the terminal state of the write.
 *
 * - a Role that carries a row policy can only be saved with a confirmation;
 * - the save carries the confirmation the preview produced;
 * - only `committed` is shown as a success.
 */
vi.mock("sonner", () => ({
  toast: {
    message: vi.fn(),
    error: vi.fn(),
    success: vi.fn()
  }
}));

const CONFIRMATION = {
  vocabularyVersion: "v0.25-row-policy-confirmation-1",
  candidateDigest: "candidate-1",
  baseAccessVersion: "access-1",
  basePolicyVersion: "policy-1",
  compileInputsDigest: "inputs-1",
  impactDigest: "impact-1",
  affectedTables: [{ connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "superstore_orders" }],
  affectedAgentIds: ["zhangsan"]
};

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/roles/:roleId" element={<RoleDetail />} />
          <Route path="/admin/roles" element={<div>roles</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function makeScopedRole(): RoleDetailType {
  return {
    id: "analyst",
    version: "v-detail",
    description: "Analyst role",
    source: "yaml",
    tools: ["lucy_query"],
    connections: ["mysql-aliyun"],
    sourceNames: ["superstore_orders"],
    sourceCount: 1,
    invalid: false,
    warnings: [],
    usageCount: 0,
    users: [],
    role: {
      description: "Analyst role",
      allow: {
        connections: ["mysql-aliyun"],
        tools: ["lucy_query"],
        tableSelectors: [
          {
            connection: "mysql-aliyun",
            schema: "dataforai",
            names: ["superstore_orders"],
            row_access: "scoped",
            row_policy: { predicates: [{ field: "region", op: "eq", value: "East" }] }
          }
        ]
      }
    },
    effectivePermissions: {
      roleIds: ["analyst"],
      snapshotHash: "abc",
      sourceMapVersion: "v1",
      tools: ["lucy_query"],
      connections: ["mysql-aliyun"],
      sources: [
        {
          connectionId: "mysql-aliyun",
          schema: "dataforai",
          sourceName: "superstore_orders",
          table: "dataforai.superstore_orders"
        }
      ],
      legacyDirectAllow: false,
      capabilities: []
    }
  } as unknown as RoleDetailType;
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;

function installFetch(role: RoleDetailType | null, handler?: FetchHandler) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const handled = await handler?.(url, init);
    if (handled) return handled;
    if (role && url === `/api/admin/roles/${role.id}` && (!init?.method || init.method === "GET")) {
      return new Response(JSON.stringify({ ok: true, data: role }));
    }
    if (url === "/api/connections") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            connections: [
              { id: "mysql-aliyun", schemas: ["dataforai"], enabledTables: ["dataforai.superstore_orders"] }
            ]
          }
        })
      );
    }
    if (url === "/api/connections/mysql-aliyun/tables") {
      return new Response(
        JSON.stringify({ ok: true, data: { tables: ["dataforai.superstore_orders"] } })
      );
    }
    if (url === "/api/admin/mcp-tools") {
      return new Response(
        JSON.stringify({ ok: true, data: { tools: [{ name: "lucy_query", globalDenied: false }] } })
      );
    }
    return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
      status: 404
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function previewBody(ok: boolean) {
  return {
    ok: true,
    data: {
      ok,
      candidateDigest: "candidate-1",
      basePolicyVersion: "policy-1",
      ...(ok ? { confirmation: CONFIRMATION } : {}),
      tables: [
        {
          requested: { connection: "mysql-aliyun", schema: "dataforai", name: "superstore_orders" },
          tableKey: { connectionId: "mysql-aliyun", schema: "dataforai", sourceName: "superstore_orders" },
          catalog: { status: "loaded", catalogLoaded: true },
          ...(ok
            ? {
                preview: {
                  effectiveRowGrant: {
                    kind: "scoped",
                    orArms: [[{ field: "region", op: "eq", value: "East" }]]
                  },
                  roleIds: ["analyst"],
                  finalRowsByAgent: [],
                  displayShape: "OR-of-AND"
                }
              }
            : {
                error: {
                  code: "ROW_POLICY_PREVIEW_FAILED",
                  message: "row_policy_catalog_unavailable:resolve:manifest_unreadable",
                  reason: "row_policy_catalog_unavailable:resolve:manifest_unreadable"
                }
              })
        }
      ]
    }
  };
}

async function openReviewAndConfirm(): Promise<void> {
  // The save bar only appears for a dirty draft.
  fireEvent.change(await screen.findByLabelText("说明"), { target: { value: "Changed" } });
  fireEvent.click(await screen.findByRole("button", { name: "保存权限配置" }));
  const drawer = await screen.findByTestId("role-permission-review-drawer");
  fireEvent.click(within(drawer).getByRole("button", { name: "确认保存" }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(toast.message).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe("RoleDetail — the row-policy save is bound to the preview confirmation", () => {
  it("refuses the save when the preview produced no confirmation", async () => {
    const patchBodies: any[] = [];
    installFetch(makeScopedRole(), (url, init) => {
      if (url === "/api/admin/roles/preview-row-policy") {
        return new Response(JSON.stringify(previewBody(false)));
      }
      if (url === "/api/admin/roles/analyst" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patchBodies.push(body);
        if (body.dryRun) {
          return new Response(JSON.stringify({ ok: true, data: { diff: "+ change", proposedYaml: "yaml", version: "v-preview" } }));
        }
        return new Response(JSON.stringify({ ok: true, data: { written: true, status: "committed", runtimeAck: true } }));
      }
    });

    renderAt("/admin/roles/analyst");
    await openReviewAndConfirm();

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    // The write was refused locally: only the dry-run preview was ever sent.
    expect(patchBodies.every((body) => body.dryRun === true)).toBe(true);
    expect(patchBodies.some((body) => body.rowPolicyConfirmation !== undefined)).toBe(false);
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
  });

  it("carries the preview confirmation into the save", async () => {
    const patchBodies: any[] = [];
    installFetch(makeScopedRole(), (url, init) => {
      if (url === "/api/admin/roles/preview-row-policy") {
        return new Response(JSON.stringify(previewBody(true)));
      }
      if (url === "/api/admin/roles/analyst" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patchBodies.push(body);
        if (body.dryRun) {
          return new Response(JSON.stringify({ ok: true, data: { diff: "+ change", proposedYaml: "yaml", version: "v-preview" } }));
        }
        return new Response(JSON.stringify({ ok: true, data: { written: true, status: "committed", runtimeAck: true, policyVersion: "pv-1" } }));
      }
    });

    renderAt("/admin/roles/analyst");
    await openReviewAndConfirm();

    await waitFor(() => expect(patchBodies.some((body) => body.dryRun === false)).toBe(true));
    const save = patchBodies.find((body) => body.dryRun === false);
    expect(save?.rowPolicyConfirmation).toEqual(CONFIRMATION);
    await waitFor(() => expect(vi.mocked(toast.success)).toHaveBeenCalled());
  });
});

describe("RoleDetail — only a committed write is shown as a success", () => {
  it("shows a rolled-back write as not saved", async () => {
    installFetch(makeScopedRole(), (url, init) => {
      if (url === "/api/admin/roles/preview-row-policy") {
        return new Response(JSON.stringify(previewBody(true)));
      }
      if (url === "/api/admin/roles/analyst" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if (body.dryRun) {
          return new Response(JSON.stringify({ ok: true, data: { diff: "+ change", proposedYaml: "yaml", version: "v-preview" } }));
        }
        return new Response(
          JSON.stringify({
            ok: false,
            written: false,
            runtimeAck: false,
            recoveryRequired: false,
            error: {
              code: "ROW_POLICY_SAVE_ROLLED_BACK",
              message: "保存未生效：新变更已回滚，旧配置与旧策略已核验恢复。"
            },
            data: { status: "rolled_back", written: false, runtimeAck: false }
          }),
          { status: 500 }
        );
      }
    });

    renderAt("/admin/roles/analyst");
    await openReviewAndConfirm();

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toContain("新变更已回滚");
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
  });

  it("shows a recovery-required write as blocked", async () => {
    installFetch(makeScopedRole(), (url, init) => {
      if (url === "/api/admin/roles/preview-row-policy") {
        return new Response(JSON.stringify(previewBody(true)));
      }
      if (url === "/api/admin/roles/analyst" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if (body.dryRun) {
          return new Response(JSON.stringify({ ok: true, data: { diff: "+ change", proposedYaml: "yaml", version: "v-preview" } }));
        }
        return new Response(
          JSON.stringify({
            ok: false,
            written: false,
            runtimeAck: false,
            recoveryRequired: true,
            error: {
              code: "ACCESS_RECOVERY_REQUIRED",
              message: "保存中断：受影响读取与后续写入已阻断，需要人工核验恢复。"
            },
            data: { status: "recovery_required", written: false, runtimeAck: false, recoveryRequired: true }
          }),
          { status: 503 }
        );
      }
    });

    renderAt("/admin/roles/analyst");
    await openReviewAndConfirm();

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toContain("受影响读取与后续写入已阻断");
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
  });
});
