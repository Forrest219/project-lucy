import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

const TABLES = [
  "ai_intl_ad_daily",
  "ai_intl_country_daily",
  "ai_intl_retention_daily",
  "ai_intl_user_active_30d_uv_daily",
];

async function installSetupApi(page: Page) {
  const writes: Array<{ path: string; method: string; body: unknown }> = [];
    let created = false;
    let manifestUploaded = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    let body: unknown = undefined;
    try { body = request.postDataJSON(); } catch { /* no body */ }
    if (method !== "GET") writes.push({ path: url.pathname, method, body });

    if (url.pathname === "/api/connections" && method === "GET") {
      await route.fulfill({ json: { ok: true, data: { connections: [] } } }); return;
    }
    if (url.pathname === "/api/connections/probe" && method === "POST") {
      await route.fulfill({ json: { ok: true, data: { status: "ok", latencyMs: 12 } } }); return;
    }
    if (url.pathname === "/api/connections" && method === "POST") {
      created = true;
      await route.fulfill({ json: { ok: true, data: {
        connection: { id: "e2e-chatbi", schemas: ["chatbi"], enabledTables: [] },
        test: { status: "ok", latencyMs: 12 },
      } } }); return;
    }
    if (url.pathname === "/api/catalog/assets/validate" && method === "POST") {
      await route.fulfill({ json: { ok: true, data: {
        valid: true,
        connectionId: "e2e-chatbi",
        schema: "chatbi",
        assetKind: "schema_manifest",
        assetType: "schemaManifest",
        targetPath: "semantic-layer/e2e-chatbi/_schema/chatbi.yaml",
        exists: false,
        originalFilename: "chatbi.yaml",
        sizeBytes: 64,
        sha256: "abc",
        tables: 4,
        tableNames: ["ai_intl_ad_daily"],
        warnings: [],
        errors: [],
      } } }); return;
    }
    if (url.pathname === "/api/catalog/assets/upload" && method === "POST") {
      await route.fulfill({ json: { ok: true, data: {
        uploaded: true,
        validation: {
          valid: true,
          tables: 4,
          exists: false,
          errors: [],
          warnings: [],
          tableNames: ["ai_intl_ad_daily"],
          targetPath: "semantic-layer/e2e-chatbi/_schema/chatbi.yaml",
          sizeBytes: 64,
        },
        record: { tables: 4, targetPath: "semantic-layer/e2e-chatbi/_schema/chatbi.yaml" },
        reload: { id: "reload-1", status: "success" },
      } } });
      manifestUploaded = true;
      return;
    }
    if (url.pathname === "/api/sources" && method === "GET") {
      await route.fulfill({ json: { ok: true, data: manifestUploaded ? {
        manifestSchemas: [{ conn: "e2e-chatbi", schema: "chatbi", filePath: "semantic-layer/e2e-chatbi/_schema/chatbi.yaml", tableCount: 4, mtime: "2026-09-27T00:00:00Z" }],
        tables: TABLES.map((table) => ({
          conn: "e2e-chatbi", schema: "chatbi", table,
          qualifiedName: `chatbi.${table}`, filePath: `semantic-layer/e2e-chatbi/chatbi/${table}.yaml`,
          columnCount: 4, columnNames: ["event_date", "country", "platform", "value"],
          hasTableDesc: true, hasGrain: true, measureCount: 1, joinCount: 0, wikiRefCount: 1,
          completion: "complete", mtime: "2026-09-27T00:00:00Z", enabled: false,
          authorizedAgentCount: 0, semanticUpdatedAt: "2026-09-27T00:00:00Z", semanticUpdatedAtSource: "manifest",
        })),
      } : { manifestSchemas: [], tables: [] } } }); return;
    }
    if (url.pathname === "/api/connections/e2e-chatbi/enabled-tables" && method === "PUT") {
      await route.fulfill({ json: { ok: true, data: { ok: true } } }); return;
    }
    if (url.pathname === "/api/wiki" && method === "POST") {
      await route.fulfill({ json: { ok: true, data: { ok: true } } }); return;
    }
    if (url.pathname === "/api/project" && method === "GET") {
      await route.fulfill({ json: { ok: true, data: {
        mcpEndpoint: { url: "https://lucy.example.test/mcp", status: "configured", source: "env", configured: true, diagnostics: [] },
        connections: created
          ? [{ id: "e2e-chatbi", schemas: ["chatbi"], enabledTables: TABLES.map((table) => `chatbi.${table}`) }]
          : [],
      } } }); return;
    }
    if (url.pathname === "/api/admin/mcp-runtime/status" && method === "GET") {
      await route.fulfill({ json: { ok: true, data: {
        endpoint: { upstreamHost: "127.0.0.1", upstreamPort: 7879 },
        config: { projectRoot: "/tmp/lucy-e2e-fixture", ktxYamlDigest: "cfg", connectionIds: ["e2e-chatbi"], updatedAt: "2026-09-27T00:00:00Z" },
        catalog: { connectionIds: ["e2e-chatbi"], lastByConnection: { "e2e-chatbi": { id: "reload-1", status: "success", finishedAt: "2026-09-27T00:00:00Z" } } },
        policy: { policyVersion: "1", degradedGlobal: false, degradedAgents: [], accessConfigDigest: "acl", sourceMapVersion: "1", healthy: true },
        execution: { status: "ok", loadedConnectionIds: ["e2e-chatbi"], lastCheckedAt: "2026-09-27T00:00:00Z", missingConnections: [] },
      } } }); return;
    }
    if (url.pathname === "/api/connections/e2e-chatbi/test" && method === "POST") {
      await route.fulfill({ json: { ok: true, data: { status: "ok", latencyMs: 9 } } }); return;
    }
    if (url.pathname === "/api/admin/agents" && method === "GET") {
      await route.fulfill({ json: { ok: true, data: { agents: [
        { id: "journey-agent", name: "Journey Agent", enabled: true, role: "analyst", roles: ["analyst"], tokens: [] },
      ] } } }); return;
    }
    if (url.pathname === "/api/admin/agents/journey-agent/tokens" && method === "POST") {
      await route.fulfill({ json: { ok: true, data: { token: "lucy_test_redacted_token", label: "journey", created: "2026-09-27", expires_at: "2026-10-27" } } }); return;
    }
    await route.fulfill({
      status: 404,
      json: { ok: false, error: { code: "NOT_FOUND", message: `Route ${method} ${url.pathname} not found` } },
    });
  });
  return writes;
}

