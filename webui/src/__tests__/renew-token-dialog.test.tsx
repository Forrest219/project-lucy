// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { RenewTokenDialog } from "../components/admin/RenewTokenDialog";
import { Tokens } from "../pages/admin/Tokens";
import { ConfigAudit } from "../pages/admin/ConfigAudit";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() }
}));

function presetDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function renderDialog(onSuccess = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RenewTokenDialog userId="zhangsan" label="hermes-laptop" onClose={vi.fn()} onSuccess={onSuccess} />
    </QueryClientProvider>
  );
  return onSuccess;
}

const inventory = {
  tokens: [
    {
      hashPrefix: "sha256:aaaa0000",
      label: "hermes-laptop",
      created: "2026-06-18",
      expires_at: presetDate(20),
      device_name: "desk",
      agent: { id: "zhangsan", name: "张三", enabled: true, roles: [] },
      status: "available" as const
    }
  ],
  stats: {
    totalTokens: 1,
    availableTokens: 1,
    activeLast7dTokens: 0,
    expiringSoonTokens: 1,
    expiredTokens: 0
  }
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("token renewal UI", () => {
  it("SC-18 opens on today+365 with only the 365d preset active", () => {
    renderDialog();
    expect(screen.getByTestId("renew-token-expiry")).toHaveValue(presetDate(365));
    expect(screen.getByTestId("renew-token-expiry-preset-365d")).toHaveClass("pl-segmented-control-item--active");
    for (const id of ["30d", "90d", "180d"]) {
      expect(screen.getByTestId(`renew-token-expiry-preset-${id}`)).not.toHaveClass(
        "pl-segmented-control-item--active"
      );
    }
    fireEvent.change(screen.getByTestId("renew-token-expiry"), { target: { value: presetDate(12) } });
    for (const id of ["30d", "90d", "180d", "365d"]) {
      expect(screen.getByTestId(`renew-token-expiry-preset-${id}`)).not.toHaveClass(
        "pl-segmented-control-item--active"
      );
    }
  });

  it("SC-19 refreshes the list and the success toast has no plaintext", async () => {
    const fetches: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        fetches.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/renew")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                written: true,
                label: "hermes-laptop",
                expires_at: presetDate(365),
                runtimeAck: true
              }
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ ok: true, data: inventory }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Tokens />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(await screen.findByTestId("token-renew-hermes-laptop")).toBeInTheDocument();
    const getsBefore = fetches.filter((line) => line.startsWith("GET")).length;
    fireEvent.click(screen.getByTestId("token-renew-hermes-laptop"));
    fireEvent.click(screen.getByTestId("renew-token-confirm"));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalled();
    });
    const message = String(vi.mocked(toast.success).mock.calls[0]?.[0]);
    expect(message).toContain("已续期至");
    expect(message).not.toMatch(/[0-9a-f]{64}/);
    await waitFor(() => {
      expect(fetches.filter((line) => line.startsWith("GET")).length).toBeGreaterThan(getsBefore);
    });
  });

  it("SC-20 says to renew or rotate before the 30-day mark", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, data: inventory }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Tokens />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(await screen.findByText("需关注续期或换签")).toBeInTheDocument();
    const helpButton = screen.getByTestId("metric-help-kpi-expiring-tokens");
    fireEvent.focus(helpButton);
    fireEvent.mouseOver(helpButton);
    const help = await screen.findByRole("tooltip");
    expect(help.textContent).toMatch(/续期或换签/);
  });

  it("SC-21 does not toast success when renew fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "RUNTIME_ACK_FAILED",
              message: "runtime ack failed",
              detail: { expires_at: presetDate(365), runtimeAck: false }
            }
          }),
          { status: 503, headers: { "content-type": "application/json" } }
        )
      )
    );
    renderDialog();
    fireEvent.click(screen.getByTestId("renew-token-confirm"));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("SC-13 offers 续期 Token in the config audit filter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { total: 0, actorMode: "single_local_admin", entries: [] }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ConfigAudit />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const changeType = await screen.findByTestId("config-audit-change-type");
    expect(changeType).toHaveTextContent("续期 Token");
  });
});
