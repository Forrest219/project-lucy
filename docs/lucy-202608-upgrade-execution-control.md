# Lucy 202608 Enterprise Governance & Observability Execution Control

| Metadata | Content |
|---|---|
| Document name | Lucy 202608 Enterprise Governance & Observability Execution Control |
| Document type | Master Plan / Execution Control |
| Version | v0.7 |
| Written date | 2026-08-03；v0.3 更新 2026-08-03（收窄 202608 为访问治理与可观测性迭代，移出 FDE Copilot 与通用 Static Lint / Reindex）；v0.4 更新 2026-08-03（删除 Dynamic RLS / CLS POC active task，P2 收敛为只读风险复核与统一发布证据包）；v0.5 更新 2026-08-03（修正 Trace / Gate verifier 路径与 runner 口径）；v0.6 更新 2026-08-03（将 GOV-02 拆为 Dashboard 专项 work order，显式声明 GOV-04 为 P1 Active 缺口并允许 GOV-02 / GOV-04 并行启动）；v0.7 更新 2026-08-20（GOV-01 Kernel Landed；P0 Closure 指向 `docs/plans/2026-08-20-trace-evidence-p0-plan.md`） |
| Source | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` v0.6 |
| Scope | 202608 governance / observability specs, execution waves, minimax handoff, verification matrix |

---

## 1. Purpose

This document controls only the 202608 **Enterprise Governance & Observability** iteration.

Mainline scope:

- P0: Trace / Evidence Kernel for access governance, ACL policy decision trace, Admin Audit Trace read model.
- P1: Tiered Access Governance Gate, Safe Log-to-Security-Eval, Admin Observability Dashboard.
- P2: Agent / Role Risk Review Candidates, Release Readiness Evidence Package.

Deferred out of 202608:

- FDE Copilot Candidate.
- Generic semantic-layer Static Lint / Reindex Diagnosis.
- Broad Log-to-Eval for business quality cases.
- Dynamic RLS / CLS POC or GA.

## 2. Execution Waves

| Wave | Order | Parallel | Content | Dependency | Completion condition |
|---|---:|---|---|---|---|
| A | 1 | No | P0 Trace / Evidence Kernel + ACL policy decision trace | Spec 62 v0.5 | **Kernel Landed**；P0 Closed 见 Closure plan T2–T4 |
| B | 2 | Yes | Admin Audit Trace read model；Tiered Access Governance Gate；Safe Log-to-Security-Eval | Wave A event contract | read model can inspect evidence; gate writes events; security candidates are isolated |
| C | 3 | Yes | Admin Observability Dashboard | Wave A/B governance events | dashboard aggregates governance signals |
| D | 4 | No | Agent / Role Risk Review Candidates；Release Readiness Evidence Package；cross-wave review | A-C | release readiness evidence produced, non-browser verification pass |

## 3. Artifact Tracker

| ID | Spec | Plan / Task | Owner mode | Status | Notes |
|---|---|---|---|---|---|
| 202608-GOV-01 | `webui/docs/62-trace-evidence-kernel-spec.md` v0.5 | Kernel WO: `webui/docs/plans/wo-202608-01-trace-evidence-kernel.md`；P0 Closure: `docs/plans/2026-08-20-trace-evidence-p0-plan.md` | minimax backend agent | **Kernel Landed**；P0 Closure open | Foundation landed；Closure = evidence 完整度 + purge + Trace UI 术语 |
| 202608-GOV-02 | `webui/docs/69-admin-governance-observability-spec.md` | `webui/docs/plans/wo-202608-GOV-02-admin-governance-observability-dashboard.md` | minimax admin observability agent | Ready for execution | Dashboard aggregation only (GOV-02 专项 work order; trace read model / risk review / release package 已完成，本单不要重做) |
| 202608-GOV-03 | `webui/docs/64-tiered-publish-gate-spec.md` | `webui/docs/plans/wo-202608-03-tiered-publish-gate.md` | minimax governance gate agent | Ready after GOV-01 | Access Governance Gate, not generic publish gate |
| 202608-GOV-04 | `webui/docs/65-safe-log-to-eval-spec.md` | `webui/docs/plans/wo-202608-04-safe-log-to-eval.md` | minimax security eval agent | Ready for execution | Safe Log-to-Security-Eval only; **no implementation exists yet** — minimax 必须从零实现并补 verifier |
| 202608-GOV-05 | none | none | none | Deleted from 202608 | Dynamic RLS / CLS POC removed as超前设计；Lucy 当前没有多租户 |
| 202608-GOV-06 | `webui/docs/69-admin-governance-observability-spec.md` | `docs/plans/wo-202608-06-governance-review-release-evidence.md` | minimax governance ops agent | Ready after GOV-02/03/04 | Risk review candidates + release readiness evidence package |
| Deferred-202608-02 | `webui/docs/63-static-lint-reindex-diagnosis-spec.md` | `webui/docs/plans/wo-202608-02-static-lint-reindex-diagnosis.md` | none | Deferred | Not in 202608 governance iteration |
| Deferred-202608-05 | `webui/docs/66-fde-copilot-candidate-spec.md` | `webui/docs/plans/wo-202608-05-fde-copilot-candidate.md` | none | Deferred | Not in 202608 governance iteration |

Parallel-start note (v0.6)：

- 202608-GOV-02 与 202608-GOV-04 两份 work order 的文件边界**互不重叠**（前者只动 `server/admin/governance-observability.ts` + `src/pages/admin/**`，后者只动 `server/eval/security-candidates.ts` + `src/pages/eval/**`），可以**并行启动**两个 minimax。
- 推荐顺序：
  - GOV-02 先交 server 五个聚合 API（`overview` / `agents` / `roles` / `tokens` / `denials`），再交 Dashboard UI。
  - GOV-04 先交 candidate pool / reviewer / promotion preview，再交轻量 UI（如果做 UI 的话）。
- 两个任务都**不做浏览器验证**，仅跑各自工单内的 Vitest + 根目录 verifier + `npm run lint:terminology` / `lint:ia-boundary`。

Execution handoff rule:

- GOV-01 Kernel 已落地；后续 P0 Closure（T2–T4）以 `docs/plans/2026-08-20-trace-evidence-p0-plan.md` + Spec 62 v0.5 §11.2 为准，不要重做 append-only schema / 基础 helper。
- Give minimax the matching Work Order for GOV-03 / GOV-04（GOV-01 仅在领取 Closure 任务时使用上述 P0 plan）。
- For GOV-02, use `webui/docs/plans/wo-202608-GOV-02-admin-governance-observability-dashboard.md`（**Dashboard 专项**，已与 Trace Detail / Risk Review / Release Package 拆分）。**不要**让 GOV-02 重做 Trace Detail Drawer、`/api/admin/governance/risk-review`、`/api/admin/governance/release-readiness-package`。
- For GOV-04, use `webui/docs/plans/wo-202608-04-safe-log-to-eval.md`；该工单**当前没有实现**，minimax 必须从零补齐 `server/eval/security-candidates.ts`、测试、`scripts/verify-202608-safe-log-to-security-eval.mjs` 与 `/api/eval/security-candidates*` 五个路由。
- For GOV-06, use `docs/plans/wo-202608-06-governance-review-release-evidence.md` plus `webui/docs/69-admin-governance-observability-spec.md`.
- Do not hand minimax Deferred work orders unless the product owner explicitly reopens them.
- GOV-02 与 GOV-04 可以并行执行：两者文件边界互不重叠（见 §4 File Ownership）；不要在并行时把对方的文件一起改。
- AC-P0 `policyVersion`（`docs/access-control/plans/wo-202608-59-access-control-p0.md`）**不是** GOV-01 / Trace P0 Closure 范围。

## 4. File Ownership

| Agent | May change | Must not change |
|---|---|---|
| Trace agent | `webui/server/trace/**`、`webui/server/proxy/audit.ts`、`webui/server/proxy/mcp-proxy.ts`、trace tests、trace verify script | Eval promotion, semantic lint, FDE Copilot, dynamic isolation research |
| Admin observability agent | `webui/server/admin/governance-observability.ts`（新增）、`webui/server/admin/audit.ts`、`webui/server/observability.ts`、`webui/src/pages/admin/**`、admin observability tests | ACL decision semantics, semantic-layer writes, `webui/server/eval/**`, `webui/src/pages/eval/**`, Risk Review / Release Package 实现 |
| Governance gate agent | Agent / Role / Token admin APIs, governance gate module / tests | MCP Proxy ACL runtime result changes unless required by trace evidence |
| Security eval agent | `webui/server/eval/security-candidates.ts`（新增）、`webui/server/eval/**` candidate tables / APIs, eval candidate UI / tests | Direct writes to formal Eval YAML without reviewer evidence, `webui/server/admin/**`（除最小兼容读取外）, `webui/src/pages/admin/**`, `webui/server/trace/**` schema |
| Release evidence agent | `inbox/**` release readiness report, docs indexes | Product code unless fixing broken documentation links |

## 5. Global Minimax Instructions

1. Read this file, the matching spec, the matching work order or umbrella plan task, `docs/DEVELOPMENT.md`, and `webui/docs/00-product-terminology-standard.md`.
2. Record `git status --short` before starting.
3. Do not touch unrelated dirty worktree changes.
4. Do not run browser or mobile tests unless explicitly requested.
5. Do not read `.ktx/secrets/**`, do not output Token plaintext, do not modify production SQLite in tests.
6. All SQLite tests and verify scripts must use `:memory:` or unique temp SQLite files.
7. Do not implement FDE Copilot or Static Lint / Reindex under this iteration.
8. Do not implement Dynamic RLS / CLS POC or any dynamic tenant isolation path in 202608.

## 6. Test Runner Boundaries

| Scope | Command shape | Forbidden |
|---|---|---|
| `webui/` TS / TSX tests | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- <test files>` | Do not use root `node --test` for Vitest tests |
| `webui/scripts/` `.mjs` verify scripts | `cd /Users/zhangxingchen/Projects/project-lucy && node webui/scripts/verify-*.mjs` | Do not assume every verifier lives under root `scripts/` |
| TS-backed root verify scripts | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm run verify:gate -- --strict` | Do not run TypeScript-importing verifiers with root `node` |
| Root `.mjs` verify scripts | `cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-*.mjs` | Do not run with Vitest / Jest |
| Root Node native tests | `cd /Users/zhangxingchen/Projects/project-lucy && node --test <test files>` | Do not add Jest-only flags |

## 7. Verification Matrix

| ID | Required self-validation |
|---|---|
| 202608-GOV-01 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/trace-evidence.test.ts server/__tests__/mcp-proxy-trace.test.ts server/__tests__/admin-trace-events.test.ts src/__tests__/admin-audit-trace-drawer.test.tsx src/__tests__/admin-audit-trace-link.test.tsx`；`cd /Users/zhangxingchen/Projects/project-lucy && node webui/scripts/verify-202608-trace-evidence.mjs`；P0 Closure 另见 `docs/plans/2026-08-20-trace-evidence-p0-plan.md` 验证节 |
| 202608-GOV-02 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/admin-trace-events.test.ts src/__tests__/admin-trace-events.test.tsx server/__tests__/admin-governance-observability.test.ts src/__tests__/admin-governance-observability.test.tsx`；`cd /Users/zhangxingchen/Projects/project-lucy/webui && npm run lint:terminology && npm run lint:ia-boundary`。**不做浏览器验证。** |
| 202608-GOV-03 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/access-governance-gate.test.ts server/__tests__/admin-roles.test.ts server/__tests__/admin-agents.test.ts server/__tests__/admin-tokens.test.ts`；`cd /Users/zhangxingchen/Projects/project-lucy/webui && npm run verify:gate -- --strict` |
| 202608-GOV-04 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/security-eval-candidates.test.ts src/__tests__/security-eval-candidates.test.tsx`；`cd /Users/zhangxingchen/Projects/project-lucy && node scripts/verify-202608-safe-log-to-security-eval.mjs`；`cd /Users/zhangxingchen/Projects/project-lucy && npm run lint:terminology`。**不做浏览器验证。** |
| 202608-GOV-06 | `cd /Users/zhangxingchen/Projects/project-lucy/webui && npm test -- server/__tests__/admin-risk-review.test.ts server/__tests__/admin-release-readiness-package.test.ts` |

## 8. Review And Commit Gate

After each wave:

- Review security boundaries first: no raw payloads in hot store, no automatic permission expansion, no hidden dynamic isolation or multi-tenant path.
- Run the wave verification commands.
- Run `npm run lint:terminology` and `npm run lint:spec`.
- If lint failures are pre-existing and unrelated, document exact file / rule in the final note.
- Commit only after review and non-browser verification pass.

Suggested commit message:

```text
feat(202608): strengthen governance observability evidence loop
```

## 9. Known Failure Patterns To Prevent

- Treating SQLite as the access configuration source.
- Storing raw SQL AST, result rows, full original question, Token plaintext, DB credentials, or customer samples.
- Letting unreviewed security candidates enter formal Eval.
- Running Deferred FDE Copilot / Static Lint tasks as part of this iteration.
- Reintroducing Dynamic RLS / CLS POC or multi-tenant isolation work into 202608.
- Computing access gate decisions only in the frontend.
- Replacing existing `/admin` IA with an unrelated dashboard style.

## 10. Terminology Compliance

This control file follows `webui/docs/00-product-terminology-standard.md`.

Protected terms: `Agent`、`MCP`、`KTX`、`Trace`、`Evidence`、`Eval`、`SQL AST`、`Token`、`Role`、`ACL`、`access.yaml`、`semantic-layer`。
