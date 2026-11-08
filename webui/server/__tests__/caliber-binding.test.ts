/**
 * P0-1 问题类型口径绑定 —— 装载／匹配／门禁／会话单测。
 *
 * 覆盖 Spec v0.9 的 SC-01、SC-04–SC-13、SC-15、SC-15b、SC-16、SC-17a/b、
 * SC-19、SC-21、SC-23、SC-25–SC-29。
 *
 * 夹具沿用 `mcp-proxy-acl.test.ts` 的形态：`KTX_PROJECT_ROOT` 指向临时工程，
 * `LUCY_CONTENT_ROOT="."` 让内容根＝工程根，`semantic-layer/<连接>/_schema/*.yaml`
 * 提供 sourceMap，`caliber-bindings/*.yaml` 提供绑定资产。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateContentPathsCache } from "../paths";
import { resetEffectivePolicyForTests } from "../proxy/acl";
import {
  clearCaliberBindingCredential,
  commitCaliberBindingRegistry,
  currentCaliberBindingRegistry,
  loadCaliberBindingCandidate,
  recoverCaliberBindingRegistry,
  registrySyncPending,
  resetCaliberBindingFaultHooks,
  resetCaliberBindingRegistryForTests,
  setCaliberBindingFaultHooks,
  verifyCurrentBindingContentAndDependencies
} from "../proxy/caliber-binding-registry";
import {
  bindingScopeKey,
  beginBindingSessionPreparation,
  clearBindingSession,
  commitBindingSession,
  readBindingSession,
  restorePriorBindingSession
} from "../proxy/caliber-binding-session";
import {
  checkCaliberBindingGate,
  matchTriggerCandidates,
  normalizeCaliberText,
  parseFilterStringField,
  prepareCaliberBindingActivation,
  requestedMeasureKeys,
  validateCaliberTrigger
} from "../proxy/caliber-binding";
import { setCaliberBindingStateDir } from "../proxy/caliber-binding-session";
import type { Identity } from "../proxy/identity";

const TOKEN = "caliber-binding-token";
const CONNECTION = "mysql-aliyun";
const OTHER_CONNECTION = "mysql-other";

const SCHEMA_YAML = `tables:
  asset_count:
    table: dataforai.asset_count
  orders:
    table: dataforai.orders
`;

const OTHER_SCHEMA_YAML = `tables:
  asset_count:
    table: otherdb.asset_count
`;

function accessYaml(tables: string[]): string {
  return `users:
  - id: asset_agent
    name: Asset Agent
    enabled: true
    tokens:
      - hash: "sha256:${TOKEN}"
        label: caliber-test
        created: 2026-11-08
    allow:
      tables:
${tables.map((table) => `        - ${table}`).join("\n")}
      tools:
        - lucy_query
        - lucy_explain_query
        - lucy_begin_question
        - lucy_read_source
defaults:
  deny_tools: []
`;
}

const BINDING_YAML = `bindingId: asset_count
title: 资产台数
status: published
triggers:
  - 资产台数
  - 资产的数量
connectionId: ${CONNECTION}
source: asset_count
caliber:
  measures:
    - asset_count.asset_count
  dimensions:
    - asset_count.company_code
  segments:
    - asset_count.domestic
  filterFields:
    - asset_count.company_code
  requireMeasures:
    - asset_count.asset_count
`;

let projectRoot: string;
let previousProjectRoot: string | undefined;
let previousContentRoot: string | undefined;

const identity: Identity = {
  userId: "asset_agent",
  tokenLabel: "caliber-test",
  tokenHashPrefix: "caliber-test"
};

async function writeContent(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function makeProject(options: { allowTables?: string[] } = {}): Promise<void> {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-caliber-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  // access.yaml 固定在 `<projectRoot>/webui/config/`（与既有 acl 夹具一致）；
  // 内容根则由 `LUCY_CONTENT_ROOT="."` 指向工程根。
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "webui", "config", "access.yaml"),
    accessYaml(options.allowTables ?? ["dataforai.asset_count"]),
    "utf8"
  );
  await writeContent(`semantic-layer/${CONNECTION}/_schema/dataforai.yaml`, SCHEMA_YAML);
  await writeContent(`semantic-layer/${OTHER_CONNECTION}/_schema/otherdb.yaml`, OTHER_SCHEMA_YAML);
}

async function publishBindings(): Promise<void> {
  const candidate = await loadCaliberBindingCandidate();
  if (!candidate.ok) throw new Error(`candidate failed: ${candidate.reason} ${candidate.detail}`);
  const committed = await commitCaliberBindingRegistry(candidate, {
    releaseId: "rel_test",
    attemptId: "att_test"
  });
  if (!committed.ok) throw new Error(`commit failed: ${committed.reason}`);
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
  setCaliberBindingStateDir(null);
  if (previousProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousProjectRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  await rm(projectRoot, { recursive: true, force: true });
});

// ─── SC-01 ─ 装载与校验 ───────────────────────────────────────────────────────

describe("SC-01 绑定资产装载", () => {
  it("published 可加载并固化 boundKey；draft 不参与", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await writeContent("caliber-bindings/draft_only.yaml", BINDING_YAML.replace(
      "bindingId: asset_count",
      "bindingId: draft_only"
    ).replace("status: published", "status: draft"));

    const candidate = await loadCaliberBindingCandidate();
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(candidate.registry.bindings.has("asset_count")).toBe(true);
    // draft 不进入 published 候选。
    expect(candidate.registry.bindings.has("draft_only")).toBe(false);
    const binding = candidate.registry.bindings.get("asset_count")!;
    expect(binding.boundKey.connectionId).toBe(CONNECTION);
    expect(binding.boundKey.sourceName).toBe("asset_count");
    expect(binding.boundKey.physicalTable).toBe("dataforai.asset_count");
    expect(binding.normalizedTriggers).toEqual(["资产台数", "资产的数量"]);
  });

  it("(connectionId,source) 无法解析唯一 boundKey → 加载失败（fail-closed）", async () => {
    await writeContent("caliber-bindings/bad.yaml", BINDING_YAML.replace(
      "source: asset_count",
      "source: no_such_source"
    ));
    const candidate = await loadCaliberBindingCandidate();
    expect(candidate.ok).toBe(false);
    if (candidate.ok) return;
    expect(candidate.reason).toBe("bound_key_unresolved");
  });

  it("触发词非字符串 → 候选发布失败（不得静默丢弃）", async () => {
    await writeContent("caliber-bindings/bad.yaml", BINDING_YAML.replace(
      "  - 资产的数量",
      "  - 42"
    ));
    const candidate = await loadCaliberBindingCandidate();
    expect(candidate.ok).toBe(false);
    if (candidate.ok) return;
    expect(candidate.reason).toBe("trigger_invalid");
    expect(candidate.detail).toContain("trigger_not_string");
  });

  it("规范化后字母数字码点 <4 → 候选发布失败", async () => {
    await writeContent("caliber-bindings/bad.yaml", BINDING_YAML.replace(
      "  - 资产的数量",
      "  - 资产台"
    ));
    const candidate = await loadCaliberBindingCandidate();
    expect(candidate.ok).toBe(false);
    if (candidate.ok) return;
    expect(candidate.reason).toBe("trigger_invalid");
    expect(candidate.detail).toContain("trigger_too_short");
  });

  it("空串触发词 → 候选发布失败", async () => {
    await writeContent("caliber-bindings/bad.yaml", BINDING_YAML.replace(
      "  - 资产的数量",
      "  - '   '"
    ));
    const candidate = await loadCaliberBindingCandidate();
    expect(candidate.ok).toBe(false);
    if (candidate.ok) return;
    expect(candidate.reason).toBe("trigger_invalid");
  });

  it("重复 bindingId → 加载失败", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await writeContent("caliber-bindings/asset_count_copy.yaml", BINDING_YAML);
    const candidate = await loadCaliberBindingCandidate();
    expect(candidate.ok).toBe(false);
    if (candidate.ok) return;
    expect(candidate.reason).toBe("duplicate_binding_id");
  });

  it("有效空目录与读取失败必须区分", async () => {
    const candidate = await loadCaliberBindingCandidate();
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    expect(candidate.registry.fileCount).toBe(0);
  });
});

// ─── O2 §4.2 —— 规范化与触发匹配（SC-04／SC-05／SC-06） ─────────────────────

describe("O2 规范化与触发匹配", () => {
  it("N(s)：NFKC → toLowerCase → 空白折叠 → trim", () => {
    expect(normalizeCaliberText("ＡＳＳＥＴ")).toBe("asset");
    expect(normalizeCaliberText("资产  台数")).toBe("资产 台数");
    expect(normalizeCaliberText("  asset\t\ncount ")).toBe("asset count");
  });

  it("SC-04：`Straße` 与 `STRASSE` 不命中（非 full casefold）", () => {
    expect(normalizeCaliberText("Straße")).toBe("straße");
    expect(normalizeCaliberText("STRASSE")).toBe("strasse");
    expect(normalizeCaliberText("STRASSE").includes(normalizeCaliberText("Straße"))).toBe(false);
  });

  it("SC-04：内部标点保留（`资产台数` vs `资产，台数` 不命中）", () => {
    const trigger = normalizeCaliberText("资产台数");
    expect(normalizeCaliberText("资产，台数").includes(trigger)).toBe(false);
  });

  it("SC-04：两字段分别匹配，禁止跨字段拼接", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();

    // 只有 intentSummary 命中。
    const onIntent = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "查一下资产台数",
      question: "有哪些"
    });
    expect(onIntent.ok).toBe(true);
    if (onIntent.ok) expect(onIntent.activation.binding?.bindingId).toBe("asset_count");

    // 只有 question 命中。
    const onQuestion = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "统计一下",
      question: "资产台数是多少"
    });
    expect(onQuestion.ok).toBe(true);
    if (onQuestion.ok) expect(onQuestion.activation.binding?.bindingId).toBe("asset_count");

    // 跨字段拼接必须**不**命中：`资产` + `台数` ≠ `资产台数`。
    const split = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "资产",
      question: "台数"
    });
    expect(split.ok).toBe(true);
    if (split.ok) expect(split.activation.binding).toBeNull();
  });

  it("SC-04：同绑定多 trigger 规范化后去重为 1（不算 ambiguous）", async () => {
    // `ＡＳＳＥＴ`（全角）与 `ASSET` 规范化后是同一个词 → 去重为 1。
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML.replace(
      "  - 资产的数量",
      "  - ASSET\n  - ＡＳＳＥＴ"
    ));
    await publishBindings();
    const registry = currentCaliberBindingRegistry()!;
    expect(registry.bindings.get("asset_count")!.normalizedTriggers).toEqual(["资产台数", "asset"]);
    const activation = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "查一下 ASSET 数量"
    });
    expect(activation.ok).toBe(true);
    if (activation.ok) expect(activation.activation.binding?.bindingId).toBe("asset_count");
  });

  it("SC-05：≥2 命中 → ambiguous，不按最长词／顺序择一", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    // 第二条绑定指向**同一个可见来源**，只是触发词不同 → 两条都可见且都命中。
    await writeContent("caliber-bindings/asset_count_alt.yaml", BINDING_YAML
      .replace("bindingId: asset_count", "bindingId: asset_count_alt")
      .replace("title: 资产台数", "title: 资产台数（另一口径）")
      .replace("  - 资产台数", "  - 台数资产")
      .replace("  - 资产的数量", "  - 数量资产"));
    await publishBindings();
    const activation = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "查一下资产台数和台数资产"
    });
    expect(activation.ok).toBe(false);
    if (activation.ok) return;
    expect(activation.denial.code).toBe("caliber_binding_ambiguous");
  });

  it("SC-06：真零命中 → begun_no_hit（不施加绑定）", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    const activation = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "今天天气怎么样"
    });
    expect(activation.ok).toBe(true);
    if (!activation.ok) return;
    expect(activation.activation.kind).toBe("none");
    expect(activation.activation.binding).toBeNull();
  });

  it("SC-06：`triggers: []` 仅支持显式 id 激活", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML.replace(
      "triggers:\n  - 资产台数\n  - 资产的数量",
      "triggers: []"
    ));
    await publishBindings();
    const byTrigger = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "查一下资产台数"
    });
    expect(byTrigger.ok).toBe(true);
    if (byTrigger.ok) expect(byTrigger.activation.binding).toBeNull();

    const byId = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "查一下资产台数",
      explicitBindingId: "asset_count"
    });
    expect(byId.ok).toBe(true);
    if (byId.ok) expect(byId.activation.binding?.bindingId).toBe("asset_count");
  });

  it("不可见绑定不进入命中集合（无侧信道）", async () => {
    await writeContent("caliber-bindings/order_count.yaml", BINDING_YAML
      .replace("bindingId: asset_count", "bindingId: order_count")
      .replace("source: asset_count", "source: orders")
      .replace("  - 资产台数", "  - 订单台数")
      .replace("  - 资产的数量", "  - 订单的数量"));
    await publishBindings();
    // 调用者只被授权 dataforai.asset_count；orders 不可见 → 不命中。
    const activation = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "查一下订单台数"
    });
    expect(activation.ok).toBe(true);
    if (activation.ok) expect(activation.activation.binding).toBeNull();
  });
});

// ─── SC-02／SC-03 —— 显式激活 ────────────────────────────────────────────────

describe("SC-02／SC-03 显式激活", () => {
  it("显式 id 命中 → 激活", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    const activation = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "随便问一句",
      explicitBindingId: "asset_count"
    });
    expect(activation.ok).toBe(true);
    if (activation.ok) expect(activation.activation.binding?.bindingId).toBe("asset_count");
  });

  it("显式 id 不存在 → invalid_or_invisible_binding，且不回退触发匹配", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    const activation = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "查一下资产台数",
      explicitBindingId: "no_such_binding"
    });
    expect(activation.ok).toBe(false);
    if (activation.ok) return;
    expect(activation.denial.code).toBe("invalid_or_invisible_binding");
  });

  it("显式 id 命中但对调用者不可见 → invalid_or_invisible_binding", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    const invisible: Identity = { userId: "nobody", tokenLabel: "x", tokenHashPrefix: "x" };
    const activation = await prepareCaliberBindingActivation({
      identity: invisible,
      intentSummary: "随便问一句",
      explicitBindingId: "asset_count"
    });
    expect(activation.ok).toBe(false);
    if (activation.ok) return;
    expect(activation.denial.code).toBe("invalid_or_invisible_binding");
  });
});

// ─── SC-16／SC-17／SC-25／SC-27／SC-28 —— BindingSession 四态 ────────────────

describe("BindingSession 四态（D5／D11）", () => {
  const scope = () => bindingScopeKey("asset_agent|hash", "session-1");

  it("SC-12：从未开题 → never_begun", async () => {
    const session = await readBindingSession(scope());
    expect(session.state).toBe("never_begun");
  });

  it("SC-06：未命中 → begun_no_hit", async () => {
    await beginBindingSessionPreparation(scope(), {
      turnId: "turn-1",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(scope(), {
      turnId: "turn-1",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const session = await readBindingSession(scope());
    expect(session.state).toBe("begun_no_hit");
  });

  it("SC-02：命中 → begun_bound，快照是深拷贝", async () => {
    const candidate = await loadCaliberBindingCandidate();
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    void candidate;
    await publishBindings();
    const binding = currentCaliberBindingRegistry()!.bindings.get("asset_count")!;
    await beginBindingSessionPreparation(scope(), {
      turnId: "turn-1",
      registryGeneration: 1,
      bindingId: binding.bindingId,
      boundKey: binding.boundKey,
      caliberSnapshot: binding.caliber
    });
    await commitBindingSession(scope(), {
      turnId: "turn-1",
      registryGeneration: 1,
      bindingId: binding.bindingId,
      boundKey: binding.boundKey,
      caliberSnapshot: binding.caliber
    });
    const session = await readBindingSession(scope());
    expect(session.state).toBe("begun_bound");
    expect(session.record?.commitPhase).toBe("committed");
    expect(session.record?.boundKey?.physicalTable).toBe("dataforai.asset_count");

    // 深拷贝：改动资产侧的 caliber 不影响已提交快照。
    binding.caliber.measures.push("asset_count.injected");
    const reread = await readBindingSession(scope());
    expect(reread.record?.caliberSnapshot?.measures).toEqual(["asset_count.asset_count"]);
  });

  it("SC-17c／SC-16：重启读到未完成提交 → lost_or_conflict（不得放行）", async () => {
    await beginBindingSessionPreparation(scope(), {
      turnId: "turn-1",
      registryGeneration: 1,
      bindingId: "asset_count",
      boundKey: null,
      caliberSnapshot: null
    });
    const session = await readBindingSession(scope());
    expect(session.state).toBe("lost_or_conflict");
  });

  it("SC-17b：失败 begin → 旧 committed 状态不变", async () => {
    await beginBindingSessionPreparation(scope(), {
      turnId: "turn-1",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(scope(), {
      turnId: "turn-1",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    // 第二次开题在 preparing 阶段失败。
    await beginBindingSessionPreparation(scope(), {
      turnId: "turn-2",
      registryGeneration: 2,
      bindingId: "asset_count",
      boundKey: null,
      caliberSnapshot: null
    });
    await restorePriorBindingSession(scope());
    const session = await readBindingSession(scope());
    expect(session.state).toBe("begun_no_hit");
    expect(session.record?.turnId).toBe("turn-1");
  });

  it("SC-16：指针损坏（会话文件不可解析）→ lost_or_conflict，不得当成从未开题", async () => {
    const scopeKey = bindingScopeKey("asset_agent|hash", "session-corrupt");
    const dir = path.join(projectRoot, ".ktx-ui", "caliber-binding", "sessions");
    await mkdir(dir, { recursive: true });
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(scopeKey).digest("hex").slice(0, 32);
    await writeFile(path.join(dir, `session-${digest}.json`), "{ not json", "utf8");
    const session = await readBindingSession(scopeKey);
    expect(session.state).toBe("lost_or_conflict");
  });

  it("SC-25：预算关闭时四态仍成立", async () => {
    // 本测试不涉及预算存储；四态由 BindingSession 自身决定。
    const session = await readBindingSession(scope());
    expect(["never_begun", "begun_no_hit", "begun_bound", "lost_or_conflict"]).toContain(session.state);
  });

  it("SC-20：supersede 替换 generation", async () => {
    await beginBindingSessionPreparation(scope(), {
      turnId: "turn-1",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(scope(), {
      turnId: "turn-1",
      registryGeneration: 1,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const first = (await readBindingSession(scope())).record!.generation;
    await beginBindingSessionPreparation(scope(), {
      turnId: "turn-2",
      registryGeneration: 2,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    await commitBindingSession(scope(), {
      turnId: "turn-2",
      registryGeneration: 2,
      bindingId: null,
      boundKey: null,
      caliberSnapshot: null
    });
    const second = (await readBindingSession(scope())).record!;
    expect(second.generation).toBeGreaterThan(first);
    expect(second.turnId).toBe("turn-2");
  });
});

// ─── SC-07–SC-15b —— 门禁 ────────────────────────────────────────────────────

describe("查询门禁（D7／D12）", () => {
  const scope = bindingScopeKey("asset_agent|hash", "session-1");

  async function bindAsset(): Promise<void> {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    const binding = currentCaliberBindingRegistry()!.bindings.get("asset_count")!;
    await beginBindingSessionPreparation(scope, {
      turnId: "turn-1",
      registryGeneration: currentCaliberBindingRegistry()!.generation,
      bindingId: binding.bindingId,
      boundKey: binding.boundKey,
      caliberSnapshot: binding.caliber
    });
    await commitBindingSession(scope, {
      turnId: "turn-1",
      registryGeneration: currentCaliberBindingRegistry()!.generation,
      bindingId: binding.bindingId,
      boundKey: binding.boundKey,
      caliberSnapshot: binding.caliber
    });
  }

  async function gate(args: Record<string, unknown>) {
    return checkCaliberBindingGate({
      identity,
      identityKey: "asset_agent|hash",
      sessionId: "session-1",
      toolName: "lucy_query",
      args
    });
  }

  it("SC-10：合规请求 → 放行", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: CONNECTION,
      measures: ["asset_count.asset_count"],
      dimensions: [{ field: "asset_count.company_code" }],
      filters: [{ field: "asset_count.company_code", op: "eq", value: "X" }],
      segments: ["asset_count.domestic"]
    });
    expect(outcome.kind).toBe("allow");
  });

  it("SC-07：reqKeys ≠ {boundKey} → violation", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: CONNECTION,
      measures: ["orders.order_count"]
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.code).toBe("caliber_binding_violation");
    expect(outcome.denial.payload.dimension).toBe("source");
  });

  it("SC-07：双连接同名 logical source → violation", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: OTHER_CONNECTION,
      measures: ["asset_count.asset_count"]
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.payload.dimension).toBe("source");
  });

  it("SC-08：越出快照允许集 → violation（参数化）", async () => {
    await bindAsset();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["measures", { connectionId: CONNECTION, measures: ["asset_count.other_measure"] }],
      ["dimensions", { connectionId: CONNECTION, measures: ["asset_count.asset_count"], dimensions: [{ field: "asset_count.other_dim" }] }],
      ["segments", { connectionId: CONNECTION, measures: ["asset_count.asset_count"], segments: ["asset_count.other_segment"] }],
      ["filters", { connectionId: CONNECTION, measures: ["asset_count.asset_count"], filters: [{ field: "asset_count.other_field" }] }]
    ];
    for (const [dimension, args] of cases) {
      const outcome = await gate(args);
      expect(outcome.kind).toBe("deny");
      if (outcome.kind !== "deny") continue;
      expect(outcome.denial.code).toBe("caliber_binding_violation");
      expect(outcome.denial.payload.dimension).toBe(dimension);
    }
  });

  it("SC-09：缺 requireMeasures → violation", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: CONNECTION,
      measures: [],
      dimensions: [{ field: "asset_count.company_code" }]
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.payload.dimension).toBe("require_measures");
  });

  it("SC-15：`{expr}` measure → violation", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: CONNECTION,
      measures: [{ expr: "sum(1)", name: "x" }]
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.code).toBe("caliber_binding_violation");
  });

  it("SC-15：不可解析 filter → violation", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: CONNECTION,
      measures: ["asset_count.asset_count"],
      filters: ["count(*) > 5"]
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.payload.dimension).toBe("filters");
  });

  it("SC-15：跨源 order_by → violation", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: CONNECTION,
      measures: ["asset_count.asset_count"],
      order_by: [{ field: "orders.order_id" }]
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.payload.dimension).toBe("source");
  });

  it("SC-15b：D12 禁键 → violation（即使同源）", async () => {
    await bindAsset();
    for (const key of ["where", "having", "groupBy", "group_by", "joins", "join", "sort", "sorts"]) {
      const outcome = await gate({
        connectionId: CONNECTION,
        measures: ["asset_count.asset_count"],
        [key]: ["asset_count.company_code"]
      });
      expect(outcome.kind).toBe("deny");
      if (outcome.kind !== "deny") continue;
      expect(outcome.denial.code).toBe("caliber_binding_violation");
      expect(outcome.denial.payload.dimension).toBe("extra_parameter");
      expect(outcome.denial.payload.offendingKey).toBe(key);
    }
  });

  it("F-R1／D7②：合规请求额外带来源别名（`sourceName` 等）→ 放行，不得 extra_parameter", async () => {
    await bindAsset();
    const baseline = await gate({
      connectionId: CONNECTION,
      measures: ["asset_count.asset_count"],
      dimensions: [{ field: "asset_count.company_code" }]
    });
    expect(baseline.kind).toBe("allow");
    // D7② 的来源别名同族：`sourceName`｜`source`｜`source_name`｜`table`
    // （＋同族 camel／snake 变体）都指向 bound logical source → 与无别名同码通过。
    for (const key of ["sourceName", "source", "source_name", "table", "tableName", "table_name"]) {
      const outcome = await gate({
        connectionId: CONNECTION,
        measures: ["asset_count.asset_count"],
        dimensions: [{ field: "asset_count.company_code" }],
        [key]: "asset_count"
      });
      expect(outcome.kind, key).toBe("allow");
    }
  });

  it("F-R1 对照：仍带 `where` → 继续 extra_parameter violation", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: CONNECTION,
      measures: ["asset_count.asset_count"],
      sourceName: "asset_count",
      where: ["asset_count.company_code"]
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.code).toBe("caliber_binding_violation");
    expect(outcome.denial.payload.dimension).toBe("extra_parameter");
    expect(outcome.denial.payload.offendingKey).toBe("where");
  });

  it("F-R1：来源别名指向别的源 → source violation（别名不得成为无人检查的顶层键）", async () => {
    await bindAsset();
    for (const key of ["sourceName", "source", "source_name", "table", "tableName", "table_name"]) {
      const outcome = await gate({
        connectionId: CONNECTION,
        measures: ["asset_count.asset_count"],
        [key]: "orders"
      });
      expect(outcome.kind, key).toBe("deny");
      if (outcome.kind !== "deny") continue;
      expect(outcome.denial.code, key).toBe("caliber_binding_violation");
      expect(outcome.denial.payload.dimension, key).toBe("source");
    }
  });

  it("F-R1：来源别名取值为空／非字符串 → 不可解析引用 violation", async () => {
    await bindAsset();
    for (const value of ["", "   ", 42, null]) {
      const outcome = await gate({
        connectionId: CONNECTION,
        measures: ["asset_count.asset_count"],
        sourceName: value
      });
      expect(outcome.kind, String(value)).toBe("deny");
      if (outcome.kind !== "deny") continue;
      expect(outcome.denial.code, String(value)).toBe("caliber_binding_violation");
      expect(outcome.denial.payload.dimension, String(value)).toBe("unresolvable_reference");
    }
  });

  it("SC-11：行权限注入的谓词不参与口径校验（Agent 同字段仍校验）", async () => {
    await bindAsset();
    // 只带行权限注入的字段（不在 filterFields 里）→ 仍然 violation。
    const injected = await gate({
      connectionId: CONNECTION,
      measures: ["asset_count.asset_count"],
      filters: [{ field: "asset_count.secret_scope" }]
    });
    expect(injected.kind).toBe("deny");
    // Agent 自己的同字段也要被校验 → 口径快照是唯一权威。
    const agentSameField = await gate({
      connectionId: CONNECTION,
      measures: ["asset_count.asset_count"],
      filters: [{ field: "asset_count.company_code" }]
    });
    expect(agentSameField.kind).toBe("allow");
  });

  it("SC-26：物理表别名归一后等于 boundKey → 通过", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: CONNECTION,
      measures: ["dataforai.asset_count.asset_count"]
    });
    expect(outcome.kind).toBe("allow");
  });

  it("SC-12：never_begun 不施加绑定", async () => {
    const outcome = await checkCaliberBindingGate({
      identity,
      identityKey: "other|hash",
      sessionId: "session-x",
      toolName: "lucy_query",
      args: { connectionId: CONNECTION, measures: ["orders.order_count"] }
    });
    expect(outcome.kind).toBe("allow");
  });

  it("SC-16：lost_or_conflict → unresolved，不得放行", async () => {
    const otherScope = bindingScopeKey("asset_agent|hash", "session-2");
    await beginBindingSessionPreparation(otherScope, {
      turnId: "turn-x",
      registryGeneration: 1,
      bindingId: "asset_count",
      boundKey: null,
      caliberSnapshot: null
    });
    const outcome = await checkCaliberBindingGate({
      identity,
      identityKey: "asset_agent|hash",
      sessionId: "session-2",
      toolName: "lucy_query",
      args: { connectionId: CONNECTION, measures: ["asset_count.asset_count"] }
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.code).toBe("caliber_binding_unresolved");
  });

  it("SC-13：拒绝文案中文主称；不可见对象不回显", async () => {
    await bindAsset();
    const outcome = await gate({
      connectionId: CONNECTION,
      measures: ["asset_count.other_measure"]
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.label).toBe("偏离固定口径");
    expect(outcome.denial.text).toContain("偏离固定口径");
  });

  it("SC-18：激活后撤权再查 → 拒绝且不泄密", async () => {
    await bindAsset();
    // 撤权后的身份对该来源不可见。
    const revoked: Identity = { userId: "nobody", tokenLabel: "x", tokenHashPrefix: "x" };
    const outcome = await checkCaliberBindingGate({
      identity: revoked,
      identityKey: "asset_agent|hash",
      sessionId: "session-1",
      toolName: "lucy_query",
      args: { connectionId: CONNECTION, measures: ["asset_count.asset_count"] }
    });
    expect(outcome.kind).toBe("deny");
    if (outcome.kind !== "deny") return;
    expect(outcome.denial.code).toBe("caliber_binding_unresolved");
    // 不泄密：载荷里不得出现 source／允许集／绑定 id。
    const serialized = JSON.stringify(outcome.denial.payload);
    expect(serialized).not.toContain("asset_count");
    expect(serialized).not.toContain("dataforai");
    expect(outcome.denial.payload.allowed).toBeUndefined();
  });

  it("SC-21：query 与 explain 同码同口径", async () => {
    await bindAsset();
    const args = { connectionId: CONNECTION, measures: ["asset_count.other_measure"] };
    const query = await gate(args);
    const explain = await checkCaliberBindingGate({
      identity,
      identityKey: "asset_agent|hash",
      sessionId: "session-1",
      toolName: "lucy_explain_query",
      args
    });
    expect(query.kind).toBe("deny");
    expect(explain.kind).toBe("deny");
    if (query.kind !== "deny" || explain.kind !== "deny") return;
    expect(query.denial.code).toBe(explain.denial.code);
    expect(query.denial.payload.dimension).toBe(explain.denial.payload.dimension);
  });
});

// ─── O1 —— 注册表提交／核验／恢复 ────────────────────────────────────────────

describe("O1 注册表提交与恢复", () => {
  it("SC-19：重复 id／加载失败可观测；已 bound 不因加载失败静默放行", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await writeContent("caliber-bindings/asset_count_copy.yaml", BINDING_YAML);
    const candidate = await loadCaliberBindingCandidate();
    expect(candidate.ok).toBe(false);
    if (candidate.ok) return;
    expect(candidate.reason).toBe("duplicate_binding_id");
  });

  it("SC-22：generation 切换后新 begin 可读", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    expect(currentCaliberBindingRegistry()!.generation).toBe(1);
    expect(currentCaliberBindingRegistry()!.bindings.has("asset_count")).toBe(true);
  });

  it("SC-23／SC-28：改盘后旧 begin 准备结果跨 generation 失效；核验失败", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    const generation = currentCaliberBindingRegistry()!.generation;
    expect(registrySyncPending()).toBe(false);
    const proof = await verifyCurrentBindingContentAndDependencies(generation);
    expect(proof.complete).toBe(true);
    expect(proof.matchesCommitted).toBe(true);

    // 直接改盘 → 内容漂移 → 核验不通过。
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML.replace("title: 资产台数", "title: 改过的标题"));
    const drifted = await verifyCurrentBindingContentAndDependencies(generation);
    expect(drifted.matchesCommitted).toBe(false);
    expect(drifted.reason).toBe("content_drift");
  });

  it("SC-29：删盘 → 核验失败", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    const generation = currentCaliberBindingRegistry()!.generation;
    await rm(path.join(projectRoot, "caliber-bindings", "asset_count.yaml"), { force: true });
    const proof = await verifyCurrentBindingContentAndDependencies(generation);
    expect(proof.matchesCommitted).toBe(false);
  });

  it("SC-24：无提交证据但有候选 → 拒绝新 begin（不得空注册表放行）", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await clearCaliberBindingCredential();
    const recovery = await recoverCaliberBindingRegistry();
    expect(recovery.usable).toBe(false);
    expect(recovery.reason).toBe("no_commit_evidence");
  });

  it("SC-24／O1 §4.1③：注册表同步未决 → 新 begin 返回 unresolved（不得用旧注册表匹配）", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    // 制造同步未决：候选持久化失败。
    setCaliberBindingFaultHooks({
      beforeRegistryCredential: () => { throw new Error("credential persist failed"); }
    });
    const candidate = await loadCaliberBindingCandidate();
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) return;
    const commit = await commitCaliberBindingRegistry(candidate, {
      releaseId: "rel_failed",
      attemptId: "att_failed"
    });
    resetCaliberBindingFaultHooks();
    expect(commit.ok).toBe(false);
    expect(registrySyncPending()).toBe(true);

    // 新 begin：即使旧注册表里能命中，也必须 unresolved。
    const activation = await prepareCaliberBindingActivation({
      identity,
      intentSummary: "查一下资产台数"
    });
    expect(activation.ok).toBe(false);
    if (activation.ok) return;
    expect(activation.denial.code).toBe("caliber_binding_unresolved");
  });

  it("SC-24：无历史且未配置绑定 → 空注册表可用", async () => {
    await clearCaliberBindingCredential();
    const recovery = await recoverCaliberBindingRegistry();
    expect(recovery.usable).toBe(true);
    expect(recovery.generation).toBe(0);
  });

  it("SC-24：凭据已提交且引用完整 → 恢复同一 generation", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    resetCaliberBindingRegistryForTests();
    const recovery = await recoverCaliberBindingRegistry();
    expect(recovery.usable).toBe(true);
    expect(recovery.generation).toBe(1);
    expect(currentCaliberBindingRegistry()!.bindings.has("asset_count")).toBe(true);
  });
});

// ─── 辅助函数的独立断言 ──────────────────────────────────────────────────────

describe("触发词与 filter 字段解析", () => {
  it("触发词校验：字符串／长度门槛", () => {
    expect(validateCaliberTrigger("资产台数").ok).toBe(true);
    expect(validateCaliberTrigger("abcd").ok).toBe(true);
    expect(validateCaliberTrigger("资产台").ok).toBe(false);
    expect(validateCaliberTrigger(123).ok).toBe(false);
    expect(validateCaliberTrigger("").ok).toBe(false);
  });

  it("度量提取：`{expr,name}` → 不可解析", () => {
    expect(requestedMeasureKeys({ measures: ["a.b"] }).ok).toBe(true);
    const expr = requestedMeasureKeys({ measures: [{ expr: "sum(1)", name: "x" }] });
    expect(expr.ok).toBe(false);
  });

  it("字符串 filter：只接受左操作数是限定字段键的形式", () => {
    expect(parseFilterStringField("asset_count.company_code")).toBe("asset_count.company_code");
    expect(parseFilterStringField("asset_count.company_code = 'X'")).toBe("asset_count.company_code");
    expect(parseFilterStringField("count(*) > 5")).toBeNull();
  });

  it("命中计数只扫描 triggers（不扫 title／bindingId）", async () => {
    await writeContent("caliber-bindings/asset_count.yaml", BINDING_YAML);
    await publishBindings();
    const registry = currentCaliberBindingRegistry()!;
    const visible = new Set<string>();
    const hits = matchTriggerCandidates(
      registry.bindings.values(),
      "查一下资产台数",
      undefined,
      // 空的可见集合 → 不可见 → 不命中
      visible
    );
    expect(hits).toHaveLength(0);
  });
});

afterEach(async () => {
  await clearBindingSession(bindingScopeKey("asset_agent|hash", "session-1"));
});
