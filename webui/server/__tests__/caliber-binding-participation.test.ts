/**
 * P1-60 (REQ-030-081) §3.1 参与分类单测。
 *
 * 覆盖：
 *   I0 — 无 caliber-bindings 目录（fileCount=0）→ inactive
 *   I1 — 空目录（无文件）→ inactive
 *   I2 — 全 draft 文件、无凭据 → inactive
 *   I3 — 旧 committed fileCount=0（空注册表）→ inactive
 *   I4 — committed 含已发布绑定 → active
 *   无凭据 + published 文件 → unknown
 *   无凭据 + 读取失败（YAML 解析错误）→ unknown
 *   prepared 凭据 → unknown
 *   syncPending（内容漂移后第二次提交失败）→ unknown
 *   L0 负控：inactive + scope never_begun → inactive
 *   L0 负控：inactive + scope begun_no_hit → inactive
 *   L1 负控：inactive + scope committed begun_bound → active（强制快照优先）
 *   L1 负控：inactive + scope lost_or_conflict → unknown
 *
 * 夹具沿用 caliber-binding.test.ts 的形态：KTX_PROJECT_ROOT 指向临时工程，
 * LUCY_CONTENT_ROOT="." 让内容根 = 工程根。
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateContentPathsCache } from "../paths";
import { resetEffectivePolicyForTests } from "../proxy/acl";
import {
  classifyCaliberParticipation,
  commitCaliberBindingRegistry,
  currentCaliberBindingRegistry,
  loadCaliberBindingCandidate,
  resetCaliberBindingFaultHooks,
  resetCaliberBindingRegistryForTests,
  setCaliberBindingFaultHooks
} from "../proxy/caliber-binding-registry";
import {
  bindingScopeKey,
  beginBindingSessionPreparation,
  clearBindingSession,
  commitBindingSession,
  setCaliberBindingStateDir,
  type BoundCaliber
} from "../proxy/caliber-binding-session";
import type { CanonicalSourceKey } from "../proxy/acl";

// ─── 夹具常量 ─────────────────────────────────────────────────────────────────

const CONNECTION = "mysql-aliyun";

const SCHEMA_YAML = `tables:
  asset_count:
    table: dataforai.asset_count
`;

const PUBLISHED_BINDING_YAML = `bindingId: asset_count
title: 资产台数
status: published
triggers:
  - 资产台数
connectionId: ${CONNECTION}
source: asset_count
caliber:
  measures:
    - asset_count.asset_count
  dimensions: []
  segments: []
  filterFields: []
  requireMeasures:
    - asset_count.asset_count
`;

const DRAFT_BINDING_YAML = PUBLISHED_BINDING_YAML.replace(
  "status: published",
  "status: draft"
);

// 伪造的完整 BindingSession 快照指针（L1 测试用）。
const FAKE_BOUND_KEY: CanonicalSourceKey = {
  connectionId: CONNECTION,
  schema: "dataforai",
  sourceName: "asset_count",
  physicalTable: "dataforai.asset_count"
};

const FAKE_CALIBER: BoundCaliber = {
  measures: ["asset_count.asset_count"],
  dimensions: [],
  segments: [],
  filterFields: [],
  requireMeasures: ["asset_count.asset_count"]
};

// ─── 测试环境 ─────────────────────────────────────────────────────────────────

let projectRoot: string;
let previousProjectRoot: string | undefined;
let previousContentRoot: string | undefined;

async function writeContent(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function makeProject(): Promise<void> {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-cb-part-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "webui", "config", "access.yaml"),
    `users: []\ndefaults:\n  deny_tools: []\n`,
    "utf8"
  );
  // 语义层（提供最简 sourceMap，避免 source_map_compile_failed）。
  await writeContent(`semantic-layer/${CONNECTION}/_schema/dataforai.yaml`, SCHEMA_YAML);
}

/** 提交当前 caliber-bindings 目录内容（调用前先写好 YAML 文件）。 */
async function commitCurrentBindings(): Promise<void> {
  const candidate = await loadCaliberBindingCandidate();
  if (!candidate.ok) throw new Error(`candidate failed: ${candidate.reason} ${candidate.detail}`);
  const result = await commitCaliberBindingRegistry(candidate, {
    releaseId: "rel_part_test",
    attemptId: "att_part_test"
  });
  if (!result.ok) throw new Error(`commit failed: ${result.reason}`);
}

beforeEach(async () => {
  await makeProject();
  previousProjectRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  invalidateContentPathsCache();
  resetEffectivePolicyForTests();
  resetCaliberBindingRegistryForTests();
  setCaliberBindingStateDir(path.join(projectRoot, ".ktx-ui", "caliber-binding"));
});

