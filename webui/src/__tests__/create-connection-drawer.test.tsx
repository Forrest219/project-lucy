// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateConnectionDrawer } from "../components/CreateConnectionDrawer";

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error
  }
}));

function renderDrawer(existingIds: string[] = [], onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <CreateConnectionDrawer open onClose={onClose} existingIds={existingIds} />
    </QueryClientProvider>
  );
  return { client, onClose };
}

function fillRequiredFields(overrides: Partial<Record<string, string>> = {}) {
  const values = {
    id: "demo-mysql",
    host: "127.0.0.1",
    port: "3306",
    database: "analytics",
    username: "lucy_ro",
    password: "s3cret",
    ...overrides
  };
  fireEvent.change(screen.getByTestId("create-connection-id"), { target: { value: values.id } });
  fireEvent.change(screen.getByTestId("create-connection-host"), { target: { value: values.host } });
  fireEvent.change(screen.getByTestId("create-connection-port"), { target: { value: values.port } });
  fireEvent.change(screen.getByTestId("create-connection-database"), {
    target: { value: values.database }
  });
  fireEvent.change(screen.getByTestId("create-connection-username"), {
    target: { value: values.username }
  });
  fireEvent.change(screen.getByTestId("create-connection-password"), {
    target: { value: values.password }
  });
}

