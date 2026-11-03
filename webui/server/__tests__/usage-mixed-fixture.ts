/**
 * Spec 189 / WO-202610-28 T1 — deterministic mixed usage fixture.
 *
 * ONE fixed set of `access_log` rows that exercises every layer boundary
 * (Raw Audit → Raw Business → Default Usage) plus the population boundaries
 * (current config assets vs. historical log identities).
 *
 * This module is **data only**. It deliberately contains no classifier and no
 * SQL, so it cannot become a second protocol list:
 *   - the expected layer of every row is declared explicitly on the row
 *     (`expected_class`) — hand-curated against Spec 189 §4.2, and reviewed
 *     as the oracle by the tests;
 *
 * All timestamps are absolute so the fixture is replayable: the tests pin the
 * system clock to `FIXTURE_NOW_ISO`, making the 7-day window deterministic.
 */

/** The pinned "now" for every test that consumes this fixture. */
export const FIXTURE_NOW_ISO = "2026-10-27T08:00:00.000Z";

/** The fixture's Role — bound on the rows that carry role_ids. */
export const FIXTURE_ROLE_ID = "role_finance";

/**
 * How many decommissioned (unconfigured) identities the fixture creates.
 * They make the active numerator exceed the configured denominator, which is
 * the `partial` population-boundary case.
 */
export const LEGACY_IDENTITY_COUNT = 13;

/** Spec 189 §4.2 — the protocol event set (9 named methods + `server/*` rule). */
export const PROTOCOL_METHODS = [
  "initialize",
  "notifications/initialized",
  "tools/list",
  "ping",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
  "notifications/cancelled",
  "server/discover"
] as const;

/** Spec 189 §4.2 — any `server/`-prefixed method is a protocol event. */
export const SERVER_PREFIXED_METHOD = "server/unknown";

/**
 * Spec 189 §4.2 — the admission set is NOT the protocol set. Every admitted
 * JSON-RPC method must have exactly one usage classification.
 */
export const ADMITTED_METHOD_CLASSIFICATION: ReadonlyArray<{
  method: string;
  classification: "protocol" | "business";
}> = [
  { method: "initialize", classification: "protocol" },
  { method: "ping", classification: "protocol" },
  { method: "notifications/initialized", classification: "protocol" },
  { method: "notifications/cancelled", classification: "protocol" },
  { method: "tools/list", classification: "protocol" },
  { method: "resources/list", classification: "protocol" },
  { method: "resources/templates/list", classification: "protocol" },
  { method: "prompts/list", classification: "protocol" },
  { method: "tools/call", classification: "business" },
  { method: "resources/read", classification: "business" },
  { method: "prompts/get", classification: "business" }
];

/**
 * Row classification under Spec 189 §4.
 *   - `protocol`     → Raw Audit only (excluded from business and usage)
 *   - `eval_probe`   → Raw Business, excluded from Default Usage (Spec 162 §7.6)
 *   - `default_usage`→ Raw Business and Default Usage
 */
export type FixtureClass = "protocol" | "eval_probe" | "default_usage";

export interface UsageFixtureRow {
  ts: string;
  user_id: string;
  token_hash_prefix: string | null;
  token_label: string | null;
  tool: string;
  outcome: "ok" | "error" | "denied" | "budget_stop";
  duration_ms: number;
  /** SQLite stores the Token's explicit eval mark as integer 1. */
  eval_mark: 0 | 1 | null;
  args_summary: string | null;
  role_ids: string | null;
  user_agent: string | null;
  tables: string | null;
  request_id: string;
  /** The oracle: this row's classification under Spec 189 §4. */
  expected_class: FixtureClass;
}

export interface FixtureAgent {
  id: string;
  /** Full token hashes configured in access.yaml (may share a 19-char prefix). */
  token_hashes: string[];
  /** Whether the agent exists in the current access.yaml (population boundary). */
  configured: boolean;
}

const HOUR = 60 * 60 * 1000;
const FIXTURE_NOW_MS = Date.parse(FIXTURE_NOW_ISO);

/** Deterministic in-window timestamp: `hours` before the pinned now. */
function ago(hours: number): string {
  return new Date(FIXTURE_NOW_MS - hours * HOUR).toISOString();
}

/** Deterministic out-of-window timestamp (outside the 7d window). */
function longAgo(hours: number): string {
  return new Date(FIXTURE_NOW_MS - hours * HOUR).toISOString();
}

/** 19-char canonical token prefix (`sha256:` + 12 chars), matching production. */
export function fixturePrefix(seed: number): string {
  return `sha256:${String(seed).padStart(12, "0")}`;
}

/** Full hash whose first 19 chars equal `prefix`. */
export function fixtureHash(prefix: string, suffix: string): string {
  return `${prefix}${suffix}`;
}

