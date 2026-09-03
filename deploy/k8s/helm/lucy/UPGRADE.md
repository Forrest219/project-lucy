# Lucy Helm Chart — Upgrade Guide

Upgrade Lucy on Kubernetes while preserving `/data/lucy` PVC data, Secrets, and MCP tokens.

## Before you start

1. Read [`deploy/k8s/K8S_CONTRACT.md`](../../K8S_CONTRACT.md).
2. Confirm the target image tag is **immutable** and record its digest.
3. Back up the PVC or snapshot `/data/lucy` if your platform supports it.
4. **Do not use** `lucy-k8s-integration-delivery-20260902-v1` or `v2` for in-place upgrades — use **v3+** only.
5. Clear stale Helm state if a previous upgrade failed:

```bash
helm history lucy-starrocks -n lucy-test
# If status is pending-upgrade or pending-rollback:
helm rollback lucy-starrocks <last-good-revision> -n lucy-test
```

## Pre-upgrade checks (no customer logs required)

```bash
helm history lucy-starrocks -n lucy-test
kubectl -n lucy-test get pvc lucy
kubectl -n lucy-test get deploy -o jsonpath='{.items[0].spec.template.spec.containers[0].image}{"\n"}'
```

If the rendered Deployment still references `k8s-preflight.sh` or uses `startupProbe.exec` with `docker-healthcheck.sh`, upgrade the Chart to **0.2.x+** before applying v3 image.

## Expected downtime

This chart uses `strategy: Recreate` with a single RWO PVC. During upgrade:

- The old pod terminates before the new pod starts.
- WebUI and MCP are unavailable for **seconds to a few minutes**.
- This is expected — not a rolling zero-downtime deployment.

Plan upgrades in a maintenance window.

## Standard upgrade (N-1 → v3, zero manual patch)

Target profile: K3s single node, namespace `lucy-test`, release `lucy-starrocks`, PVC `lucy`, external ports **8276/8277**.

1. **Backup** (recommended):

```bash
kubectl -n lucy-test cp deploy/lucy-starrocks:/data/lucy/ktx.yaml ./ktx.yaml.bak
kubectl -n lucy-test cp deploy/lucy-starrocks:/data/lucy/webui/config/access.yaml ./access.yaml.bak
```

2. **Load offline image** (from delivery package):

```bash
docker load -i image/project-lucy-*.tar
```

3. **Helm upgrade** using package `examples/values.k3s-test.yaml` (tag/digest pre-synced):

```bash
helm upgrade lucy-starrocks helm/lucy \
  --namespace lucy-test \
  -f examples/values.k3s-test.yaml \
  --atomic \
  --wait \
  --timeout 15m
```

**Forbidden during routine upgrade:** `git init`, `chown`, `kubectl set env`, Deployment patch.

4. **Acceptance**:

```bash
bash scripts/acceptance.sh \
  --namespace lucy-test \
  --release lucy-starrocks \
  --public-mcp-url "http://<node-ip>:8277/mcp" \
  --token "<bearer-token>"
```

## Required values changes when coming from chart 0.1.x / v1/v2 packages

| Old (0.1.x / v1/v2) | New (0.2.2 / v3+) |
|---|---|
| exec startup/readiness probes | HTTP `/api/health` (chart default) |
| `service.webuiPort` also used as container port | split: `containerPorts.webui: 5174`, `service.webuiPort: 8276` |
| optional `runtime-preflight` init | **remove entirely**; use `project-migrate` if needed |
| `runAsUser: 0` | `runAsUser: 10001`, `fsGroup: 10001` |
| `service.type: ClusterIP` on K3s test | `LoadBalancer` for host ports 8276/8277 |
| mutable image tag only | immutable tag + `image.digest` in values |

Example production values overlay:

```yaml
image:
  repository: registry.example.com/data-team/project-lucy
  tag: customer-amd64-0.17.0-20260902-b262798
  digest: sha256:…
  pullPolicy: IfNotPresent

containerPorts:
  webui: 5174
  mcp: 7879

service:
  type: LoadBalancer
  webuiPort: 8276
  mcpPort: 8277

env:
  LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/mcp"

persistence:
  existingClaim: lucy

lucy:
  version: "0.17.0"  # must equal Chart.appVersion
  projectMigrate:
    enabled: true   # disable only on guaranteed-clean fresh PVC
```

## Symptom decision tree (no customer logs)

| Symptom | Likely cause | Action |
|---|---|---|
| `k8s-preflight.sh: No such file` | Stale init container | Upgrade to Chart 0.2.x+; remove `runtime-preflight` |
| `Startup probe failed: command timed out` | exec `docker-healthcheck.sh` probe | Upgrade to HTTP `/api/health` Chart |
| `dubious ownership in repository at '/data/lucy'` | root container vs UID 10001 `.git` | Use v3 image + Chart; enable `projectMigrate` |
| Pod CrashLoop, PVC missing `.git` | No entrypoint `git init` | Use v3 image; check init/entrypoint logs |
| `GIT_CONFIG_COUNT ... not permitted` | Invalid Git env injection | Remove from values; never enable `allowUnsafeConfigEnvCount` |
| Pod Running but 8276/8277 unreachable | ClusterIP Service | Set `service.type: LoadBalancer` (K3s) or NodePort/Ingress |
| MCP fallback in WebUI | Missing `LUCY_PUBLIC_MCP_URL` in Helm values | Set in values and `helm upgrade`; no `kubectl set env` |
| Wrong runtime behaviour | tag/digest mismatch in values vs loaded image | Use v3 package; verify `image/image-digest.txt` |

## Post-upgrade verification

Minimum manual checks:

- Pod `1/1 Ready`
- `curl -fsS http://<webui-host>:8276/api/health` → 200
- MCP without token → 401
- MCP `initialize` with token → 200
- `ktx --project-dir /data/lucy connection test kc-starrocks` succeeds
- Pod restart preserves config, index, and tokens

## Migrating from a custom customer Chart

If you previously maintained your own Chart (e.g. with `runtime-preflight`):

1. Diff your values against `deploy/k8s/helm/lucy/values.yaml`.
2. Delete any init container referencing `k8s-preflight.sh`.
3. Replace exec probes with HTTP `/api/health`.
4. Set `workingDir: /data/lucy` and `runAsUser: 10001`.
5. Ensure `LUCY_PUBLIC_MCP_URL` is in Helm values, not applied via `kubectl set env`.
6. Run `bash scripts/helm-lucy-gate.sh` on rendered manifests before applying.

## Do not

- Delete the PVC unless intentionally rebuilding the environment.
- Reuse mutable tags across different image builds.
- Expose port `7878` in Service or Ingress.
- Put StarRocks / reindex / MCP handshake checks into Kubernetes probes.
- Ship v1/v2 delivery packages as “direct in-place upgrade” builds.

See [`ROLLBACK.md`](ROLLBACK.md) if the upgrade fails.
