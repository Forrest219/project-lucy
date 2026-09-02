# Lucy Kubernetes Deployment Contract

| Metadata | Value |
|---|---|
| Document | Lucy K8s Deployment Contract |
| Version | 1.1 |
| Date | 2026-09-02 |
| Scope | Supported Helm chart `deploy/k8s/helm/lucy/` and customer K8s integrations |

This document is the **authoritative contract** for Lucy on Kubernetes. The Helm chart
in this repository is a **supported delivery artifact** — not a reference snapshot.

## Compatibility matrix

| Chart version | App (KTX) | Probe model | Notes |
|---|---|---|---|
| `0.1.x` | `0.16.0` | startup/readiness exec `docker-healthcheck.sh` | **Deprecated** — do not use for new installs or upgrades |
| `0.2.0` | `0.16.0` | HTTP `GET /api/health` on port `webui` | Supported; missing UID/git contract — superseded by 0.2.1 for upgrades |
| `0.2.1` | `0.16.0` | HTTP probes + UID 10001 + `workingDir` | **Current** — use for v3 delivery and in-place upgrades |

Image tags must be **immutable**. Recommended form:

```text
project-lucy:customer-amd64-0.16.0-YYYYMMDD-<gitShortSha>
```

Record the digest in `image/image-digest.txt` and pin via Helm `image.digest` when possible.

## Workload constraints

| Field | Required value | Rationale |
|---|---|---|
| `replicaCount` | `1` | Single RWO PVC at `/data/lucy` |
| `strategy.type` | `Recreate` | Prevent two pods binding the same RWO volume |
| `persistence.enabled` | `true` | Without PVC, pod re-seeds on every restart |

## Ports

| Name | Container port | Service port | Exposure |
|---|---|---|---|
| `webui` | `5174` | configurable (e.g. `8276`) | WebUI, API, `/api/health` |
| `mcp` | `7879` | configurable (e.g. `8277`) | Lucy MCP Proxy (agent entry) |
| KTX upstream | `7878` | **must not appear in Service** | Pod-internal only (`127.0.0.1`) |

**Do not** remap container listen ports to match external Service ports. Map externally
at the Service layer: `port: 8276 → targetPort: webui (5174)`.

Helm values:

```yaml
containerPorts:
  webui: 5174
  mcp: 7879
service:
  webuiPort: 8276   # example external port
  mcpPort: 8277
```

## Probes

| Probe | Mechanism | Path / port |
|---|---|---|
| `startupProbe` | `httpGet` | `/api/health` on named port `webui` |
| `readinessProbe` | `httpGet` | `/api/health` on named port `webui` |
| `livenessProbe` | `httpGet` | `/api/health` on named port `webui` |

**Forbidden in probes:**

- `exec /app/scripts/docker-healthcheck.sh` (designed for Docker HEALTHCHECK, not Kubelet timeouts)
- StarRocks connectivity checks
- `ktx admin reindex`
- MCP `tools/list`

Run deep checks in post-deploy acceptance (`scripts/k8s-acceptance.sh`), not in probes.

Recommended defaults (chart `0.2.x`):

```yaml
startupProbe:
  httpGet: { path: /api/health, port: webui }
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 60

readinessProbe:
  httpGet: { path: /api/health, port: webui }
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 6

livenessProbe:
  httpGet: { path: /api/health, port: webui }
  initialDelaySeconds: 60
  periodSeconds: 30
  timeoutSeconds: 5
  failureThreshold: 3
```

## Init containers

**Forbidden:**

- `runtime-preflight` or any init container calling `/app/scripts/k8s-preflight.sh`
- Init containers that connect to databases, run `ktx admin reindex`, or download artifacts

**Allowed (chart 0.2.1+):**

- `project-migrate`: `chown` `/data/lucy` to UID 10001 and `git init` if missing — no network/DB

Preflight belongs in post-deploy scripts or Helm test Jobs, not in the pod startup path.

## Git / project directory

| Requirement | Value |
|---|---|
| Container `workingDir` | `/data/lucy` |
| Entrypoint | Idempotent `git -C /data/lucy init` when `.git` missing |
| Forbidden | `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_*` env injection |

## Required environment

| Variable | Required | Notes |
|---|---|---|
| `KTX_PROJECT_ROOT` | yes | `/data/lucy` |
| `POSTHOG_DISABLED` | yes | `"1"` |
| `LUCY_PUBLIC_MCP_URL` | yes (non-local) | Externally reachable MCP URL; chart fails render if empty for customer registry |
| `LUCY_ALLOW_PLACEHOLDER_KTX` | prod: empty | `"1"` only for demo seed |

All runtime env must be declared in Helm values — **never** patch with `kubectl set env`
after install (causes manifest drift and extra pod restarts).

## Security context

Chart 0.2.1+ / v3 image contract:

```yaml
podSecurityContext:
  fsGroup: 10001
containerSecurityContext:
  runAsUser: 10001
  runAsGroup: 10001
  runAsNonRoot: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
```

KTX Python runtime path: `/home/lucy/.ktx/runtime/0.16.0/.venv/bin/python`

The optional `project-migrate` init container runs as root **only** to `chown` legacy PVC data before the main container starts.

## Upgrade contract

In-place upgrades (N-1 → N) must succeed **without** operator `git init`, `chown`, `kubectl set env`, or Deployment patches.

Standard path: see [`deploy/k8s/helm/lucy/UPGRADE.md`](helm/lucy/UPGRADE.md).

**Deprecated delivery packages** (do not ship for in-place upgrade):

- `lucy-k8s-integration-delivery-20260902-v1`
- `lucy-k8s-integration-delivery-20260902-v2`

Use `lucy-k8s-integration-delivery-20260902-v3` or later after H2–H5 gates pass.

## Persistence — do not destroy on upgrade

These assets must survive chart upgrades:

- PVC backing `/data/lucy`
- `/data/lucy/ktx.yaml`, `semantic-layer/`, `wiki/`, `evals/`, `skills/`
- `/data/lucy/webui/config/access.yaml`, `.ktx/`
- Kubernetes Secrets for DB passwords and MCP tokens

**Forbidden during routine upgrade:**

```bash
helm uninstall lucy-starrocks   # unless explicitly rebuilding DB
kubectl delete pvc lucy         # unless backed up and intentionally resetting
```

## Release gates

Before any K8s delivery:

1. `bash scripts/build-customer-amd64-image.sh` (G1–G4b + **G8**)
2. `bash scripts/helm-lucy-gate.sh` (H1 static)
3. `bash scripts/k8s-release-gate.sh` (H1–H5 when kind/cluster available; **H3 N-1 upgrade required before customer release**)
4. Post-deploy: `bash scripts/k8s-acceptance.sh`

See [`docs/customer-delivery-preflight-checklist.md`](../../docs/customer-delivery-preflight-checklist.md).
