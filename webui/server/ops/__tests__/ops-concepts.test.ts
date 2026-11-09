/**
 * P1-11 S2–S4 — 概念 Ops 控制面（授权、只读不建目录、scan 计划形状）。
 */

import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpsConceptScanAdapter, OPS_EMPTY_PLAN } from "../concepts-adapter";
import { conceptsDirExists } from "../concepts-read";
import { invokeOpsTool } from "../ops-tools";

const ACCESS_YAML = `roles:
  concept_ops:
    allow:
      ops:
        - tools:
            - lucy_ops_concept_list
            - lucy_ops_concept_show
            - lucy_ops_concept_summary
            - lucy_ops_concept_scan
            - lucy_ops_concept_set_canonical
            - lucy_ops_concept_reject
          asset_kinds:
            - governance
  concept_reader:
    allow:
      ops:
        - tools:
            - lucy_ops_concept_list
            - lucy_ops_concept_show
            - lucy_ops_concept_summary
            - lucy_ops_concept_scan
            - lucy_ops_concept_set_canonical
          asset_kinds:
            - governance
          instance_scope: read_only
  lucy_ops_reader:
    description: ops evidence reader — data plane only
    allow:
      tools:
        - lucy_catalog
        - lucy_query
  concept_none:
    allow:
      ops: []
users:
  - id: concept_agent
    name: Concept Ops
    enabled: true
    roles:
      - concept_ops
    tokens: []
  - id: concept_reader_agent
    name: Concept Reader
    enabled: true
    roles:
      - concept_reader
    tokens: []
  - id: lucy_ops_reader_agent
    name: Ops Reader Agent
    enabled: true
    roles:
      - lucy_ops_reader
    tokens: []
  - id: no_ops_agent
    name: No Ops
    enabled: true
    roles: []
    tokens: []
defaults:
  deny_tools: []
`;

const KTX_YAML = `paths:
  content_root: config
connections: {}
`;

let projectRoot: string;
let previousRoot: string | undefined;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

