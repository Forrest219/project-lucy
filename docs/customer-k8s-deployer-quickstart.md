# Lucy Kubernetes / Helm Deployer Quickstart

| Metadata | Value |
|---|---|
| Document | Lucy Kubernetes / Helm Deployer Quickstart |
| Type | Customer deployment runbook |
| Version | v0.1 |
| Date | 2026-08-03 |
| Scope | Single-replica Kubernetes deployment for Lucy with bundled `@kaelio/ktx@0.16.0` |

This guide is for a customer deployment manager installing Lucy on Kubernetes
with Helm. The chart is intentionally single-replica: it uses one RWO PVC for
`/data/lucy` and `Deployment.strategy.type=Recreate`.

Lucy exposes:

| Port | Purpose | Exposure |
|---|---|---|
| `5174` | WebUI / API / `/api/health` | Kubernetes Service |
| `7879` | Lucy MCP Proxy for agents | Kubernetes Service / Ingress |
| `7878` | KTX MCP upstream | Pod-internal only; do not expose |

## 1. Prerequisites

- `kubectl` access to the target namespace.
- `helm` 3.10 or newer.
- A registry image for Lucy built from this repository.
- A default or named `ReadWriteOnce` StorageClass.
- Network access from the Lucy Pod to the customer database.
- A Kubernetes Secret containing database password files when using real
  customer data.

## 2. Build And Push Image

> ⚠ Architecture matters. Lucy release images are published as a multi-arch
> manifest list containing both `linux/amd64` (primary; x86_64 customer
> hardware) and `linux/arm64` (secondary; Apple Silicon / AWS Graviton
> developers). If you build on an `arm64` Mac and forget to set
> `--platform linux/amd64`, you will push an `arm64`-only image and your
> customer AMD nodes will pull with `ImagePullBackOff` or fail at exec.

Check the architecture of your **build host** and your **target K8s nodes**:

```bash
# Build host
uname -m

# Target K8s nodes
kubectl get nodes -o wide
# The `OS-IMAGE` / kernel columns hint at the CPU; for binary confirmation:
kubectl get nodes -o jsonpath='{.items[*].status.nodeInfo.architecture}'
# Returns e.g. ["amd64"] or ["arm64"] or ["amd64" "arm64"] (heterogeneous).
```

### 2.1 Production build (recommended)

Use `docker buildx` with explicit `--platform linux/amd64` so the published
tag always contains the customer architecture:

```bash
docker buildx build \
  --platform linux/amd64 \
  --build-arg KTX_VERSION=0.16.0 \
  -t registry.example.com/data-team/project-lucy:0.16.0 \
  --push .
```

If your cluster also serves `arm64` workloads, add the second platform and
push a multi-arch manifest list in one command:

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg KTX_VERSION=0.16.0 \
  -t registry.example.com/data-team/project-lucy:0.16.0 \
  --push .
```

After pushing, verify the manifest list really contains `linux/amd64`:

```bash
docker manifest inspect registry.example.com/data-team/project-lucy:0.16.0
# Look for `manifests[].platform.architecture == "amd64"`.
```

### 2.2 Local kind / k3d verification (optional)

For local verification on a kind cluster running on the same architecture as
your build host, you can use the simpler `docker build` form:

```bash
docker build -t project-lucy:0.16.0 --build-arg KTX_VERSION=0.16.0 .
kind load docker-image project-lucy:0.16.0 --name <kind-cluster>
```

> If your build host is `arm64` (Apple Silicon) and your kind cluster
> happens to be `amd64` (or you want to mirror production), pass
> `--platform linux/amd64` to `docker buildx build` even for local kind
> verification:
>
> ```bash
> docker buildx build --platform linux/amd64 \
>   -t project-lucy:0.16.0 --build-arg KTX_VERSION=0.16.0 \
>   --load .
> kind load docker-image project-lucy:0.16.0 --name <kind-cluster>
> ```

## 3. Prepare Customer Values

Start from the committed example:

```bash
cp deploy/k8s/helm/lucy/examples/values.local-test.yaml values.customer.yaml
```

Edit at least these fields:

```yaml
image:
  repository: registry.example.com/data-team/project-lucy
  tag: "0.16.0"
  pullPolicy: IfNotPresent

persistence:
  storageClass: "<storage-class-name>"
  size: 10Gi

env:
  LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/mcp"
  LUCY_ALLOW_PLACEHOLDER_KTX: ""

existingSecret: "lucy-db-secrets"
extraSecretData: {}
```

> ⚠ The chart refuses to render when `image.repository` starts with
> `REPLACE-ME-`. Use the example `values.local-test.yaml` only for kind /
> docker compose local dev (it deliberately leaves `repository: project-lucy`
> for `kind load docker-image`); for any real cluster install, override
> `image.repository` to a customer registry path that contains
> `linux/amd64`.

`LUCY_PUBLIC_MCP_URL` is the URL copied into agent configuration. Do not use
`127.0.0.1`, Pod IPs, or cluster-local service names for production agents.

## 4. Create Secrets

Use an externally managed Secret for production. Example:

```bash
kubectl create namespace lucy

kubectl create secret generic lucy-db-secrets \
  --namespace lucy \
  --from-literal=mysql-password='<REPLACE-WITH-DB-PASSWORD>'
