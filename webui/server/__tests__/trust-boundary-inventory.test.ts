import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectPublishPortInventory,
  PUBLISH_PORTS,
  summarizeSqlGrants,
  tokensAreDistinct
} from "../admin/trust-boundary-inventory";

/**
 * Spec 186 (T14) — trust-boundary read-only inventory.
 *
 * These tests use the repo's real deploy/ files for the port inventory and
 * a fixture for the GRANT parser. They never read process env, real
 * credentials, or open a network connection. The `tokensAreDistinct` tests
 * assert that the function never echoes either input string.
 */

let projectRoot: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-spec-186-"));
});

afterEach(async () => {
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

// --------------------------------------------------------------------
// §2 — Helm Service / compose publish ports must NOT include 7878.
// --------------------------------------------------------------------

describe("collectPublishPortInventory — repo files (§2)", () => {
  it("scans the real deploy/ tree; published ports are webui/mcp only, no 7878", async () => {
    const inventory = await collectPublishPortInventory();
    // All four expected sources must have been scanned.
    expect(inventory.sources).toEqual(
      expect.arrayContaining([
        "deploy/k8s/helm/lucy/templates/service.yaml",
        "deploy/k8s/helm/lucy/values.yaml",
        "deploy/k8s/helm/lucy/templates/_helpers.tpl",
        "deploy/compose/docker-compose.demo.yml"
      ])
    );

    // The T14 invariant: 7878 must never appear in a customer-facing position.
    expect(inventory.forbiddenPublishedHits).toEqual([]);

    // 7878 IS allowed in container-internal positions; capture its footprint.
    const internal = inventory.internalUpstreamPorts.filter((e) => e.port === 7878);
    expect(internal.length).toBeGreaterThanOrEqual(1);
    expect(internal.some((e) => e.origin === "compose-internal-env" && e.path.endsWith("docker-compose.demo.yml"))).toBe(true);
    expect(internal.some((e) => e.origin === "helm-internal-helper" && e.path.endsWith("_helpers.tpl"))).toBe(true);

    // Customer entry published ports = WebUI (5174) and MCP (7879) only.
    const publishPorts = inventory.publishedPorts.map((e) => e.port);
    expect(publishPorts).toContain(PUBLISH_PORTS.webui);
    expect(publishPorts).toContain(PUBLISH_PORTS.mcp);
    expect(publishPorts).not.toContain(PUBLISH_PORTS.internalUpstream);

    // And 5174 / 7879 are only present in published positions, never pod-internal.
    for (const port of [PUBLISH_PORTS.webui, PUBLISH_PORTS.mcp]) {
      expect(
        inventory.publishedPorts.some((e) => e.port === port && e.scope === "published")
      ).toBe(true);
    }
  });

  it("flags a manually crafted publish entry that exposes 7878 (negative case)", async () => {
    // Build a minimal deploy/ tree in tmp so we can prove the negative path.
    await mkdir(path.join(projectRoot, "deploy", "k8s", "helm", "lucy", "templates"), { recursive: true });
    await mkdir(path.join(projectRoot, "deploy", "compose"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "deploy", "k8s", "helm", "lucy", "templates", "service.yaml"),
      [
        "spec:",
        "  ports:",
        "    - name: webui",
        "      port: 5174",
        "      targetPort: webui",
        "    - name: mcp",
        "      port: 7879",
        "      targetPort: mcp",
        "    - name: leaked_upstream",
        "      port: 7878",
        "      targetPort: mcp",
        ""
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, "deploy", "k8s", "helm", "lucy", "values.yaml"),
      "containerPorts:\n  webui: 5174\n  mcp: 7879\nservice:\n  webuiPort: 5174\n  mcpPort: 7879\n",
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, "deploy", "k8s", "helm", "lucy", "templates", "_helpers.tpl"),
      "upstream 7878",
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, "deploy", "compose", "docker-compose.demo.yml"),
      [
        "services:",
        "  lucy:",
        "    ports:",
        '      - "${LUCY_DEMO_WEBUI_HOST_PORT:-55176}:5174"',
        '      - "${LUCY_DEMO_PROXY_HOST_PORT:-57881}:7879"',
        '      - "${LUCY_DEMO_LEAK_HOST_PORT:-78789}:7878"',
        ""
      ].join("\n"),
      "utf8"
    );

    const inventory = await collectPublishPortInventory({ root: projectRoot });
    expect(inventory.warnings).toEqual([]);
    expect(inventory.forbiddenPublishedHits.length).toBe(2);
    const ports = inventory.forbiddenPublishedHits.map((e) => e.port);
    expect(ports).toEqual([7878, 7878]);
    expect(
      inventory.forbiddenPublishedHits.some((e) => e.origin === "helm-service")
    ).toBe(true);
    expect(
      inventory.forbiddenPublishedHits.some((e) => e.origin === "compose-publish")
    ).toBe(true);
  });

  it("tolerates a missing source file with a warning instead of throwing", async () => {
    // Only provide the Helm Service template; everything else is missing.
    await mkdir(path.join(projectRoot, "deploy", "k8s", "helm", "lucy", "templates"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "deploy", "k8s", "helm", "lucy", "templates", "service.yaml"),
      "spec:\n  ports:\n    - name: webui\n      port: 5174\n      targetPort: webui\n",
      "utf8"
    );
    const inventory = await collectPublishPortInventory({ root: projectRoot });
    expect(inventory.warnings.some((w) => w.startsWith("missing_file:"))).toBe(true);
    expect(inventory.forbiddenPublishedHits).toEqual([]);
  });
});

