// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/**
 * 呈现修订：可选 prop 的合同（Spec §5.4 / D9 / D10）。
 *
 * 每一个可选 prop 都有默认值，默认行为与今天完全一样——角色编辑页不传这些
 * prop，它的预览不能少任何东西。
 */
describe("RowPolicyDnfPreview — 可选 prop（呈现修订 Spec §5.4）", () => {
  /** The order of the test ids inside the preview — the reading order. */
  function previewOrder(): string[] {
    return Array.from(
      screen.getByTestId("row-policy-dnf-preview").querySelectorAll("[data-testid]")
    ).map((node) => node.getAttribute("data-testid") ?? "");
  }

  const TWO_ARMS = {
    kind: "scoped" as const,
    orArms: [
      [{ field: "region", op: "eq" as const, value: "East" }],
      [{ field: "region", op: "eq" as const, value: "West" }]
    ]
  };

  it("默认：边界句在上、没有中间插槽、Agent 不折叠", () => {
    render(
      <RowPolicyDnfPreview
        effectiveRowGrant={TWO_ARMS}
        finalRowsByAgent={[{ agentId: "agent_a", finalRows: { kind: "all" } }]}
      />
    );
    const order = previewOrder();
    expect(order.indexOf("row-policy-dnf-boundary")).toBeLessThan(
      order.indexOf("row-policy-dnf-union-section")
    );
    // 没有中间插槽，也没有统一 Agent 句。
    expect(screen.queryByTestId("row-policy-view-agent-uniform")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-policy-view-agent-expand")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-agent-agent_a")).toBeInTheDocument();
  });

  it("footnote + children：结论 → 边界句 → 中间插槽 → Agent", () => {
    render(
      <RowPolicyDnfPreview
        effectiveRowGrant={{ kind: "all" }}
        boundaryPlacement="footnote"
        finalRowsByAgent={[{ agentId: "agent_a", finalRows: { kind: "all" } }]}
      >
        <section data-testid="role-groups">角色分组</section>
      </RowPolicyDnfPreview>
    );
    const order = previewOrder();
    expect(order.indexOf("row-policy-dnf-union-section")).toBeLessThan(
      order.indexOf("row-policy-dnf-boundary")
    );
    expect(order.indexOf("row-policy-dnf-boundary")).toBeLessThan(order.indexOf("role-groups"));
    expect(order.indexOf("role-groups")).toBeLessThan(
      order.indexOf("row-policy-dnf-agents-section")
    );
  });

  it("collapseUniformAllRows：全体都是全部行时先给一句统一结论，展开后逐个渲染", () => {
    render(
      <RowPolicyDnfPreview
        collapseUniformAllRows
        finalRowsByAgent={[
          { agentId: "agent_a", finalRows: { kind: "all" } },
          { agentId: "agent_b", finalRows: { kind: "all" } }
        ]}
      />
    );
    expect(screen.getByTestId("row-policy-view-agent-uniform")).toHaveTextContent(
      "这 2 个 Agent 的最终行约束都是行权限：全部行。"
    );
    expect(screen.queryByTestId("row-policy-dnf-agent-agent_a")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("row-policy-view-agent-expand"));
    expect(screen.getByTestId("row-policy-dnf-agent-agent_a")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-agent-agent_b")).toBeInTheDocument();
  });

  it("collapseUniformAllRows：有一个受限 Agent 时不折叠", () => {
    render(
      <RowPolicyDnfPreview
        collapseUniformAllRows
        finalRowsByAgent={[
          { agentId: "agent_a", finalRows: { kind: "all" } },
          { agentId: "agent_b", finalRows: { kind: "scoped", orArms: [[{ field: "region", op: "eq", value: "East" }]] } }
        ]}
      />
    );
    expect(screen.queryByTestId("row-policy-view-agent-uniform")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-agent-agent_a")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-dnf-agent-agent_b")).toBeInTheDocument();
  });

  it("predicateLayout=stacked：一支一块，支间看得见「或」；默认仍是今天的单行", () => {
    const { unmount } = render(
      <RowPolicyDnfPreview predicateLayout="stacked" effectiveRowGrant={TWO_ARMS} />
    );
    expect(screen.getByTestId("row-policy-dnf-union-arm-0")).toHaveTextContent("region 等于 East");
    expect(screen.getByTestId("row-policy-dnf-union-arm-1")).toHaveTextContent("region 等于 West");
    expect(screen.getByText("或")).toBeInTheDocument();
    unmount();

    render(<RowPolicyDnfPreview effectiveRowGrant={TWO_ARMS} />);
    expect(screen.getByTestId("row-policy-dnf-union-arm-0")).toHaveTextContent("region 等于 East");
    expect(screen.queryByText("或")).not.toBeInTheDocument();
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
