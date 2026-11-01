# Entry performance baseline (baseline-2026-10-31T01-28-29-379Z)

commit af3dc785890c2ca59d246e48976a1b9c7a936f85 (dirty)

acceptance: partial (smoke — not a Spec pass) · partial

| scenario | route | metric | n | P50 | P95 | max | failures |
|---|---|---|---:|---:|---:|---:|---:|
| spec195-roundtrip | roundtrip-roles | hubVisibleMs | 10 | 2.70 | 4.40 | 4.40 | 0 |
| spec195-roundtrip | roundtrip-roles | partnerVisibleMs | 10 | 2.80 | 4.50 | 4.50 | 0 |
| spec195-roundtrip | roundtrip-roles | backVisibleMs | 10 | 3.00 | 5.70 | 5.70 | 0 |
| spec195-roundtrip | roundtrip-roles | networkCompleteMs | 10 | 0.00 | 13.60 | 13.60 | 0 |
| spec195-roundtrip | roundtrip-roles | networkRequests | 10 | 0.00 | 1.00 | 1.00 | 0 |
| spec195-roundtrip | roundtrip-roles | busyResponses | 10 | 0.00 | 0.00 | 0.00 | 0 |
| spec195-roundtrip | roundtrip-catalog | hubVisibleMs | 10 | 2.70 | 5.60 | 5.60 | 0 |
| spec195-roundtrip | roundtrip-catalog | partnerVisibleMs | 10 | 3.00 | 3.30 | 3.30 | 0 |
| spec195-roundtrip | roundtrip-catalog | backVisibleMs | 10 | 3.80 | 5.80 | 5.80 | 0 |
| spec195-roundtrip | roundtrip-catalog | networkCompleteMs | 10 | 0.00 | 0.00 | 0.00 | 0 |
| spec195-roundtrip | roundtrip-catalog | networkRequests | 10 | 0.00 | 0.00 | 0.00 | 0 |
| spec195-roundtrip | roundtrip-catalog | busyResponses | 10 | 0.00 | 0.00 | 0.00 | 0 |
| spec195-roundtrip | roundtrip-audit | hubVisibleMs | 10 | 2.80 | 3.40 | 3.40 | 0 |
| spec195-roundtrip | roundtrip-audit | partnerVisibleMs | 10 | 2.90 | 3.20 | 3.20 | 0 |
| spec195-roundtrip | roundtrip-audit | backVisibleMs | 10 | 2.90 | 8.40 | 8.40 | 0 |
| spec195-roundtrip | roundtrip-audit | networkCompleteMs | 10 | 0.00 | 18.60 | 18.60 | 0 |
| spec195-roundtrip | roundtrip-audit | networkRequests | 10 | 0.00 | 2.00 | 2.00 | 0 |
| spec195-roundtrip | roundtrip-audit | busyResponses | 10 | 0.00 | 0.00 | 0.00 | 0 |
| spec195-roundtrip | roundtrip-overlay-edit | visibleMs | 1 | 1.70 | 1.70 | 1.70 | 0 |
| spec195-roundtrip | roundtrip-overlay-edit | networkCompleteMs | 1 | 5.40 | 5.40 | 5.40 | 0 |
| spec195-roundtrip | roundtrip-overlay-edit | networkRequests | 1 | 1.00 | 1.00 | 1.00 | 0 |
| spec195-roundtrip | roundtrip-overlay-edit | busyResponses | 1 | 0.00 | 0.00 | 0.00 | 0 |

| budget | scenario | route | metric | stat | limit | actual | pass |
|---|---|---|---|---|---:|---:|---|

behavior: null

