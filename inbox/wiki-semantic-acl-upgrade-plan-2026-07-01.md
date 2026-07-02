# Wiki / Semantic Metadata ACL Upgrade Plan

| Item | Value |
|---|---|
| Date | 2026-07-01 |
| Status | Pending approval |
| Scope | Lucy MCP Proxy ACL for wiki and semantic metadata; POC discovery and query-routing hardening |
| Trigger | `poc_demo` can read `kx-financial-analysis-playbook.md` through `wiki_read` and leak KX financial business context despite lacking KX data access; `moz` / `lucy_poc` was also guided to ask the user to choose between `mysql-aliyun` and `poc-mysql-aliyun` instead of deterministically querying POC ad revenue |
| Decision | No temporary hotfix for now; implement durable ACL upgrade after approval |

## 1. Problem Statement

Current Lucy MCP Proxy ACL mainly protects data-bearing tools and table-touching calls. This blocks low-privilege roles from querying unauthorized rows/tables, but it does not fully protect business knowledge.

Observed leak:

- `poc_demo` has role `poc_readonly`.
- `poc_demo` cannot query KX financial sources.
- `poc_demo` can still call `wiki_read` for `wiki/global/kx-financial-analysis-playbook.md`.
- That page exposes sensitive business context such as KX financial analysis口径、公司别名、报表分析方法 and domain existence.

This is a metadata / knowledge disclosure vulnerability. Even without raw data access, low-privilege roles can infer unauthorized domains, metrics, business workflows, and analysis methods.

Observed POC query regression:

- `moz` is configured as `lucy_poc` and authenticates as `poc_demo` / `poc_readonly`.
- `poc_readonly` is only authorized for `poc-mysql-aliyun`, but the model called `connection_list` and saw two configured MySQL connections.
- The agent then asked the user to choose between `mysql-aliyun` and `poc-mysql-aliyun`, even though `mysql-aliyun` is not authorized for this token.
- The same turn did not successfully call `sl_query`; it stopped after `connection_list`, `wiki_search`, repeated failing `wiki_read`, and a later MCP unreachable state.
- `wiki_read` key handling is inconsistent: the real file is `wiki/global/poc-ad-revenue.md`, but the tool rejected `global/poc-ad-revenue` and the suggested flat key `global-poc-ad-revenue` did not resolve.
- Prior query attempts also show missing or fragile month routing, such as generated `dt_month` references that are not declared as a semantic dimension.

## 2. Goal

Extend ACL from "data access control" to "data knowledge access control".

After this upgrade, a role may only see:

- Authorized semantic sources and their metadata.
- Authorized wiki pages.
- Authorized dictionary / discovery / entity details output.
- Authorized connection and catalog entries.
- Role-appropriate runtime discovery and instructions.

Unauthorized roles must not see page titles, snippets, source names, schema/table names, field dictionaries, business口径, examples, or playbooks for domains outside their effective permissions.

For the POC ad-revenue workflow specifically, `moz` / `poc_demo` must be able to answer "用 lucy 查本年各月的广告收入" without asking the user to select a database. The route is deterministic:

- connection: `poc-mysql-aliyun`
- schema: `data_agent_poc`
- primary source: `poc_ad_revenue_daily`
- measure: `poc_ad_revenue_daily.ad_revenue`
- date field: `poc_ad_revenue_daily.dt`
- default filter: `country = '国内'`
- data period: 2026-01-01 through 2026-05-31

## 3. Non-Goals

- No immediate hotfix removing `wiki_search` / `wiki_read` from `poc_readonly`.
- No raw SQL enablement.
- No row-level / column-level ACL in this iteration.
- No redesign of KTX upstream MCP server.
- No change to model prompts as the primary enforcement layer. Enforcement must remain in Lucy MCP Proxy.
- No broadening of `poc_readonly` data access beyond the five currently authorized POC tables.
- No exposure of `mysql-aliyun`, KX, or Superstore metadata to `poc_readonly` as a workaround.

## 4. Security Principles

1. Default deny for knowledge artifacts.
2. ACL must be enforced in proxy, not trusted to the agent.
3. Wiki search must filter before content reaches the client.
4. Wiki read must deny before returning title/body/snippet.
5. Semantic metadata tools must filter outputs, not only reject data queries.
6. Mixed-domain pages are visible only if the role can access every protected reference, unless explicitly allowed by role.
7. Audit should distinguish denied from filtered results.

## 5. Proposed ACL Model

### 5.1 Effective Permissions Remain the Source of Truth