function stubFetch(handlers: Record<string, (body: unknown) => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      let body: unknown = undefined;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      const key = `${method} ${url}`;
      const handler =
        handlers[key] ??
        handlers[url] ??
        handlers[`${method} ${url.replace(/^http:\/\/[^/]+/, "")}`];
      if (!handler) {
        return new Response(
          JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: key } }),
          { status: 404 }
        );
      }
      return handler(body);
    })
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CreateConnectionDrawer", () => {
  it("blocks preview until required fields are filled", () => {
    renderDrawer();
    fireEvent.click(screen.getByTestId("create-connection-preview-btn"));
    expect(screen.getByText("连接 ID 为必填项")).toBeInTheDocument();
    expect(screen.getByText("主机为必填项")).toBeInTheDocument();
    expect(screen.getByText("数据库为必填项")).toBeInTheDocument();
    expect(screen.getByText("用户名为必填项")).toBeInTheDocument();
    expect(screen.getByText("数据库密码为必填项")).toBeInTheDocument();
  });

  it("rejects a duplicate connection id client-side", () => {
    renderDrawer(["demo-mysql"]);
    fillRequiredFields({ id: "demo-mysql" });
    fireEvent.blur(screen.getByTestId("create-connection-id"));
    expect(screen.getByText("连接 ID 已存在")).toBeInTheDocument();
  });

  it("defaults port when switching database types and switches to sqlite file mode", () => {
    renderDrawer();
    expect(screen.getByTestId("create-connection-port")).toHaveValue("3306");
    fireEvent.change(screen.getByTestId("create-connection-driver"), {
      target: { value: "postgres" }
    });
    expect(screen.getByTestId("create-connection-port")).toHaveValue("5432");

    fireEvent.change(screen.getByTestId("create-connection-driver"), {
      target: { value: "starrocks" }
    });
    expect(screen.getByTestId("create-connection-port")).toHaveValue("9030");

    fireEvent.change(screen.getByTestId("create-connection-driver"), {
      target: { value: "doris" }
    });
    expect(screen.getByTestId("create-connection-port")).toHaveValue("9030");

    fireEvent.change(screen.getByTestId("create-connection-driver"), {
      target: { value: "sqlserver" }
    });
    expect(screen.getByTestId("create-connection-port")).toHaveValue("1433");

    fireEvent.change(screen.getByTestId("create-connection-driver"), {
      target: { value: "oracle" }
    });
    expect(screen.getByTestId("create-connection-port")).toHaveValue("1521");

    fireEvent.change(screen.getByTestId("create-connection-driver"), {
      target: { value: "sqlite" }
    });
    expect(screen.queryByTestId("create-connection-host")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-connection-port")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-connection-username")).not.toBeInTheDocument();
    expect(screen.queryByTestId("create-connection-password")).not.toBeInTheDocument();
    expect(screen.getByText("数据库文件路径")).toBeInTheDocument();
  });

  it("shows dryRun preview without sending password, then confirms create", async () => {
    const bodies: unknown[] = [];
    stubFetch({
      "POST /api/connections": (body) => {
        bodies.push(body);
        const payload = body as { dryRun?: boolean; password?: string; id?: string };
        if (payload.dryRun === false) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                written: true,
                secretRelPath: ".ktx/secrets/demo-mysql-password",
                connection: {
                  id: "demo-mysql",
                  driver: "mysql",
                  schemas: [],
                  enabledTables: []
                },
                test: { status: "ok", durationMs: 12 }
              }
            })
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "@@ -0,0 +1 @@\n+  demo-mysql:\n+    password: file:.ktx/secrets/demo-mysql-password\n",
              proposedYaml: "connections:\n  demo-mysql:\n    password: file:.ktx/secrets/demo-mysql-password\n",
              secretRelPath: ".ktx/secrets/demo-mysql-password",
              connection: {
                id: "demo-mysql",
                driver: "mysql",
                schemas: [],
                enabledTables: []
              }
            }
          })
        );
      }
    });

    renderDrawer();
    fillRequiredFields();
    fireEvent.click(screen.getByTestId("create-connection-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("create-connection-confirm-btn")).toBeInTheDocument();
    });
    expect(screen.getByText(/file:\.ktx\/secrets\/demo-mysql-password/)).toBeInTheDocument();
    expect(screen.getByText(".ktx/secrets/demo-mysql-password")).toBeInTheDocument();
    expect(bodies[0]).toMatchObject({ dryRun: true, id: "demo-mysql" });
    expect(bodies[0]).not.toHaveProperty("password");

    fireEvent.click(screen.getByTestId("create-connection-confirm-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("create-connection-success")).toBeInTheDocument();
    });
    expect(bodies[1]).toMatchObject({
      dryRun: false,
      id: "demo-mysql",
      password: "s3cret"
    });
    expect(toastMocks.success).toHaveBeenCalledWith("连接已创建：demo-mysql");
  });

  it("maps CONNECTION_ALREADY_EXISTS on dryRun", async () => {
    stubFetch({
      "POST /api/connections": () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: "CONNECTION_ALREADY_EXISTS", message: "exists" }
          }),
          { status: 409 }
        )
    });

    renderDrawer();
    fillRequiredFields({ id: "other-mysql" });
    fireEvent.click(screen.getByTestId("create-connection-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("create-connection-error")).toHaveTextContent("连接 ID 已存在");
    });
    expect(toastMocks.error).toHaveBeenCalledWith("连接 ID 已存在");
    expect(screen.queryByTestId("create-connection-confirm-btn")).not.toBeInTheDocument();
  });

  it("keeps the created connection when the post-write connectivity test fails", async () => {
    stubFetch({
      "POST /api/connections": (body) => {
        if ((body as { dryRun?: boolean }).dryRun === false) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                written: true,
                secretRelPath: ".ktx/secrets/demo-mysql-password",
                connection: {
                  id: "demo-mysql",
                  driver: "mysql",
                  schemas: [],
                  enabledTables: []
                },
                test: { status: "error", message: "Access denied for user", durationMs: 8 }
              }
            })
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "+ demo-mysql\n",
              proposedYaml: "connections: {}\n",
              secretRelPath: ".ktx/secrets/demo-mysql-password",
              connection: {
                id: "demo-mysql",
                driver: "mysql",
                schemas: [],
                enabledTables: []
              }
            }
          })
        );
      }
    });

    renderDrawer();
    fillRequiredFields();
    fireEvent.click(screen.getByTestId("create-connection-preview-btn"));
    await waitFor(() => screen.getByTestId("create-connection-confirm-btn"));
    fireEvent.click(screen.getByTestId("create-connection-confirm-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("create-connection-success")).toBeInTheDocument();
    });
    expect(screen.getByTestId("create-connection-test-warning")).toHaveTextContent("连通测试未通过");
    expect(screen.getByTestId("create-connection-test-warning")).toHaveTextContent("配置已保存");
    expect(toastMocks.success).toHaveBeenCalledWith(
      "连接已创建：demo-mysql（连通测试未通过，配置已保存）"
    );
  });

  it("creates a sqlite connection with file-based inputs", async () => {
    const bodies: unknown[] = [];
    stubFetch({
      "POST /api/connections": (body) => {
        bodies.push(body);
        const payload = body as { dryRun?: boolean; id?: string };
        if (payload.dryRun === false) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                written: true,
                connection: {
                  id: "local-sqlite",
                  driver: "sqlite",
                  database: "data/my.sqlite",
                  schemas: [],
                  enabledTables: []
                },
                test: { status: "ok", durationMs: 5 }
              }
            })
          );
        }
        return new Response(
          JSON.stringify({
            ok: true,
            data: {
              diff: "+  local-sqlite:\n+    driver: sqlite\n",
              proposedYaml: "connections:\n  local-sqlite:\n    driver: sqlite\n",
              connection: {
                id: "local-sqlite",
                driver: "sqlite",
                database: "data/my.sqlite",
                schemas: [],
                enabledTables: []
              }
            }
          })
        );
      }
    });

    renderDrawer();
    fireEvent.change(screen.getByTestId("create-connection-id"), {
      target: { value: "local-sqlite" }
    });
    fireEvent.change(screen.getByTestId("create-connection-driver"), {
      target: { value: "sqlite" }
    });
    fireEvent.change(screen.getByTestId("create-connection-database"), {
      target: { value: "data/my.sqlite" }
    });
    fireEvent.click(screen.getByTestId("create-connection-preview-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("create-connection-confirm-btn")).toBeInTheDocument();
    });
    expect(bodies[0]).toMatchObject({
      dryRun: true,
      id: "local-sqlite",
      driver: "sqlite",
      database: "data/my.sqlite"
    });
    expect(bodies[0]).not.toHaveProperty("host");
    expect(bodies[0]).not.toHaveProperty("password");

    fireEvent.click(screen.getByTestId("create-connection-confirm-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("create-connection-success")).toBeInTheDocument();
    });
    expect(toastMocks.success).toHaveBeenCalledWith("连接已创建：local-sqlite");
  });
});

