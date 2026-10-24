// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RowPolicyDnfPreview } from "../components/admin/RowPolicyDnfPreview";
import { RoleRowPolicyPanel } from "../components/RoleRowPolicyPanel";

/**
 * Lucy v0.25 — L25-14 R2 / R5 admin UX (§3.2, §3.5, §6.1).
 *
 * - the final-row preview keeps the OR-of-AND structure (never flattened);
 * - 「行权限：全部行」 is only claimed when the preview really succeeded;
 * - an unavailable catalog shows the operations-side reason instead.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RowPolicyDnfPreview — the DNF shape", () => {
  it("shows the union as two OR branches, never flattened into one AND", () => {
    render(
      <RowPolicyDnfPreview
        effectiveRowGrant={{
          kind: "scoped",
          digest: "d1",
          orArms: [
            [{ field: "region", op: "eq", value: "East" }],
            [{ field: "region", op: "eq", value: "West" }]
          ]
        }}
        roleIds={["east_role", "west_role"]}
      />
    );

    expect(screen.getByTestId("row-policy-dnf-union-arm-0")).toHaveTextContent("region 等于 East");
    expect(screen.getByTestId("row-policy-dnf-union-arm-1")).toHaveTextContent("region 等于 West");
    // The union is NOT flattened into a single AND condition.
    expect(screen.queryByText(/region 等于 East 且 region 等于 West/)).not.toBeInTheDocument();
    expect(screen.getByText(/满足以下任一分支即可/)).toBeInTheDocument();
  });

  it("shows 行权限：全部行 explicitly for an all-rows union", () => {
    render(<RowPolicyDnfPreview effectiveRowGrant={{ kind: "all" }} />);
    expect(screen.getByTestId("row-policy-dnf-union-all")).toHaveTextContent("行权限：全部行");
  });

  it("never claims 行权限：全部行 when the preview failed", () => {
    render(
      <RowPolicyDnfPreview
        effectiveRowGrant={undefined}
        unavailableReason="清单不可用（需运维处理）：resolve"
      />
    );
    expect(screen.queryByText("行权限：全部行")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-unavailable")).toHaveTextContent("清单不可用");
  });

  it("carries the fixed boundary sentence", () => {
    render(<RowPolicyDnfPreview effectiveRowGrant={{ kind: "all" }} />);
    expect(screen.getByTestId("row-policy-dnf-boundary")).toHaveTextContent(
      "多个角色的行授权取并集，并集可能比任意单个角色更宽；个人行限制在其上再收窄"
    );
  });

  it("shows the per-Agent intersection next to the union", () => {
    render(
      <RowPolicyDnfPreview
        effectiveRowGrant={{
          kind: "scoped",
          orArms: [[{ field: "region", op: "eq", value: "East" }]]
        }}
        finalRowsByAgent={[
          {
            agentId: "zhangsan",
            finalRows: {
              kind: "scoped",
              orArms: [
                [
                  { field: "region", op: "eq", value: "East" },
                  { field: "category", op: "in", values: ["Book", "Office"] }
                ]
              ]
            }
          }
        ]}
      />
    );
    expect(screen.getByTestId("row-policy-dnf-agent-zhangsan")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-agent-zhangsan-rows-arm-0")).toHaveTextContent(
      "region 等于 East 且 category 属于 Book、Office"
    );
  });
});

describe("RoleRowPolicyPanel — the third state", () => {
  function renderPanel(previewBody: unknown) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/admin/roles/preview-row-policy") {
        return new Response(JSON.stringify(previewBody));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), {
        status: 404
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <RoleRowPolicyPanel
          tables={[{ connection: "warehouse", schema: "fin", name: "fin_ledger" }]}
          onChange={() => undefined}
          roleId="analyst"
          previewRole={{ permission_model_version: 2, allow: { tools: ["lucy_query"] } }}
        />
      </QueryClientProvider>
    );
  }

  it("shows the operations-side reason instead of 全部行 when the catalog is unavailable", async () => {
    renderPanel({
      ok: true,
      data: {
        ok: false,
        candidateDigest: "c1",
        basePolicyVersion: "b1",
        tables: [
          {
            requested: { connection: "warehouse", schema: "fin", name: "fin_ledger" },
            tableKey: { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" },
            catalog: {
              status: "manifest_unavailable",
              catalogLoaded: false,
              stage: "resolve",
              reason: "manifest_unreadable"
            },
            error: {
              code: "ROW_POLICY_PREVIEW_FAILED",
              message: "row_policy_catalog_unavailable:resolve:manifest_unreadable",
              reason: "row_policy_catalog_unavailable:resolve:manifest_unreadable"
            }
          }
        ]
      }
    });

    await waitFor(() =>
      expect(screen.getByTestId("row-policy-preview-unavailable-warehouse/fin/fin_ledger")).toBeInTheDocument()
    );
    expect(screen.getByTestId("row-policy-preview-unavailable-warehouse/fin/fin_ledger")).toHaveTextContent(
      "清单不可用"
    );
    // 「全部行」 must not mask the operations-side fault.
    expect(screen.queryByText("全部行")).not.toBeInTheDocument();
  });

  it("shows 全部行 only when the preview succeeded with an all-rows union", async () => {
    renderPanel({
      ok: true,
      data: {
        ok: true,
        candidateDigest: "c1",
        basePolicyVersion: "b1",
        tables: [
          {
            requested: { connection: "warehouse", schema: "fin", name: "fin_ledger" },
            tableKey: { connectionId: "warehouse", schema: "fin", sourceName: "fin_ledger" },
            catalog: { status: "loaded", catalogLoaded: true, manifestPathDigest: "d1" },
            preview: {
              effectiveRowGrant: { kind: "all" },
              roleIds: ["analyst"],
              finalRowsByAgent: [],
              displayShape: "OR-of-AND"
            }
          }
        ]
      }
    });

    await waitFor(() => expect(screen.getByText("全部行")).toBeInTheDocument());
    expect(screen.queryByTestId("row-policy-preview-unavailable-warehouse/fin/fin_ledger")).not.toBeInTheDocument();
  });
});