test.describe("@pr-smoke Setup Assistant golden path", () => {
  test("runs all six steps and persists the four-table scope", async ({ page }) => {
    const writes = await installSetupApi(page);
    await page.goto("/connections");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("start-onboarding-assistant-btn").click();
    await expect(page.getByTestId("setup-step-1")).toBeVisible();
    await page.waitForTimeout(100);

    for (const [index, [testId, value]] of [
      ["setup-host", "db.example.test"],
      ["setup-database", "chatbi"],
      ["setup-schema", "chatbi"],
      ["setup-username", "readonly"],
      ["setup-password", "not-recorded"],
    ].entries()) {
      await page.getByTestId(testId).click();
      // The dialog deliberately moves focus to its heading after opening. The
      // leading sentinel proves the focus hand-off completed without losing
      // any real credential character.
      if (index === 0) await page.getByTestId(testId).pressSequentially(`x${value}`);
      else await page.getByTestId(testId).fill(value);
      await expect(page.getByTestId(testId)).toHaveValue(value);
    }
    await expect(page.getByTestId("setup-probe-btn")).toBeEnabled();
    await page.getByTestId("setup-probe-btn").click();
    await expect(page.getByText(/连通测试成功/)).toBeVisible();
    await page.getByTestId("setup-conn-id").fill("e2e-chatbi");
    await expect(page.getByTestId("setup-conn-id")).toHaveValue("e2e-chatbi");
    await expect(page.getByTestId("setup-step1-next")).toBeEnabled();
    await page.getByTestId("setup-step1-next").click();

    await expect(page.getByTestId("setup-step-2")).toBeVisible();
    await page.getByTestId("setup-manifest-file-input").setInputFiles({
      name: "chatbi.yaml", mimeType: "application/yaml",
      buffer: Buffer.from("version: 1\nschema: chatbi\ntables:\n  - name: ai_intl_ad_daily\n"),
    });
    await expect(page.getByTestId("setup-step2-next")).toBeEnabled();
    await page.getByTestId("setup-step2-next").click();

    await expect(page.getByTestId("setup-manifest-parsed-count")).toContainText("已解析 4 张表");
    await expect(page.getByTestId("setup-step-3")).toBeVisible();
    const upload = writes.find((item) => item.path === "/api/catalog/assets/upload");
    expect(upload?.body).toMatchObject({
      connectionId: "e2e-chatbi",
      schema: "chatbi",
      assetKind: "schema_manifest",
      filename: "chatbi.yaml",
    });
    expect(JSON.stringify(upload?.body)).toContain("ai_intl_ad_daily");
    expect(writes.some((item) => item.path === "/api/catalog/assets" && item.method === "POST")).toBe(false);
    for (const table of TABLES) {
      await expect(page.getByTestId(`setup-table-item-chatbi.${table}`)).toHaveAttribute("aria-pressed", "false");
    }
    await page.getByTestId("setup-select-all").click();
    for (const table of TABLES) {
      await expect(page.getByTestId(`setup-table-item-chatbi.${table}`)).toHaveAttribute("aria-pressed", "true");
    }
    await page.getByTestId("setup-step3-next").click();

    await expect(page.getByTestId("setup-step-4")).toBeVisible();
    await page.getByRole("button", { name: "← 上一步" }).click();
    await expect(page.getByTestId("setup-step-3")).toBeVisible();
    await page.getByTestId("setup-step3-next").click();
    await page.getByTestId("setup-step4-next").click();

    await expect(page.getByTestId("setup-step-5")).toBeVisible();
    await page.getByTestId("setup-wiki-file-input").setInputFiles({
      name: "metrics.md", mimeType: "text/markdown",
      buffer: Buffer.from("# AF 归因覆盖率\n用于用户旅程 E2E。\n"),
    });
    await expect(page.getByTestId("setup-step5-next")).toBeEnabled();
    await page.getByTestId("setup-step5-next").click();

    await expect(page.getByTestId("setup-step-6")).toBeVisible();
    await expect(page.getByTestId("setup-readiness-summary")).toContainText(/已就绪|可以/);
    await expect(page.getByTestId("setup-mcp-config-snippet")).toContainText("https://lucy.example.test/mcp");
    await page.getByTestId("setup-finish-btn").click();
    await expect(page.getByTestId("setup-assistant-modal")).toHaveCount(0);

    const scopeWrite = writes.find((item) => item.path.endsWith("/enabled-tables"));
    expect(scopeWrite?.body).toMatchObject({ enabledTables: TABLES.map((table) => `chatbi.${table}`), dryRun: false });
  });

  test("asks before discarding dirty connection input", async ({ page }) => {
    await installSetupApi(page);
    await page.goto("/connections");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("start-onboarding-assistant-btn").click();
    await page.getByTestId("setup-host").fill("dirty.example.test");
    await page.getByTestId("setup-modal-close-btn").click();
    await expect(page.getByTestId("setup-discard-confirm")).toBeVisible();
    await page.getByTestId("setup-discard-close").click();
    await expect(page.getByTestId("setup-assistant-modal")).toHaveCount(0);
  });
});