function previewPayload() {
  return new Response(
    JSON.stringify({
      ok: true,
      data: {
        diff: "@@ -0,0 +1 @@\n+  demo-mysql:\n+    password: file:.ktx/secrets/demo-mysql-password\n",
        proposedYaml: "connections:\n  demo-mysql:\n    password: file:.ktx/secrets/demo-mysql-password\n",
        secretRelPath: ".ktx/secrets/demo-mysql-password",
        connection: {
          id: "demo-mysql",
          driver: "mysql",
          schemas: [],
          enabledTables: []
        }
      }
    })
  );
}

describe("CreateConnectionDrawer UX", () => {
  it("shows human-readable id rules instead of a raw regex", () => {
    renderDrawer();
    expect(screen.getByText("小写字母开头，仅小写字母、数字、下划线和短横线，2–64 个字符")).toBeInTheDocument();
    expect(screen.queryByText(/\^\[a-z\]/)).not.toBeInTheDocument();
    expect(screen.getByText("连接标识 (ID)")).toBeInTheDocument();
    expect(screen.getByText("数据库类型")).toBeInTheDocument();
    expect(screen.getByText("主机")).toBeInTheDocument();
    expect(screen.getByText("数据库")).toBeInTheDocument();
    expect(screen.getByText("用户名")).toBeInTheDocument();
    expect(screen.getByText("数据库密码")).toBeInTheDocument();
    expect(screen.getByText(/连接时使用的默认数据库名称/)).toBeInTheDocument();
    expect(screen.getByTestId("create-connection-secret-banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
    expect(screen.getByTestId("create-connection-advanced")).not.toHaveAttribute("open");
  });

  it("toggles password visibility", () => {
    renderDrawer();
    const input = screen.getByTestId("create-connection-password");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByTestId("create-connection-password-toggle"));
    expect(input).toHaveAttribute("type", "text");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderDrawer([], onClose);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks preview after failed probe until override is checked", async () => {
    stubFetch({
      "POST /api/connections/probe": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { status: "error", message: "Access denied" }
          })
        )
    });

    renderDrawer();
    fillRequiredFields();
    fireEvent.click(screen.getByTestId("create-connection-test-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("create-connection-probe-result")).toHaveTextContent("连接失败");
    });
    expect(screen.getByTestId("create-connection-preview-btn")).toBeDisabled();
    fireEvent.click(screen.getByTestId("create-connection-probe-override"));
    expect(screen.getByTestId("create-connection-preview-btn")).not.toBeDisabled();
  });

  it("lets preview proceed after failed probe when override is checked", async () => {
    const bodies: unknown[] = [];
    stubFetch({
      "POST /api/connections/probe": () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { status: "error", message: "Access denied" }
          })
        ),
      "POST /api/connections": (body) => {
        bodies.push(body);
        return previewPayload();
      }
    });

    renderDrawer();
    fillRequiredFields();
    fireEvent.click(screen.getByTestId("create-connection-test-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("create-connection-probe-result")).toHaveTextContent("连接失败");
    });
    fireEvent.click(screen.getByTestId("create-connection-probe-override"));
    fireEvent.click(screen.getByTestId("create-connection-preview-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("create-connection-confirm-btn")).toBeInTheDocument();
    });
    expect(bodies[0]).toMatchObject({ dryRun: true, id: "demo-mysql" });
    expect(bodies[0]).not.toHaveProperty("password");
  });

  it("keeps paired fields on a shared 3-row subgrid", () => {
    renderDrawer();
    const pair = screen.getByTestId("create-connection-username").closest(
      ".pl-connection-field-pair"
    );
    expect(pair).not.toBeNull();
    expect(pair?.querySelectorAll(":scope > .pl-connection-field--pair")).toHaveLength(2);
    const userField = screen.getByTestId("create-connection-username").closest(
      ".pl-connection-field--pair"
    );
    expect(userField?.querySelector(".pl-connection-field-message")).toBeInTheDocument();
  });

  it("reserves a message row even when username has no hint", () => {
    renderDrawer();
    const userField = screen.getByTestId("create-connection-username").closest("label");
    const passField = screen.getByTestId("create-connection-password").closest("label");
    expect(userField?.querySelector(".pl-connection-field-message")?.textContent ?? "").toBe("");
    expect(passField?.querySelector(".pl-connection-field-message")?.textContent).toContain(
      "仅本次提交使用"
    );
  });

  it("uses subgrid for connection field pairs", () => {
    const css = readFileSync("src/app/app.css", "utf8");
    expect(css).toMatch(
      /\.pl-connection-field-pair\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+auto/s
    );
    expect(css).toMatch(/\.pl-connection-field--pair\s*\{[^}]*grid-template-rows:\s*subgrid/s);
  });
});
