# KTX MiniMax-M3 Runtime Validation TODO

Date: 2026-06-21
Scope: prove `ktx.yaml` LLM settings are actually used by KTX runtime paths.

## Preconditions

- Do not write the MiniMax API key to tracked repo files.
- Run tests from `/Users/forrest/Projects/project-lucy`.
- Key is stored locally at `.ktx/secrets/minimax-api-key`.
- Confirm the key file is ignored and only readable by the current user:

  ```bash
  git check-ignore -v .ktx/secrets/minimax-api-key
  ls -l .ktx/secrets/minimax-api-key
  ```

- Current expected config:

  ```yaml
  llm.provider.backend: anthropic
  llm.provider.anthropic.api_key: file:/Users/forrest/Projects/project-lucy/.ktx/secrets/minimax-api-key
  llm.provider.anthropic.base_url: https://api.minimaxi.com/anthropic/v1
  llm.models.default: MiniMax-M3
  llm.promptCaching.enabled: false
  ```

## Pass Criteria

- KTX reads `backend: anthropic` and `model: MiniMax-M3`.
- KTX runtime created from the actual project config can call MiniMax for text generation.
- KTX runtime created from the actual project config can complete one structured-output call.
- At least one low-risk KTX CLI path that depends on LLM succeeds.
- Any remaining failures are classified as model compatibility, KTX ingest coverage, or data/task issue.

## Test TODO

### T0. Static Config Checks

- [x] Run:

  ```bash
  ktx status --validate
  ktx status --fast --json
  ```

- [x] Confirm:
  - `config.status == ok`
  - `llm.backend == anthropic`
  - `llm.model == MiniMax-M3`
  - `promptCaching.enabled == false`

Result: PASS. `ktx status --validate` returned schema valid. `ktx status --fast --json` returned `llm.backend=anthropic`, `llm.model=MiniMax-M3`, `llm.status=ok`, `promptCaching.enabled=false`.

### T1. Full KTX Readiness With File Secret

- [x] Run without exporting `MINIMAX_API_KEY`:

  ```bash
  ktx status
  ```

- [x] Confirm:
  - LLM line shows `anthropic · MiniMax-M3`
  - detail shows `key set`
  - verdict is `Ready`

Result: PASS. `ktx status` returned `Ready` and `LLM anthropic · MiniMax-M3 ✓ key set`.

### T2. KTX LLM Health Check From Actual Project Config

This proves KTX can resolve `ktx.yaml` into an AI SDK runtime config and call MiniMax.

- [x] Run:

  ```bash
  node --input-type=module <<'NODE'
  import { loadKtxProject } from '/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx/dist/context/project/project.js';
  import { resolveLocalKtxLlmConfig } from '/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx/dist/context/llm/local-config.js';
  import { runKtxLlmHealthCheck } from '/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx/dist/llm/model-health.js';

  const project = await loadKtxProject({ projectDir: process.cwd() });
  const config = resolveLocalKtxLlmConfig(project.config.llm, process.env);
  const result = await runKtxLlmHealthCheck(config, { timeoutMs: 60000 });
  console.log(JSON.stringify({
    backend: config?.backend,
    model: config?.modelSlots?.default,
    ok: result.ok,
    message: result.message,
  }, null, 2));
  NODE
  ```

- [x] Confirm:
  - `backend` is `anthropic`
  - `model` is `MiniMax-M3`
  - `ok` is `true`

Result: PASS. Worker validation from actual `loadKtxProject` config returned `backend=anthropic`, `model=MiniMax-M3`, `ok=true`, elapsed about 1.2s.

### T3. KTX Runtime Text Generation From Actual Project Config

This proves the KTX runtime, not just health-check wiring, can generate text through MiniMax.

- [x] Run:

  ```bash
  node --input-type=module <<'NODE'
  import { loadKtxProject } from '/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx/dist/context/project/project.js';
  import { createLocalKtxLlmRuntimeFromConfig } from '/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx/dist/context/llm/local-config.js';

  const project = await loadKtxProject({ projectDir: process.cwd() });
  const runtime = createLocalKtxLlmRuntimeFromConfig(project.config.llm, { projectDir: project.projectDir, env: process.env });
  const text = await runtime.generateText({
    role: 'default',
    system: 'Reply with exactly the requested token.',
    prompt: 'Reply exactly: ktx-minimax-ok',
    temperature: 0,
  });
  console.log(JSON.stringify({ text }, null, 2));
  NODE
  ```

- [x] Confirm output contains `ktx-minimax-ok`.

Result: PASS. Worker validation from actual KTX runtime returned `text: ktx-minimax-ok`, elapsed about 3.1s.

### T4. KTX Runtime Structured Output From Actual Project Config

This is the main unresolved compatibility gap from the previous run.

- [x] Run:

  ```bash
  node --input-type=module <<'NODE'
  import { loadKtxProject } from '/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx/dist/context/project/project.js';
  import { createLocalKtxLlmRuntimeFromConfig } from '/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx/dist/context/llm/local-config.js';
  import { z } from '/Users/forrest/.local/node-v24.14.1-darwin-arm64/lib/node_modules/@kaelio/ktx/node_modules/zod/index.js';

  const project = await loadKtxProject({ projectDir: process.cwd() });
  const runtime = createLocalKtxLlmRuntimeFromConfig(project.config.llm, { projectDir: project.projectDir, env: process.env });
  const output = await runtime.generateObject({
    role: 'candidateExtraction',
    system: 'Return only data that satisfies the schema.',
    prompt: 'Return ok=true, label="ktx-minimax-structured", and score=1.',
    schema: z.object({
      ok: z.boolean(),
      label: z.string(),
      score: z.number(),
    }),
    temperature: 0,
  });
  console.log(JSON.stringify(output, null, 2));
  NODE
  ```