const AGENT_TOOL_ALLOW = `    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_query
`;

/**
 * The fixture agents. Protocol-only Agents exist once per protocol method so
 * SC-01 / SC-02 can assert "a protocol-only Agent is never business-active"
 * for every single method, not just for the aggregate.
 *
 * The prefix seed counter is **local** to this function on purpose: calling
 * `buildFixtureAgents()` twice must yield byte-identical Agents, otherwise the
 * fixture would not be replayable.
 */
export function buildFixtureAgents(): FixtureAgent[] {
  const agents: FixtureAgent[] = [];
  let seed = 1;
  const localPrefix = (): string => {
    seed += 1;
    return fixturePrefix(seed);
  };
  const protocolTools = [...PROTOCOL_METHODS, SERVER_PREFIXED_METHOD];
  for (const method of protocolTools) {
    agents.push({
      id: `protocol_${method.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      token_hashes: [fixtureHash(localPrefix(), "aaaa")],
      configured: true
    });
  }
  for (const id of [
    "business_agent",
    "eval_probe_agent",
    "name_only_agent",
    "resource_read_agent",
    "prompts_get_agent",
    "skill_read_agent",
    "mixed_agent",
    "historical_agent",
    // Above the Access Governance Gate high-traffic threshold (50), so the
    // gate wiring can be verified end-to-end.
    "high_traffic_agent"
  ]) {
    agents.push({ id, token_hashes: [fixtureHash(localPrefix(), "bbbb")], configured: true });
  }
  // Two configured tokens sharing one 19-char prefix → Spec 128 D4 collision.
  const collisionPrefix = fixturePrefix(9999);
  agents.push({
    id: "collision_agent",
    token_hashes: [fixtureHash(collisionPrefix, "aa01"), fixtureHash(collisionPrefix, "bb02")],
    configured: true
  });
  // A logged identity that is NOT in the current access.yaml → the §6
  // population boundary (numerator may exceed the configured denominator).
  agents.push({
    id: "unconfigured_history_agent",
    token_hashes: [fixtureHash(localPrefix(), "cccc")],
    configured: false
  });
  return agents;
}

function agentPrefix(agents: FixtureAgent[], id: string): string {
  const agent = agents.find((a) => a.id === id);
  if (!agent) throw new Error(`fixture agent not found: ${id}`);
  return agent.token_hashes[0].slice(0, 19);
}

/**
 * Row factory with a **local** counter: building the fixture twice must
 * produce byte-identical rows, so the counter cannot live at module scope.
 */
function makeRowFactory(): (input: {
  user_id: string;
  prefix: string | null;
  tool: string;
  outcome?: UsageFixtureRow["outcome"];
  duration_ms?: number;
  eval_mark?: 0 | 1 | null;
  args_summary?: string | null;
  role_ids?: string | null;
  user_agent?: string | null;
  tables?: string | null;
  ts?: string;
  expected_class: FixtureClass;
}) => UsageFixtureRow {
  let rowCounter = 0;
  return (input) => {
    rowCounter += 1;
    return {
      ts: input.ts ?? ago(1),
      user_id: input.user_id,
      token_hash_prefix: input.prefix,
      token_label: `${input.user_id}-token`,
      tool: input.tool,
      outcome: input.outcome ?? "ok",
      duration_ms: input.duration_ms ?? 10,
      eval_mark: input.eval_mark ?? null,
      args_summary: input.args_summary ?? null,
      role_ids: input.role_ids ?? null,
      user_agent: input.user_agent ?? "fixture-client/1.0",
      tables: input.tables ?? null,
      request_id: `fixture-req-${String(rowCounter).padStart(4, "0")}`,
      expected_class: input.expected_class
    };
  };
}
/**
 * The deterministic mixed record set.
 *
 * Coverage (Spec 189 SC-01…SC-13):
 *   - one protocol-only Agent per protocol method + `server/unknown`
 *   - real business calls with `ok` / `error` / `denied`
 *   - `resources/read` / `prompts/get` / `lucy_skill_read` skill content reads
 *   - an explicit eval probe (eval_mark + probe name) and a name-only match
 *   - a mixed Agent (protocol + business in the same window)
 *   - a historical Agent whose rows fall outside the 7d window
 *   - an unconfigured log identity (population boundary)
 */
export function buildFixtureRows(agents: FixtureAgent[] = buildFixtureAgents()): UsageFixtureRow[] {
  const rows: UsageFixtureRow[] = [];
  const row = makeRowFactory();

  // 1) Protocol-only Agents — one row each, one per protocol method.
  for (const method of [...PROTOCOL_METHODS, SERVER_PREFIXED_METHOD]) {
    const id = `protocol_${method.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`;
    rows.push(
      row({
        user_id: id,
        prefix: agentPrefix(agents, id),
        tool: method,
        expected_class: "protocol"
      })
    );
  }

  // 2) Real business calls — ok / error / denied all count as attempts.
  const businessPrefix = agentPrefix(agents, "business_agent");
  rows.push(
    row({
      user_id: "business_agent",
      prefix: businessPrefix,
      tool: "lucy_query",
      outcome: "ok",
      duration_ms: 120,
      args_summary: JSON.stringify({ connection: "mysql-aliyun", source: "superstore_orders" }),
      tables: JSON.stringify(["dataforai.superstore_orders"]),
      role_ids: JSON.stringify([FIXTURE_ROLE_ID]),
      expected_class: "default_usage"
    }),
    row({
      user_id: "business_agent",
      prefix: businessPrefix,
      tool: "lucy_query",
      outcome: "error",
      duration_ms: 240,
      ts: ago(2),
      args_summary: JSON.stringify({ connection: "mysql-aliyun" }),
      role_ids: JSON.stringify([FIXTURE_ROLE_ID]),
      expected_class: "default_usage"
    }),
    row({
      user_id: "business_agent",
      prefix: businessPrefix,
      tool: "lucy_query",
      outcome: "denied",
      duration_ms: 30,
      ts: ago(3),
      args_summary: JSON.stringify({ connection: "mysql-aliyun" }),
      role_ids: JSON.stringify([FIXTURE_ROLE_ID]),
      expected_class: "default_usage"
    })
  );

  // 3) Explicit eval probes — eval_mark = 1 AND a probe name in args.
  const probePrefix = agentPrefix(agents, "eval_probe_agent");
  rows.push(
    row({
      user_id: "eval_probe_agent",
      prefix: probePrefix,
      tool: "lucy_query",
      eval_mark: 1,
      args_summary: JSON.stringify({ connection: "probe-demo" }),
      role_ids: JSON.stringify([FIXTURE_ROLE_ID]),
      expected_class: "eval_probe"
    }),
    row({
      user_id: "eval_probe_agent",
      prefix: probePrefix,
      tool: "lucy_query",
      eval_mark: 1,
      ts: ago(2),
      args_summary: JSON.stringify({ table: "demo-mysql" }),
      role_ids: JSON.stringify([FIXTURE_ROLE_ID]),
      expected_class: "eval_probe"
    })
  );

  // 4) Name-only match without eval_mark → stays in the default usage view.
  rows.push(
    row({
      user_id: "name_only_agent",
      prefix: agentPrefix(agents, "name_only_agent"),
      tool: "lucy_query",
      args_summary: JSON.stringify({ connection: "probe-demo" }),
      role_ids: JSON.stringify([FIXTURE_ROLE_ID]),
      expected_class: "default_usage"
    })
  );

  // 5) Skill content reads — real business content, never protocol noise.
  rows.push(
    row({
      user_id: "resource_read_agent",
      prefix: agentPrefix(agents, "resource_read_agent"),
      tool: "resources/read",
      args_summary: JSON.stringify({ uri: "lucy-skill://finance/restricted-sop" }),
      expected_class: "default_usage"
    }),
    row({
      user_id: "prompts_get_agent",
      prefix: agentPrefix(agents, "prompts_get_agent"),
      tool: "prompts/get",
      args_summary: JSON.stringify({ name: "restricted-sop" }),
      expected_class: "default_usage"
    }),
    row({
      user_id: "skill_read_agent",
      prefix: agentPrefix(agents, "skill_read_agent"),
      tool: "lucy_skill_read",
      args_summary: JSON.stringify({ uri: "lucy-skill://finance/restricted-sop" }),
      expected_class: "default_usage"
    })
  );

  // 6) Mixed Agent — protocol events and business calls in the same window.
  const mixedPrefix = agentPrefix(agents, "mixed_agent");
  rows.push(
    row({
      user_id: "mixed_agent",
      prefix: mixedPrefix,
      tool: "initialize",
      expected_class: "protocol"
    }),
    row({
      user_id: "mixed_agent",
      prefix: mixedPrefix,
      tool: "ping",
      ts: ago(2),
      expected_class: "protocol"
    }),
    row({
      user_id: "mixed_agent",
      prefix: mixedPrefix,
      tool: "lucy_query",
      outcome: "ok",
      ts: ago(3),
      args_summary: JSON.stringify({ connection: "mysql-aliyun" }),
      expected_class: "default_usage"
    })
  );

  // 7) Historical Agent — rows exist but fall outside the 7d window.
  const historicalPrefix = agentPrefix(agents, "historical_agent");
  rows.push(
    row({
      user_id: "historical_agent",
      prefix: historicalPrefix,
      tool: "lucy_query",
      ts: longAgo(24 * 30),
      expected_class: "default_usage"
    }),
    row({
      user_id: "historical_agent",
      prefix: historicalPrefix,
      tool: "initialize",
      ts: longAgo(24 * 31),
      expected_class: "protocol"
    })
  );

  // 8) High-traffic Agent — above the governance gate threshold (50).
  const hotPrefix = agentPrefix(agents, "high_traffic_agent");
  for (let i = 0; i < 51; i += 1) {
    rows.push(
      row({
        user_id: "high_traffic_agent",
        prefix: hotPrefix,
        tool: "lucy_query",
        outcome: "ok",
        ts: ago(1 + (i % 40) / 60),
        args_summary: JSON.stringify({ connection: "mysql-aliyun" }),
        role_ids: JSON.stringify([FIXTURE_ROLE_ID]),
        expected_class: "default_usage"
      })
    );
  }

  // 9) Unconfigured log identity — inside the window, not a current asset.
  rows.push(
    row({
      user_id: "unconfigured_history_agent",
      prefix: agentPrefix(agents, "unconfigured_history_agent"),
      tool: "lucy_query",
      args_summary: JSON.stringify({ connection: "mysql-aliyun" }),
      expected_class: "default_usage"
    })
  );

  // 10) Decommissioned identities — real business calls in the window, but
  //      not current assets. They push the active numerator above the
  //      configured denominator, which is exactly the population boundary
  //      Spec 189 §6 / SC-16 says must surface as `partial` (never as a
  //      silently truncated rate).
  for (let i = 1; i <= LEGACY_IDENTITY_COUNT; i += 1) {
    rows.push(
      row({
        user_id: `legacy_identity_${String(i).padStart(2, "0")}`,
        prefix: fixturePrefix(20_000 + i),
        tool: "lucy_query",
        ts: ago(2 + i / 24),
        args_summary: JSON.stringify({ connection: "mysql-aliyun" }),
        expected_class: "default_usage"
      })
    );
  }

  return rows;
}

/** The recorded per-Agent expectation under the pinned window. */
export interface UsageFixtureExpectation {
  /** Rows inside the 7d window. */
  callsLast7d: number;
  /** Spec 189 — Raw Business Tool Call count (protocol events excluded). */
  targetRawBusinessCalls: number;
  /** Spec 189 target — Default Usage Call count. */
  targetDefaultUsageCalls: number;
  /** Spec 189 target — protocol event count. */
  targetProtocolCalls: number;
  /** Spec 189 target — does this Agent count as business-active? */
  targetBusinessActive: boolean;
}

const WINDOW_START_MS = FIXTURE_NOW_MS - 168 * HOUR;

function inWindow(ts: string): boolean {
  const ms = Date.parse(ts);
  return ms >= WINDOW_START_MS && ms < FIXTURE_NOW_MS;
}

/**
 * Derive the per-Agent expectation from the fixture rows.
 *
 * "before" comes from the legacy 3-method protocol set (the historical
 * baseline); "target" comes from each row's declared `expected_class`.
 */
export function buildFixtureExpectations(rows: UsageFixtureRow[]): Map<string, UsageFixtureExpectation> {
  const grouped = new Map<string, UsageFixtureRow[]>();
  for (const r of rows) {
    const list = grouped.get(r.user_id) ?? [];
    list.push(r);
    grouped.set(r.user_id, list);
  }
  const result = new Map<string, UsageFixtureExpectation>();
  for (const [userId, all] of grouped) {
    const windowed = all.filter((r) => inWindow(r.ts));
    const targetProtocol = windowed.filter((r) => r.expected_class === "protocol");
    const targetRawBusiness = windowed.filter((r) => r.expected_class !== "protocol");
    const targetDefaultUsage = windowed.filter((r) => r.expected_class === "default_usage");
    result.set(userId, {
      callsLast7d: windowed.length,
      targetRawBusinessCalls: targetRawBusiness.length,
      targetDefaultUsageCalls: targetDefaultUsage.length,
      targetProtocolCalls: targetProtocol.length,
      targetBusinessActive: targetDefaultUsage.length > 0
    });
  }
  return result;
}

/** access.yaml content for the fixture's configured Agents. */
export function buildFixtureAccessYaml(agents: FixtureAgent[] = buildFixtureAgents()): string {
  const users = agents
    .filter((a) => a.configured)
    .map((a, index) => {
      const tokens = a.token_hashes
        .map((h, i) => `      - hash: "${h}"\n        label: ${a.id}-token-${i + 1}\n        created: 2026-10-01`)
        .join("\n");
      return `  - id: ${a.id}
    name: ${a.id}
    enabled: true
    tokens:
${tokens}
${AGENT_TOOL_ALLOW}`;
    })
    .join("\n");
  return `roles:
  ${FIXTURE_ROLE_ID}:
    description: 财务只读
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_query
users:
${users}
defaults:
  deny_tools:
    - sql_execution
`;
}
