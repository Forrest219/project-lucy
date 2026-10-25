// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RowPolicyTemplates } from "../pages/admin/RowPolicyTemplates";
import {
  RowPolicyTemplatePicker,
  type RowPolicyTemplateOption
} from "../components/admin/RowPolicyTemplatePicker";

vi.mock("sonner", () => ({
  toast: {
    message: vi.fn(),
    error: vi.fn(),
    success: vi.fn()
  }
}));

const SNAPSHOT = {
  identity: {
    configVersion: "cfg-1",
    policyVersion: "pol-1",
    sourceMapVersion: "sm-1",
    capabilityDigest: "cap-1"
  },
  state: "ok",
  problem: null,
  failures: []
};

const TEMPLATES = {
  snapshot: SNAPSHOT,
  state: "ok",
  templates: [
    {
      name: "by_region",
      description: "按大区限定行",
      predicates: [{ field: "region", op: "eq", value: "East" }],
      digest: "digest-region",
      references: [
        { roleId: "east_role", connectionId: "warehouse", schema: "fin", sourceNames: ["fin_ledger"] }
      ],
      usabilityByTable: [
        {
          connectionId: "warehouse",
          schema: "fin",
          sourceName: "fin_ledger",
          usability: { status: "bindable" }
        }
      ]
    },
    {
      name: "by_status",
      description: "按状态限定行",
      predicates: [{ field: "status", op: "eq", value: "SETTLED" }],
      digest: "digest-status",
      references: [],
      usabilityByTable: []
    }
  ],
  issues: []
};

const WRITE_PREVIEW = {
  dryRun: true,
  written: false,
  operationId: "op-1",
  candidateDigest: "candidate-1",
  version: "v-1",
  impact: {
    tables: [
      {
        connectionId: "warehouse",
        schema: "fin",
        sourceName: "fin_ledger",
        beforeDigest: "before",
        afterDigest: "after",
        changed: true
      }
    ],
    agents: [{ agentId: "agent_a", roleIds: ["east_role"] }],
    policyDigestBefore: "before-policy",
    policyDigestAfter: "after-policy",
    affectedRoleIds: ["east_role"]
  },
  issues: [],
  blockingReferences: []
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/row-policy-templates"]}>
        <RowPolicyTemplates />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/admin/row-policy/templates" && method === "GET") {
        return new Response(JSON.stringify({ ok: true, data: TEMPLATES }));
      }
      if (url === "/api/admin/row-policy/templates" && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if (body.dryRun === false) {
          return new Response(
            JSON.stringify({ ok: true, data: { ...WRITE_PREVIEW, dryRun: false, written: true, runtimeAck: true } })
          );
        }
        return new Response(JSON.stringify({ ok: true, data: WRITE_PREVIEW }));
      }
      if (url.startsWith("/api/admin/row-policy/templates/") && method === "DELETE") {
        return new Response(JSON.stringify({ ok: true, data: { ...WRITE_PREVIEW, blockingReferences: [] } }));
      }
      return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("行策略模板管理页", () => {
  it("列出模板的名称、说明、谓词与引用数", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("row-policy-template-table")).toBeInTheDocument());
    expect(screen.getByText("by_region")).toBeInTheDocument();
    expect(screen.getByText("按大区限定行")).toBeInTheDocument();
    expect(screen.getByTestId("row-policy-template-reference-count-by_region")).toHaveTextContent("1");
    expect(screen.getByTestId("row-policy-template-reference-count-by_status")).toHaveTextContent("0");
  });

  it("详情显示逐表可用性与引用清单", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("row-policy-template-table")).toBeInTheDocument());
    fireEvent.click(screen.getByText("by_region"));
    await waitFor(() => expect(screen.getByTestId("row-policy-template-detail")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-template-usability")).toHaveTextContent("可绑定");
    expect(screen.getByTestId("row-policy-template-references")).toHaveTextContent("east_role");
  });

  it("先预演再保存：预演之前正式保存不可用", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("row-policy-template-table")).toBeInTheDocument());
    expect(screen.getByTestId("row-policy-template-save")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("模板名"), { target: { value: "by_status" } });
    fireEvent.change(screen.getByLabelText("谓词 1 字段"), { target: { value: "status" } });
    fireEvent.change(screen.getByLabelText("谓词 1 取值"), { target: { value: "SETTLED" } });
    fireEvent.click(screen.getByTestId("row-policy-template-dry-run"));

    await waitFor(() => expect(screen.getByTestId("row-policy-template-impact")).toBeInTheDocument());
    // The impact surface is disclosed BEFORE the write.
    expect(screen.getByTestId("row-policy-template-impact-tables")).toHaveTextContent("warehouse/fin/fin_ledger");
    expect(screen.getByTestId("row-policy-template-impact")).toHaveTextContent("agent_a");
    expect(screen.getByTestId("row-policy-template-impact")).toHaveTextContent("before-policy");
    expect(screen.getByTestId("row-policy-template-audit-state")).toHaveTextContent("预演完成，待保存");
    await waitFor(() => expect(screen.getByTestId("row-policy-template-save")).toBeEnabled());
  });

  it("正式保存只在运行态确认后才显示成功", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("row-policy-template-table")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("模板名"), { target: { value: "by_status" } });
    fireEvent.change(screen.getByLabelText("谓词 1 字段"), { target: { value: "status" } });
    fireEvent.change(screen.getByLabelText("谓词 1 取值"), { target: { value: "SETTLED" } });
    fireEvent.click(screen.getByTestId("row-policy-template-dry-run"));
    await waitFor(() => expect(screen.getByTestId("row-policy-template-save")).toBeEnabled());
    fireEvent.click(screen.getByTestId("row-policy-template-save"));
    await waitFor(() =>
      expect(screen.getByTestId("row-policy-template-audit-state")).toHaveTextContent("已保存，运行态已确认")
    );
  });
});