Reuse the existing role resolution in `webui/server/proxy/acl.ts`:

- role ids
- allowed tools
- allowed connections
- allowed physical tables
- allowed semantic sources
- permission snapshot hash

Add small reusable helpers around the resolved permission snapshot:

- `canAccessConnection(identity, connectionId)`
- `canAccessSource(identity, sourceRef)`
- `canAccessTable(identity, physicalTable)`
- `canAccessWikiPage(identity, wikiPageMeta)`
- `filterSourceRefs(identity, refs)`
- `filterWikiResults(identity, results)`

### 5.2 Wiki Page Metadata

Add frontmatter ACL metadata to wiki pages:

```yaml
---
visibility: private
sl_refs:
  - poc-mysql-aliyun/data_agent_poc/poc_ad_revenue_daily
allowed_roles: []
---
```

Rules:

- `visibility: public`: visible to all authenticated users.
- `visibility: private` or missing: requires ACL match.
- `sl_refs`: all referenced sources/tables must be allowed for the current role.
- `allowed_roles`: any matching role grants access.
- If both `sl_refs` and `allowed_roles` exist, either can grant access unless a future spec introduces `require_all`.
- Missing `visibility`, missing `sl_refs`, and missing `allowed_roles` means not visible to low-privilege roles.

Reference formats to support:

- `connection/schema/source`
- `connection/schema/table`
- `schema.table`
- existing KTX `sl_refs` if present

Resolution should normalize to the existing source map used by ACL.

## 6. Implementation Plan

### Phase 0: POC Discovery and Query-Routing Hot Path

This phase addresses the concrete `moz` screenshot regression before the broader wiki ACL migration lands.

#### 0.1 Filter or Replace `connection_list`

Problem:

- `connection_list` currently reaches upstream KTX and returns all configured connections.
- `poc_demo` only has `connections: ["poc-mysql-aliyun"]`, but the client can still see `mysql-aliyun`.
- This causes the model to ask the user to choose a database and leaks the existence of unauthorized domains.

Required behavior:

- For authenticated requests through Lucy proxy, `connection_list` must return only effective-permission connections.
- For `poc_demo`, `connection_list` returns exactly `["poc-mysql-aliyun"]`.
- If filtering the upstream response is brittle, serve `connection_list` locally from `resolveEffectivePermissions` and do not forward it to KTX.
- Audit should record whether the result was local or filtered, and how many connections were suppressed.

Acceptance:

- `poc_demo` cannot see `mysql-aliyun` via `connection_list`.
- `workhorse` / `kx_readonly` sees only `mysql-aliyun`.
- `forrest_local` sees only the connections allowed by its role; do not assume all configured connections unless the role actually grants them.

#### 0.2 Add a Role-Aware Catalog Entry Point

Problem:

- Runtime instructions say "current token visibility is determined by `kx_catalog`".
- `poc_readonly` does not currently allow `kx_catalog`, so the agent falls back to `connection_list` / `wiki_search`.
- The `kx_` name is also misleading for POC and non-KX domains.

Required behavior, choose one:

1. Preferred: add `lucy_catalog` as the neutral proxy-served catalog tool.
   - Returns effective `connections`, `sources`, source descriptions, common query templates, and examples.
   - Works for POC, KX, Superstore, and local dev roles.
   - `kx_catalog` can remain as a compatibility alias or KX-specific facade.
2. Minimum viable: allow `kx_catalog` for `poc_readonly` and make its payload role-aware enough to return POC sources only.

For `poc_demo`, catalog must include:

- `poc_ad_revenue_daily`
- `poc_ad_revenue_by_type_daily`
- `poc_app_active_daily`
- `poc_ceo_metric_snapshot`
- `poc_metric_catalog`

It must not include:

- `mysql-aliyun`
- `dataforai.*`
- `kx_*`
- Superstore sources
- `forbidden_finance`

#### 0.3 Make POC Ad-Revenue Query Deterministic

Problem:

- The target question is routable without user clarification.
- Prior attempts failed because the agent used ambiguous measures, missing `connectionId`, wrong fields such as `category`, or generated undeclared dimensions such as `dt_month`.

Required behavior:

- For "本年各月广告收入", route to `poc_ad_revenue_daily`.
- Use `connectionId="poc-mysql-aliyun"`.
- Use qualified measure `poc_ad_revenue_daily.ad_revenue`.
- Use source-qualified date field `poc_ad_revenue_daily.dt`.
- Filter to domestic POC scope unless the user asks otherwise.
- Do not ask the user to select a connection.

