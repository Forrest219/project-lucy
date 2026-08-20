# Lucy Trace / Evidence P0 Implementation Plan

> **For Claude:** P0-only plan. Do not expand into P1 Gate / Security Eval / Dashboard or P2 Risk Review / Release Package unless product owner reopens scope.

**Goal:** Designate and close Lucy 202608 P0 Governance Evidence Kernel so every allow / deny can be explained by identity, permission snapshot, reach, and result scale — without re-persisting sensitive business data.

**Architecture:** Keep `access.yaml` as access configuration fact source and `.ktx-ui/audit.sqlite` as the shared audit + Trace / Evidence hot store. Dual-write MCP Proxy decisions to `access_log` and append-only `trace_events` / `evidence_events`. Expose read-only Trace Detail from `/admin/audit`.

**Tech Stack:** TypeScript, Fastify, React, better-sqlite3, existing Admin Audit page / Drawer patterns.

**Canonical Spec:** `webui/docs/62-trace-evidence-kernel-spec.md` v0.5.1  
**Integrity baseline:** `docs/access-control/integrity-p0-decision.md`（IP0；扩展且不替代本工程 P0）  
**Blueprint:** `docs/lucy-202608-reliable-delivery-upgrade-spec.md` §5  
**Execution control:** `docs/lucy-202608-upgrade-execution-control.md`（GOV-01）  
**Kernel work order (historical):** `webui/docs/plans/wo-202608-01-trace-evidence-kernel.md`

---

## Scope

This plan covers **only** P0:

1. Trace / Evidence Kernel
2. ACL Policy Decision Trace
3. Admin Audit Trace Read Model
4. P0 Closure gaps required for **P0 Closed**（evidence 完整度、retention purge、术语 UI）

Out of scope:

- 完整性 P0 全集中的 **IP0-3 / IP0-4** 实现（受控查询指纹、授权↔触达对账；须另批 Spec + WO）。本计划仅交付 **IP0-1**（工程 Trace P0）；IP0-2 覆盖率指标不阻塞 P0 Closed（见 Spec 62 §4.1）
- AC-P0 `policyVersion` / capability model（`docs/access-control/plans/wo-202608-59-access-control-p0.md`）
- P1 Access Governance Gate、Safe Log-to-Security-Eval、Admin Observability Dashboard
- P2 Risk Review Candidates、Release Readiness Evidence Package
- Visual Debugger、OTel export、SSO、Dynamic RLS / CLS
- Browser / mobile tests（unless explicitly requested later）

Global constraints:

- Do not read or write `.ktx/secrets/**`.
- Do not store raw result rows, raw SQL AST, full original question, DB credentials, customer row samples, or unredacted Token / secret in SQLite.
- SQLite tests must use `:memory:` or unique temp files.
- Trace write failure must not break MCP traffic.
- Prefer `permissionSnapshotHash` as the P0 policy binding（no `policyVersion` requirement）.

---

## Status Snapshot（2026-08-20）

| Layer | Status |
|---|---|
| Kernel + helper + MCP policy decision dual-write | **Kernel Landed** |
| Admin Trace Read API + Audit Drawer | **Kernel Landed** |
| `result_snapshot_hash` / source evidence on MCP path | **P0 Closed** |
| Retention purge worker | **P0 Closed** |
| Trace UI terminology alignment | **P0 Closed** |
| Spec / gap / terminology docs | **Done** |

---

## Tasks

### Task T0: Spec / terminology / gap documentation alignment（本轮）

**Files:**

- Modify: `webui/docs/62-trace-evidence-kernel-spec.md`（v0.5）
- Create: `docs/plans/2026-08-20-trace-evidence-p0-plan.md`（本文件）
- Modify: `webui/docs/00-product-terminology-standard.md`
- Modify: `docs/access-control/gap-analysis-202608.md`
- Modify: `docs/lucy-202608-upgrade-execution-control.md`
- Modify: `docs/lucy-202608-reliable-delivery-upgrade-spec.md`
- Modify: `docs/plans/README.md`

**Steps:**

1. Freeze P0 最低充分条件、五元组、三件套、Kernel Landed / P0 Closed 两档验收于 Spec 62.
2. Register Trace Read Model terms in terminology standard §4.7.
3. Correct gap analysis P0 rows from「未建」to Landed / Partial.
4. Point execution control GOV-01 to Landed + this Closure plan.
5. Index this plan from `docs/plans/README.md` and blueprint §10.

**Expected:** Document package is the authoritative handoff; no runtime code changes in T0.