// --------------------------------------------------------------------
// §3 — Token distinctness (never echoes the input).
// --------------------------------------------------------------------

describe("tokensAreDistinct (§3)", () => {
  it("returns distinct:true for two different non-empty tokens and never echoes the inputs", () => {
    const result = tokensAreDistinct("client-token-abcdef0123456789", "internal-token-fedcba9876543210");
    expect(result).toEqual({ distinct: true });
    expect(JSON.stringify(result)).not.toContain("client-token");
    expect(JSON.stringify(result)).not.toContain("internal-token");
  });

  it("returns distinct:false when the two tokens are equal and never echoes the value", () => {
    const shared = "shared-secret-xxxxxxxxxxxxxxxxx";
    const result = tokensAreDistinct(shared, shared);
    expect(result).toEqual({ distinct: false });
    expect(JSON.stringify(result)).not.toContain(shared);
  });

  it("returns distinct:false for empty strings on either side", () => {
    expect(tokensAreDistinct("", "non-empty-token")).toEqual({ distinct: false });
    expect(tokensAreDistinct("non-empty-token", "")).toEqual({ distinct: false });
    expect(tokensAreDistinct("", "")).toEqual({ distinct: false });
  });

  it("treats non-string inputs as empty (never throws, never echoes)", () => {
    // The function must not throw on accidental non-string input, and must
    // not include the input back in any error / return value.
    const result = tokensAreDistinct(undefined, null as unknown as string);
    expect(result).toEqual({ distinct: false });
    expect(JSON.stringify(result)).not.toContain("undefined");
    expect(JSON.stringify(result)).not.toContain("null");
  });
});

// --------------------------------------------------------------------
// §4 — SHOW GRANTS fixture parser (no DB connection).
// --------------------------------------------------------------------

describe("summarizeSqlGrants (§4)", () => {
  it("lists per-account statements for the fixture from the spec demo compose", () => {
    const fixture = [
      "Grants for lucy@%",
      "GRANT USAGE ON *.* TO `lucy`@`%`",
      "GRANT SELECT, INSERT ON `dataforai`.`fin_ledger` TO `lucy`@`%`",
      "",
      "Grants for root@%",
      "GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION",
      ""
    ].join("\n");

    const summary = summarizeSqlGrants(fixture);
    expect(summary.warnings).toEqual([]);
    expect(summary.entries.map((e) => e.user)).toEqual(["lucy@%", "root@%"]);
    expect(summary.entries[0]?.statements).toEqual([
      "GRANT USAGE ON *.* TO `lucy`@`%`",
      "GRANT SELECT, INSERT ON `dataforai`.`fin_ledger` TO `lucy`@`%`"
    ]);
    expect(summary.entries[1]?.statements).toEqual([
      "GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION"
    ]);
  });

  it("returns an empty list for empty / whitespace input", () => {
    expect(summarizeSqlGrants("")).toEqual({ entries: [], warnings: [] });
    expect(summarizeSqlGrants("   \n\n  \n")).toEqual({ entries: [], warnings: [] });
    expect(summarizeSqlGrants(null as unknown as string)).toEqual({ entries: [], warnings: [] });
  });

  it("records an orphan_grant_line warning when a GRANT line has no preceding header", () => {
    const fixture = "GRANT SELECT ON db.* TO `orphan`@`%`\n";
    const summary = summarizeSqlGrants(fixture);
    expect(summary.warnings).toContain("orphan_grant_line");
    expect(summary.entries).toEqual([]);
  });
});
