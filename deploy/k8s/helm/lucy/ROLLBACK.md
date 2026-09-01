# Lucy Helm Chart — Rollback Guide

## When to rollback

- `helm upgrade --atomic` timed out and auto-rolled back, but the cluster is still unhealthy.
- New pod starts but fails acceptance (`scripts/k8s-acceptance.sh`).
- Wrong image digest was deployed under a reused mutable tag.

## Quick rollback

```bash
helm history lucy -n <namespace>
helm rollback lucy <REVISION> -n <namespace> --wait --timeout 15m
```

Verify the rolled-back revision uses the **expected immutable image tag and digest**:

```bash
kubectl -n <namespace> get deploy lucy -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

If the tag is mutable and was overwritten in containerd/docker, rollback to an old Helm
revision may still pull the **new** image. In that case:

1. Re-import the known-good image tar with its original immutable tag, or
2. Pin `image.digest` in values to the last known-good digest and upgrade again.

## After atomic upgrade failure

```bash
helm status lucy -n <namespace>
kubectl -n <namespace> get pods -l app.kubernetes.io/instance=lucy
kubectl -n <namespace> describe pod -l app.kubernetes.io/instance=lucy | tail -40
```

Common failure signatures:

| Symptom | Likely cause | Fix |
|---|---|---|
| `Startup probe failed: command timed out` | Chart 0.1.x exec probe | Upgrade to chart 0.2.x |
| `k8s-preflight.sh: No such file` | stale init container | Remove `runtime-preflight` |
| Pod Running but not Ready | probe timeout / wrong port | Check HTTP probe on `webui:5174` |
| MCP fallback in WebUI | missing `LUCY_PUBLIC_MCP_URL` in Helm values | set in values, re-upgrade |

## PVC and data safety

Rollback **does not** delete the PVC or `/data/lucy` contents. Tokens, semantic layer,
wiki, and ACL config should remain intact.

**Do not run** unless intentionally resetting the environment:

```bash
kubectl delete pvc lucy -n <namespace>
helm uninstall lucy -n <namespace>   # only when decommissioning
```

## Rollback verification

```bash
bash scripts/k8s-acceptance.sh \
  --namespace <namespace> \
  --release lucy \
  --public-mcp-url "<external-mcp-url>" \
  --token "<bearer-token>"
```

Confirm:

- `/api/health` → 200
- External WebUI and MCP ports reachable (e.g. 8276 / 8277)
- StarRocks connection test passes
- MCP `tools/list` succeeds with token

## Recording rollback evidence

For customer deliveries, archive:

- `helm history` output
- Pod image digest before and after
- Acceptance script output
- Timestamp and operator

Store under `inbox/` or your release evidence package per
[`docs/customer-delivery-preflight-checklist.md`](../../../docs/customer-delivery-preflight-checklist.md).