Month handling, choose one:

1. Preferred semantic fix: add a `dt_month` computed dimension to POC ad revenue sources and reindex.
2. Minimum viable runtime fix: query daily results by `dt`, then aggregate to month client-side / agent-side, while explicitly converting UTC ISO display values to `Asia/Shanghai` business dates.

Acceptance:

- `moz` / `poc_demo` can answer "用 lucy 查本年各月的广告收入" with 2026-01 through 2026-05 monthly values.
- The answer states the POC data period is 2026-01-01 through 2026-05-31.
- The answer includes provenance for `poc-mysql-aliyun.data_agent_poc.poc_ad_revenue_daily`.
- No tool call references `mysql-aliyun`.
- No answer is produced from wiki-only context when `sl_query` did not return data.

### Phase A: Characterize Current Leak With Tests

Add failing tests before implementation:

- `poc_demo` can currently `wiki_read` KX playbook.
- `poc_demo` can currently discover KX wiki via `wiki_search`.
- `poc_demo` can currently call metadata tools that may reveal unauthorized domains.
- `poc_demo` can currently see unauthorized `mysql-aliyun` through `connection_list`.
- `poc_demo` currently lacks a safe catalog path for authorized POC sources.
- `wiki_search` may return a key that `wiki_read` cannot consume directly.
- `moz` / `poc_demo` currently fails or asks for clarification on "用 lucy 查本年各月的广告收入".

Expected final behavior:

- `poc_demo` cannot read `kx-financial-analysis-playbook`.
- `poc_demo` search for `KX`, `财务`, or company aliases returns no KX-only pages.
- `poc_demo` can read POC pages.
- `poc_demo` search for POC ad revenue returns only authorized POC pages with read-compatible keys.
- `poc_demo` can discover exactly its authorized POC sources through `lucy_catalog` or the chosen catalog fallback.
- `poc_demo` sees exactly one connection, `poc-mysql-aliyun`, through any connection discovery path.
- `forrest_local` can read local dev full-access pages.
- `workhorse` / `kx_readonly` can read KX pages.

Primary files likely touched:

- `webui/server/__tests__/mcp-proxy-acl.test.ts`
- `webui/server/__tests__/mcp-proxy-smoke.test.ts`
- New focused test file if existing tests become too broad.

### Phase B: Add Wiki ACL Parser and Decision Helper

Implement wiki frontmatter parsing inside proxy-side code, close to ACL rather than frontend wiki code.

Likely file options:

- `webui/server/proxy/wiki-acl.ts` for isolated page parsing and decision logic.
- Or extend `webui/server/proxy/acl.ts` if keeping ACL in one module is simpler.

Behavior:

- Load wiki markdown by path/slug from project root.
- Parse YAML frontmatter.
- Extract `visibility`, `sl_refs`, `allowed_roles`.
- Normalize referenced sources to physical table refs via existing source map.
- Return allow/deny decision without exposing page content.

### Phase C: Filter `wiki_read`

In `webui/server/proxy/mcp-proxy.ts`:

- Intercept `tools/call` for `wiki_read`.
- Extract requested page identifier from tool args.
- Resolve page path.
- Accept the same key shape emitted by `wiki_search`; `wiki_search` result keys must be round-trippable into `wiki_read` without model-side rewriting.
- Support existing repository wiki paths such as `global/poc-ad-revenue.md` and the upstream KTX key shape observed in real responses.
- Run `canAccessWikiPage`.
- If denied, return MCP tool result with generic access denied:
  - no title
  - no page path beyond what the caller already supplied
  - no body/snippet
- Audit reason: `wiki_forbidden`.

Additional read-key acceptance:

- If the upstream tool currently rejects `global/poc-ad-revenue` while the repo file is `wiki/global/poc-ad-revenue.md`, Lucy proxy should either normalize and serve/forward the correct key, or rewrite the upstream error into a usable, exact key that actually works.
- Do not leave the agent in a loop where `global/poc-ad-revenue` is invalid and `global-poc-ad-revenue` is not found.

### Phase D: Filter `wiki_search`

In `webui/server/proxy/mcp-proxy.ts`:

- Let upstream KTX execute `wiki_search`.
- Buffer response in proxy.
- Parse JSON or SSE payload.
- Remove unauthorized wiki results before sending response to client.
- Preserve or normalize result keys so every returned result can be passed to `wiki_read` exactly as returned.
- Prefer returning a canonical `key` plus optional `displayPath`; the `key` must be machine-usable.
- Ensure snippets from unauthorized pages never pass through.
- Audit:
  - `outcome=ok`
  - `decision_reason=allowed`
  - add filter summary where available, e.g. `wiki_filtered:<count>`.

