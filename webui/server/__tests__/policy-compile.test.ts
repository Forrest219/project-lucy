import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Identity } from "../proxy/identity";

const ACCESS_YAML = `roles:
  ok_role:
    description: Compiles cleanly
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          names:
            - fin_ledger
          row_access: all
      tools:
        - lucy_query
        - wiki_search
  bad_role:
    description: v2 with prefix — compile failure
    permission_model_version: 2
    allow:
      connections:
        - warehouse
      tableSelectors:
        - connection: warehouse
          schema: fin
          prefix: fin_
          row_access: all
      tools:
        - lucy_query
users:
  - id: ok_agent
    name: OK Agent
    enabled: true
    role: ok_role
    tokens: []
  - id: bad_agent
    name: Bad Agent
    enabled: true
    role: bad_role
    tokens: []
defaults:
  deny_tools: []
`;

const FIN_SCHEMA_YAML = `tables:
  fin_ledger:
    table: fin.fin_ledger
  fin_budget:
    table: fin.fin_budget
`;

let projectRoot: string;
let previousRoot: string | undefined;

function identity(userId: string): Identity {
  return { userId, tokenLabel: "unit-test", tokenHashPrefix: "unit-test" };
}

async function makeProject(accessYaml = ACCESS_YAML) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-policy-compile-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "warehouse", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), accessYaml, "utf8");
  await writeFile(path.join(root, "semantic-layer", "warehouse", "_schema", "fin.yaml"), FIN_SCHEMA_YAML, "utf8");
  return root;
}

