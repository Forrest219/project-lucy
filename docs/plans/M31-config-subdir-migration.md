# M31 — Configurable Content Root Migration Guide

> **For deployments upgrading from M30 (or earlier) to M31 / A2.**
> M31 ships the A2 refactor: Lucy WebUI now loads
> `semantic-layer/`、`wiki/`、`evals/`、`skills/` from a **configurable
> content root** instead of treating them as hard-coded siblings of
> `ktx.yaml`. Default = `<projectRoot>/config/`. The `@kaelio/ktx` runtime
> still requires the sibling view, which the Docker entrypoint populates
> at `<projectRoot>/runtime/`.

---

## What changed

| Was (M30 and earlier)        | Now (M31 / A2)                        |
|-----------------------------|---------------------------------------|
| `semantic-layer/` is sibling of `ktx.yaml` | `<contentRoot>/semantic-layer/` (default `<projectRoot>/config/semantic-layer/`) |
| `wiki/` is sibling                      | `<contentRoot>/wiki/`               |
| `evals/` is sibling                     | `<contentRoot>/evals/`              |
| `skills/` is sibling                    | `<contentRoot>/skills/`             |
| WebUI hardcodes siblings                | Resolver honours `LUCY_CONTENT_ROOT` env and `ktx.yaml` `paths.content_root` |
| ktx requires sibling view               | Docker entrypoint mirrors content root to `<projectRoot>/runtime/` so ktx sees a sibling view (no change to ktx itself) |

**Breaking for direct dev checkouts.** Non-breaking if you set `LUCY_CONTENT_ROOT=.` or `paths.content_root: .`.

---

## Recommended migration (move into `config/`)

```bash
cd <your-project-root>
mkdir -p config
# If using git (tracked files):
git mv semantic-layer wiki evals skills config/
# Or plain filesystem:
# mv semantic-layer wiki evals skills config/

# Restart Lucy. Done.
```

The Docker entrypoint will auto-populate `<projectRoot>/runtime/{semantic-layer,wiki,evals,skills}/` from `config/` on every boot (only copies missing files; customer edits to `runtime/` are preserved).

---

## Keep the legacy sibling layout (no migration)

Set `LUCY_CONTENT_ROOT=.` (or any path that resolves to project root):

```bash
export LUCY_CONTENT_ROOT=.
lucy webui start
```

Or in `docker-compose.yml`:

```yaml
environment:
  LUCY_CONTENT_ROOT: "."
```

Or in `ktx.yaml` (per-deployment override):

```yaml
paths:
  content_root: .   # relative to project root
```

Resolution order (high → low):

1. `LUCY_CONTENT_ROOT` env var (absolute or relative to project root)
2. `ktx.yaml` top-level `paths.content_root`
3. Default: `./config`

---

## Per-deployment layout (custom content root)

```yaml
# ktx.yaml
paths:
  content_root: ./content        # relative to project root
  # content_root: /opt/lucy/content   # absolute
```

```bash
# Or via env, e.g. container orchestrator:
LUCY_CONTENT_ROOT=/opt/lucy/content
```

`webui/config/access.yaml`, `.ktx/secrets/`, `.ktx-ui/` always live at the **project root** — never under the content root. They are admin/security state and the resolver does not move them.

---

## Docker behaviour

`scripts/runtime/docker-entrypoint.sh` now:

1. Resolves `LUCY_CONTENT_ROOT` (default `<PROJECT_ROOT>/config/`).
2. Seeds templates into `${CONTENT_ROOT}/{semantic-layer,wiki,evals,skills}/`.
3. Mirrors `${CONTENT_ROOT}/*` into `${PROJECT_ROOT}/runtime/*` so ktx sees the sibling view it requires. Mirroring is idempotent — only missing files are copied; customer-authored `runtime/` files survive.
4. Validates `${CONTENT_ROOT}/semantic-layer/` (not `${PROJECT_ROOT}/semantic-layer/`) for non-empty + `_schema/` presence.

`LUCY_DISABLE_RUNTIME_MIRROR=1` disables the mirror (only do this if you've arranged the sibling view some other way).

`LUCY_DISABLE_TEMPLATE_SYNC=1` skips the template seed (customers with `customer-config.example/` bind mounts already use this).

---

## Rollback

```bash
# Unset the env var and remove paths: from ktx.yaml.
unset LUCY_CONTENT_ROOT
# Remove `paths:` block from ktx.yaml.

# If you migrated into config/, move back:
mv config/semantic-layer config/wiki config/evals config/skills .

# Restart Lucy with no env / ktx.yaml override. WebUI uses siblings again.
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| WebUI shows no data after upgrade | Content dirs still at sibling paths, but WebUI is reading `./config/` | Set `LUCY_CONTENT_ROOT=.` or move dirs into `config/` |
| `fatal: <dir> has no YAML files` from entrypoint | Content root empty | Seed template (`LUCY_DISABLE_TEMPLATE_SYNC=0`) or copy customer content into `<contentRoot>/` |
| ktx logs "missing semantic-layer/" | Content root not seeded or runtime mirror disabled | Check `LUCY_CONTENT_ROOT`, `LUCY_DISABLE_RUNTIME_MIRROR`; verify `${PROJECT_ROOT}/runtime/semantic-layer/` exists |
| Permission denied on `mkdir -p config/...` | Lucy user lacks write | `chown -R <lucy-uid> <projectRoot>/config/` or pick a writable path |
| E2E fixture (`/tmp/lucy-e2e-fixture`) misses content | Fixture init script still seeds sibling paths | `scripts/demo/init-e2e-fixture.sh` writes `config/semantic-layer/` and `config/wiki/` from M31 onwards |

---

## Versioning

Ships in M31. Legacy layout (`LUCY_CONTENT_ROOT=.`) is supported through at least two minor versions. New customers should adopt the `config/` default from day 1.

---

## Reference

- Plan: `/.claude/plans/glistening-gathering-otter.md` (A2 section)
- Resolver: `webui/server/paths.ts`
- fs-safe dynamic ALLOW: `webui/server/fs-safe.ts` (`CONTENT_PREFIXES` + `ROOT_PREFIXES`)
- Entrypoint: `scripts/runtime/docker-entrypoint.sh` (`sync_context_from_template`, `sync_runtime_mirror`, `validate_project_context`)
- Smoke: `scripts/smoke/headless-config-smoke.mjs` (`LUCY_CONTENT_ROOT` parameter, default `./config`)
- E2E: `webui/playwright.config.ts` (`LUCY_E2E_CONTENT_ROOT`, `LUCY_CONTENT_ROOT` webServer env)
- Template: `customer-config.example/` — 4 content dirs now under `config/`
- Demo compose: `deploy/compose/docker-compose.{demo,postgres-demo,executive-poc}.yml` — bind mounts target `<configRoot>/evals`