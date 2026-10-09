# Lucy Helm Chart — Upgrade Guide

Upgrade Lucy on Kubernetes while preserving `/data/lucy` PVC data, Secrets, and MCP tokens.
Current chart: **0.2.4** (Lucy `0.17.0`, bundled KTX `0.16.0`).

## Before you start

1. Read [`deploy/k8s/K8S_CONTRACT.md`](../../K8S_CONTRACT.md).
2. Confirm the target image tag is **immutable** and record its digest / config ID (`BUILD-INFO.json`).
3. Back up the PVC or snapshot `/data/lucy` if your platform supports it.
4. **Do not use** `lucy-k8s-integration-delivery-20260902-v1` / `v2`, or any package older than chart `0.2.3`,
   for in-place upgrades (read-only password Secret, non-runnable scripts).
5. Clear stale Helm state if a previous upgrade failed:

```bash
helm history lucy-starrocks -n lucy-test
# If status is pending-upgrade or pending-rollback:
helm rollback lucy-starrocks <last-good-revision> -n lucy-test
```

## Pre-upgrade checks (no customer logs required)

```bash
helm status lucy-starrocks -n lucy-test            # must be "deployed"
kubectl -n lucy-test get deploy,svc,pvc -o wide
kubectl -n lucy-test get deploy lucy -o jsonpath='{.spec.selector.matchLabels}{"\n"}'
kubectl -n lucy-test get secret lucy-starrocks     # exists (keys only; do not print values)
```

**Deployment selector (immutable).** Helm cannot change `spec.selector` of an existing Deployment. The chart
renders `app.kubernetes.io/name=lucy` and `app.kubernetes.io/instance=<helm release>`. For release
`lucy-starrocks` the live selector must be exactly:

```text
{"app.kubernetes.io/instance":"lucy-starrocks","app.kubernetes.io/name":"lucy"}
```

If it differs (for example the Deployment was created by another chart or release name), stop: `helm upgrade`
would fail with `field is immutable`. Do not patch or delete the Deployment by hand — contact Lucy delivery to
agree a one-off migration plan first (PVC is kept in every case).

## Upgrade preflight (live cluster)

Run this from the package root **before** `helm upgrade`. It reports three things Helm will not fix by itself:

- a live Deployment that still has a hand-patched `command` / `args`, hotfix volume, or extra init container
- semantic-layer column `type` values other than `string`, `number`, `time`, `boolean`
- `roles.*.allow.tools` entries that Lucy 0.17.0 treats as AbsoluteDeny (`sl_query`, `sl_read_source`, and the other names in that set)

`defaults.known_tools` and `defaults.table_touching_tools` are not flagged and are not edited.

```bash
bash scripts/preflight-upgrade.sh \
  --namespace lucy-test --release lucy-starrocks \
  --deployment lucy --chart helm/lucy -f examples/values.k3s-test.yaml
```

The script prints a JSON Patch and does **not** apply it. Read the patch, save the array to a file, then:

```bash
kubectl -n lucy-test patch deploy lucy --type=json --patch-file drift.json
```

`helm upgrade --force` deletes and recreates the Deployment. Use it only when the printed patch cannot express the drift. The PVC stays. It is not the default.

Column types and role tools are customer data. The preflight does not change them unless you pass a flag. Each flag copies the original to a sibling `.backup.<timestamp>` first.

```bash
bash scripts/preflight-upgrade.sh \
  --namespace lucy-test --release lucy-starrocks \
  --deployment lucy --chart helm/lucy -f examples/values.k3s-test.yaml \
  --apply-types --apply-access
```

`--apply-types` rewrites only a fixed SQL Server map (`varchar`/`nvarchar`/`int`/`decimal`/`datetime`/`bit`, and the other names listed in `scripts/preflight-upgrade-lib.mjs`). A type with no mapping, such as `geometry`, is reported and left unchanged, and the preflight still fails. `--apply-access` removes AbsoluteDeny names from role tool lists only.

