# KTX LLM Switch To MiniMax Execution Plan

Date: 2026-06-21
Status: approved for execution
Scope: `ktx.yaml` LLM provider and model role configuration

## Decision

Use KTX's `anthropic` backend directly with MiniMax's Anthropic-compatible API.
Do not use LiteLLM for the first cut.

Reasons:

- KTX 0.12.0 supports `llm.provider.anthropic.api_key` and `base_url`.
- MiniMax supports Anthropic-compatible SDK/API access.
- This avoids the protocol mismatch risk between KTX's AI SDK Gateway provider and LiteLLM's Anthropic/OpenAI proxy routes.

## Target Config

```yaml
llm:
  provider:
    backend: anthropic
    anthropic:
      api_key: env:MINIMAX_API_KEY
      base_url: https://api.minimaxi.com/anthropic/v1
  models:
    default: MiniMax-M3
    triage: MiniMax-M3
    candidateExtraction: MiniMax-M3
    curator: MiniMax-M3
    reconcile: MiniMax-M3
    repair: MiniMax-M3
    # NOTE: 高风险审查（reviewer skill）跑在 Claude Code 主会话里，模型由用户 /model 选定，不在此处控制。
  promptCaching:
    enabled: false
```

## Preconditions

- `MINIMAX_API_KEY` must be present in the shell environment before running real LLM calls.
- Execution update: `MINIMAX_API_KEY` was injected into a temporary shell for validation only, not written to the repository.
- Business/data owner accepts that KTX LLM prompts may be sent to MiniMax.

## Execution Steps

1. Back up the current config:

   ```bash
   cp ktx.yaml inbox/ktx.yaml.before-minimax-20260621.bak
   ```

2. Modify `ktx.yaml` to the target config above.

3. Validate schema:

   ```bash
   ktx status --validate
   ```

4. Validate readiness without remote probes:

   ```bash
   ktx status --fast --json
   ```

5. Once `MINIMAX_API_KEY` is exported, run full readiness:

   ```bash
   ktx status
   ```

6. Run a lightweight smoke test:

   ```bash
   ktx wiki "test query" 2>&1 | head -40
   ```

7. If the smoke test passes, run one low-risk structured-output path before any large ingest/scan run.

## Rollback

Preferred rollback:

```bash
cp inbox/ktx.yaml.before-minimax-20260621.bak ktx.yaml
ktx status --validate
ktx status --fast
```

Git rollback is only acceptable if no other concurrent edits to `ktx.yaml` need to be preserved:

```bash
git checkout -- ktx.yaml
```

## Go / No-Go

Go:

- `ktx status --validate` passes.
- `ktx status --fast --json` shows `backend: anthropic` and `model: MiniMax-M3`.
- After key injection, `ktx status` has no auth/protocol failure.
- At least one lightweight LLM call succeeds.

No-Go:

- `MINIMAX_API_KEY` cannot be provided.
- MiniMax rejects the model name or base URL.
- KTX structured generation cannot parse MiniMax output.
- Data governance rejects sending KTX prompt context to MiniMax.