### Task T1: Kernel Landed regression verify

**Files:** none（verify only）

**Steps:**

1. Run Vitest + verifier + terminology lint（commands below）.
2. Confirm tests use temp / memory DB and do not touch `.ktx-ui/audit.sqlite`.
3. Confirm denied MCP path still yields `policy_decision` + `access_policy` evidence in tests.

**Expected:** Green regression for Kernel Landed acceptance（Spec §11.1）.

### Task T2: Evidence completeness on MCP path（P0 Closure）

**Files:**

- Modify: `webui/server/trace/evidence.ts`
- Modify: `webui/server/proxy/mcp-proxy.ts`
- Modify: `webui/server/__tests__/trace-evidence.test.ts`
- Modify: `webui/server/__tests__/mcp-proxy-trace.test.ts`
- Optional modify: `webui/scripts/verify-202608-trace-evidence.mjs`

**Steps:**

1. When response row / column counts are known, write `result_snapshot_hash` evidence（hash of bounded size summary only）.
2. When `access_log_sources`（or equivalent source refs）are available for the call, write `semantic_yaml_node`（or agreed source evidence kind）refs.
3. Keep hot-store blacklist：no result rows, no SQL AST plaintext.
4. Extend tests / verifier for the new evidence kinds.

**Expected:** Allow / deny Trace chain includes policy + scope + result-scale hashes when data is available.

### Task T3: Retention purge worker（P0 Closure）

**Files:**

- Modify: `webui/server/trace/evidence.ts`（or dedicated purge module under `webui/server/trace/`）
- Create: `webui/server/__tests__/trace-evidence-purge.test.ts`
- Optional modify: verifier script

**Steps:**

1. Implement purge / archive selection by `retention_days` / `max_rows` / `max_bytes`.
2. Preserve evidence still referenced by active release, formal Eval Case, or reviewer decision unless archived first.
3. After purge, allow `PRAGMA incremental_vacuum(N)`.
4. Do not full-`VACUUM` production DBs that are not already `auto_vacuum = INCREMENTAL`.

**Expected:** Hot store can enforce Spec retention without deleting protected evidence.

### Task T4: Admin Trace UI terminology alignment（P0 Closure）

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx`（Trace Drawer / links）
- Modify: related `webui/src/__tests__/admin-audit-trace-*.tsx`
- Follow: `webui/docs/00-product-terminology-standard.md` §4.7 Trace 子表

**Steps:**

1. Map section titles to registered UI 主术语（Trace 详情 / 有序 Span / 策略裁决 / Evidence Ref 等）.
2. Add `translate="no"` + `notranslate` on protected English / id nodes.
3. Run `npm run lint:terminology`.

**Expected:** Trace Read Model copy matches terminology standard; no Kernel Evidence / Action Evidence mix-up.

### Task T5: Execution-control / gap closure marking

**Files:**

- Modify: `docs/lucy-202608-upgrade-execution-control.md`
- Modify: `docs/access-control/gap-analysis-202608.md`
- Optional: create `webui/docs/plans/wo-202608-01b-trace-evidence-p0-closure.md` when T2–T4 start coding

**Steps:**

1. After T2–T4 land, mark GOV-01 / P0 as **P0 Closed**.
2. Keep AC-P0 `policyVersion` listed as separate domain work, not Trace P0 debt.

**Expected:** Tracker and gap table match code reality.

---

## Verification

No browser tests required for this plan.

```bash
cd webui && npm test -- \
  server/__tests__/trace-evidence.test.ts \
  server/__tests__/mcp-proxy-trace.test.ts \
  server/__tests__/admin-trace-events.test.ts \
  src/__tests__/admin-audit-trace-drawer.test.tsx \
  src/__tests__/admin-audit-trace-link.test.tsx

node webui/scripts/verify-202608-trace-evidence.mjs

npm run lint:terminology
```

After T3 lands, also run purge unit tests:

```bash
cd webui && npm test -- server/__tests__/trace-evidence-purge.test.ts
```

---

## Done Definitions

| Gate | Meaning |
|---|---|
| **T0 Done** | Spec 62 v0.5 + this plan + terminology + gap / tracker sync merged |
| **Kernel Landed** | Spec §11.1；GOV-01 foundation already in tree |
| **P0 Closed** | Spec §11.2；T2–T4 complete + T5 tracker update |

---

## Terminology Compliance

This plan follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Trace`、`Evidence`、`Span`、`Agent`、`MCP`、`Token`、`Role`、`ACL`、`access.yaml`、`Eval`、`SQL AST`.