afterEach(async () => {
  invalidateContentPathsCache();
  resetEffectivePolicyForTests();
  resetCaliberBindingRegistryForTests();
  resetCaliberBindingFaultHooks();
  setCaliberBindingStateDir(null);
  if (previousProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousProjectRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

// ─── I0–I4 基础 inactive/active 情形 ─────────────────────────────────────────

describe("I0 — 无 caliber-bindings 目录（fileCount=0）→ inactive", () => {
  it("无目录时分类为 inactive", async () => {
    // 未创建 caliber-bindings 目录，也无凭据。
    const result = await classifyCaliberParticipation();
    expect(result).toBe("inactive");
  });
});

describe("I1 — 空目录（无 YAML 文件）→ inactive", () => {
  it("空目录时分类为 inactive", async () => {
    await mkdir(path.join(projectRoot, "caliber-bindings"), { recursive: true });
    const result = await classifyCaliberParticipation();
    expect(result).toBe("inactive");
  });
});

describe("I2 — 全 draft 文件、无凭据 → inactive", () => {
  it("无凭据且全部文件可解析为 draft → inactive", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", DRAFT_BINDING_YAML);
    // 不提交（无凭据）。
    const result = await classifyCaliberParticipation();
    expect(result).toBe("inactive");
  });

  it("多个 draft 文件、无凭据 → inactive", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", DRAFT_BINDING_YAML);
    await writeContent(
      "caliber-bindings/other.yaml",
      DRAFT_BINDING_YAML.replace("bindingId: asset_count", "bindingId: other")
    );
    const result = await classifyCaliberParticipation();
    expect(result).toBe("inactive");
  });
});

describe("I3 — 旧 committed fileCount=0（空注册表）→ inactive", () => {
  it("committed 凭据 + 空注册表 → inactive", async () => {
    // 提交空候选（无 YAML 文件）→ fileCount=0, bindings.size=0。
    await commitCurrentBindings();
    expect(currentCaliberBindingRegistry()?.fileCount).toBe(0);
    expect(currentCaliberBindingRegistry()?.bindings.size).toBe(0);
    const result = await classifyCaliberParticipation();
    expect(result).toBe("inactive");
  });

  it("committed 凭据 + 全 draft 文件（bindings.size=0, fileCount>0）→ inactive", async () => {
    // 写 draft 文件后提交 → fileCount>0 但 bindings.size=0（draft 不入 bindings）。
    await writeContent("caliber-bindings/draft_only.yaml", DRAFT_BINDING_YAML);
    await commitCurrentBindings();
    expect(currentCaliberBindingRegistry()?.fileCount).toBeGreaterThan(0);
    expect(currentCaliberBindingRegistry()?.bindings.size).toBe(0);
    const result = await classifyCaliberParticipation();
    expect(result).toBe("inactive");
  });
});

describe("I4 — committed 含已发布绑定 → active", () => {
  it("committed 凭据 + published 绑定 → active", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", PUBLISHED_BINDING_YAML);
    await commitCurrentBindings();
    expect(currentCaliberBindingRegistry()?.bindings.size).toBeGreaterThan(0);
    const result = await classifyCaliberParticipation();
    expect(result).toBe("active");
  });
});

// ─── unknown 情形 ────────────────────────────────────────────────────────────

describe("无凭据 + published 文件 → unknown", () => {
  it("published 文件存在但无凭据 → unknown", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", PUBLISHED_BINDING_YAML);
    // 不提交（无凭据）。
    const result = await classifyCaliberParticipation();
    expect(result).toBe("unknown");
  });
});

describe("无凭据 + YAML 解析失败（状态不可读）→ unknown", () => {
  it("无效 YAML 文件（无凭据）→ unknown", async () => {
    await writeContent("caliber-bindings/broken.yaml", "{ not valid yaml: [\n");
    const result = await classifyCaliberParticipation();
    expect(result).toBe("unknown");
  });
});

describe("prepared 凭据 → unknown", () => {
  it("凭据 phase=prepared → unknown", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", PUBLISHED_BINDING_YAML);
    const candidate = await loadCaliberBindingCandidate();
    if (!candidate.ok) throw new Error(`candidate failed: ${candidate.reason}`);
    // 在 committed 写入前注入故障，使凭据停留在 prepared 阶段。
    setCaliberBindingFaultHooks({
      afterRegistryCredential: () => {
        throw new Error("test: abort before committed");
      }
    });
    await commitCaliberBindingRegistry(candidate, {
      releaseId: "rel_prepared",
      attemptId: "att_prepared"
    });
    resetCaliberBindingFaultHooks();
    // 凭据文件为 prepared；通过 recoverCaliberBindingRegistry 重建内存状态。
    resetCaliberBindingRegistryForTests();
    const { recoverCaliberBindingRegistry } = await import("../proxy/caliber-binding-registry");
    await recoverCaliberBindingRegistry();
    const { currentRegistryCredential } = await import("../proxy/caliber-binding-registry");
    expect(currentRegistryCredential()?.phase).toBe("prepared");

    const result = await classifyCaliberParticipation();
    expect(result).toBe("unknown");
  });
});