If the rendered Deployment still references `k8s-preflight.sh` or uses `startupProbe.exec` with
`docker-healthcheck.sh`, upgrade the Chart to **0.2.x+** before applying the v3 image.

## Resource names (`fullnameOverride`)

By default every object is named after the Helm release. When the environment already runs objects under a
different name, pin them in values — otherwise Helm creates a **second** Deployment/Service next to the old one:

| Item | lucy-test value |
|---|---|
| Namespace | `lucy-test` |
| Helm release | `lucy-starrocks` |
| Deployment / Service / ServiceAccount | `lucy` (`fullnameOverride: lucy`) |
| PVC | `lucy` (`persistence.existingClaim: lucy`) |
| Secret | `lucy-starrocks` (`existingSecret`) |

`scripts/preflight-helm.sh` renders with release `lucy-starrocks` and fails if any of these names drift.

## Database password Secret (`secrets-sync`)

A Kubernetes Secret volume is **always read-only**. The chart therefore does **not** mount the Secret over
`/data/lucy/.ktx/secrets` (that caused `EROFS` when the WebUI created or edited a data source). Instead:

1. The Secret is mounted read-only at `/mnt/lucy-secrets` in the `secrets-sync` init container only.
2. `secrets-sync` copies each key into the PVC at `/data/lucy/.ktx/secrets/<key>`:
   directory `0700`, files `0600`, owner `10001:10001` (the Lucy runtime user).
3. The Lucy container mounts only the `/data/lucy` PVC. `ktx.yaml` keeps using
   `password: file:/data/lucy/.ktx/secrets/<key>` unchanged.

| Situation | Behaviour |
|---|---|
| Key added to the Secret | Copied on the next pod start |
| Key value changed in the Secret | **Overwrites** the same-named file on the next pod start (restart the pod or `helm upgrade`) |
| Key removed from the Secret | File on the PVC is **kept** (never pruned) |
| File exists only on the PVC (created via the WebUI) | Kept; its password is not in the Secret |

Files are never deleted automatically because the PVC is the source of truth for WebUI-created connections.
To retire a password, delete the connection in the WebUI (it removes its own file) or remove the file by hand
after confirming nothing references it. Never print Secret or password file contents in tickets or logs.

## Legacy PVC ownership

`project-migrate` runs first as root (only `CHOWN`, `DAC_OVERRIDE`, `FOWNER`) and hands every entry not already
owned by `10001:10001` to the runtime user — at least `/data/lucy`, `.ktx`, `.ktx/secrets`, `.ktx-ui`. It does not
run `git init` (the entrypoint owns that). No manual `chown`, `kubectl patch` or start-command edit is needed.
Always test the upgrade on a PVC that already holds history, not an empty one.

## Legacy content layout (`LUCY_CONTENT_ROOT`)

The default content root is `/data/lucy/config`. PVCs created before M31 keep `semantic-layer/`, `wiki/`,
`skills/`, `webui/config/` next to `ktx.yaml`. For those set:

```yaml
env:
  LUCY_CONTENT_ROOT: "."
```

Without it the WebUI shows an empty catalog after the upgrade (data is not lost — set the value and upgrade
again). New installs leave it empty. `access.yaml`, `.ktx/secrets/` and `.ktx-ui/` always live at the project
root regardless of this setting.

## Expected downtime

This chart uses `strategy: Recreate` with a single RWO PVC. During upgrade:

- The old pod terminates before the new pod starts.
- WebUI and MCP are unavailable for **seconds to a few minutes**.
- This is expected — not a rolling zero-downtime deployment.

Plan upgrades in a maintenance window.

## Standard upgrade (K3s single node, zero manual patch)

Target profile: K3s, namespace `lucy-test`, release `lucy-starrocks`, PVC `lucy`, external ports **8276/8277**.

1. **Verify the package and back up** (recommended):

