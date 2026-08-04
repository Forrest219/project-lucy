# Lucy Enterprise Governance & Observability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the 202608 Governance & Observability iteration so Lucy can explain, audit, observe, review, and package Agent / Role / Token access behavior as a trustworthy enterprise data agent platform.

**Architecture:** Keep `access.yaml` as the access configuration fact source and `.ktx-ui/audit.sqlite` as the audit / Trace / Evidence hot store. Extend existing `/admin` pages and APIs rather than creating a new console; route risky governance actions through append-only evidence, tiered gates, reviewer evidence, and security regression cases.

**Tech Stack:** TypeScript, Fastify, React, better-sqlite3, YAML `access.yaml`, existing Eval SQLite store, existing WebUI PageHeader / table / Drawer / metric card components.

---

## Scope

This plan implements only:

- P0 MVP: Trace / Evidence Kernel for access governance, ACL policy decision trace, Admin Audit Trace read model.
- P1 Reliable Governance: Tiered Access Governance Gate, Safe Log-to-Security-Eval, Admin Observability Dashboard.
- P2 Governance Review: Agent / Role Risk Review Candidates, Release Readiness Evidence Package.

Do not implement:

- FDE Copilot Candidate.
- Generic Static Lint / Reindex Diagnosis.
- Broad business Log-to-Eval.
- Dynamic RLS / CLS POC or production runtime.

## Execution Waves

| Wave | Tasks | Blocking rule |
|---|---|---|
| A | Task 1 | Must finish first |
| B | Task 2, Task 3, Task 4 | Can run after Task 1 contract is stable |
| C | Task 5 | Can run after relevant Wave B APIs are stable |
| D | Task 6, Task 7 | Cross-wave review and release readiness evidence |

Global constraints:

- Do not read or write `.ktx/secrets/**`.
- Do not store raw result rows, raw SQL AST, full original question, DB credentials, customer row samples, or unredacted Token / secret in SQLite.
- SQLite tests must use `:memory:` or unique temp files.
- WebUI tests use `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- ...`.
- Root scripts use `cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-*.mjs` or `node --test ...`.
- Browser tests are not required unless explicitly requested later.

### Task 1: P0 Trace / Evidence Kernel And ACL Policy Decision Trace

**Files:**
- Create: `webui/server/trace/evidence.ts`
- Create: `webui/server/__tests__/trace-evidence.test.ts`
- Create: `webui/server/__tests__/mcp-proxy-trace.test.ts`
- Create: `scripts/verify-202608-trace-evidence.mjs`
- Modify: `webui/server/proxy/audit.ts`
- Modify: `webui/server/admin/audit.ts`
- Modify: `webui/server/proxy/mcp-proxy.ts`

**Steps:**

1. Write failing tests for append-only `trace_events` and `evidence_events`.
2. Implement schema setup with WAL, `busyTimeout: 5000`, new DB `auto_vacuum = INCREMENTAL`, and constants `365 / 500000 / 1073741824`.
3. Implement `writeTraceEvent()`, `writeEvidenceEvents()`, `listTraceEvents()`, and `hashArtifact()`.
4. Add hot-store payload guard for raw SQL AST, raw token, raw result rows, full question text, DB credentials, and customer samples.
5. Integrate MCP Proxy business `tools/call` with `mcp_tools_call` and `policy_decision` events.
6. Preserve existing `access_log` behavior and response semantics.
7. Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/trace-evidence.test.ts server/__tests__/mcp-proxy-trace.test.ts
cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-trace-evidence.mjs
```

**Expected:** tests pass; no test touches real `.ktx-ui/audit.sqlite`; denied calls produce policy decision trace.

### Task 2: P0 Admin Audit Trace Read Model

**Files:**
- Create: `webui/server/__tests__/admin-trace-events.test.ts`
- Create: `webui/src/__tests__/admin-trace-events.test.tsx`
- Modify: `webui/server/admin/audit.ts`
- Modify: `webui/src/pages/admin/Audit.tsx`
- Optional create: `webui/src/pages/admin/TraceDetail.tsx`

**Steps:**

1. Write API tests for `GET /api/admin/trace/events?traceId=<id>` and `GET /api/admin/trace/events?turnId=<id>`.
2. Implement read-only trace event listing with evidence refs.
3. Add audit row link to trace detail when trace can be resolved from `traceId`, `turnId`, `requestId`, or access log evidence.
4. Render ordered spans, policy decision, evidence refs, artifact hashes, and redacted metadata.
5. Add tests proving raw args, raw SQL AST, raw result rows, and Token plaintext do not render.
6. Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/admin-trace-events.test.ts src/__tests__/admin-trace-events.test.tsx
```

**Expected:** Admin can inspect evidence chain from an audit row without mutating trace events.

### Task 3: P1 Tiered Access Governance Gate

**Files:**
- Create: `webui/server/access-governance-gate.ts`
- Create: `webui/server/__tests__/access-governance-gate.test.ts`
- Create: `scripts/verify-202608-access-governance-gate.mjs`
- Modify: `webui/server/admin/agents.ts`
- Modify: `webui/server/admin/roles.ts`
- Modify: `webui/server/admin/tokens.ts`