describe("syncPending（内容漂移后第二次提交失败）→ unknown", () => {
  it("committed 凭据 + syncPending=true → unknown", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", PUBLISHED_BINDING_YAML);
    await commitCurrentBindings();
    // 此时已有 committed 凭据。修改文件后再提交，注入故障使 syncPending=true。
    await writeContent(
      "caliber-bindings/asset_count.yaml",
      PUBLISHED_BINDING_YAML.replace("title: 资产台数", "title: modified")
    );
    const candidate2 = await loadCaliberBindingCandidate();
    if (!candidate2.ok) throw new Error(`candidate failed: ${candidate2.reason}`);
    setCaliberBindingFaultHooks({
      beforeRegistryCredential: () => {
        throw new Error("test: abort second commit");
      }
    });
    await commitCaliberBindingRegistry(candidate2, {
      releaseId: "rel_sync_pending",
      attemptId: "att_sync_pending"
    });
    resetCaliberBindingFaultHooks();
    // 此时：credential=committed（来自第一次提交），syncPending=true。
    const { registrySyncPending, currentRegistryCredential } = await import(
      "../proxy/caliber-binding-registry"
    );
    expect(currentRegistryCredential()?.phase).toBe("committed");
    expect(registrySyncPending()).toBe(true);

    const result = await classifyCaliberParticipation();
    expect(result).toBe("unknown");
  });
});

// ─── L0／L1 scope 边界判定 ────────────────────────────────────────────────────

function makeScope(): string {
  return bindingScopeKey("test_user|hash", "session-part-test");
}

/** 建立全局 inactive 状态（committed 空注册表）。 */
async function setupGlobalInactive(): Promise<void> {
  await commitCurrentBindings(); // 无 YAML 文件 → fileCount=0, bindings.size=0
  expect(currentCaliberBindingRegistry()?.bindings.size).toBe(0);
}

describe("L0 — inactive + scope never_begun → inactive", () => {
  it("无 scope 文件时分类为 inactive", async () => {
    await setupGlobalInactive();
    const scope = makeScope();
    const result = await classifyCaliberParticipation({ scopeKey: scope });
    expect(result).toBe("inactive");
  });
});