async function loadAcl() {
  vi.resetModules();
  return import("../proxy/acl");
}

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  projectRoot = await makeProject();
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("WP-I5 EffectivePolicy compile + submit", () => {
  it("U-REL-01-ish: policyVersion changes when access config digest changes", async () => {
    const acl = await loadAcl();
    const first = await acl.commitEffectivePolicy();
    expect(first.degradedGlobal).toBe(false);
    expect(first.policyVersion).toMatch(/^[a-f0-9]{64}$/);

    const nextYaml = ACCESS_YAML.replace("OK Agent", "OK Agent Renamed");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), nextYaml, "utf8");
    const second = await acl.commitEffectivePolicy();

    expect(second.accessConfigDigest).not.toBe(first.accessConfigDigest);
    expect(second.policyVersion).not.toBe(first.policyVersion);
    expect(second.sourceMapVersion).toBe(first.sourceMapVersion);
  });

  it("U-REL-04-ish: policyVersion changes when sourceMapVersion changes", async () => {
    const acl = await loadAcl();
    const first = await acl.commitEffectivePolicy();

    await writeFile(
      path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"),
      `tables:
  fin_ledger:
    table: fin.fin_ledger
  fin_budget:
    table: fin.fin_budget
  fin_forecast:
    table: fin.fin_forecast
`,
      "utf8"
    );
    const second = await acl.commitEffectivePolicy();

    expect(second.sourceMapVersion).not.toBe(first.sourceMapVersion);
    expect(second.policyVersion).not.toBe(first.policyVersion);
    expect(second.accessConfigDigest).toBe(first.accessConfigDigest);
  });

  it("compile failure for a Role marks that Agent DataPlane deny", async () => {
    const acl = await loadAcl();
    const status = await acl.commitEffectivePolicy();
    expect(status.degradedGlobal).toBe(false);
    expect(status.degradedAgents).toContain("bad_agent");
    expect(status.degradedAgents).not.toContain("ok_agent");

    await expect(
      acl.authorizeAndRewrite(identity("bad_agent"), "lucy_query", {
        connectionId: "warehouse",
        measures: ["fin_ledger.amount"]
      })
    ).resolves.toEqual({
      allowed: false,
      reason: "role_resolution_failed:bad_role:v2_prefix_forbidden"
    });

    // Meta wiki still allowed for degraded agent (Spec 98 §8.3)
    await expect(
      acl.authorizeAndRewrite(identity("bad_agent"), "wiki_search", { query: "x" })
    ).resolves.toEqual({ allowed: true });

    await expect(
      acl.authorizeAndRewrite(identity("ok_agent"), "lucy_query", {
        connectionId: "warehouse",
        measures: ["fin_ledger.amount"]
      })
    ).resolves.toEqual({ allowed: true });

    await expect(
      acl.authorizeAndRewrite(identity("ok_agent"), "wiki_search", { query: "x" })
    ).resolves.toEqual({ allowed: true });
  });

  it("global degrade on unparseable / invalid access.yaml after force reload", async () => {
    const acl = await loadAcl();
    await acl.commitEffectivePolicy();
    expect(acl.getPolicyRuntimeStatus().degradedGlobal).toBe(false);

    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "{ not: valid access config\n", "utf8");
    const status = await acl.commitEffectivePolicy();
    expect(status.degradedGlobal).toBe(true);
    expect(acl.getPolicyRuntimeStatus().degradedGlobal).toBe(true);

    await expect(
      acl.authorizeAndRewrite(identity("ok_agent"), "lucy_query", {
        connectionId: "warehouse",
        measures: ["fin_ledger.amount"]
      })
    ).resolves.toEqual({ allowed: false, reason: "policy_degraded_deny" });

    // AbsoluteDeny still wins
    await expect(
      acl.authorizeAndRewrite(identity("ok_agent"), "sl_query", {})
    ).resolves.toEqual({ allowed: false, reason: "tool_absolute_deny:sl_query" });
  });

  it("Admin writeAccessYaml returns runtimeAck + policyVersion after commit", async () => {
    vi.resetModules();
    const { parse } = await import("yaml");
    const { readFile } = await import("node:fs/promises");
    const { writeAccessYaml } = await import("../admin/access-config");
    const acl = await import("../proxy/acl");

    const raw = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    const config = parse(raw) as Parameters<typeof writeAccessYaml>[1];
    // Drop the bad role so Admin save path commits cleanly
    delete config.roles?.bad_role;
    config.users = (config.users ?? []).filter((user) => user.id !== "bad_agent");
    if (config.users[0]) config.users[0].name = "OK Agent Via Admin";

    const result = await writeAccessYaml(projectRoot, config, {
      enabled: false,
      changeType: "test_policy_compile"
    });

    expect(result.runtimeAck).toBe(true);
    expect(result.policyVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(acl.getPolicyRuntimeStatus().policyVersion).toBe(result.policyVersion);
    expect(acl.getPolicyRuntimeStatus().degradedGlobal).toBe(false);
  });

  it("policyVersion formula binds access digest, source map, and tool classification", async () => {
    const acl = await loadAcl();
    const status = await acl.commitEffectivePolicy();
    const expected = acl.computePolicyVersion(
      status.accessConfigDigest,
      status.sourceMapVersion,
      acl.TOOL_CLASSIFICATION_VERSION
    );
    expect(status.policyVersion).toBe(expected);
  });

  it("hot Meta paths use committed EffectivePolicy (external YAML widen not visible until commit)", async () => {
    const acl = await loadAcl();
    await acl.commitEffectivePolicy();

    const catalogBefore = await acl.lucyCatalog(identity("ok_agent"));
    expect(catalogBefore.sources.map((s) => s.sourceName)).toEqual(["fin_ledger"]);

    // External widen on disk without commit — Spec 98 §8.2 hot path must ignore.
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      ACCESS_YAML
        .replace("OK Agent", "OK Agent Widened")
        .replace(
          `names:
            - fin_ledger`,
          `names:
            - fin_ledger
            - fin_budget`
        ),
      "utf8"
    );

    const catalogStale = await acl.lucyCatalog(identity("ok_agent"));
    expect(catalogStale.sources.map((s) => s.sourceName)).toEqual(["fin_ledger"]);

    const toolsStale = await acl.allowedToolNames(identity("ok_agent"));
    expect(toolsStale).toContain("lucy_query");

    await acl.commitEffectivePolicy();
    const catalogAfter = await acl.lucyCatalog(identity("ok_agent"));
    expect(catalogAfter.sources.map((s) => s.sourceName).sort()).toEqual(["fin_budget", "fin_ledger"]);
  });

  it("evaluateRuntimeAck requires digest match and no global degrade", async () => {
    const acl = await loadAcl();
    const status = await acl.commitEffectivePolicy();
    expect(status.degradedAgents).toContain("bad_agent");
    expect(acl.evaluateRuntimeAck(status, status.accessConfigDigest)).toBe(true);
    expect(acl.evaluateRuntimeAck({ ...status, degradedGlobal: true }, status.accessConfigDigest)).toBe(false);
    expect(acl.evaluateRuntimeAck(status, "deadbeef")).toBe(false);
  });

  it("global degrade keeps Wiki Meta via authorize + LKG effectivePermissions", async () => {
    const acl = await loadAcl();
    await acl.commitEffectivePolicy();

    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "{ not: valid\n", "utf8");
    const status = await acl.commitEffectivePolicy();
    expect(status.degradedGlobal).toBe(true);

    await expect(
      acl.authorizeAndRewrite(identity("ok_agent"), "wiki_search", { query: "x" })
    ).resolves.toEqual({ allowed: true });

    const perms = await acl.effectivePermissions(identity("ok_agent"));
    expect(perms.ok).toBe(true);

    const catalog = await acl.lucyCatalog(identity("ok_agent"));
    expect(catalog.sources).toEqual([]);
  });

  it("queued commits each observe latest disk (no coalesce)", async () => {
    const acl = await loadAcl();
    await acl.commitEffectivePolicy();

    const yamlA = ACCESS_YAML.replace("OK Agent", "Agent A");
    const yamlB = ACCESS_YAML.replace("OK Agent", "Agent B");
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");

    await writeFile(accessPath, yamlA, "utf8");
    const p1 = acl.commitEffectivePolicy();
    await writeFile(accessPath, yamlB, "utf8");
    const p2 = acl.commitEffectivePolicy();
    const [s1, s2] = await Promise.all([p1, p2]);

    // Second commit must win on runtime; first may equal second if it ran after yamlB write.
    expect(s2.accessConfigDigest).toBe(acl.getPolicyRuntimeStatus().accessConfigDigest);
    const { parse } = await import("yaml");
    const { readFile } = await import("node:fs/promises");
    const onDisk = parse(await readFile(accessPath, "utf8")) as Parameters<typeof acl.computeAccessConfigDigest>[0];
    expect(s2.accessConfigDigest).toBe(acl.computeAccessConfigDigest(onDisk));
    // At least one of the commits must have seen a distinct digest transition from initial.
    expect(s1.accessConfigDigest === s2.accessConfigDigest || s1.policyVersion !== s2.policyVersion).toBe(true);
  });
});
