# Changelog

All notable user-visible changes to Lucy ship here. Versions follow `<major>.<minor>.<patch>`; the current development line is M31.

> Conventions: `**Breaking**` = action required on upgrade; `**Deprecated**` = still works, will be removed; `**Added**` / `**Changed**` / `**Fixed**` are self-describing.

---

## Unreleased — M31 / A2 — Configurable Content Root

> Target release: M31 (post-0.17.0). WebUI loads `semantic-layer/`, `wiki/`,
> `evals/`, `skills/` from a configurable root instead of treating them as
> siblings of `ktx.yaml`.

### Added
- **Resolver**: `webui/server/paths.ts` — `resolveContentPaths()`, `loadContentPaths()` (cached), `invalidateContentPathsCache()`, `ensureContentDirs()`. Reads `LUCY_CONTENT_ROOT` env first, then `ktx.yaml` `paths.content_root`, then defaults to `<projectRoot>/config/`.
- **`ktx.yaml` override**: top-level `paths.content_root` (string, relative or absolute).
- **Env override**: `LUCY_CONTENT_ROOT` — absolute or relative to project root.
- **Tests**: `webui/server/__tests__/paths.test.ts` (resolver unit), `webui/server/__tests__/fs-safe.config-root.test.ts` (dynamic ALLOW across both layouts).
- **E2E fixture**: `scripts/demo/init-e2e-fixture.sh` now seeds `config/{semantic-layer,wiki}/`; `webui/playwright.config.ts` webServer env adds `LUCY_CONTENT_ROOT=$PROJECT_DIR/config`.
- **Migration guide**: `docs/plans/M31-config-subdir-migration.md`.
- **Docker entrypoint**: `scripts/runtime/docker-entrypoint.sh` resolves `LUCY_CONTENT_ROOT`, seeds into the resolved root, and mirrors to `<projectRoot>/runtime/` so `@kaelio/ktx`'s sibling view keeps working.
- **Smoke**: `scripts/smoke/headless-config-smoke.mjs` honours `LUCY_CONTENT_ROOT` (default `./config`); CI can run legacy + new layout from one script.
- **`customer-config.example/` migrated**: 4 content dirs now under `customer-config.example/config/`.

### Changed
- **`fs-safe.ts` ALLOW list is dynamic**: split into `CONTENT_PREFIXES` (semantic-layer/evals/skills/wiki) resolved from the content root, and `ROOT_PREFIXES` (.ktx-ui/webui/config) at project root. No behaviour change for legacy layout.
- **Demo compose files** bind mounts target `<configRoot>/evals`:
  `deploy/compose/docker-compose.demo.yml`, `docker-compose.postgres-demo.yml`, `docker-compose.executive-poc.yml`. All three also export `LUCY_CONTENT_ROOT=${LUCY_CONTENT_ROOT:-/data/lucy/config}`.
- **`ktx.yaml.example`**: documents the `paths.content_root` override.

### **Breaking** for direct dev checkouts (M30 → M31)
- After upgrading, a project that still has `semantic-layer/`, `wiki/`, `evals/`, `skills/` as siblings of `ktx.yaml` will appear empty in the WebUI. Resolution: either `mv <dir> config/`, or set `LUCY_CONTENT_ROOT=.` (env) / `paths.content_root: .` (`ktx.yaml`).
- The `customer-config.example/` fixture tree changed shape: 4 content dirs now under `customer-config.example/config/`. Any script or doc that `cp -R`'d `customer-config.example/{semantic-layer,wiki,evals,skills}` into a deliverable needs updating — see `docs/plans/M31-config-subdir-migration.md` and the updated cp snippets in `docs/plans/wo-202608-07-customer-amd64-delivery.md`.

### Migration
- Recommended: `mkdir -p config && mv semantic-layer wiki evals skills config/` (or `git mv` if tracked) + restart Lucy.
- Legacy escape hatch: `export LUCY_CONTENT_ROOT=.` (env) or `paths.content_root: .` (ktx.yaml). Supported through at least M32 / M33.
- Full guide: `docs/plans/M31-config-subdir-migration.md`.

### Out of scope (this release)
- `@kaelio/ktx` itself is unchanged. The sibling view is preserved via the runtime mirror populated by `docker-entrypoint.sh`. Direct `ktx mcp start` outside Docker against a non-sibling layout will still complain — the mirror is a Docker-time concern.
- `webui/config/access.yaml`, `.ktx/secrets/`, `.ktx-ui/` remain at project root. Not part of the content root.
- The `webui/` directory tree (config code) is unchanged.

---

## 0.17.0 (current VERSION file baseline)

Pre-M31 line. Content dirs are siblings of `ktx.yaml`. No `LUCY_CONTENT_ROOT` env, no `paths.content_root` in `ktx.yaml`, no resolver.