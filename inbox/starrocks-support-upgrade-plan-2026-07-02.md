# Lucy StarRocks Support Upgrade Plan

| Item | Value |
|---|---|
| Status | Draft for owner confirmation |
| Date | 2026-07-02 |
| Scope | Roadmap upgrade and development plan for StarRocks support |
| Owner decision needed | Confirm whether StarRocks becomes an R1 target source, and which support tier is required |

## 1. Executive Summary

Recommendation: add StarRocks support to the Lucy roadmap, but ship it through a gated vertical slice instead of a wording-only roadmap change.

The safest product wording is:

> Lucy R1 supports StarRocks as a governed read-only OLAP target source through the MySQL wire protocol. Supported paths are schema scan, semantic-layer read/query, role/table-level ACL, query guardrails, audit, and release/eval evidence. Cross-source joins, write operations, StarRocks administration APIs, and StarRocks-specific optimizer/resource management are out of scope.

Why this is feasible:

- StarRocks officially supports MySQL protocol access and can be connected by MySQL clients/JDBC.
- StarRocks supports table-level `SELECT` privileges, which matches Lucy's read-only account model.
- Lucy already has MySQL-wire infrastructure and partial `engine: starrocks` recognition in `webui/server/project.ts`.

Why it still needs a development gate:

- MySQL protocol compatibility does not prove KTX semantic SQL, information_schema scanning, type mapping, timeout behavior, and guardrail/audit behavior all work.
- Current R1 docs, sample config, readiness scripts, evidence names, and release gates are still Doris-centric.
- Product docs currently conflict: one page says StarRocks is roadmap candidate; another says it is supported.

## 2. Current Evidence In Repo

| Area | Current state | Impact |
|---|---|---|
| Product intro | `docs/user-guide/product-intro.html` says MySQL + PostgreSQL are first-version sources, StarRocks/Oracle are roadmap candidates with no spike | Must update before claiming support |
| Data source guide | `docs/user-guide/data-sources.html` already lists StarRocks with `mysql2` and MySQL connection string | This is ahead of implementation evidence and should be corrected or promoted with gates |
| Connection model | `webui/server/project.ts` maps `driver: starrocks` to `engine: starrocks`, and maps StarRocks to MySQL wire protocol | Useful foundation |
| R1 plan | `docs/lucy-r1-controlled-data-service-plan.md` is centered on Doris / target source | Should become "OLAP target source" with Doris and StarRocks profiles |
| Config template | `ktx.yaml.example` contains `doris-r1` example only | Add `starrocks-r1` example after support is confirmed |
| Evidence scripts | `scripts/lucy-r1-doris-smoke.mjs` hardcodes `engine: "doris"` and Doris env names | Needs generic OLAP target smoke or StarRocks-specific companion |
| Release matrix | `scripts/release-artifacts.mjs` verified DBs are MySQL demo and PostgreSQL demo | Add StarRocks evidence only after real smoke passes |

## 3. Proposed Support Tier

### Recommended R1 Tier

R1 StarRocks support should be "certified read-only semantic query support", not "full database adapter support".

Included:

- Connection through MySQL wire protocol.
- `ktx connection test`.
- Schema scan/ingest for selected schemas and enabled tables.
- Semantic-layer validate/read/query.
- `lucy_catalog`, `lucy_read_source`, `lucy_query`, `lucy_explain_query`, `lucy_freshness`, `lucy_begin_question`.
- Role-aware tool visibility.
- Connection/source/table/view ACL.
- Raw SQL rejection for Agent-facing tools.
- Limit capping, timeout classification, error taxonomy, row/column/truncation metadata.
- Audit records for success, deny, SQL error, timeout, and upstream unavailable.
- Smoke and release evidence.

Excluded:

- Cross-source joins.
- DDL/DML/write operations, including StarRocks load jobs.
- StarRocks admin operations, resource groups, warehouses, user management, cluster management.
- StarRocks HTTP SQL API.
- StarRocks-specific query hints or optimizer controls.
- Column-level/row-level permissions and dynamic masking.
- Guarantee for all StarRocks versions before a version matrix is tested.

