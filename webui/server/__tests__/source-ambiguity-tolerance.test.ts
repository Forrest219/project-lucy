/**
 * P1-35 v0.4 — 容错三档（D10–D15）：选表歧义由强拦降为「放行＋披露＋审计」；硬线不变。
 * SC-E20–E30（见 docs/specs/lucy-20261116-source-ambiguity-mcp-escape-spec.md §4.5／§5）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateContentPathsCache } from "../paths";
import { resetEffectivePolicyForTests } from "../proxy/acl";
import {
  beginBindingSessionPreparation,
  commitBindingSession,
  readBindingSession,
  setCaliberBindingStateDir
} from "../proxy/caliber-binding-session";
import {
  ambiguityScopeKey,
  buildAmbiguityRepairClosure,
  buildRepairEvidenceForGate,
  checkSourceAmbiguityGate,
  denialMessageFor,
  repairEvidenceIdentityKey,
  setSourceAmbiguityStateDir,
  toRepairTargetEvidence,
  upsertJourneyOnBegin,
  type MatchableSource
} from "../proxy/source-ambiguity-gate";
import {
  SOURCE_COUNT_CAP,
  decideSourceSelection
} from "../proxy/source-selection-tolerance";

const CONN = "demo-mysql";
const SCHEMA = "dataforai";
const NAMES = ["orders", "returns", "people", "a", "b", "c", "d", "e"] as const;

const idOf = (name: string, connectionId = CONN) => ({
  connectionId,
  schema: SCHEMA,
  sourceName: name,
  physicalTable: `${SCHEMA}.${name}`
});

function matchable(name: string, description: string, extra: Partial<MatchableSource> = {}): MatchableSource {
  return {
    identity: idOf(name),
    sourceName: name,
    table: `${SCHEMA}.${name}`,
    descriptionHealth: { status: "ok" },
    descriptionState: "present",
    description,
    measureNames: [],
    dimensionNames: [],
    ...extra
  };
}

const permissions = {
  roleIds: [],
  tools: ["lucy_query", "lucy_explain_query"],
  tables: [],
  connections: [CONN],
  sources: NAMES.map((n) => ({
    connectionId: CONN,
    schema: SCHEMA,
    sourceName: n,
    table: `${SCHEMA}.${n}`
  })),
  capabilities: [],
  metaTools: [],
  opsTools: []
} as never;

// 「超市」泛化词命中 orders／returns／people；a…e 与泛化词无关
const sharedSources = (): MatchableSource[] => [
  matchable("orders", "超市订单明细"),
  matchable("returns", "超市退货"),
  matchable("people", "超市人员"),
  ...(["a", "b", "c", "d", "e"] as const).map((n) => matchable(n, `指标${n}`))
];

describe("P1-35 v0.4 source selection tolerance", () => {
  let tmpRoot: string;
  let sagDir: string;
  let prevRoot: string | undefined;
  let prevContent: string | undefined;
  let seq = 0;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "sag-tol-"));
    sagDir = path.join(tmpRoot, "sag");
    const cbDir = path.join(tmpRoot, "cb");
    await mkdir(sagDir, { recursive: true });
    await mkdir(cbDir, { recursive: true });
    await writeFile(path.join(tmpRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await mkdir(path.join(tmpRoot, "webui", "config"), { recursive: true });
    await writeFile(
      path.join(tmpRoot, "webui", "config", "access.yaml"),
      `users:\n  - id: tol_agent\n    enabled: true\n    tokens: []\n    allow:\n      tables:\n${NAMES.map((n) => `        - ${SCHEMA}.${n}`).join("\n")}\n      tools:\n        - lucy_query\n        - lucy_explain_query\n`,
      "utf8"
    );
    const schemaDir = path.join(tmpRoot, "semantic-layer", CONN, "_schema");
    await mkdir(schemaDir, { recursive: true });
    await writeFile(
      path.join(schemaDir, `${SCHEMA}.yaml`),
      `tables:\n${NAMES.map((n) => `  ${n}:\n    table: ${SCHEMA}.${n}\n`).join("")}`,
      "utf8"
    );
    // orders 单端声明 join → returns／people（对端无 yaml；returns↔people 互无声明）
    await writeFile(
      path.join(tmpRoot, "semantic-layer", CONN, "orders.yaml"),
      [
        "name: orders",
        "joins:",
        "  - to: returns",
        "    on: orders.id = returns.id",
        "    source: formal",
        "  - to: people",
        "    on: orders.r = people.r",
        "    source: formal",
        ""
      ].join("\n"),
      "utf8"
    );
    setSourceAmbiguityStateDir(sagDir);
    setCaliberBindingStateDir(cbDir);
    prevRoot = process.env.KTX_PROJECT_ROOT;
    prevContent = process.env.LUCY_CONTENT_ROOT;
    process.env.KTX_PROJECT_ROOT = tmpRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    invalidateContentPathsCache();
    resetEffectivePolicyForTests();
  });

  afterEach(async () => {
    setSourceAmbiguityStateDir(null);
    setCaliberBindingStateDir(null);
    resetEffectivePolicyForTests();
    invalidateContentPathsCache();
    if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = prevRoot;
    if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = prevContent;
    await rm(tmpRoot, { recursive: true, force: true });
  });

  /** 开一个 begun 会话（intent 决定命中集）；intent=null → never_begun。 */
  async function session(intent: string | null) {
    seq += 1;
    const identityKey = `agent:tol-${seq}`;
    const sessionId = `s-tol-${seq}`;
    if (intent !== null) {
      const cbScope = `cb:${identityKey}:${sessionId}`;
      const base = { turnId: "t", registryGeneration: 1, bindingId: null, boundKey: null, caliberSnapshot: null };
      await beginBindingSessionPreparation(cbScope, base);
      await commitBindingSession(cbScope, base);
      const sess = await readBindingSession(cbScope);
      await upsertJourneyOnBegin({
        scopeKey: ambiguityScopeKey(identityKey, sessionId),
        generation: sess.record!.generation,
        intentSummary: intent
      });
    }
    resetEffectivePolicyForTests();
    return { identityKey, sessionId };
  }

  async function gate(
    s: { identityKey: string; sessionId: string },
    args: Record<string, unknown>,
    over: { toolName?: "lucy_query" | "lucy_explain_query"; sources?: MatchableSource[] } = {}
  ) {
    return checkSourceAmbiguityGate({
      ...s,
      toolName: over.toolName ?? "lucy_query",
      args: { connectionId: CONN, ...args },
      permissions,
      matchableSources: over.sources ?? sharedSources()
    });
  }

  async function toleratedEvents(): Promise<Array<Record<string, unknown>>> {
    try {
      const text = await readFile(path.join(sagDir, "tolerated-events.jsonl"), "utf8");
      return text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    } catch {
      return [];
    }
  }

  // ─── 档①放行（无披露） ───────────────────────────────────────────────

  it("SC-E20 M1: single pin inside termHits → plain allow (no selection, no audit)", async () => {
    const s = await session("超市最近怎么样");
    const out = await gate(s, { measures: ["orders.order_count"] });
    expect(out).toEqual({ kind: "allow" });
    expect(await toleratedEvents()).toEqual([]);
  });

  it("SC-E21 M4: declared-join pair inside termHits → plain allow", async () => {
    const s = await session("超市最近怎么样");
    const out = await gate(s, {
      measures: ["orders.order_count"],
      dimensions: [{ field: "returns.returned" }]
    });
    expect(out).toEqual({ kind: "allow" });
  });

  it("SC-E22 M4: star (orders+returns+people via hub) → plain allow", async () => {
    const s = await session("超市最近怎么样");
    const out = await gate(s, {
      measures: ["orders.order_count"],
      dimensions: [{ field: "returns.returned" }, { field: "people.region" }]
    });
    expect(out).toEqual({ kind: "allow" });
  });

  // ─── 档②放行并披露 ───────────────────────────────────────────────────

  it("SC-E23 M6: unjoined pair (returns+people) → allow + tolerated unjoined_multi_source + audit", async () => {
    const s = await session("超市最近怎么样");
    const out = await gate(s, {
      measures: ["returns.return_count"],
      dimensions: [{ field: "people.region" }]
    });
    expect(out.kind).toBe("allow");
    if (out.kind !== "allow") throw new Error("unreachable");
    expect(out.selection?.status).toBe("tolerated");
    expect(out.selection?.reason).toBe("unjoined_multi_source");
    expect(out.selection?.usedSources.map((u) => u.sourceName).sort()).toEqual(["people", "returns"]);
    expect(out.selection?.termHits.map((u) => u.sourceName).sort()).toEqual(["orders", "people", "returns"]);
    const events = await toleratedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ reason: "unjoined_multi_source", tool: "lucy_query" });
    // 不含取值与凭据
    expect(JSON.stringify(events[0])).not.toMatch(/token|secret|password/i);
  });

  it("SC-E24 M5: pin outside termHits → allow + tolerated pin_outside_hits (supersedes E05/E14)", async () => {
    const s = await session("退货和人员");
    const sources = [
      matchable("orders", "订单明细"),
      matchable("returns", "超市退货"),
      matchable("people", "超市人员")
    ];
    const out = await gate(s, { measures: ["orders.order_count"] }, { sources });
    expect(out.kind).toBe("allow");
    if (out.kind !== "allow") throw new Error("unreachable");
    expect(out.selection).toMatchObject({ status: "tolerated", reason: "pin_outside_hits" });
    expect(out.selection?.usedSources.map((u) => u.sourceName)).toEqual(["orders"]);
  });

  it("M7: declared-join pair but one source outside termHits → tolerated multi_hit_unconfirmed", async () => {
    const s = await session("订单和人员");
    const sources = [
      matchable("orders", "订单明细"),
      matchable("returns", "退款"),
      matchable("people", "人员名单")
    ];
    // hits = orders,people（命中≥2）；keys = orders+returns；returns∉hits，orders→returns 已声明连通
    const out = await gate(
      s,
      { measures: ["orders.order_count"], dimensions: [{ field: "returns.returned" }] },
      { sources }
    );
    expect(out.kind).toBe("allow");
    if (out.kind !== "allow") throw new Error("unreachable");
    expect(out.selection?.reason).toBe("multi_hit_unconfirmed");
  });

  // 委托人 2026-11-17 确权（Spec §4.1 v0.4 修订句）：never_begun 无词源命中集，连通多钉选维持档①，不披露不审计。
  it("never_begun: connected pair → plain allow; unjoined pair → tolerated", async () => {
    const connected = await gate(await session(null), {
      measures: ["orders.order_count"],
      dimensions: [{ field: "returns.returned" }]
    });
    expect(connected).toEqual({ kind: "allow" });

    const unjoined = await gate(await session(null), {
      measures: ["returns.return_count"],
      dimensions: [{ field: "people.region" }]
    });
    expect(unjoined.kind).toBe("allow");
    if (unjoined.kind === "allow") expect(unjoined.selection?.reason).toBe("unjoined_multi_source");
  });

  it("explain_query follows the same tiers and audits with tool=lucy_explain_query", async () => {
    const s = await session("超市最近怎么样");
    const out = await gate(
      s,
      { measures: ["returns.return_count"], dimensions: [{ field: "people.region" }] },
      { toolName: "lucy_explain_query" }
    );
    expect(out.kind).toBe("allow");
    const events = await toleratedEvents();
    expect(events[0]).toMatchObject({ tool: "lucy_explain_query" });
  });

  // ─── 硬线 ────────────────────────────────────────────────────────────

  it("SC-E27: ghost dotted filter stays a hard deny even for a tier-1 shape", async () => {
    const s = await session("超市最近怎么样");
    const out = await gate(s, {
      measures: ["orders.order_count"],
      filters: ["ghost_table.amount > 1"]
    });
    expect(out.kind).toBe("deny");
    if (out.kind === "deny") expect(out.denial.detail).toBe("unresolved_source_refs");
  });

  it("SC-E27: any requested source with description read_failed denies (not only the pin)", async () => {
    const s = await session("超市最近怎么样");
    const sources = sharedSources().map((m) =>
      m.sourceName === "people"
        ? { ...m, descriptionHealth: { status: "read_failed" as const, reason: "boom" } }
        : m
    );
    const out = await gate(
      s,
      { measures: ["orders.order_count"], dimensions: [{ field: "people.region" }] },
      { sources }
    );
    expect(out.kind).toBe("deny");
  });

  it("SC-E29: more than SOURCE_COUNT_CAP sources denies with usable single-source retry (H1)", async () => {
    expect(SOURCE_COUNT_CAP).toBe(4);
    const s = await session("超市最近怎么样");
    const probe = new Map(
      ["a", "b", "c", "d", "e"].map((n) => [
        repairEvidenceIdentityKey(idOf(n)),
        { schemaExists: true as boolean | null, completion: "done", measureNames: ["m"] }
      ])
    );
    const out = await checkSourceAmbiguityGate({
      ...s,
      toolName: "lucy_query",
      args: { connectionId: CONN, measures: ["a.m", "b.m", "c.m", "d.m", "e.m"] },
      permissions,
      matchableSources: sharedSources(),
      sourceMapReliable: true,
      schemaProbeByIdentity: probe
    });
    expect(out.kind).toBe("deny");
    if (out.kind !== "deny") throw new Error("unreachable");
    expect(out.denial.detail).toBe("source_count_over_cap");
    expect(out.denial.message).toContain("拆成单来源");
    expect(out.denial.repair.usableTargets.length).toBeGreaterThan(0);
    expect(out.executed).toBe(false);
  });

  // ─── 纯判定 ──────────────────────────────────────────────────────────

  it("SC-E28 D15 pure: cross-connection keys deny; cap boundary", () => {
    const k = (n: string, c = CONN) => idOf(n, c);
    expect(
      decideSourceSelection({ keys: [k("a"), k("b", "other")], termHits: [], connected: true })
    ).toEqual({ kind: "deny", detail: "cross_connection" });
    const four = ["a", "b", "c", "d"].map((n) => k(n));
    expect(decideSourceSelection({ keys: four, termHits: [], connected: true })).toEqual({ kind: "allow" });
    expect(
      decideSourceSelection({ keys: [...four, k("e")], termHits: [], connected: true })
    ).toEqual({ kind: "deny", detail: "source_count_over_cap" });
  });

  it("D15: cross-connection message tells the agent to split by connection", () => {
    expect(denialMessageFor("cross_connection")).toContain("按连接拆分");
  });

  it("D12 pure: termHits<2 treats keys as inside; connected required for plain allow", () => {
    const k = (n: string) => idOf(n);
    expect(decideSourceSelection({ keys: [k("a")], termHits: [k("b")], connected: true })).toEqual({ kind: "allow" });
    expect(
      decideSourceSelection({ keys: [k("a"), k("b")], termHits: [], connected: false })
    ).toEqual({ kind: "tolerate", reason: "unjoined_multi_source" });
    expect(
      decideSourceSelection({ keys: [k("a")], termHits: [k("b"), k("c")], connected: true })
    ).toEqual({ kind: "tolerate", reason: "pin_outside_hits" });
  });

  // ─── ESC-08：H1 argsShape 相对候选重试形态 ──────────────────────────

  it("SC-E08/ESC-08: multi-identity args do not make a compiled candidate invalid_parameter_shape", () => {
    const a = idOf("a");
    const b = idOf("b");
    const rows = [a, b].map((key) => ({
      sourceKey: key,
      displayName: key.sourceName,
      allowListName: key.sourceName,
      measures: ["m"],
      description: "x",
      descriptionState: "present" as const
    }));
    const probe = new Map([
      [repairEvidenceIdentityKey(a), { schemaExists: true as boolean | null, completion: "done", measureNames: ["m"] }],
      [repairEvidenceIdentityKey(b), { schemaExists: true as boolean | null, completion: "done", measureNames: ["m"] }]
    ]);
    const map = buildRepairEvidenceForGate({
      candidates: rows,
      permissions: {
        sources: [
          { connectionId: CONN, schema: SCHEMA, sourceName: "a", table: `${SCHEMA}.a` },
          { connectionId: CONN, schema: SCHEMA, sourceName: "b", table: `${SCHEMA}.b` }
        ],
        tools: ["lucy_query"]
      } as never,
      toolName: "lucy_query",
      sourceMapReliable: true,
      schemaProbeByIdentity: probe,
      args: { connectionId: CONN, measures: ["a.m", "b.m"] }
    });
    const closure = buildAmbiguityRepairClosure(toRepairTargetEvidence(rows, map));
    expect(closure.usableTargets.sort()).toEqual(["a", "b"]);
    expect(closure.rejected.some((r) => r.reason === "invalid_parameter_shape")).toBe(false);
  });

  it("CR-05: a candidate without the requested measure is not a usable retry target", () => {
    const a = idOf("a");
    const b = idOf("b");
    const rows = [a, b].map((key) => ({
      sourceKey: key,
      displayName: key.sourceName,
      allowListName: key.sourceName,
      measures: [],
      description: "x",
      descriptionState: "present" as const
    }));
    const probe = new Map([
      [repairEvidenceIdentityKey(a), { schemaExists: true as boolean | null, completion: "done", measureNames: ["order_count"] }],
      [repairEvidenceIdentityKey(b), { schemaExists: true as boolean | null, completion: "done", measureNames: ["return_count"] }]
    ]);
    const evidenceFor = (measures: unknown[]) =>
      buildAmbiguityRepairClosure(
        toRepairTargetEvidence(
          rows,
          buildRepairEvidenceForGate({
            candidates: rows,
            permissions: {
              sources: [
                { connectionId: CONN, schema: SCHEMA, sourceName: "a", table: `${SCHEMA}.a` },
                { connectionId: CONN, schema: SCHEMA, sourceName: "b", table: `${SCHEMA}.b` }
              ],
              tools: ["lucy_query"]
            } as never,
            toolName: "lucy_query",
            sourceMapReliable: true,
            schemaProbeByIdentity: probe,
            args: { connectionId: CONN, measures }
          })
        )
      );
    // 度量只在 a 存在：b 不能进 usableTargets（重试到 b 上游必然报错）。
    expect(evidenceFor(["a.order_count"]).usableTargets).toEqual(["a"]);
    // 两个度量各归各表：各自限定的度量都存在，两者都可单来源重试。
    expect(evidenceFor(["a.order_count", "b.return_count"]).usableTargets.sort()).toEqual(["a", "b"]);
    // 限定到本候选但本候选没有该度量 → 不合法。
    expect(evidenceFor(["a.return_count"]).usableTargets).toEqual(["b"]);
  });
});
