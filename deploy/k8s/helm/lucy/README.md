# Lucy Helm Chart (supported delivery artifact)

This chart is the **supported** Kubernetes install package for Lucy. It ships with
customer K8s integration deliveries and is versioned together with the container image.

See also:

- [`deploy/k8s/K8S_CONTRACT.md`](../../K8S_CONTRACT.md) — authoritative deployment contract
- [`UPGRADE.md`](UPGRADE.md) — N-1 upgrade procedure
- [`ROLLBACK.md`](ROLLBACK.md) — rollback and recovery

This chart installs Lucy as a single-replica Kubernetes workload.

Key constraints:

- Lucy product version: `0.20.0` (`Chart.appVersion` / `lucy.version`; independent of KTX). Rendering fails if those two fields differ. Chart package version is `0.2.7`, independent of the product version.
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
bash scripts/gates/helm-lucy-gate.sh
```

K3s test profile (external 8276/8277, container 5174/7879):

```bash
helm template lucy deploy/k8s/helm/lucy \
  -f deploy/k8s/helm/lucy/examples/values.k3s-test.yaml
```

## OIDC single sign-on (optional, default OFF)

`oidc.enabled` is `false` by default. With the default, the chart renders
**no** OIDC ConfigMap, Secret volume, mount or env var — the install is
identical to a pre-OIDC deployment and local login is unaffected.

Enabling it wires exactly two env vars, both file paths:

| Env var | Value | Source |
|---|---|---|
| `LUCY_OIDC_CONFIG_FILE` | `/data/lucy/oidc/profile.yaml` | chart-rendered ConfigMap (non-sensitive) |
| `LUCY_OIDC_CLIENT_SECRET_FILE` | `/data/lucy/oidc/client-secret` | the customer's own Kubernetes Secret |

The client secret **value** never appears in values.yaml, in a ConfigMap, in
the pod env or in a command-line argument. It is referenced by name only:

```yaml
webui:
  publicUrl: https://lucy.example.com   # https origin, no path/query/fragment
oidc:
  enabled: true
  issuer: https://idp.example.com
  authorizationEndpoint: https://idp.example.com/oauth2/authorize
  tokenEndpoint: https://idp.example.com/oauth2/token
  jwksUri: https://idp.example.com/oauth2/jwks
  clientId: lucy-webui
  scopes: "openid profile email"
  tokenEndpointAuth: client_secret_post
  redirectPath: /api/auth/oidc/callback
  existingSecret: lucy-oidc-secret      # customer-managed Secret
  clientSecretKey: client-secret        # key inside that Secret
```

The chart refuses to render (loudly) when `oidc.enabled=true` and
`webui.publicUrl` is missing or not an https origin, `security.access` is
not `https`, `existingSecret` / `clientSecretKey` are empty, `scopes` does
not contain `openid`, or `extraEnvFrom` would project the client secret
Secret into the pod env.

The chart never contacts the identity provider: `discoveryUrl`, the
endpoints and `jwksUri` are plain values, so an offline install stays
offline. Probes are unchanged and never talk to the IdP.

Setting `oidc.enabled=false` (or rolling back the chart) removes the
wiring. It does not delete the client secret, the bindings in
`admins.yaml`, or any local password — local login and break-glass keep
working.

Customer deployment steps are in:

```text
docs/runbooks/customer-k8s-deployer-quickstart.md
```

Origin evidence: this chart was promoted from the internal draft at
`inbox/k8s-helm-draft/` (kept as historical reference for the kind cluster
end-to-end verification log, MCP handshake, and `kubectl` / `kubeconform`
output captured before promotion).