### Version Positioning

Do not promise `StarRocks 2.5+` until verified. Recommended wording:

- Certified: the customer target version used in the StarRocks vertical slice.
- Candidate baseline: StarRocks 3.5 stable or the customer's production version, whichever is required first.
- Earlier versions: best-effort until smoke evidence exists.

## 4. Development Phases

### Phase 0: Scope And Doc Alignment

Goal: remove roadmap ambiguity before coding starts.

Tasks:

- Update the R1 plan from "Doris vertical slice" to "OLAP target source vertical slice".
- Define `doris` and `starrocks` as target profiles under the same R1 contract.
- Fix product/user docs so StarRocks is not simultaneously "supported" and "unspiked".
- Decide whether StarRocks is R1 P0 or P1.
- Decide the minimum certified StarRocks version and target test environment.

Acceptance:

- One official support matrix exists.
- All docs use the same wording for StarRocks support.
- No user-facing page claims support before smoke evidence exists, unless clearly marked "planned".

### Phase 1: StarRocks Vertical Slice

Goal: prove the database path end to end.

Tasks:

- Add `starrocks-r1` example to `ktx.yaml.example` after owner confirms target fields.
- Use `driver: mysql`, `engine: starrocks`, `wire_protocol: mysql`, `readonly: true`, `r1_target: true`.
- Test `ktx connection test <connection-id>`.
- Run scan/ingest against a small allowlisted schema/table set.
- Validate generated manifest and overlay merge.
- Run `ktx sl validate`, `ktx sl read`, and `ktx sl query --execute`.
- Verify `LIMIT`, date/time fields, decimals, strings, nullable columns, and aggregate queries.
- Capture timeout and SQL error examples for taxonomy.

Acceptance:

- StarRocks connection is stable.
- Read-only account has only required read privileges.
- Schema scan produces valid semantic-layer YAML.
- At least one measure/dimension query returns expected rows through KTX.
- Failure cases are classifiable.

### Phase 2: Lucy MCP And Policy Integration

Goal: prove StarRocks works through Lucy, not only direct KTX CLI.

Tasks:

- Ensure `engine: starrocks` is treated as an R1 target source where appropriate.
- Confirm `lucy_catalog` only shows authorized StarRocks sources.
- Confirm `lucy_read_source` and `lucy_query` pass through to KTX and attach Lucy metadata.
- Confirm raw SQL is rejected at the Agent-facing tool boundary.
- Confirm unauthorized source/table/view references are denied and audited.
- Confirm `lucy_explain_query` reports StarRocks source resolution and guardrails without executing.
- Confirm `lucy_freshness` returns metadata-only freshness without inventing physical freshness.

Acceptance:

- StarRocks works through the six R1 `lucy_*` tools.
- Legacy/upstream tools remain hidden for R1 tokens.
- ACL and guardrail denials are fail-closed and recorded.

### Phase 3: Evidence Scripts And Tests

Goal: make StarRocks support repeatable.

Tasks:

- Refactor `scripts/lucy-r1-doris-smoke.mjs` into a generic `scripts/lucy-r1-olap-smoke.mjs`, or add a StarRocks-specific `scripts/lucy-r1-starrocks-smoke.mjs`.
- Recommended approach: generic script with `--engine doris|starrocks`; keep the Doris command as a compatibility wrapper if needed.
- Add tests for StarRocks evidence shape.
- Add `project.ts` tests for `engine: starrocks`, `wireProtocol: mysql`, and `r1Target` behavior.
- Parameterize readiness/release evidence checks so Doris and StarRocks can share the same contract.
- Add fixture data or a documented external evidence path.

Acceptance:

- Local tests pass without requiring a live StarRocks cluster.
- Live smoke produces `inbox/starrocks-r1-evidence.json`.
- Readiness gate can consume StarRocks evidence.

### Phase 4: Release Matrix And Docs Promotion

Goal: promote from "planned" to "supported".

Tasks:

