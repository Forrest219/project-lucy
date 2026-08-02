# Lucy Helm Chart

This chart installs Lucy as a single-replica Kubernetes workload.

Key constraints:

- Bundled KTX version: `@kaelio/ktx@0.16.0`.
- `replicaCount` must be `1`.
- `persistence.enabled` must be `true`.
- `/data/lucy` is mounted from an RWO PVC.
- Service exposes only `5174` and `7879`.
- KTX upstream `7878` remains Pod-internal and must not be exposed.

Quick local render:

```bash
helm lint deploy/k8s/helm/lucy
helm template lucy deploy/k8s/helm/lucy \
  -f deploy/k8s/helm/lucy/examples/values.local-test.yaml
```

Customer deployment steps are in:

```text
docs/customer-k8s-deployer-quickstart.md
```