- [x] Confirm:
  - command returns within 60 seconds
  - `ok === true`
  - `label === "ktx-minimax-structured"`
  - `score === 1`

- [x] If it hangs or fails:
  - capture stderr and exact error
  - classify as structured-output compatibility issue
  - do not proceed to broad ingest until resolved or accepted

Result: PASS. Worker validation from actual KTX runtime returned `{ ok: true, label: "ktx-minimax-structured", score: 1 }`, elapsed about 1.8s. No hang or parser failure.

### T5. Low-Risk KTX CLI LLM Path

Use text ingest because it is lower risk than full database ingest and exercises KTX memory ingestion.

- [x] Run:

  ```bash
  ktx ingest --text "MiniMax-M3 runtime validation note: ktx should capture this short validation note." --json --no-input
  ```

- [x] Confirm:
  - command exits 0
  - output has no auth/protocol/model error
  - if JSON includes model/usage/LLM metrics, record them in the results section

Result: PASS. `ktx ingest --text ... --json --no-input` exited 0 with `status: done`; run id `memory-8ac78549-eb4c-4bc6-b304-3a103c787481`; no auth/protocol/model error.

### T6. Database Ingest Small-Scope Check

Only run after T4 and T5 pass.

- [x] Run:

  ```bash
  ktx ingest mysql-aliyun --json --no-input
  ```

- [x] Confirm:
  - command exits 0
  - no Anthropic/MiniMax protocol errors
  - no structured-output parser failure
  - generated/updated report indicates non-empty completed work or a clean no-op

Result: PASS. `ktx ingest mysql-aliyun --json --no-input` exited 0. `database-schema` completed; `query-history`, `source-ingest`, and `memory-update` were skipped. No Anthropic/MiniMax protocol error and no structured-output parser failure.

### T7. Schema Scan / Relationship Enrichment Coverage

KTX 0.12.0 installed here does not expose a public `ktx scan` CLI command. This is not a blocking capability gap for this validation because KTX exposes schema scan / enrichment through `ktx ingest <connectionId>`.

- [x] Treat `ktx ingest mysql-aliyun --json --no-input` as the canonical public schema scan / enrichment entrypoint for KTX 0.12.0.
- [x] Confirm the `database-schema` step completes.
- [x] Do not run broad schema refreshes against production without explicit approval.

Result: PASS / COVERED BY INGEST. KTX 0.12.0 does not expose a public `ktx scan` command, but `ktx ingest mysql-aliyun --json --no-input` is the public entrypoint that runs the database schema scan / enrichment path. T6 completed `database-schema` successfully with no Anthropic/MiniMax protocol error and no structured-output parser failure.

### T8. Hermes Workhorse KTX MCP Business Path

Use the local Hermes `workhorse` profile, which is bound to KTX MCP, to prove a real agent can query KX financial data through the MCP boundary.

- [x] Confirm `workhorse` MCP server `lucy_ktx` is enabled.
- [x] Confirm the MCP server exposes KTX tools.
- [x] Run one read-only query through Hermes oneshot, instructing the agent to use KTX MCP only.
- [x] Return the actual KTX tools, source/table, query summary, and no more than 5 rows.

Commands:

```bash
hermes --profile workhorse --accept-hooks mcp test lucy_ktx
hermes --profile workhorse --accept-hooks -z '<read-only KTX MCP KX income statement validation prompt>'
```

Result: PASS. `lucy_ktx` connected at `http://localhost:7879/mcp` and discovered 4 tools: `sl_read_source`, `sl_query`, `entity_details`, and `kx_catalog`. Hermes `workhorse` used `kx_catalog`, `sl_read_source`, and `sl_query` to query `kx_vw_income_statement_detail` / `dataforai.kx_vw_income_statement_detail`, filtering income statement rows where `项目名称 LIKE '%营业收入%'`, ordered by latest `报表期间`, limit 5. Returned 5 rows for `深圳市柯西信息科技...`, including 202604 `本年累计金额=69339.62` and `本月金额=69339.62`, plus 202605 `本年累计金额=69339.62` with `本月金额=null`. This proves `workhorse -> lucy_ktx MCP -> KX income statement view` is usable.

## Result Log

Fill after execution:

| Test | Status | Evidence |
|---|---|---|
| T0 Static config | PASS | schema valid; `anthropic` / `MiniMax-M3`; prompt caching disabled |
| T1 Full readiness | PASS | `ktx status` Ready; `key set` from file secret |
| T2 LLM health from config | PASS | actual `loadKtxProject` config health check `ok=true` |
| T3 Runtime text generation | PASS | actual KTX runtime returned `ktx-minimax-ok` |
| T4 Runtime structured output | PASS | actual KTX runtime returned expected object in about 1.8s |
| T5 Text ingest | PASS | `ktx ingest --text` exited 0, status `done` |
| T6 DB ingest small-scope | PASS | `database-schema` completed, no protocol/parser error |
| T7 Scan/enrichment coverage | PASS | no standalone `ktx scan` in KTX 0.12.0; public scan/enrichment path is covered by `ktx ingest mysql-aliyun` |
| T8 Hermes workhorse KTX MCP path | PASS | `workhorse` queried `kx_vw_income_statement_detail` through `lucy_ktx` and returned 5营业收入 rows |

## Stop Conditions

- Missing `.ktx/secrets/minimax-api-key`.
- Any command logs the real API key.
- MiniMax returns auth/model/base URL errors.
- T4 structured output hangs or fails repeatedly.
- Any DB ingest step appears to mutate production data outside KTX local state.