```

Reference the file from `/data/lucy/ktx.yaml`:

```yaml
password: file:/data/lucy/.ktx/secrets/mysql-password
```

All keys in `existingSecret` are mounted under `/data/lucy/.ktx/secrets/`.

## 5. Install

```bash
helm upgrade --install lucy deploy/k8s/helm/lucy \
  --namespace lucy --create-namespace \
  -f values.customer.yaml
```

Expected resources:

- `Deployment/lucy`
- `Service/lucy`
- `PersistentVolumeClaim/lucy-data`
- `ConfigMap/lucy-runtime-contract`
- optional chart-managed `Secret/lucy-secrets` only when `extraSecretData` is
  set for local testing

## 6. Initialize Customer Context

On first start, the entrypoint seeds `/data/lucy` from the image template.
For a real customer deployment, replace the seeded placeholders with the
customer context package:

- `ktx.yaml`
- `semantic-layer/`
- `wiki/`
- `evals/`
- `skills/`
- `webui/config/access.yaml`
- `.ktx/secrets/`
- `.ktx-ui/`

Production must not run with `CHANGE-ME` placeholders. Keep
`LUCY_ALLOW_PLACEHOLDER_KTX` empty unless doing a template-only local test.

## 7. Verify Runtime

```bash
kubectl get pods -n lucy -l app.kubernetes.io/name=lucy
kubectl logs -n lucy deploy/lucy
kubectl exec -n lucy deploy/lucy -- ktx --version
```

Expected KTX version:

```text
@kaelio/ktx 0.16.0
```

Port-forward for local verification:

```bash
kubectl port-forward -n lucy svc/lucy 5174:5174 7879:7879
curl -fsS http://127.0.0.1:5174/api/health
```

Expected health response includes:

```json
{"ok":true,"data":{"bundledKtxVersion":"0.16.0"}}
```

## 8. Verify MCP Proxy

Use a bearer token created through Lucy agent administration. Then:

```bash
curl -fsS -X POST http://127.0.0.1:7879/mcp \
  -H "Authorization: Bearer $LUCY_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  -i
```

Capture the `mcp-session-id` response header and call `tools/list`:

```bash
curl -fsS -X POST http://127.0.0.1:7879/mcp \
  -H "Authorization: Bearer $LUCY_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

The exact tools depend on `webui/config/access.yaml`. At minimum, the intended
customer role should expose the Lucy MCP surface it needs, such as
`lucy_catalog`, `lucy_read_source`, and `lucy_query`.

KTX `0.16.0` does not expose `sl_validate` as an MCP tool. Validate semantic
sources with the CLI command in the next section.

## 9. Verify Database And Semantic Layer

```bash
kubectl exec -n lucy deploy/lucy -- \
  ktx --project-dir /data/lucy connection test <connection-id>

kubectl exec -n lucy deploy/lucy -- \
  ktx --project-dir /data/lucy admin reindex --force

kubectl exec -n lucy deploy/lucy -- \
  ktx --project-dir /data/lucy sl validate <source-name> --connection-id <connection-id>

kubectl exec -n lucy deploy/lucy -- \
  ktx --project-dir /data/lucy sl --connection-id <connection-id> query \
    --measure <source.measure> \
    --dimension <source.dimension> \
    --limit 5 \
    --execute \
    --max-rows 5
```

Do not accept a deployment as complete until the customer database connection,
semantic index rebuild, source validation, and one read-only query all pass
inside the Pod.

## 10. Upgrade And Rollback

Upgrade:

```bash
helm upgrade lucy deploy/k8s/helm/lucy \
  --namespace lucy \
  -f values.customer.yaml
```

Rollback:

```bash
helm history lucy -n lucy
helm rollback lucy <REVISION> -n lucy
```

Because the chart uses `Recreate`, upgrades have downtime while the Pod stops,
the PVC remounts, and Lucy starts.

## 11. Uninstall

```bash
helm uninstall lucy -n lucy
```

PVC data is intentionally not deleted by the chart. Delete it only after an
explicit backup and approval:

```bash
kubectl delete pvc -n lucy -l app.kubernetes.io/name=lucy,app.kubernetes.io/instance=lucy
```

## 12. Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Pod `CrashLoopBackOff` | Image pull failure, placeholder `ktx.yaml`, or invalid context files | `kubectl describe pod` and `kubectl logs`; confirm `LUCY_ALLOW_PLACEHOLDER_KTX` is only used for local tests |
| `/api/health` works but agents cannot connect | `LUCY_PUBLIC_MCP_URL` points to an internal URL | Fix DNS / Ingress and set `env.LUCY_PUBLIC_MCP_URL` to the external MCP URL |
| `ktx connection test` fails | DB network, credentials, or `file:` secret path is wrong | Check `/data/lucy/.ktx/secrets`, network policy, VPC routing, and DB allowlist |
| `sl validate` works locally but not in Pod | PVC context differs from local files | Inspect `/data/lucy/ktx.yaml` and `/data/lucy/semantic-layer` inside the Pod |
| Someone exposed `7878` | KTX upstream was added manually to Service / Ingress | Remove it immediately; `7878` is Pod-internal only |

## 13. Out Of Scope

- Multi-replica HA.
- Horizontal autoscaling.
- Operator / CRD management.
- Automated TLS certificate issuance.
- Customer-specific NetworkPolicy and registry credential management.
