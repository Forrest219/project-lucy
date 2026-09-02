# Lucy Helm Chart — Rollback Guide

## When to rollback

- `helm upgrade --atomic` timed out and auto-rolled back, but the cluster is still unhealthy.
- New pod starts but fails acceptance (`scripts/k8s-acceptance.sh`).
- Wrong image digest was deployed under a reused mutable tag.
- v1/v2 package upgrade failed — roll back to last known-good revision, then plan v3 retry.

## Quick rollback

```bash
helm history lucy-starrocks -n lucy-test
helm rollback lucy-starrocks <REVISION> -n lucy-test --wait --timeout 15m
```

Verify the rolled-back revision uses the **expected immutable image tag and digest**:

```bash
kubectl -n lucy-test get deploy lucy-starrocks -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

If the tag is mutable and was overwritten in containerd/docker, rollback to an old Helm
revision may still pull the **new** image. In that case:

1. Re-import the known-good image tar with its original immutable tag, or
2. Pin `image.digest` in values to the last known-good digest and upgrade again.

## After atomic upgrade failure

```bash
helm status lucy-starrocks -n lucy-test
kubectl -n lucy-test get pods -l app.kubernetes.io/instance=lucy-starrocks
kubectl -n lucy-test describe pod -l app.kubernetes.io/instance=lucy-starrocks | tail -40
kubectl -n lucy-test logs deploy/lucy-starrocks --tail=100
```

Common failure signatures:

| Symptom | Likely cause | Fix |
|---|---|---|
| `Startup probe failed: command timed out` | Chart 0.1.x exec probe | Upgrade to chart 0.2.x+ |
| `k8s-preflight.sh: No such file` | stale init container | Remove `runtime-preflight`; use v3 chart |
| `dubious ownership in repository at '/data/lucy'` | root pod vs UID 10001 `.git` | v3 image + Chart 0.2.1; enable `projectMigrate` |
| Pod CrashLoop, no `.git` on PVC | missing git init | v3 entrypoint + `project-migrate` init |
| `GIT_CONFIG_COUNT ... not permitted` | invalid Git env | Remove `GIT_CONFIG_*` from values |
| Pod Running but not Ready | probe timeout / wrong port | Check HTTP probe on `webui:5174` |
| Pod Running but 8276/8277 down | ClusterIP Service | Use LoadBalancer / NodePort |
| MCP fallback in WebUI | missing `LUCY_PUBLIC_MCP_URL` in Helm values | set in values, re-upgrade |

## PVC and data safety

Rollback **does not** delete the PVC or `/data/lucy` contents. Tokens, semantic layer,
wiki, and ACL config should remain intact.

**Do not run** unless intentionally resetting the environment:

```bash
kubectl delete pvc lucy -n lucy-test
helm uninstall lucy-starrocks -n lucy-test   # only when decommissioning
```

## Rollback verification

```bash
bash scripts/acceptance.sh \
  --namespace lucy-test \
  --release lucy-starrocks \
  --public-mcp-url "http://<node-ip>:8277/mcp" \
  --token "<bearer-token>"
```

Confirm:

- `/api/health` → 200
- External WebUI and MCP ports reachable (8276 / 8277)
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