```bash
sha256sum -c SHA256SUMS
kubectl -n lucy-test exec deploy/lucy -c lucy -- cat /data/lucy/ktx.yaml > ktx.yaml.bak

# Fingerprint customer-owned files (paths + hashes only; no contents leave the pod).
# The SQLite audit DB is excluded because it legitimately changes while running.
kubectl -n lucy-test exec deploy/lucy -c lucy -- sh -ec '
  cd /data/lucy
  find ktx.yaml semantic-layer wiki skills webui/config .ktx-ui .git/HEAD -type f ! -name "*.sqlite*" 2>/dev/null \
    | sort | xargs sha256sum' > before-upgrade.sha256
```

After the upgrade (and after the pod restart test) run the same command to `after-upgrade.sha256` and
`diff before-upgrade.sha256 after-upgrade.sha256` — it must be empty.

2. **Import the offline image into containerd** (K3s does not use Docker — `docker load` has no effect):

```bash
sudo k3s ctr images import image/project-lucy-*.tar
sudo k3s ctr images list | grep project-lucy
```

The listed `repository:tag` must equal `image.repository` / `image.tag` in `examples/values.k3s-test.yaml`
exactly; the profile sets `image.pullPolicy: Never`. For multi-node clusters import on every node that can run
the pod, or pin `nodeSelector`.

3. **Preflight and Helm upgrade** from the package root:

```bash
bash scripts/preflight-helm.sh --k3s-only
helm upgrade lucy-starrocks helm/lucy \
  --namespace lucy-test \
  -f examples/values.k3s-test.yaml \
  --atomic --wait --timeout 15m
```

**Forbidden during routine upgrade:** `git init`, `chown`, `kubectl set env`, `kubectl patch`, Deployment edits.

4. **Acceptance** (token via environment, never on the command line):

```bash
export LUCY_MCP_TOKEN="<bearer-token>"
bash scripts/acceptance.sh \
  --namespace lucy-test \
  --release lucy-starrocks --deployment lucy --service lucy \
  --public-mcp-url "http://10.69.95.109:8277/mcp" \
  --connection kc-starrocks --connection rds-test --connection zijin \
  --expect-content-root .
unset LUCY_MCP_TOKEN
```

The script checks Helm status, 1/1 Ready, init containers exited 0, Service/Endpoints ports (5174/7879, never
7878), health, `ktx --version`, secrets directory owner/mode/writability, every connection test, `admin reindex`
and MCP 401 / `initialize` / `tools/list`. It prints no tokens, passwords or Secret contents.

## Required values changes when coming from chart 0.1.x / v1/v2 packages

| Old (0.1.x / v1/v2) | New (0.2.4) |
|---|---|
| exec startup/readiness probes | HTTP `/api/health` (chart default) |
| `service.webuiPort` also used as container port | split: `containerPorts.webui: 5174`, `service.webuiPort: 8276` |
| optional `runtime-preflight` init | **remove entirely**; `project-migrate` + `secrets-sync` are built in |
| Secret mounted at `/data/lucy/.ktx/secrets` | Secret copied in by `secrets-sync`; no Secret mount on the Lucy container |
| `runAsUser: 0` | `runAsUser: 10001`, `fsGroup: 10001` |
| `service.type: ClusterIP` on K3s test | `LoadBalancer` for host ports 8276/8277 |
| legacy layout silently ignored | set `env.LUCY_CONTENT_ROOT: "."` on pre-M31 PVCs |
| resources named after the release | `fullnameOverride` when objects already exist under another name |
| mutable image tag only | immutable tag (+ `image.digest` for registry installs) |

A customer template is provided in `examples/values.customer.example.yaml`.

## Symptom decision tree (no customer logs)