If KTX response shape is hard to parse robustly, add a conservative fallback:

- If parsing fails, return a proxy-side error rather than pass through unfiltered results for authenticated clients.
- This should be fail-closed for `wiki_search`, unlike initialize instructions injection which can fail open.

### Phase E: Semantic Metadata Filtering

Review and update all metadata-bearing tools:

- `connection_list`: return only allowed connections.
- `entity_details`: already table-touching, but ensure unknown / unauthorized refs do not reveal entity metadata.
- `dictionary_search`: either filter results to allowed sources or deny for roles lacking all sensitive metadata access.
- `discover_data`: either filter results to allowed sources or deny for roles lacking all sensitive metadata access.
- `kx_catalog`: already generated from effective permissions; keep and expand tests.
- `sl_read_source`: already table-checked; ensure denial does not disclose source metadata beyond generic reason.
- `tools/list`: keep tool filtering, but do not treat allowed tool visibility as enough to expose all content.

Preferred behavior:

- For tools whose output can be filtered safely, filter.
- For tools whose output shape is unstable or hard to filter safely, deny unless the role has broad enough metadata access.

### Phase F: Role-Aware Initialize Instructions

Proxy ACL is the security boundary, but instructions still shape model behavior. Current global instructions include POC, Superstore, and KX routes for every token. This causes low-privilege POC agents to reason about unauthorized domains before ACL eventually blocks them.

Required behavior:

- Keep a shared base instruction section for universal data QA rules.
- Add role/domain-specific instruction fragments derived from effective permissions.
- For `poc_readonly`, inject only POC routes, POC date rules, POC examples, and POC allowed sources.
- Do not inject KX or Superstore routing tables into `poc_readonly` initialize instructions.
- If using a neutral `lucy_catalog`, tell agents to call that first; do not tell POC agents to call `kx_catalog` unless that tool is intentionally allowed and role-aware.

Acceptance:

- Initialize response for `poc_demo` contains `poc-mysql-aliyun` and POC sources.
- Initialize response for `poc_demo` does not contain `mysql-aliyun`, `dataforai`, `kx_`, or Superstore route guidance.
- Initialize response for `workhorse` still contains KX guidance.
- Tests verify instruction content by role, not just that instructions were injected.

### Phase G: Wiki Metadata Migration

Add frontmatter ACL to existing wiki pages.

Suggested mapping:

| Page | Access |
|---|---|
| `wiki/global/poc-active-analysis.md` | POC active tables |
| `wiki/global/poc-ad-revenue.md` | POC ad revenue tables |
| `wiki/global/poc-idm-governance.md` | POC metric snapshot / metric catalog |
| `wiki/global/poc-data-agent-playbook.md` | POC role or POC table refs |
| `wiki/global/kx-financial-analysis-playbook.md` | KX role / KX table refs |
| `wiki/global/superstore-analysis-playbook.md` | Superstore table refs |
| `wiki/global/discount-policy.md` | Superstore table refs |
| `wiki/global/profit-rule.md` | Superstore table refs |
| `wiki/global/return-semantics.md` | Superstore returns/orders refs |

If one page mixes domains, split the page or require the higher-privilege role.

### Phase H: End-to-End POC Query UAT

Add a real or mocked MCP UAT path for the exact failure class.

Required scenario:

User prompt:

```text
用 lucy 查本年各月的广告收入
```

Expected tool behavior:

- Discovery uses role-aware catalog or filtered connection discovery.
- The agent does not ask the user to choose a database.
- The agent calls `sl_read_source` and/or `sl_query` against `poc-mysql-aliyun`.
- The query uses `poc_ad_revenue_daily` for monthly total ad revenue.
- No tool call attempts `mysql-aliyun`.
- No final answer is emitted if data retrieval failed; the agent must report the tool failure instead of guessing.

Expected answer behavior:

- Returns monthly values for available 2026 POC data.
- States that available data currently covers 2026-01-01 through 2026-05-31.
- Uses Beijing business dates when interpreting `dt`.
- Includes provenance footer with connection/source/table.

### Phase I: Spec and UAT Docs

After code behavior is accepted, update formal docs:

- `webui/docs/07-mcp-auth-proxy-spec.md`
- `docs/uat-agent-permissions.md`
- `docs/security-guide.md` if relevant
- `webui/config/access.yaml` comments if the role/tool semantics need clarification
- `webui/config/data-qa-instructions.md` or its replacement role-fragment docs, if role-aware instruction injection changes the runtime instruction source.