**Steps:**

1. Write tests for P0 permission expansion, global deny weakening, sensitive source exposure, and single-approver override rejection.
2. Implement `AccessGovernanceGateDecision` with P0 / P1 / P2 results.
3. Hook Agent / Role / Token dryRun responses to include gate decisions.
4. Require explicit gate pass or valid override before durable governance writes when P0 is triggered.
5. Write gate decisions and override evidence to Trace / Evidence.
6. Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/access-governance-gate.test.ts server/__tests__/admin-agents.test.ts server/__tests__/admin-roles.test.ts server/__tests__/admin-tokens.test.ts
cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-access-governance-gate.mjs
```

**Expected:** high-risk Agent / Role / Token changes are blocked or require valid override evidence.

### Task 4: P1 Safe Log-to-Security-Eval

**Files:**
- Create: `webui/server/eval/security-candidates.ts`
- Create: `webui/server/__tests__/security-eval-candidates.test.ts`
- Create: `webui/src/__tests__/security-eval-candidates.test.tsx`
- Create: `scripts/verify-202608-safe-log-to-security-eval.mjs`
- Modify: `webui/server/eval/db.ts`
- Modify: Eval route registration

**Steps:**

1. Add security candidate tables under `.ktx-ui/eval/`.
2. Extract candidates from denied / forbidden / raw query / sensitive metadata access logs and linked trace events.
3. Reject high-entropy credentials; keep semantic Token / API key usage questions as P0 security candidates.
4. Require reviewer evidence before promotion.
5. Generate formal P0 security Eval case preview only after accepted review.
6. Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/security-eval-candidates.test.ts src/__tests__/security-eval-candidates.test.tsx
cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-safe-log-to-security-eval.mjs
```

**Expected:** denied logs can become reviewed P0 security regression cases; unreviewed candidates cannot enter formal Eval.

### Task 5: P1 Admin Governance Observability Dashboard

**Files:**
- Create: `webui/server/__tests__/admin-governance-observability.test.ts`
- Create: `webui/src/__tests__/admin-governance-observability.test.tsx`
- Modify: `webui/server/observability.ts` or create `webui/server/admin/governance-observability.ts`
- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/pages/admin/RoleList.tsx`
- Optional create: `webui/src/pages/admin/GovernanceOverview.tsx`

**Steps:**

1. Define governance metrics for Agent calls, denied rate, error rate, p95 latency, active Token count, Role usage, stale Token, and denial reason trends.
2. Implement API returning bounded aggregates from `access_log`, `permission_snapshots`, `revoked_tokens`, and `config_change_log`.
3. Add dashboard UI using existing metric cards and tables.
4. Link anomalies to `/admin/audit`, Agent detail, and Role detail.
5. Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/admin-governance-observability.test.ts src/__tests__/admin-governance-observability.test.tsx
```

**Expected:** operators can see high-denial Agent, risky Role, stale Token, and denial trends without reading raw logs.

### Task 6: P2 Agent / Role Risk Review Candidates

MiniMax Code handoff: `docs/plans/wo-202608-06-governance-review-release-evidence.md`.

**Files:**
- Create: `webui/server/admin/risk-review.ts`
- Create: `webui/server/__tests__/admin-risk-review.test.ts`
- Optional create: `webui/src/pages/admin/RiskReview.tsx`
- Modify: admin route registration

**Steps:**

1. Generate review candidates for unused Role, over-broad Role, broken Role, stale Token, revoked Token attempts, and high-denial Agent.
2. Store reviewer note / review evidence as append-only evidence event.
3. Do not auto-change `access.yaml`.
4. Link each candidate to Agent / Role / Audit evidence.
5. Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/admin-risk-review.test.ts
```

**Expected:** risk review exposes read-only governance candidates and optional reviewer evidence without making permission changes or implementing a remediation lifecycle.

### Task 7: P2 Release Readiness Evidence Package

MiniMax Code handoff: `docs/plans/wo-202608-06-governance-review-release-evidence.md`.

**Files:**
- Create: `webui/server/admin/release-readiness-package.ts`
- Create: `webui/server/__tests__/admin-release-readiness-package.test.ts`
- Create: `inbox/202608-governance-release-readiness.md`
- Modify: `docs/README.md`
- Modify: `docs/plans/README.md`

**Steps:**

1. Build one bounded release readiness evidence package with access config hash, Agent / Role / Token inventory, denied events summary, config changes, security Eval summary, and risk review candidate summary.
2. Ensure package redacts Token plaintext and does not include raw result rows or DB credentials.
3. Generate release readiness Markdown under `inbox/`.
4. Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/admin-release-readiness-package.test.ts
cd /Users/zhangxingchen/Projects/project-lucy && npm run lint:terminology
cd /Users/zhangxingchen/Projects/project-lucy && npm run lint:spec
```

**Expected:** the single release readiness evidence package is bounded, redacted, based only on current facts, and linked to the 202608 evidence chain.
