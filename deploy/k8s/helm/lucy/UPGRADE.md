# Lucy Helm Chart — Upgrade Guide

Upgrade Lucy on Kubernetes while preserving `/data/lucy` PVC data, Secrets, and MCP tokens.

## Before you start

1. Read [`deploy/k8s/K8S_CONTRACT.md`](../../K8S_CONTRACT.md).
2. Confirm the target image tag is **immutable** and record its digest.
3. Back up the PVC or snapshot `/data/lucy` if your platform supports it.
4. Clear stale Helm state if a previous upgrade failed:

```bash
helm history lucy -n <namespace>
# If status is pending-upgrade or pending-rollback:
helm rollback lucy <last-good-revision> -n <namespace>
# or: helm upgrade lucy ... --force   (only when you understand the risk)
```

## Expected downtime

This chart uses `strategy: Recreate` with a single RWO PVC. During upgrade:

- The old pod terminates before the new pod starts.
- WebUI and MCP are unavailable for **seconds to a few minutes**.
- This is expected — not a rolling zero-downtime deployment.

Plan upgrades in a maintenance window.

## Standard upgrade (N-1 → N)

```bash
helm upgrade lucy deploy/k8s/helm/lucy \
  --namespace <namespace> \
  -f values.production.yaml \
  --atomic \
  --wait \
  --timeout 15m
```

### Required values changes when coming from chart 0.1.x

| Old (0.1.x) | New (0.2.x) |
|---|---|
| exec startup/readiness probes | HTTP `/api/health` (chart default) |
| `service.webuiPort` also used as container port | split: `containerPorts.webui: 5174`, `service.webuiPort: <external>` |
| optional `runtime-preflight` init | **remove entirely** |
| mutable image tag only | add immutable tag + optional `image.digest` |

Example production values overlay:

```yaml
image:
  repository: registry.example.com/data-team/project-lucy
  tag: customer-amd64-0.16.0-20260901-b893a0c
  digest: sha256:bfcb649a2fb9f472e1b58ed212a05bb27d70c30dc7273be13ebeb008fb20a0a5
  pullPolicy: IfNotPresent

containerPorts:
  webui: 5174
  mcp: 7879

service:
  webuiPort: 8276
  mcpPort: 8277

env:
  LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/mcp"

persistence:
  existingClaim: lucy   # reuse existing PVC — do not recreate
```

## Post-upgrade verification

```bash
bash scripts/k8s-acceptance.sh \
  --namespace <namespace> \
  --release lucy \
  --public-mcp-url "https://lucy.example.com/mcp" \
  --token "<bearer-token>"
```

Minimum manual checks:

- Pod `1/1 Ready`
- `curl -fsS http://<webui-host>/api/health` → 200
- MCP without token → 401
- MCP `initialize` with token → 200
- `ktx --project-dir /data/lucy connection test <connection>` succeeds
- Pod restart preserves config, index, and tokens

## Migrating from a custom customer Chart

If you previously maintained your own Chart (e.g. with `runtime-preflight`):

1. Diff your values against `deploy/k8s/helm/lucy/values.yaml`.
2. Delete any init container referencing `k8s-preflight.sh`.
3. Replace exec probes with HTTP `/api/health`.
4. Ensure `LUCY_PUBLIC_MCP_URL` is in Helm values, not applied via `kubectl set env`.
5. Run `bash scripts/helm-lucy-gate.sh` on rendered manifests before applying.

You may either adopt this supported chart directly or merge its templates into your GitOps repo — but the contract in `K8S_CONTRACT.md` must hold either way.

## Do not

- Delete the PVC unless intentionally rebuilding the environment.
- Reuse mutable tags across different image builds.
- Expose port `7878` in Service or Ingress.
- Put StarRocks / reindex / MCP handshake checks into Kubernetes probes.

See [`ROLLBACK.md`](ROLLBACK.md) if the upgrade fails.