| Symptom | Likely cause | Action |
|---|---|---|
| `EROFS` / read-only file system when creating a data source | Secret mounted over `.ktx/secrets` (chart < 0.2.3) | Upgrade to chart 0.2.3 |
| `Permission denied` writing `.ktx/secrets` | Legacy PVC owner; `projectMigrate` disabled | Set `lucy.projectMigrate.enabled: true`, upgrade |
| WebUI shows no semantic layer / wiki after upgrade | Legacy layout without content root | Set `env.LUCY_CONTENT_ROOT: "."`, upgrade |
| A second `lucy-starrocks` Deployment/Service appears | Missing `fullnameOverride: lucy` | Add it to values and upgrade; remove the stray objects only after confirming `deploy/lucy` is Ready |
| `field is immutable: spec.selector` | Existing Deployment selector differs | Stop; see "Pre-upgrade checks" |
| `Init:Error` on `secrets-sync` | `existingSecret` does not exist in the namespace | Create the Secret, then `kubectl -n lucy-test rollout restart deploy/lucy` |
| `ErrImageNeverPull` | Image not imported into containerd, or tag mismatch | `sudo k3s ctr images import ...`; compare tag with values |
| `k8s-preflight.sh: No such file` | Stale init container | Upgrade to Chart 0.2.x+; remove `runtime-preflight` |
| `Startup probe failed: command timed out` | exec `docker-healthcheck.sh` probe | Upgrade to HTTP `/api/health` Chart |
| `dubious ownership in repository at '/data/lucy'` | root container vs UID 10001 `.git` | Use v3+ image + Chart; enable `projectMigrate` |
| Pod CrashLoop, PVC missing `.git` | No entrypoint `git init` | Use v3+ image; check entrypoint logs |
| `GIT_CONFIG_COUNT ... not permitted` | Invalid Git env injection | Remove from values |
| Pod Running but 8276/8277 unreachable | ClusterIP Service | Set `service.type: LoadBalancer` (K3s) or NodePort/Ingress |
| MCP fallback in WebUI | Missing `LUCY_PUBLIC_MCP_URL` in Helm values | Set in values and `helm upgrade`; no `kubectl set env` |
| Wrong runtime behaviour | tag/digest mismatch in values vs imported image | Compare `image/image-tag.txt`, `BUILD-INFO.json` |

## Post-upgrade verification

`scripts/acceptance.sh` covers these; manual spot checks:

- `helm status lucy-starrocks -n lucy-test` → `deployed` (never `pending-*`)
- `kubectl -n lucy-test rollout status deployment/lucy --timeout=600s`; Pod `1/1 Running`
- `curl -fsS http://127.0.0.1:8276/api/health` → `ok: true`
- `kubectl -n lucy-test exec deployment/lucy -c lucy -- ktx --version`
- Create a temporary connection in the WebUI: no `EROFS` / `Permission denied`, `connection test` passes,
  it survives `kubectl -n lucy-test delete pod -l app.kubernetes.io/instance=lucy-starrocks`, and deleting it
  leaves existing connections untouched.
- Customer-owned files unchanged (compare checksums taken before the upgrade): `ktx.yaml`, `semantic-layer/`,
  `wiki/`, `skills/`, `webui/config/`, `.ktx-ui/`, `.git/`.

## Migrating from a custom customer Chart

If you previously maintained your own Chart (e.g. with `runtime-preflight`):

1. Diff your values against `deploy/k8s/helm/lucy/values.yaml`.
2. Delete any init container referencing `k8s-preflight.sh`.
3. Replace exec probes with HTTP `/api/health`.
4. Set `workingDir: /data/lucy` and `runAsUser: 10001`.
5. Do not mount Secrets over `/data/lucy/.ktx/secrets`; use the `secrets-sync` pattern.
6. Ensure `LUCY_PUBLIC_MCP_URL` is in Helm values, not applied via `kubectl set env`.
7. Run `bash scripts/preflight-helm.sh` (package) or `bash scripts/gates/helm-lucy-gate.sh` (repo) before applying.

## Do not

- Delete the PVC unless intentionally rebuilding the environment.
- Reuse mutable tags across different image builds.
- Expose port `7878` in Service or Ingress.
- Put StarRocks / reindex / MCP handshake checks into Kubernetes probes.
- Pass the MCP token with `--token` or paste it into reports or screenshots.
- Ship v1/v2 delivery packages as "direct in-place upgrade" builds.

See [`ROLLBACK.md`](ROLLBACK.md) if the upgrade fails.
