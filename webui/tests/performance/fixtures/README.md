# Spec 174 performance fixtures

Performance fixtures are generated, never committed. `npm run perf:entry`
creates them under `inbox/webui-entry-perf/<run-id>/fixture-clean` with
`scripts/entry-performance-fixture.mts` (seed 161):

- 7 connections, 8 Schema Manifests, 60 tables, 1,786 columns, 45 enabled
  tables (one connection with zero enabled tables), overlays on every third
  table;
- 13 Agents (12 enabled) covering `roles[]`, legacy `role`, legacy `allow`,
  multi-role, `lucy_admin` catalog_bound, catalog_bound pairs, a meta-only
  role and Agent constraints;
- 200 anonymous audit events per enabled Agent written through the real
  audit API (sessions, turns, `access_log_sources`, protocol rows, denied and
  error outcomes) around a UTC anchor recorded in `fixture-manifest.json`;
- a bash 3.2 compatible KTX stub (`bin/ktx`) with per-connection delay /
  failure / timeout configuration and an invocation log.

All values are synthetic. Generation refuses to write outside
`inbox/webui-entry-perf/` and deletion requires the
`.lucy-entry-perf-owner` marker. The `after` phase reuses the baseline's
`fixture-clean` snapshot after re-verifying its content hash.
