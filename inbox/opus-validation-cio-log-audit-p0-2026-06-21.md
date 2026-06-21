# Opus Validation - CIO Log Audit P0

Date: 2026-06-21

## Initial Opus Findings

### P1 - per-token last_used join lacked integration coverage

Opus noted that the new `getLastUsedMap` -> `userToAgent` token attribution path depended on exact equality between `t.hash.slice(0, 19)` and logged `token_hash_prefix`, but the frontend test only mocked returned `last_used` fields. It requested a route/integration test proving `access_log` rows attach `last_used`, `last_tool`, and `last_outcome` to issued agent tokens.

Resolution: added `webui/server/__tests__/admin-agents.test.ts` coverage for `/api/admin/agents/:userId` returning token last-used metadata from access log rows.

### P1 - getLastUsedMap could degrade on large audit tables

Opus flagged the original query:

```sql
SELECT user_id, token_hash_prefix, ts, tool, outcome
FROM access_log
WHERE user_id IN (...) AND token_hash_prefix IS NOT NULL
ORDER BY ts DESC
```

as pulling all historical rows and sorting them just to keep one row per token.

Resolution: changed the query to use `ROW_NUMBER() OVER (PARTITION BY user_id, token_hash_prefix ORDER BY ts DESC, id DESC)` and added `idx_al_user_token_ts` in both proxy/admin audit DB creation paths.

### P2 - audit list API redaction only happened in the frontend

Opus noted CSV export redacted server-side, while `/api/admin/audit` returned raw `argsSummary` to the browser and relied on React rendering to redact.

Resolution: `/api/admin/audit` now redacts `argsSummary` and `errorDetail` server-side before returning JSON. Frontend redaction remains as a defense-in-depth rendering guard.

### P2 - valid JSON string values could contain embedded secrets

Opus noted JSON values under non-sensitive keys, such as `{ "note": "password=hunter2" }`, were not redacted because only key names were checked.

Resolution: service-side redaction now also runs pair-pattern redaction on string leaf values. Test coverage includes `note: "password=hunter2"`.

### P2 - CSV formula injection

Opus noted `csvCell` escaped quotes but did not guard fields beginning with `=`, `+`, `-`, or `@`.

Resolution: CSV cells now prefix formula-like cell values with `'`. Test coverage includes a `client` field beginning with `=`.

### P2 - denied card wording did not match metric

Opus noted `deniedCalls` only counted `outcome='denied'`, while the card subtitle said `ACL / 上游错误`.

Resolution: subtitle now says `ACL 拒绝`.

## Remaining Non-Blocking Notes

- Frontend and server redaction patterns are still maintained separately; they should eventually be unified or generated from one source.
- Historical audit rows written before `token_hash_prefix` existed cannot populate token last-used metadata.
- CSV formula protection applies at cell boundaries; JSON fields are serialized as JSON cells, so formula-like values inside JSON strings are not spreadsheet formulas unless extracted.

## Verification

- `npm run build` passed.
- `npm test` passed: 28 files, 149 tests.

## Opus Revalidation

Opus revalidated the updated diff after the fixes above.

Conclusion: no remaining P0/P1 blockers.

Closed items:

- per-token `last_used` join now has an integration-style route test.
- recent-token lookup now uses a window query and `idx_al_user_token_ts`.
- `/api/admin/audit` and CSV export now redact server-side.
- string leaf values with `key=value` secrets are redacted.
- CSV cell formula injection is guarded with a leading quote.
- denied metric wording now matches `outcome='denied'`.

Remaining non-blocking P2/P3 risks from Opus:

- audit list summary/count queries can still scan the full audit table on broad filters; consider materialized summaries or stronger default time windows later.
- sensitive-key matching can over-redact fields whose names merely contain substrings like `token` or `cert`.
- summary cards follow active filters except protocol visibility, which may need clearer UX copy.
- token hash prefix is intentionally short for display/join; collision risk is negligible but should remain documented.
- arbitrary plaintext secrets without `key=value` syntax cannot be reliably detected by regex.
- CSV column expansion may affect any external parser expecting the old 10-column shape.