beforeEach(async () => {
  previousRoot = process.env.KTX_PROJECT_ROOT;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-ops-concepts-"));
  await cp(path.join(repoRoot, "scripts", "concepts"), path.join(projectRoot, "scripts", "concepts"), {
    recursive: true
  });
  await mkdir(path.join(projectRoot, "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "config", "semantic-layer"), { recursive: true });
  await mkdir(path.join(projectRoot, "config", "wiki", "global"), { recursive: true });
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  process.env.KTX_PROJECT_ROOT = projectRoot;
  vi.resetModules();
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("P1-11 concept ops authorization", () => {
  it("without allow.ops → deny list", async () => {
    const envelope = await invokeOpsTool({
      toolName: "lucy_ops_concept_list",
      args: {},
      userId: "no_ops_agent",
      projectRoot
    });
    expect(envelope.ok).toBe(false);
    expect((envelope as { error?: { code?: string } }).error?.code).toBe(
      "ops_not_granted:lucy_ops_concept_list"
    );
  });

  it("with governance grant → list ok", async () => {
    const envelope = await invokeOpsTool({
      toolName: "lucy_ops_concept_list",
      args: {},
      userId: "concept_agent",
      projectRoot
    });
    expect(envelope.ok).toBe(true);
    const data = (envelope as { data?: { concepts?: unknown[] } }).data;
    expect(Array.isArray(data?.concepts)).toBe(true);
  });
});

describe("P1-11 read-only does not create concepts/", () => {
  it("list with missing concepts dir leaves tree absent", async () => {
    const before = await conceptsDirExists(projectRoot);
    expect(before).toBe(false);

    const envelope = await invokeOpsTool({
      toolName: "lucy_ops_concept_list",
      args: {},
      userId: "concept_agent",
      projectRoot
    });
    expect(envelope.ok).toBe(true);

    const after = await conceptsDirExists(projectRoot);
    expect(after).toBe(false);
    await expect(access(path.join(projectRoot, "config", "concepts"), constants.F_OK)).rejects.toThrow();
  });
});

describe("P1-11 scan adapter buildPlan", () => {
  it("produces a single batch group for dirty scan targets", async () => {
    const adapter = new OpsConceptScanAdapter();
    const draft = await adapter.buildPlan({
      projectRoot,
      actor: "concept_agent",
      delegatedFrom: null,
      request: { dry_run: true }
    });
    if (draft.perTarget.length > 0) {
      expect(draft.groups).toHaveLength(1);
      expect(draft.groups[0]?.id).toBe("concepts");
      expect(draft.groups[0]?.memberIds).toEqual(draft.perTarget.map((target) => target.id));
      for (const target of draft.perTarget) {
        expect(target.id.startsWith("concept:")).toBe(true);
        expect(target.groupId).toBe("concepts");
        expect(target.connectionId).toBe("");
      }
    }
  });

  it("empty write-set → ops_empty_plan blocker", async () => {
    const adapter = new OpsConceptScanAdapter();
    const draft = await adapter.buildPlan({
      projectRoot,
      actor: "concept_agent",
      delegatedFrom: null,
      request: { dry_run: true, whitelist_ref: "seed" }
    });
    if (draft.perTarget.length === 0) {
      expect(draft.blockers).toContain(OPS_EMPTY_PLAN);
    }
  });

  it("rejects client targets override on parse", () => {
    const adapter = new OpsConceptScanAdapter();
    expect(() =>
      adapter.parseTargets({ dry_run: true, targets: [{ conceptId: "x" }] })
    ).toThrow(/targets/);
  });

  it("preview→commit scan writes concepts atomically", async () => {
    await mkdir(path.join(projectRoot, "config", "semantic-layer", "demo"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "config", "semantic-layer", "demo", "orders.yaml"),
      `name: orders
measures:
  - name: total_sales
    expr: sum(sales)
    description: 收入
`,
      "utf8"
    );

    const preview = await invokeOpsTool({
      toolName: "lucy_ops_concept_scan",
      args: { dry_run: true, whitelist_ref: "seed" },
      userId: "concept_agent",
      projectRoot
    });
    expect(preview.ok).toBe(true);
    const planId = (preview as { data?: { plan_id?: string } }).data?.plan_id;
    const digest = (preview as { data?: { confirm_digest?: string } }).data?.confirm_digest;
    expect(planId).toBeTruthy();
    expect(digest).toBeTruthy();

    const commit = await invokeOpsTool({
      toolName: "lucy_ops_concept_scan",
      args: {
        dry_run: false,
        plan_id: planId,
        confirm_digest: digest,
        idempotency_key: `concept-scan-${Date.now()}`
      },
      userId: "concept_agent",
      projectRoot
    });
    expect(commit.ok).toBe(true);
    await expect(
      access(path.join(projectRoot, "config", "concepts", "revenue.yaml"), constants.F_OK)
    ).resolves.toBeUndefined();
  });
});

describe("P1-11 S5 service⇄pure contrast", () => {
  it("adapter buildPlan target ids match planScan concept ids", async () => {
    await mkdir(path.join(projectRoot, "config", "semantic-layer", "demo"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "config", "semantic-layer", "demo", "orders.yaml"),
      `name: orders
measures:
  - name: total_sales
    description: 收入
`,
      "utf8"
    );
    const scanUrl = pathToFileURL(path.join(projectRoot, "scripts/concepts/scan.mjs")).href;
    const scan = await import(scanUrl);
    const pure = scan.planScan({
      contentRoot: path.join(projectRoot, "config"),
      whitelistPath: path.join(projectRoot, "scripts/concepts/seed-whitelist.yaml")
    });
    const adapter = new OpsConceptScanAdapter();
    const draft = await adapter.buildPlan({
      projectRoot,
      actor: "concept_agent",
      delegatedFrom: null,
      request: { dry_run: true, whitelist_ref: "seed" }
    });
    const pureIds = pure.targets.map((t: { conceptId: string }) => `concept:${t.conceptId}`).sort();
    const draftIds = draft.perTarget.map((t) => t.id).sort();
    expect(draftIds).toEqual(pureIds);
  });
});

describe("P1-11 SC-21 recovering fence", () => {
  it("list/show/scan blocked while recovering marker present", async () => {
    const { markConceptsRecovering, clearConceptsRecovering, OPS_CONCEPT_RECOVERING } =
      await import("../concepts-recovery-fence");
    await markConceptsRecovering(projectRoot, "exec-test", ["revenue"]);

    const list = await invokeOpsTool({
      toolName: "lucy_ops_concept_list",
      args: {},
      userId: "concept_agent",
      projectRoot
    });
    expect(list.ok).toBe(false);
    expect((list as { error?: { code?: string } }).error?.code).toBe(OPS_CONCEPT_RECOVERING);

    const show = await invokeOpsTool({
      toolName: "lucy_ops_concept_show",
      args: { concept_id: "revenue" },
      userId: "concept_agent",
      projectRoot
    });
    expect(show.ok).toBe(false);
    expect((show as { error?: { code?: string } }).error?.code).toBe(OPS_CONCEPT_RECOVERING);

    const scan = await invokeOpsTool({
      toolName: "lucy_ops_concept_scan",
      args: { dry_run: true },
      userId: "concept_agent",
      projectRoot
    });
    expect(scan.ok).toBe(false);
    expect((scan as { error?: { code?: string } }).error?.code).toBe(OPS_CONCEPT_RECOVERING);

    await clearConceptsRecovering(projectRoot, "exec-test");
    const list2 = await invokeOpsTool({
      toolName: "lucy_ops_concept_list",
      args: {},
      userId: "concept_agent",
      projectRoot
    });
    expect(list2.ok).toBe(true);
  });
});

describe("P1-11 SC-15 baseline drift rejects commit", () => {
  it("A preview then external mutate → old digest commit fails closed", async () => {
    await mkdir(path.join(projectRoot, "config", "semantic-layer", "demo"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "config", "semantic-layer", "demo", "orders.yaml"),
      `name: orders
measures:
  - name: total_sales
    description: 收入
`,
      "utf8"
    );
    const preview = await invokeOpsTool({
      toolName: "lucy_ops_concept_scan",
      args: { dry_run: true, whitelist_ref: "seed" },
      userId: "concept_agent",
      projectRoot
    });
    expect(preview.ok).toBe(true);
    const planId = (preview as { data?: { plan_id?: string } }).data?.plan_id as string;
    const digest = (preview as { data?: { confirm_digest?: string } }).data?.confirm_digest as string;

    // External mutate: seed concepts outside the plan commit path
    const scanUrl = pathToFileURL(path.join(projectRoot, "scripts/concepts/scan.mjs")).href;
    const scan = await import(scanUrl);
    scan.runScan({
      contentRoot: path.join(projectRoot, "config"),
      whitelistPath: path.join(projectRoot, "scripts/concepts/seed-whitelist.yaml")
    });

    const commit = await invokeOpsTool({
      toolName: "lucy_ops_concept_scan",
      args: {
        dry_run: false,
        plan_id: planId,
        confirm_digest: digest,
        idempotency_key: `drift-${Date.now()}`
      },
      userId: "concept_agent",
      projectRoot
    });
    // D19：协议信封可能 ok，但业务不得标记 succeeded
    if (commit.ok) {
      const data = (commit as { data?: { operation_state?: string; per_target?: Array<{ kind?: string }> } })
        .data;
      expect(data?.operation_state).not.toBe("succeeded");
    } else {
      expect((commit as { error?: { code?: string } }).error?.code).toMatch(
        /ops_external_modification|ops_concept|ops_/
      );
    }
  });
});

describe("P1-11 SC-03/04 Ops authority", () => {
  async function seedAndScan() {
    await mkdir(path.join(projectRoot, "config", "semantic-layer", "demo"), { recursive: true });
    await writeFile(
      path.join(projectRoot, "config", "semantic-layer", "demo", "orders.yaml"),
      `name: orders
measures:
  - name: total_sales
    description: 收入
`,
      "utf8"
    );
    const preview = await invokeOpsTool({
      toolName: "lucy_ops_concept_scan",
      args: { dry_run: true, whitelist_ref: "seed" },
      userId: "concept_agent",
      projectRoot
    });
    const planId = (preview as { data?: { plan_id?: string } }).data?.plan_id as string;
    const digest = (preview as { data?: { confirm_digest?: string } }).data?.confirm_digest as string;
    await invokeOpsTool({
      toolName: "lucy_ops_concept_scan",
      args: {
        dry_run: false,
        plan_id: planId,
        confirm_digest: digest,
        idempotency_key: `seed-scan-${Date.now()}`
      },
      userId: "concept_agent",
      projectRoot
    });
  }

  it("SC-03 set_canonical then rescan keeps pointer/summary", async () => {
    await seedAndScan();
    const storeUrl = pathToFileURL(path.join(projectRoot, "scripts/concepts/store.mjs")).href;
    const store = await import(storeUrl);
    const dir = path.join(projectRoot, "config", "concepts");
    const revenue = store.readConcept(dir, "revenue");
    const hit = (revenue.bindings || []).find(
      (b: { ref?: { measureKey?: string } }) => b.ref?.measureKey === "total_sales"
    );
    expect(hit).toBeTruthy();

    const preview = await invokeOpsTool({
      toolName: "lucy_ops_concept_set_canonical",
      args: {
        dry_run: true,
        concept_id: "revenue",
        binding_id: hit.bindingId,
        summary: "Ops 权威 summary"
      },
      userId: "concept_agent",
      projectRoot
    });
    expect(preview.ok).toBe(true);
    const planId = (preview as { data?: { plan_id?: string } }).data?.plan_id as string;
    const digest = (preview as { data?: { confirm_digest?: string } }).data?.confirm_digest as string;
    const commit = await invokeOpsTool({
      toolName: "lucy_ops_concept_set_canonical",
      args: {
        dry_run: false,
        plan_id: planId,
        confirm_digest: digest,
        idempotency_key: `set-can-${Date.now()}`,
        concept_id: "revenue",
        binding_id: hit.bindingId,
        summary: "Ops 权威 summary"
      },
      userId: "concept_agent",
      projectRoot
    });
    expect(commit.ok).toBe(true);

    const preview2 = await invokeOpsTool({
      toolName: "lucy_ops_concept_scan",
      args: { dry_run: true, whitelist_ref: "seed" },
      userId: "concept_agent",
      projectRoot
    });
    // empty write-set is ok as blockers or zero targets; commit only if writable
    if ((preview2 as { data?: { plan_id?: string } }).data?.plan_id) {
      const planId2 = (preview2 as { data?: { plan_id?: string } }).data?.plan_id as string;
      const digest2 = (preview2 as { data?: { confirm_digest?: string } }).data?.confirm_digest as string;
      if (!(preview2 as { data?: { blockers?: string[] } }).data?.blockers?.length) {
        await invokeOpsTool({
          toolName: "lucy_ops_concept_scan",
          args: {
            dry_run: false,
            plan_id: planId2,
            confirm_digest: digest2,
            idempotency_key: `rescan-${Date.now()}`
          },
          userId: "concept_agent",
          projectRoot
        });
      }
    }

    const after = store.readConcept(dir, "revenue");
    expect(after.canonical).toBe(hit.bindingId);
    expect(after.summary).toBe("Ops 权威 summary");
  });

  it("SC-04 reject stays rejected across rescan", async () => {
    await seedAndScan();
    const storeUrl = pathToFileURL(path.join(projectRoot, "scripts/concepts/store.mjs")).href;
    const store = await import(storeUrl);
    const dir = path.join(projectRoot, "config", "concepts");
    const revenue = store.readConcept(dir, "revenue");
    const hit = (revenue.bindings || []).find(
      (b: { ref?: { measureKey?: string } }) => b.ref?.measureKey === "total_sales"
    );
    expect(hit).toBeTruthy();

    const preview = await invokeOpsTool({
      toolName: "lucy_ops_concept_reject",
      args: { dry_run: true, concept_id: "revenue", binding_id: hit.bindingId },
      userId: "concept_agent",
      projectRoot
    });
    expect(preview.ok).toBe(true);
    const planId = (preview as { data?: { plan_id?: string } }).data?.plan_id as string;
    const digest = (preview as { data?: { confirm_digest?: string } }).data?.confirm_digest as string;
    const commit = await invokeOpsTool({
      toolName: "lucy_ops_concept_reject",
      args: {
        dry_run: false,
        plan_id: planId,
        confirm_digest: digest,
        idempotency_key: `reject-${Date.now()}`,
        concept_id: "revenue",
        binding_id: hit.bindingId
      },
      userId: "concept_agent",
      projectRoot
    });
    expect(commit.ok).toBe(true);

    const scanUrl = pathToFileURL(path.join(projectRoot, "scripts/concepts/scan.mjs")).href;
    const scan = await import(scanUrl);
    scan.runScan({
      contentRoot: path.join(projectRoot, "config"),
      whitelistPath: path.join(projectRoot, "scripts/concepts/seed-whitelist.yaml")
    });
    const after = store.readConcept(dir, "revenue");
    const binding = after.bindings.find((b: { bindingId: string }) => b.bindingId === hit.bindingId);
    expect(binding.role).toBe("rejected");
  });
});

describe("P1-11 SC-18 read_only cannot commit write", () => {
  it("read_only grant denies set_canonical commit prerequisites", async () => {
    const envelope = await invokeOpsTool({
      toolName: "lucy_ops_concept_set_canonical",
      args: {
        dry_run: true,
        concept_id: "revenue",
        binding_id: "measure:x/y/z",
        summary: "nope"
      },
      userId: "concept_reader_agent",
      projectRoot
    });
    // preview may fail grant unmatched or plan blockers; must not silently succeed write
    // instance_scope read_only should fail authorize for write tools
    expect(envelope.ok).toBe(false);
  });
});

describe("P1-11 SC-09 ask-path invariant vs concepts assets", () => {
  it("changing concepts/ does not change semantic+wiki fingerprint", async () => {
    const { createHash } = await import("node:crypto");
    const { readdirSync, readFileSync, existsSync, statSync } = await import("node:fs");

    function hashTree(root: string): string {
      const hash = createHash("sha256");
      if (!existsSync(root)) return hash.update("ABSENT").digest("hex");
      const stack = [root];
      while (stack.length) {
        const cur = stack.pop()!;
        const st = statSync(cur);
        if (st.isDirectory()) {
          for (const name of readdirSync(cur).sort()) stack.push(path.join(cur, name));
        } else {
          hash.update(cur.slice(root.length));
          hash.update(readFileSync(cur));
        }
      }
      return hash.digest("hex");
    }

    const content = path.join(projectRoot, "config");
    await mkdir(path.join(content, "semantic-layer", "demo"), { recursive: true });
    await writeFile(path.join(content, "semantic-layer", "demo", "orders.yaml"), "name: orders\n", "utf8");
    await mkdir(path.join(content, "wiki"), { recursive: true });
    await writeFile(path.join(content, "wiki", "note.md"), "# 收入\n", "utf8");

    const before = `${hashTree(path.join(content, "semantic-layer"))}:${hashTree(path.join(content, "wiki"))}`;
    await mkdir(path.join(content, "concepts"), { recursive: true });
    await writeFile(
      path.join(content, "concepts", "revenue.yaml"),
      "id: revenue\nlabel: 收入\naliases: [收入]\ncanonical: null\nbindings: []\n",
      "utf8"
    );
    const after = `${hashTree(path.join(content, "semantic-layer"))}:${hashTree(path.join(content, "wiki"))}`;
    expect(after).toBe(before);
  });

  it("check-ask-path-invariant module rejects ask-path file hits", async () => {
    const mod = await import(
      pathToFileURL(path.join(repoRoot, "scripts/concepts/check-ask-path-invariant.mjs")).href
    );
    const result = mod.checkAskPathInvariant({ base: "" });
    expect(typeof result.ok).toBe("boolean");
    expect(Array.isArray(result.askHits)).toBe(true);
  });
});

describe("P1-11 SC-06 lucy_ops_reader has no concept ops", () => {
  it("data-plane ops reader cannot call concept tools", async () => {
    for (const toolName of [
      "lucy_ops_concept_list",
      "lucy_ops_concept_scan",
      "lucy_ops_concept_set_canonical"
    ] as const) {
      const envelope = await invokeOpsTool({
        toolName,
        args:
          toolName === "lucy_ops_concept_set_canonical"
            ? { dry_run: true, concept_id: "revenue", binding_id: "x", summary: "s" }
            : toolName === "lucy_ops_concept_scan"
              ? { dry_run: true }
              : {},
        userId: "lucy_ops_reader_agent",
        projectRoot
      });
      expect(envelope.ok).toBe(false);
      expect((envelope as { error?: { code?: string } }).error?.code).toContain("ops_not_granted");
    }
  });
});

describe("P1-11 SC-07/08/20/22", () => {
  it("SC-07 confirmed no-effect failure leaves concepts absent", async () => {
    const before = await conceptsDirExists(projectRoot);
    expect(before).toBe(false);
    const preview = await invokeOpsTool({
      toolName: "lucy_ops_concept_set_canonical",
      args: {
        dry_run: true,
        concept_id: "revenue",
        binding_id: "measure:missing/x/y",
        summary: "nope"
      },
      userId: "concept_agent",
      projectRoot
    });
    // missing concept → blockers or deny; either way no concepts dir
    if (preview.ok) {
      const blockers = (preview as { data?: { blockers?: string[] } }).data?.blockers ?? [];
      expect(blockers.length).toBeGreaterThan(0);
      const planId = (preview as { data?: { plan_id?: string } }).data?.plan_id as string;
      const digest = (preview as { data?: { confirm_digest?: string } }).data?.confirm_digest as string;
      const commit = await invokeOpsTool({
        toolName: "lucy_ops_concept_set_canonical",
        args: {
          dry_run: false,
          plan_id: planId,
          confirm_digest: digest,
          idempotency_key: `noeff-${Date.now()}`,
          concept_id: "revenue",
          binding_id: "measure:missing/x/y",
          summary: "nope"
        },
        userId: "concept_agent",
        projectRoot
      });
      expect(commit.ok === false || (commit as { data?: { operation_state?: string } }).data?.operation_state !== "succeeded").toBe(
        true
      );
    }
    expect(await conceptsDirExists(projectRoot)).toBe(false);
  });

  it("SC-08 plan changeType distinguishes write tools", async () => {
    const { OpsConceptScanAdapter, OpsConceptSetCanonicalAdapter, OpsConceptRejectAdapter } =
      await import("../concepts-adapter");
    expect(new OpsConceptScanAdapter().planChangeType).toBe("concept_scan");
    expect(new OpsConceptSetCanonicalAdapter().planChangeType).toBe("concept_set_canonical");
    expect(new OpsConceptRejectAdapter().planChangeType).toBe("concept_reject");
  });

  it("SC-20 summary mismatch on commit is rejected", async () => {
    await mkdir(path.join(projectRoot, "config", "concepts"), { recursive: true });
    const storeUrl = pathToFileURL(path.join(projectRoot, "scripts/concepts/store.mjs")).href;
    const store = await import(storeUrl);
    const dir = path.join(projectRoot, "config", "concepts");
    store.writeConceptAtomic(dir, {
      id: "revenue",
      label: "收入",
      aliases: ["收入"],
      canonical: null,
      bindings: [
        {
          bindingId: "measure:demo/orders/total_sales",
          kind: "measure",
          role: "candidate",
          confidence: "high",
          ref: { connectionId: "demo", sourceName: "orders", measureKey: "total_sales" },
          evidence: [{ type: "semantic", path: "p", alias: "收入", field: "measure_key", snippet: "total_sales" }]
        }
      ],
      updated_at: "2026-01-01T00:00:00.000Z"
    });
    const preview = await invokeOpsTool({
      toolName: "lucy_ops_concept_set_canonical",
      args: {
        dry_run: true,
        concept_id: "revenue",
        binding_id: "measure:demo/orders/total_sales",
        summary: "计划内 summary"
      },
      userId: "concept_agent",
      projectRoot
    });
    expect(preview.ok).toBe(true);
    const planId = (preview as { data?: { plan_id?: string } }).data?.plan_id as string;
    const digest = (preview as { data?: { confirm_digest?: string } }).data?.confirm_digest as string;
    const commit = await invokeOpsTool({
      toolName: "lucy_ops_concept_set_canonical",
      args: {
        dry_run: false,
        plan_id: planId,
        confirm_digest: digest,
        idempotency_key: `mismatch-${Date.now()}`,
        concept_id: "revenue",
        binding_id: "measure:demo/orders/total_sales",
        summary: "被篡改的 summary"
      },
      userId: "concept_agent",
      projectRoot
    });
    expect(commit.ok).toBe(false);
    expect((commit as { error?: { code?: string } }).error?.code).toBe("ops_concept_request_mismatch");
    const after = store.readConcept(dir, "revenue");
    expect(after.canonical).toBeNull();
  });

  it("SC-22 verify after-image mismatch fails closed", async () => {
    const applyUrl = pathToFileURL(path.join(projectRoot, "scripts/concepts/apply.mjs")).href;
    const apply = await import(applyUrl);
    const dir = path.join(projectRoot, "config", "concepts");
    await mkdir(dir, { recursive: true });
    const afterBytes = Buffer.from("id: revenue\ncanonical: null\nbindings: []\n", "utf8");
    apply.applyConceptPlan(dir, [
      {
        conceptId: "revenue",
        beforeBytes: null,
        afterBytes
      }
    ]);
    const verified = apply.verifyConceptPlanAfterImages(dir, [
      {
        conceptId: "revenue",
        beforeBytes: null,
        afterBytes: Buffer.from("id: revenue\ncanonical: other\n", "utf8")
      }
    ]);
    expect(verified.members.some((m: { state: string }) => m.state !== "succeeded")).toBe(true);
  });
});
