# Lucy Headless Customer Config Package Example

This directory shows the recommended customer-owned configuration package shape for
headless Docker deployments.

Use it as a template for a real `customer-config/` directory, then mount that
directory to `/data/lucy` with `deploy/compose/docker-compose.customer-config.yml`.

Do not commit real secret files. Runtime credentials should live in
`.ktx/secrets/`, Docker secrets, or the customer's secret store.

## Layout

```text
customer-config/
  ktx.yaml
  webui/config/access.yaml
  .ktx/secrets/
  .ktx-ui/
  config/                    ← Lucy content root (LUCY_CONTENT_ROOT)
    semantic-layer/
    wiki/
    evals/
    skills/
```

> A2 (M31): the four content dirs live under the configurable content root
> (default `config/`). `LUCY_CONTENT_ROOT=.` keeps the legacy sibling layout
> if a deployment still depends on it. `webui/config/access.yaml`,
> `.ktx/secrets/`, and `.ktx-ui/` always live at the project root.

## Validate

```bash
# New layout (M31 default)
npm run smoke:p0:headless-config -- --root customer-config.example

# Legacy sibling layout
LUCY_CONTENT_ROOT=. npm run smoke:p0:headless-config -- --root customer-config.example
```

For a real customer package, run:

```bash
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
```
