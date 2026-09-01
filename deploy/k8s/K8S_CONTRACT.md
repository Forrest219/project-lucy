# Lucy Kubernetes Deployment Contract

| Metadata | Value |
|---|---|
| Document | Lucy K8s Deployment Contract |
| Version | 1.0 |
| Date | 2026-09-01 |
| Scope | Supported Helm chart `deploy/k8s/helm/lucy/` and customer K8s integrations |

This document is the **authoritative contract** for Lucy on Kubernetes. The Helm chart
in this repository is a **supported delivery artifact** — not a reference snapshot.

## Compatibility matrix

| Chart version | App (KTX) | Probe model | Notes |
|---|---|---|---|
| `0.1.x` | `0.16.0` | startup/readiness exec `docker-healthcheck.sh` | **Deprecated** — do not use for new installs or upgrades |
| `0.2.x` | `0.16.0` | HTTP `GET /api/health` on port `webui` | Current supported baseline |

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

Preflight belongs in post-deploy scripts or Helm test Jobs, not in the pod startup path.

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

Current image contract (root entrypoint):

```yaml
containerSecurityContext:
  runAsUser: 0
  runAsNonRoot: false
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
```

Long-term: ship a non-root image for PSA `restricted` / OpenShift SCC compatibility.

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

1. `bash scripts/helm-lucy-gate.sh` (H1 static)
2. `bash scripts/k8s-release-gate.sh` (H1–H5 when kind/cluster available)
3. Post-deploy: `bash scripts/k8s-acceptance.sh`

See [`docs/customer-delivery-preflight-checklist.md`](../../docs/customer-delivery-preflight-checklist.md).