This phase touches governance/spec files and should be done after implementation details are settled.

## 7. Acceptance Criteria

### Security

- `poc_demo` cannot read `wiki/global/kx-financial-analysis-playbook.md`.
- `poc_demo` cannot discover KX-only wiki pages via `wiki_search`.
- `poc_demo` cannot discover KX-only semantic metadata via dictionary/discovery/entity tools.
- `poc_demo` cannot discover unauthorized connections through `connection_list`.
- `poc_demo` can still query/read authorized POC semantic sources.
- `poc_demo` can read POC wiki pages.
- `forbidden_finance` remains invisible to `poc_demo` in semantic and wiki paths.
- KX roles can read KX wiki and KX semantic metadata.

### Behavior

- Unauthorized content is filtered before leaving proxy.
- Denied reads return generic access denied without leaking page title/body/snippet.
- Filtered search returns an empty or reduced result set, not an error, unless response parsing fails.
- Parse failure for ACL-sensitive search/discovery paths fails closed.
- Wiki search result keys are round-trippable: every visible `wiki_search` result can be passed directly to `wiki_read`.
- POC agents receive role-appropriate discovery and instructions.
- POC ad-revenue monthly query does not ask the user to choose a connection and does not answer from wiki-only context.

### Audit

- Denied `wiki_read` is recorded.
- Filtered `wiki_search` is recorded with enough detail to investigate.
- Permission snapshot hash remains attached to relevant access logs.

### Tests

- Add regression tests for POC, KX, and local full-access roles.
- Add an end-to-end regression for `poc_demo`: "用 lucy 查本年各月的广告收入".
- Add role-aware initialize instruction tests.
- Add wiki key round-trip tests.
- Add connection discovery filtering tests.
- Existing MCP proxy smoke/ACL tests remain green.

## 8. Risks and Open Decisions

1. **Wiki response shape from KTX may vary.**
   Need inspect real `wiki_search` and `wiki_read` response payloads before final filtering implementation.

2. **Default deny may hide existing useful docs.**
   This is intentional for security, but migration must annotate all needed pages.

3. **Mixed-domain wiki pages need product decisions.**
   A single page containing both POC and KX content should either be split or restricted to the higher privilege.

4. **`allowed_roles` vs `sl_refs` semantics.**
   Proposed rule is OR. If stricter behavior is needed, add `acl_mode: all`.

5. **Search indexing still contains unauthorized pages upstream.**
   This plan filters proxy output. It does not re-index KTX per role.

6. **Catalog naming and backward compatibility.**
   Existing clients may know `kx_catalog`. Introducing `lucy_catalog` is cleaner, but compatibility may require keeping `kx_catalog` as an alias or KX-specific tool during migration.

7. **Role-aware instructions are not a security boundary.**
   They improve agent behavior but must never replace proxy-side ACL checks. Tests should verify both instruction content and enforcement behavior.

8. **Monthly aggregation may require semantic-layer changes.**
   Adding `dt_month` is cleaner but touches semantic-layer and requires reindex. Daily-query-plus-client-aggregation is lower-risk but should be treated as a documented fallback, not hidden improvisation.

## 9. Recommended Execution Order After Approval

1. Add failing tests for the concrete `moz` regression: filtered connection discovery, catalog availability, wiki key round-trip, and monthly POC ad-revenue query.
2. Implement `connection_list` filtering or local serving from effective permissions.
3. Add `lucy_catalog` or make `kx_catalog` safely role-aware for POC.
4. Fix wiki key round-trip behavior for `wiki_search` -> `wiki_read`.
5. Add failing tests for `poc_demo` wiki/KX metadata leak.
6. Implement wiki ACL parsing and `wiki_read` denial.
7. Implement `wiki_search` filtering.
8. Extend semantic metadata filtering tests and implementation.
9. Decide and implement POC month handling (`dt_month` semantic dimension vs daily query + aggregation fallback).
10. Implement role-aware initialize instructions.
11. Migrate wiki frontmatter.
12. Run full webui test suite.
13. Manually verify with real `poc_demo`, `workhorse`, and `forrest_local` tokens through `:7879/mcp`.
14. Run the exact `moz` UAT: "用 lucy 查本年各月的广告收入".
15. Update formal docs/specs.

## 10. Approval Request

Approve this plan to proceed with durable ACL upgrade without temporary removal of `wiki_search` / `wiki_read` from `poc_readonly`.
