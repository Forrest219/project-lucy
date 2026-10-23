# audit-trust acceptance-matrix evidence

This directory contains CSV matrices produced by
[`scripts/audit-trust/2026-10-19-r1-acceptance-matrix.mjs`](../../2026-10-19-r1-acceptance-matrix.mjs)
during operator runs.

## Evidence shape

CSV is flat, three columns:
- `criterion` — the fixed assertion name (see `EXPECTED_CRITERIA_NAMES`).
- `observed_value` — what the manifest actually had.
- `verdict` — one of `pass`, `fail`, `n/a`.

The script exits with:
- `0` — every verdict is `pass` or `n/a` (no failures).
- `2` — at least one verdict is `fail`.
- `1` — argument / input / I/O error before rendering.

The script itself does **not** exit non-zero on `n/a`; `n/a` means
"criterion not applicable to this manifest shape" (e.g. an optional
field was missing). Operator reads `n/a` rows separately and decides
whether the omission is intentional.

## Criterion set (fixed)

The criterion set is **fixed at 16 entries** and asserted in
`scripts/audit-trust/__tests__/2026-10-19-r1-acceptance-matrix.test.mjs`:

```js
const FIXED_CRITERION_NAMES = Object.freeze([
  "schemaVersion is 'audit-export-manifest/v2'",
  "ledgerUpperSeq is a non-negative integer",
  "projectionComplete is boolean true",
  "scopeComplete is boolean true",
  "fileHashOk is boolean true",
  "relationCheckOk is boolean true",
  "combinedComplete = scopeComplete AND fileHashOk AND relationCheckOk",
  "associationQuality has all five categories",
  "dataScope.ok is boolean (always populated)",
  "clientCoverage.observed is boolean; gapWindows is an array",
  "policyScopeExpanded is an array (audit-trust spec §4.7)",
  "untrustedSelfReport is a non-negative integer",
  "legalEmptyWindow is boolean",
  "lagMs is a non-negative integer",
  "classificationVersion is non-empty",
  "digestVersion is non-empty"
]);
```

The test fixture `FIXED_CRITERION_NAMES` is independent of
`EXPECTED_CRITERIA_NAMES` exported from the script, so updating the
criterion set requires editing **both** the script and the test, with
the `deepEqual` assertion failing if either side drifts. This is the
T08b drift-guard.

## n/a branches

Four criteria have `n/a` branches:

| Criterion | n/a when |
|---|---|
| combinedComplete = … | any factor is non-boolean |
| associationQuality has all five categories | a required key is missing |
| clientCoverage.observed is boolean; gapWindows is an array | `observed` non-boolean or `gapWindows` not an array |
| policyScopeExpanded is an array | the field is `undefined` (optional) |

## Reproducing the r1 baseline matrix

```sh
node scripts/audit-trust/2026-10-19-r1-acceptance-matrix.mjs \
  --in path/to/manifest.json \
  --out scripts/audit-trust/2026-10-19-r1-acceptance-matrix/evidence/matrix-$(date -I).csv
```

The fixture manifest that produced the committed baseline file is the
synthetic "happy-path" used by the test suite. Operator runs against
real Lucy manifests will replace this fixture file with concrete
results.
