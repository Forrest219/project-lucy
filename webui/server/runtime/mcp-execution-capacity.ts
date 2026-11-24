/**
 * P1-82 — MCP execution capacity coordinator (Agent / Token / connection / global).
 *
 * Replaces the per-Token `lucyQueryInflight` counter, which (a) only covered `lucy_query`, (b) let one
 * Agent multiply its share by opening more Tokens or Sessions, and (c) was released when the downstream
 * response closed, not when the upstream work actually ended.
 *
 * Contract (Spec D1–D6):
 * - Admission is synchronous and never waits: a full scope is refused immediately, before any upstream work.
 * - Scopes are checked in the order token → agent → connection → global; the first full scope is reported.
 * - `agent < connection <= global` is enforced on the configured limits.
 * - A lease is released exactly once, by the caller, when the real work has ended (never on downstream close).
 * - Metrics carry ids and counters only: no Token, password, query text or result rows.
 */
export type CapacityScopeName = "token" | "agent" | "connection" | "global";

export type CapacityLimits = Record<CapacityScopeName, number>;

export const DEFAULT_CAPACITY_LIMITS: CapacityLimits = { token: 4, agent: 8, connection: 16, global: 24 };

/** Retry guidance returned to clients; they add jitter and must not auto-replay indeterminate work. */
const RETRY_AFTER_MS: CapacityLimits = { token: 1_000, agent: 1_000, connection: 2_000, global: 3_000 };

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

/**
 * Reads limits from env and repairs an invalid ordering instead of failing the process:
 * `connection` is raised above `agent`, `global` is raised to at least `connection`.
 * Returns the repairs so the caller can log them once.
 */
export function resolveCapacityLimits(env: NodeJS.ProcessEnv = process.env): { limits: CapacityLimits; repaired: string[] } {
  const token = positiveInt(env.LUCY_QUERY_MAX_INFLIGHT, DEFAULT_CAPACITY_LIMITS.token);
  const agent = positiveInt(env.LUCY_MCP_AGENT_MAX_INFLIGHT, Math.max(DEFAULT_CAPACITY_LIMITS.agent, token));
  let connection = positiveInt(env.LUCY_MCP_CONNECTION_MAX_INFLIGHT, DEFAULT_CAPACITY_LIMITS.connection);
  let global = positiveInt(env.LUCY_MCP_GLOBAL_MAX_INFLIGHT, DEFAULT_CAPACITY_LIMITS.global);
  const repaired: string[] = [];
  if (connection <= agent) {
    connection = agent + 1;
    repaired.push(`connection raised to ${connection} (must exceed agent ${agent})`);
  }
  if (global < connection) {
    global = connection;
    repaired.push(`global raised to ${global} (must be >= connection)`);
  }
  return { limits: { token, agent, connection, global }, repaired };
}

export type CapacityRequest = {
  agentId: string;
  /** Opaque, non-secret Token identity (hash prefix). */
  tokenKey: string;
  /** Empty when the call does not name a connection. */
  connectionId: string;
  /** Per-Token cap on/off; the proxy sets it for every upstream semantic tool (no tool may bypass the Token slots). */
  enforceToken: boolean;
};

export type CapacityLease = {
  readonly id: number;
  /** Idempotent. Call only when the upstream work has really ended. */
  release: () => void;
};

export type CapacityDecision =
  | { allowed: true; lease: CapacityLease }
  | { allowed: false; scope: CapacityScopeName; active: number; max: number; retryAfterMs: number };

type Counters = Map<string, number>;

export type CapacitySnapshot = {
  limits: CapacityLimits;
  global: { active: number; peak: number };
  activeByAgent: Record<string, number>;
  activeByConnection: Record<string, number>;
  activeTokens: number;
  rejectedByScope: Record<CapacityScopeName, number>;
  acquired: number;
  released: number;
};

export class McpExecutionCapacity {
  private readonly agents: Counters = new Map();
  private readonly tokens: Counters = new Map();
  private readonly connections: Counters = new Map();
  private globalActive = 0;
  private globalPeak = 0;
  private nextId = 1;
  private acquired = 0;
  private released = 0;
  private readonly rejected: Record<CapacityScopeName, number> = { token: 0, agent: 0, connection: 0, global: 0 };

  constructor(private limits: CapacityLimits) {
    McpExecutionCapacity.assertOrdering(limits);
  }

