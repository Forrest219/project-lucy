# audit-trust acceptance-matrix evidence

This directory contains CSV matrices produced by
[`scripts/audit-trust/2026-10-19-r1-acceptance-matrix.mjs`](../../2026-10-19-r1-acceptance-matrix.mjs)
during operator runs.

## Evidence shape

The CSV is flat: three columns (`criterion`, `observed_value`, `verdict`).
`verdict` is one of `pass`, `fail`, or `n/a`. The script exits with code 0
when every criterion passes; exits with code 2 when any fails.

## Criterion set

The criterion set is **fixed** and asserted in
`scripts/audit-trust/__tests__/2026-10-19-r1-acceptance-matrix.test.mjs`.
Adding a new criterion requires:

1. Adding a builder to `buildCriteria()` in the script.
2. Adding a test asserting the criterion appears in `buildCriteria()`.

Currently 16 criteria, covering:

- `schemaVersion == "audit-export-manifest/v2"` (drift guard).
- `ledgerUpperSeq` / `lagMs` / `untrustedSelfReport` non-negative integers.
- `projectionComplete` / `scopeComplete` / `fileHashOk` / `relationCheckOk` booleans.
- `combinedComplete == scopeComplete && fileHashOk && relationCheckOk`.
- `associationQuality` carries all five categories.
- `dataScope.ok`, `clientCoverage` shape.
- `policyScopeExpanded` array per spec §4.7.
- `classificationVersion` / `digestVersion` non-empty.

## Reproducing the r1 baseline matrix

```sh
node scripts/audit-trust/2026-10-19-r1-acceptance-matrix.mjs \
  --in path/to/manifest.json \
  --out scripts/audit-trust/2026-10-19-r1-acceptance-matrix/evidence/matrix-$(date -I).csv
```

The fixture manifest that produced the committed baseline file:

```json
{
  "schemaVersion": "audit-export-manifest/v2",
  "classificationVersion": "audit-trust-2026-10-19-r1.v1",
  "digestVersion": "audit-trust-2026-10-19-r1.v1",
  "ledgerUpperSeq": 12345,
  "projectionComplete": true,
  "scopeComplete": true,
  "dataScope": { "ok": true },
  "associationQuality": { "confirmed": 100, "candidate": 20, "unassigned": 5, "conflict": 0, "legacyUnverified": 3 },
  "clientCoverage": { "observed": true, "gapWindows": [] },
  "integrityVerification": { "fileHashOk": true, "relationCheckOk": true },
  "combinedComplete": true,
  "lagMs": 0,
  "policyScopeExpanded": [],
  "untrustedSelfReport": 0,
  "legalEmptyWindow": false
}
```

This is a synthetic "happy-path" fixture to demonstrate end-to-end CSV
output. Operator runs against real Lucy manifests will replace this
fixture file.
