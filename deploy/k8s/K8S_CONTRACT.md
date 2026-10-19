# Lucy Kubernetes Deployment Contract

| Metadata | Value |
|---|---|
| Document | Lucy K8s Deployment Contract |
| Version | 1.2 |
| Date | 2026-10-08 |
| Scope | Supported Helm chart `deploy/k8s/helm/lucy/` and customer K8s integrations |

This document is the **authoritative contract** for Lucy on Kubernetes. The Helm chart
in this repository is a **supported delivery artifact** — not a reference snapshot.

## Compatibility matrix

| Chart version | Lucy product | Bundled KTX | Probe model | Notes |
|---|---|---|---|---|
| `0.1.x` | legacy/ambiguous | `0.16.0` | startup/readiness exec `docker-healthcheck.sh` | **Deprecated** — do not use for new installs or upgrades |
| `0.2.0` | legacy/ambiguous | `0.16.0` | HTTP `GET /api/health` on port `webui` | Superseded; missing UID/git contract |
| `0.2.1` | legacy/ambiguous | `0.16.0` | HTTP probes + UID 10001 + `workingDir` | Superseded by product-version-aware chart 0.2.2 |
| `0.2.2` | `0.17.0` | `0.16.0` | HTTP probes + UID 10001 + `workingDir` | **Superseded** — Secret mounted read-only over `.ktx/secrets` (WebUI writes fail with `EROFS`) |
| `0.2.3` | `0.17.0` | `0.16.0` | HTTP probes + UID 10001 + `workingDir` | `secrets-sync` init, `LUCY_CONTENT_ROOT`, name pinning |
| `0.2.4` | `0.17.0` | `0.16.0` | same workload contract as 0.2.3 | Product baseline before 2026-10-19. Chart package version was not bumped for the later product cut |
| `0.2.4` | `2.0.0` | `0.16.0` | same workload contract as 0.2.3 | **Current** — product line cut from `0.17.0` to `2.0.0`; chart `version` stays `0.2.4` |

Image tags must be **immutable**. Recommended form:

```text
project-lucy:customer-amd64-2.0.0-YYYYMMDD-<gitShortSha>
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

- `exec /app/scripts/runtime/docker-healthcheck.sh` (designed for Docker HEALTHCHECK, not Kubelet timeouts)
- StarRocks connectivity checks
- `ktx admin reindex`
- MCP `tools/list`

Run deep checks in post-deploy acceptance (`scripts/gates/k8s-acceptance.sh`), not in probes.

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

**Allowed (chart 0.2.3):**

- `project-migrate`: `chown` entries under `/data/lucy` that are not already `10001:10001` — no network/DB, no `git init`
- `secrets-sync` (only when `existingSecret` / `extraSecretData` is set): copy Secret keys from the read-only
  `/mnt/lucy-secrets` mount into the PVC at `/data/lucy/.ktx/secrets` (dir `0700`, files `0600`, owner `10001:10001`).
  Keys in the Secret add/overwrite files; files that exist only on the PVC are **never deleted**. No network/DB.

Preflight belongs in post-deploy scripts or Helm test Jobs, not in the pod startup path.

## Git / project directory

| Requirement | Value |
|---|---|
| Container `workingDir` | `/data/lucy` |
| **Git init authority** | **Entrypoint only** (`docker-entrypoint.sh`) |
| `project-migrate` init | **chown only** — must not run `git init` |
| Forbidden | `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_*` env injection |

### PVC UID migration matrix

| Legacy `.git` owner | v3 behavior |
|---|---|
| UID 10001 | Compatible |
| UID 0 (v1/v2 root) | `project-migrate` chown → 10001 |
| Other UID | Not auto-supported — manual plan required |

## Required environment

| Variable | Required | Notes |
|---|---|---|
| `KTX_PROJECT_ROOT` | yes | `/data/lucy` |
| `POSTHOG_DISABLED` | yes | `"1"` |
| `LUCY_VERSION` | yes | Lucy product version; current baseline `2.0.0` |
| `LUCY_BUNDLED_KTX_VERSION` | yes | Bundled KTX identity; current baseline `0.16.0` |
| `LUCY_PUBLIC_MCP_URL` | yes (non-local) | Externally reachable MCP URL; chart fails render if empty for customer registry |
| `LUCY_ALLOW_PLACEHOLDER_KTX` | prod: empty | `"1"` only for demo seed |
| `LUCY_CONTENT_ROOT` | PVCs with legacy layout | `"."` when `semantic-layer/`, `wiki/`, `skills/` sit next to `ktx.yaml`; empty = image default `config/`. Injected by the chart from `env.LUCY_CONTENT_ROOT` |

### WebUI authentication pins (enterprise security T02)

The chart hard-codes these entries in the Pod `env` (they are not exposed as values and are not valid `env.*` overrides):

| Variable | Chart value | Notes |
|---|---|---|
| `LUCY_DEPLOYMENT_MODE` | `customer` | Default-deny WebUI auth; `LUCY_WEBUI_AUTH=off` is rejected at startup |
| `LUCY_CHART_DEPLOYMENT_MODE` | `customer` | The chart's pin. Startup (entrypoint and server) exits non-zero when it differs from the effective `LUCY_DEPLOYMENT_MODE`, e.g. when an `extraEnvFrom` Secret/ConfigMap supplies `LUCY_DEPLOYMENT_MODE=development` |
| `LUCY_WEBUI_COOKIE_SECURE` | `1` | Secure session cookie + HSTS. `0` is refused in customer mode |
| `LUCY_WEBUI_TEST_PROFILE` | absent | Set to `1` (with `LUCY_WEBUI_COOKIE_SECURE=0`) only when `security.insecureHttpTestProfile: true`, for kind / k3s test profiles over plain HTTP. `/api/health` then reports `insecureTestProfile: true`. Never enable for a customer install |
| `LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE` | `/run/secrets/lucy-bootstrap/token` | Only when `bootstrap.existingSecret` is set (Secret key `token`, mounted read-only); the value never appears in ConfigMap, argv or logs |

Kubernetes gives explicit `env` entries precedence over `envFrom`, so an `extraEnvFrom` source cannot shadow the pins on K8s itself; the startup check above is the second line of defence for other runtimes and for edited manifests. `helm template` assertions for these pins live in `npm run gate:k8s-static` (`scripts/gates/helm-lucy-gate.sh`).

Behind an ingress, supply `LUCY_TRUST_PROXY=1` and `LUCY_TRUSTED_PROXY_CIDRS` (comma-separated CIDRs of the ingress controller) through `extraEnvFrom` so login/bootstrap rate limits use the real client address. Without CIDRs, forwarded headers are ignored and all clients share the ingress address as the throttling source.

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

The `project-migrate` and `secrets-sync` init containers run as root **only** (capabilities `CHOWN`, `DAC_OVERRIDE`, `FOWNER`) to hand legacy PVC data and copied password files to UID 10001 before the main container starts.

## Secrets and resource names

- A Kubernetes Secret volume is always read-only. It must **never** be mounted at `/data/lucy/.ktx/secrets`; the Lucy container mounts only the `/data/lucy` PVC. Passwords reach the PVC through `secrets-sync`.
- `fullnameOverride` pins Deployment / Service / ServiceAccount names for environments that already run objects under a name that differs from the Helm release (lucy-test: release `lucy-starrocks`, objects `lucy`). The Deployment selector is immutable, so the live selector must already equal `app.kubernetes.io/name=<chart name>` + `app.kubernetes.io/instance=<release>`.
- The offline image is loaded with the runtime of the cluster (K3s: `k3s ctr images import`), with `image.pullPolicy: Never`.

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

1. `bash scripts/release/build-customer-amd64-image.sh` (G1–G4c + **G8** image-only)
2. `bash scripts/gates/helm-lucy-gate.sh` (H1a universal + H1b k3s profile)
3. `bash scripts/gates/verify-k8s-package.sh` (K6 package integrity)
4. `bash scripts/gates/k8s-upgrade-gate.sh` (H3; `--test-rollback` for H4)
5. `bash scripts/gates/k8s-release-gate.sh --with-cluster --test-upgrade …` (orchestrator)
6. Post-deploy: `bash scripts/gates/k8s-acceptance.sh` (H5; in a package: `scripts/acceptance.sh`, with `--release`, `--deployment`, `--service` kept distinct and the token passed via `LUCY_MCP_TOKEN`)

See [`docs/runbooks/customer-delivery-preflight-checklist.md`](../../docs/runbooks/customer-delivery-preflight-checklist.md).

## Candidate digest and real-user E2E (Spec 20261018 §8.3, Plan T14)

- A customer release is exactly one image **digest**: built once (native linux/amd64), gated (G1–G4 + ELF, G4b, G8), deployed
  to an isolated single-replica K8s, verified by real-user E2E, then **promoted** (not rebuilt) to the customer tag.
  The candidate is pushed under a `candidate-amd64-…` tag; a customer tag or package exists only after
  `customer-release-readiness` passed.
- `scripts/gates/k8s-acceptance.sh --expect-image-digest <sha256:…> --deployment-evidence <file>` fails unless the running
  Pod's registry digest (from `imageID`, never the Deployment's image string or a config ID) is the candidate, and it writes
  the instance, the single-replica topology and the digest actually deployed (`results/deployment.json`).
- The isolated test deployment lives in `deploy/k8s/security-e2e/` (values, NetworkPolicy, `deploy-candidate.sh`). It is a
  test profile only, carries no credential and no fault switch; faults come from a test control plane outside the Pod.
  **Known gap:** no K8s fault-control plane exists yet, so catalog variants that require `fault-control` stay BLOCKED on K8s.
- An N-1 → candidate in-place PVC upgrade on the same digest (`k8s-upgrade` gate, OPS-01-V02..V07) is not yet wired into the
  workflow; the verifier reports it as BLOCKED (`gate_missing`), never as passed.