/**
 * P2-7：草稿一变，旧预演结果就作废。
 *
 * 之前改模板名／说明／谓词都不清 `preview`，影响面板仍显示**旧候选**的影响面，
 * 「正式保存」仍可点 —— 操作员读到的是错的影响面（P1-1 §6.1 / RTP-06）。
 */
describe("模板草稿变更使旧预演失效（P2-7）", () => {
  it("改谓词后正式保存不可用，影响面板回到未预演", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("row-policy-template-table")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("模板名"), { target: { value: "by_status" } });
    fireEvent.change(screen.getByLabelText("谓词 1 字段"), { target: { value: "status" } });
    fireEvent.change(screen.getByLabelText("谓词 1 取值"), { target: { value: "SETTLED" } });
    fireEvent.click(screen.getByTestId("row-policy-template-dry-run"));
    await waitFor(() => expect(screen.getByTestId("row-policy-template-save")).toBeEnabled());
    expect(screen.getByTestId("row-policy-template-impact-tables")).toHaveTextContent("warehouse/fin/fin_ledger");

    // 草稿变了 → 旧影响面作废。
    fireEvent.change(screen.getByLabelText("谓词 1 取值"), { target: { value: "PENDING" } });
    await waitFor(() => expect(screen.getByTestId("row-policy-template-save")).toBeDisabled());
    expect(screen.getByTestId("row-policy-template-impact-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("row-policy-template-impact-tables")).not.toBeInTheDocument();
  });

  it("改模板名后正式保存不可用", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("row-policy-template-table")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("模板名"), { target: { value: "by_status" } });
    fireEvent.click(screen.getByTestId("row-policy-template-dry-run"));
    await waitFor(() => expect(screen.getByTestId("row-policy-template-save")).toBeEnabled());

    fireEvent.change(screen.getByLabelText("模板名"), { target: { value: "by_status_v2" } });
    await waitFor(() => expect(screen.getByTestId("row-policy-template-save")).toBeDisabled());
  });
});

/**
 * P2-8：删除预演的对象与实际删除的对象必须是**同一个模板**。
 */
