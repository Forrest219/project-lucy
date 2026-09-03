# Lucy Helm Chart (supported delivery artifact)

This chart is the **supported** Kubernetes install package for Lucy. It ships with
customer K8s integration deliveries and is versioned together with the container image.

See also:

- [`deploy/k8s/K8S_CONTRACT.md`](../../K8S_CONTRACT.md) — authoritative deployment contract
- [`UPGRADE.md`](UPGRADE.md) — N-1 upgrade procedure
- [`ROLLBACK.md`](ROLLBACK.md) — rollback and recovery

This chart installs Lucy as a single-replica Kubernetes workload.

Key constraints:

- Lucy product version: `0.17.0` (`Chart.appVersion` / `lucy.version`; independent of KTX). Rendering fails if those two fields differ.
- Bundled KTX version: `@kaelio/ktx@0.16.0`.
- `replicaCount` must be `1` (enforced by the chart template via `fail`).
- `persistence.enabled` must be `true` (enforced by the chart template via `fail`).
- `/data/lucy` is mounted from an RWO PVC.
- Container listens on `5174` (WebUI) and `7879` (MCP Proxy); Service ports are configurable separately.
- KTX upstream `7878` remains Pod-internal and must not be exposed.
- Startup/readiness probes use HTTP `GET /api/health` (not `docker-healthcheck.sh`).

Quick local render:

```bash
helm lint deploy/k8s/helm/lucy
helm template lucy deploy/k8s/helm/lucy \
  -f deploy/k8s/helm/lucy/examples/values.local-test.yaml
bash scripts/helm-lucy-gate.sh
```

K3s test profile (external 8276/8277, container 5174/7879):

```bash
helm template lucy deploy/k8s/helm/lucy \
  -f deploy/k8s/helm/lucy/examples/values.k3s-test.yaml
```

Customer deployment steps are in:

```text
docs/customer-k8s-deployer-quickstart.md
```

Origin evidence: this chart was promoted from the internal draft at
`inbox/k8s-helm-draft/` (kept as historical reference for the kind cluster
end-to-end verification log, MCP handshake, and `kubectl` / `kubeconform`
output captured before promotion).