- Update release docs and release artifact metadata to include StarRocks only when evidence is available.
- Update customer deployment guide with StarRocks connection example and read-only user guidance.
- Update user guide support table with certified version and limitations.
- Add troubleshooting notes for MySQL driver compatibility, case sensitivity, information_schema limitations, timeout classification, and privilege errors.
- Add release checklist item: StarRocks evidence must be fresh for releases that claim StarRocks support.

Acceptance:

- `lucy-release-metadata.json` can state StarRocks support with evidence.
- Customer docs are clear about what is supported and not supported.
- There is no unsupported blanket claim like "all StarRocks features supported".

## 5. Proposed File Changes After Confirmation

Docs/spec:

- `docs/lucy-r1-controlled-data-service-plan.md`
- `webui/docs/09-lucy-r1-mcp-tool-contract.md`
- `docs/release-ci.md`
- `docs/customer-deployment-guide.md`
- `docs/deployment-docker.md`
- `docs/user-guide/product-intro.html`
- `docs/user-guide/data-sources.html`
- `docs/user-guide/release-notes.html`

Config/model:

- `ktx.yaml.example`
- `webui/server/project.ts`
- `webui/server/model.ts`
- `webui/src/lib/types.ts`
- `webui/src/pages/connections/ConnectionOverview.tsx`

Tests/scripts:

- `webui/server/__tests__/project.test.ts`
- `scripts/lucy-r1-olap-smoke.mjs` or `scripts/lucy-r1-starrocks-smoke.mjs`
- `scripts/lucy-r1-doris-smoke.mjs` compatibility wrapper if genericized
- `scripts/lucy-r1-readiness.mjs`
- `scripts/lucy-r1-release-bundle.mjs`
- Related `*.test.mjs`

Optional examples:

- `examples/starrocks-demo/README.md`
- `examples/starrocks-demo/project-template/ktx.yaml`
- A Docker Compose StarRocks demo only if the image footprint and startup time are acceptable for CI.

## 6. Open Decisions

1. Is StarRocks R1 P0, or R1 P1 after Doris?
2. Which StarRocks version must be certified first?
3. Will we use a real customer/dev StarRocks cluster for smoke, or add a local container demo?
4. Should evidence be generic `olap-r1-evidence.json` or separate `doris-r1-evidence.json` and `starrocks-r1-evidence.json`?
5. Should `engine: starrocks` automatically imply `r1Target: true`, or only when `r1_target: true` is explicit?
6. Should the existing user guide claim `StarRocks 2.5+`, or should it be narrowed until tested?

## 7. Recommended Decisions

Recommended owner decisions:

- Treat StarRocks as R1 P1 unless there is a customer deadline that makes it P0.
- Use explicit `r1_target: true` for production StarRocks connections, but allow UI/model to recognize `engine: starrocks`.
- Create a generic OLAP target smoke script and keep Doris-specific aliases for compatibility.
- Require live StarRocks evidence before changing release artifacts to list StarRocks as verified.
- Replace `StarRocks 2.5+` in user docs with a "certified version pending smoke" statement until the first real environment passes.

## 8. Definition Of Done

StarRocks support is done only when all of the following are true:

- A StarRocks connection can be configured without secrets in git.
- KTX can test, scan, validate, and query the StarRocks source.
- Lucy R1 `lucy_*` tools can read/query the source through MCP.
- Raw SQL, DDL/DML, unauthorized tables, and disabled agents are rejected.
- Audit logs show StarRocks source, role/token, outcome, reason, duration, and result scale where available.
- Smoke evidence is generated and accepted by readiness/release checks.
- User-facing docs describe support scope and limitations consistently.
- No release artifact claims StarRocks support without matching evidence.

## 9. External References Checked

- StarRocks Introduction: https://docs.starrocks.io/docs/introduction/StarRocks_intro/
- StarRocks System Limits: https://docs.starrocks.io/docs/sql-reference/System_limit/
- StarRocks GRANT: https://docs.starrocks.io/docs/sql-reference/sql-statements/account-management/GRANT/
- StarRocks SELECT/LIMIT reference: https://docs.starrocks.io/docs/sql-reference/sql-statements/table_bucket_part_index/SELECT/SELECT_LIMIT/