  static assertOrdering(limits: CapacityLimits): void {
    if (!(limits.agent < limits.connection && limits.connection <= limits.global)) {
      throw new Error(`capacity limits must satisfy agent < connection <= global (got ${limits.agent}/${limits.connection}/${limits.global})`);
    }
    for (const value of Object.values(limits)) {
      if (!Number.isInteger(value) || value < 1) throw new Error("capacity limits must be positive integers");
    }
  }

  configure(limits: CapacityLimits): void {
    McpExecutionCapacity.assertOrdering(limits);
    this.limits = limits;
  }

  getLimits(): CapacityLimits {
    return { ...this.limits };
  }

  tryAcquire(request: CapacityRequest): CapacityDecision {
    const checks: Array<[CapacityScopeName, number, number]> = [];
    if (request.enforceToken) checks.push(["token", this.tokens.get(request.tokenKey) ?? 0, this.limits.token]);
    checks.push(["agent", this.agents.get(request.agentId) ?? 0, this.limits.agent]);
    if (request.connectionId) checks.push(["connection", this.connections.get(request.connectionId) ?? 0, this.limits.connection]);
    checks.push(["global", this.globalActive, this.limits.global]);
    for (const [scope, active, max] of checks) {
      if (active >= max) {
        this.rejected[scope] += 1;
        return { allowed: false, scope, active, max, retryAfterMs: RETRY_AFTER_MS[scope] };
      }
    }

    const tokenKey = request.enforceToken ? request.tokenKey : null;
    const connectionId = request.connectionId || null;
    bump(this.agents, request.agentId, 1);
    if (tokenKey !== null) bump(this.tokens, tokenKey, 1);
    if (connectionId !== null) bump(this.connections, connectionId, 1);
    this.globalActive += 1;
    if (this.globalActive > this.globalPeak) this.globalPeak = this.globalActive;
    this.acquired += 1;

    let done = false;
    const id = this.nextId++;
    return {
      allowed: true,
      lease: {
        id,
        release: () => {
          if (done) return;
          done = true;
          bump(this.agents, request.agentId, -1);
          if (tokenKey !== null) bump(this.tokens, tokenKey, -1);
          if (connectionId !== null) bump(this.connections, connectionId, -1);
          this.globalActive -= 1;
          this.released += 1;
        }
      }
    };
  }

  snapshot(): CapacitySnapshot {
    return {
      limits: { ...this.limits },
      global: { active: this.globalActive, peak: this.globalPeak },
      activeByAgent: Object.fromEntries(this.agents),
      activeByConnection: Object.fromEntries(this.connections),
      activeTokens: this.tokens.size,
      rejectedByScope: { ...this.rejected },
      acquired: this.acquired,
      released: this.released
    };
  }

  /** Aggregate-only view for unauthenticated probes: no Agent or connection identifiers. */
  publicSummary() {
    const snap = this.snapshot();
    return {
      limits: snap.limits,
      global: snap.global,
      activeAgents: Object.keys(snap.activeByAgent).length,
      activeConnections: Object.keys(snap.activeByConnection).length,
      rejectedByScope: snap.rejectedByScope,
      acquired: snap.acquired,
      released: snap.released
    };
  }

  resetForTests(): void {
    this.agents.clear();
    this.tokens.clear();
    this.connections.clear();
    this.globalActive = 0;
    this.globalPeak = 0;
    this.acquired = 0;
    this.released = 0;
    for (const scope of Object.keys(this.rejected) as CapacityScopeName[]) this.rejected[scope] = 0;
  }
}

function bump(map: Counters, key: string, delta: number): void {
  const next = (map.get(key) ?? 0) + delta;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

const resolved = resolveCapacityLimits();
let singleton = new McpExecutionCapacity(resolved.limits);

export function getMcpExecutionCapacity(): McpExecutionCapacity {
  return singleton;
}

if (resolved.repaired.length > 0) {
  console.warn(`[mcp-capacity] limits adjusted to keep agent < connection <= global: ${resolved.repaired.join("; ")}`);
}

/** Test-only: swap the process-wide coordinator. */
export function setMcpExecutionCapacityForTests(limits?: CapacityLimits): McpExecutionCapacity {
  singleton = new McpExecutionCapacity(limits ?? resolveCapacityLimits().limits);
  return singleton;
}