describe("删除预演的目标一致性（P2-8）", () => {
  it("预演删除 A 后改选 B，正式删除不可用并说明原因", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("row-policy-template-table")).toBeInTheDocument());
    fireEvent.click(screen.getByText("by_region"));
    fireEvent.click(screen.getByTestId("row-policy-template-delete-dry-run"));
    await waitFor(() => expect(screen.getByTestId("row-policy-template-delete")).toBeEnabled());

    // 换成另一个模板：预演仍然有效，但删除按钮必须禁用。
    fireEvent.click(screen.getByText("by_status"));
    await waitFor(() => expect(screen.getByTestId("row-policy-template-delete")).toBeDisabled());
    const note = screen.getByTestId("row-policy-template-delete-target-mismatch");
    expect(note).toHaveTextContent("by_region");
    expect(note).toHaveTextContent("by_status");
  });

  it("删除请求指向被预演的那个模板", async () => {
    const deletes: Array<{ url: string; dryRun: boolean }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url === "/api/admin/row-policy/templates" && method === "GET") {
          return new Response(JSON.stringify({ ok: true, data: TEMPLATES }));
        }
        if (url.startsWith("/api/admin/row-policy/templates/") && method === "DELETE") {
          const body = JSON.parse(String(init?.body ?? "{}"));
          const dryRun = body.dryRun === true;
          deletes.push({ url, dryRun });
          return new Response(
            JSON.stringify({
              ok: true,
              data: { ...WRITE_PREVIEW, dryRun, written: !dryRun, runtimeAck: true }
            })
          );
        }
        return new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: url } }), { status: 404 });
      })
    );
    renderPage();
    await waitFor(() => expect(screen.getByTestId("row-policy-template-table")).toBeInTheDocument());
    fireEvent.click(screen.getByText("by_region"));
    fireEvent.click(screen.getByTestId("row-policy-template-delete-dry-run"));
    await waitFor(() => expect(screen.getByTestId("row-policy-template-delete")).toBeEnabled());

    // 中途选到别的模板：删除按钮禁用（见上一条用例）。
    fireEvent.click(screen.getByText("by_status"));
    await waitFor(() => expect(screen.getByTestId("row-policy-template-delete")).toBeDisabled());

    // 回到被预演的模板：删除请求必须指向**被预演**的那个，不是最后一次选中的。
    fireEvent.click(screen.getByText("by_region"));
    await waitFor(() => expect(screen.getByTestId("row-policy-template-delete")).toBeEnabled());
    fireEvent.click(screen.getByTestId("row-policy-template-delete"));
    await waitFor(() => expect(deletes.some((entry) => !entry.dryRun)).toBe(true));
    const formal = deletes.find((entry) => !entry.dryRun);
    expect(formal?.url).toContain("/api/admin/row-policy/templates/by_region");
    expect(deletes.every((entry) => entry.url.includes("/by_region"))).toBe(true);
  });
});

/**
 * P1-5：模板名、谓词字段、谓词取值都是标识，输入框必须受翻译防御。
 */
describe("模板编辑器的标识翻译防御（P1-5）", () => {
  it("模板名、谓词字段与谓词取值输入框带 translate=\"no\" + notranslate", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("row-policy-template-table")).toBeInTheDocument());
    for (const label of ["模板名", "谓词 1 字段", "谓词 1 取值"]) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("translate", "no");
      expect(input.className).toContain("notranslate");
    }
  });
});

describe("模板下拉（RTP-08）", () => {
  const options: RowPolicyTemplateOption[] = [
    { name: "by_region", description: "按大区限定行", usability: { status: "bindable" } },
    {
      name: "by_missing_field",
      description: "字段不存在",
      usability: { status: "field_missing", fields: ["region_code"] }
    },
    {
      name: "by_manifest",
      description: "清单不可用",
      usability: { status: "manifest_unavailable", reason: "row_policy_catalog_unavailable:resolve" }
    },
    {
      name: "by_unknown_catalog",
      description: "目录能力未知",
      usability: { status: "catalog_unknown", reason: "catalog_capability_not_proven" }
    }
  ];

  it("展示全部候选，不可绑定项禁用并给出原因", () => {
    render(
      <RowPolicyTemplatePicker templates={options} onChange={() => undefined} />
    );
    expect(screen.getByTestId("row-policy-template-option-by_region")).toBeEnabled();
    expect(screen.getByTestId("row-policy-template-option-by_missing_field")).toBeDisabled();
    expect(screen.getByTestId("row-policy-template-option-by_manifest")).toBeDisabled();
    expect(screen.getByTestId("row-policy-template-option-by_unknown_catalog")).toBeDisabled();
    // The reason is disclosed at SELECTION time, not at save time.
    expect(screen.getByTestId("row-policy-template-option-by_missing_field")).toHaveTextContent("字段不存在");
  });

  it("选中的不可绑定项会显示原因", () => {
    render(
      <RowPolicyTemplatePicker
        templates={options}
        value="by_manifest"
        onChange={() => undefined}
      />
    );
    expect(screen.getByTestId("row-policy-template-picker-reason")).toHaveTextContent("清单不可用");
  });
});