describe("L0 — inactive + scope begun_no_hit → inactive", () => {
  it("scope begun_no_hit 时分类仍为 inactive", async () => {
    await setupGlobalInactive();
    const scope = makeScope();
    // 写入 begun_no_hit 状态的 scope（bindingId=null）。
    await beginBindingSessionPreparation(scope, {
      turnId: "turn-nohit",
      registryGeneration: 0,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(scope, {
      turnId: "turn-nohit",
      registryGeneration: 0,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const result = await classifyCaliberParticipation({ scopeKey: scope });
    expect(result).toBe("inactive");

    // 清理
    await clearBindingSession(scope);
  });
});

describe("L1 — inactive + scope committed begun_bound → active（强制快照优先）", () => {
  it("scope 有 committed begun_bound 快照时，全局 inactive 覆盖为 active", async () => {
    await setupGlobalInactive();
    const scope = makeScope();
    // 写入完整 begun_bound committed 状态的 scope。
    await beginBindingSessionPreparation(scope, {
      turnId: "turn-bound",
      registryGeneration: 0,
      bindingId: "asset_count",
      boundKey: FAKE_BOUND_KEY,
      caliberSnapshot: FAKE_CALIBER
    });
    await commitBindingSession(scope, {
      turnId: "turn-bound",
      registryGeneration: 0,
      bindingId: "asset_count",
      boundKey: FAKE_BOUND_KEY,
      caliberSnapshot: FAKE_CALIBER
    });
    const result = await classifyCaliberParticipation({ scopeKey: scope });
    expect(result).toBe("active");

    // 清理
    await clearBindingSession(scope);
  });
});

describe("L1 — inactive + scope lost_or_conflict → unknown", () => {
  it("scope preparing（lost_or_conflict）时返回 unknown", async () => {
    await setupGlobalInactive();
    const scope = makeScope();
    // 写入 preparing 状态（未提交）→ readBindingSession 返回 lost_or_conflict。
    await beginBindingSessionPreparation(scope, {
      turnId: "turn-lc",
      registryGeneration: 0,
      bindingId: "asset_count",
      boundKey: FAKE_BOUND_KEY,
      caliberSnapshot: FAKE_CALIBER
    });
    // 不调用 commitBindingSession → 停留在 preparing → lost_or_conflict。
    const result = await classifyCaliberParticipation({ scopeKey: scope });
    expect(result).toBe("unknown");

    // 清理
    await clearBindingSession(scope);
  });

  it("scope begun_bound 但指针不完整（boundKey=null）→ unknown", async () => {
    await setupGlobalInactive();
    const scope = makeScope();
    // 写入 boundKey=null 的 begun_bound（指针损坏，会被 classifyRecord 降级为 lost_or_conflict）。
    await beginBindingSessionPreparation(scope, {
      turnId: "turn-corrupt",
      registryGeneration: 0,
      bindingId: "asset_count",
      boundKey: null,       // 指针不完整
      caliberSnapshot: null
    });
    await commitBindingSession(scope, {
      turnId: "turn-corrupt",
      registryGeneration: 0,
      bindingId: "asset_count",
      boundKey: null,
      caliberSnapshot: null
    });
    // readBindingSession 对 boundKey=null 的 begun_bound 返回 lost_or_conflict。
    const result = await classifyCaliberParticipation({ scopeKey: scope });
    expect(result).toBe("unknown");

    // 清理
    await clearBindingSession(scope);
  });
});

// ─── 无 scopeKey 参数时不影响全局分类 ────────────────────────────────────────

describe("不传 scopeKey 时仅依据全局注册表状态", () => {
  it("active 注册表 + 无 scopeKey → active", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", PUBLISHED_BINDING_YAML);
    await commitCurrentBindings();
    const result = await classifyCaliberParticipation();
    expect(result).toBe("active");
  });

  it("inactive 注册表 + 无 scopeKey → inactive", async () => {
    await setupGlobalInactive();
    const result = await classifyCaliberParticipation();
    expect(result).toBe("inactive");
  });
});


describe("P1-60 final-review zero-state regressions", () => {
  it("R-01 proven optional preparing does not reject the query gate", async () => {
    await setupGlobalInactive();
    const scope = makeScope();
    await beginBindingSessionPreparation(scope, {turnId:"legacy-optional",registryGeneration:0,bindingId:null,boundKey:null,caliberSnapshot:null});
    expect(await classifyCaliberParticipation({scopeKey:scope})).toBe("inactive");
    const {checkCaliberBindingGate}=await import("../proxy/caliber-binding");
    const gate=await checkCaliberBindingGate({identity:{} as never,identityKey:"test_user|hash",sessionId:"session-part-test",toolName:"lucy_query",args:{}});
    expect(gate.kind).toBe("allow");
  });
  it("R-01 optional preparing over a prior bound snapshot must stay unknown", async () => {
    await setupGlobalInactive();const scope=makeScope();
    await commitBindingSession(scope,{turnId:"old-bound",registryGeneration:1,bindingId:"asset_count",boundKey:FAKE_BOUND_KEY,caliberSnapshot:FAKE_CALIBER});
    await beginBindingSessionPreparation(scope,{turnId:"optional-over-bound",registryGeneration:1,bindingId:null,boundKey:null,caliberSnapshot:null});
    expect(await classifyCaliberParticipation({scopeKey:scope})).toBe("unknown");
  });
  it("R-02 committed empty credential remains inactive after recovery", async () => {
    await commitCurrentBindings();
    const {recoverCaliberBindingRegistry}=await import("../proxy/caliber-binding-registry");
    resetCaliberBindingRegistryForTests();
    expect((await recoverCaliberBindingRegistry()).usable).toBe(true);
    expect(await classifyCaliberParticipation()).toBe("inactive");
  });
  it("R-02 draft-only classification does not require valid unpublished business fields", async () => {
    await writeContent("caliber-bindings/draft.yaml","status: draft\ntriggers: invalid-draft-field\n");
    expect(await classifyCaliberParticipation()).toBe("inactive");
  });
  it("R-02 corrupt credential is not silently certified as no history", async () => {
    await writeContent("caliber-bindings/.caliber-binding/active-generation.json","{invalid");
    expect(await classifyCaliberParticipation()).toBe("unknown");
  });
  it("R-02 new published content after empty recovery is not a cached inactive", async () => {
    const {recoverCaliberBindingRegistry}=await import("../proxy/caliber-binding-registry");
    await recoverCaliberBindingRegistry();
    await writeContent("caliber-bindings/asset_count.yaml",PUBLISHED_BINDING_YAML);
    expect(await classifyCaliberParticipation()).toBe("unknown");
  });
});
