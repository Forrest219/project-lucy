# Lucy Headless Customer Config Package Example

This directory shows the recommended customer-owned configuration package shape for
headless Docker deployments.

Use it as a template for a real `customer-config/` directory, then mount that
directory to `/data/lucy` with `docker-compose.customer-config.yml`.

Do not commit real secret files. Runtime credentials should live in
`.ktx/secrets/`, Docker secrets, or the customer's secret store.

## Layout

```text
customer-config/
  ktx.yaml
  semantic-layer/
  wiki/
  evals/
  skills/
  webui/config/access.yaml
  .ktx/secrets/
  .ktx-ui/
```

## Validate

```bash
npm run smoke:p0:headless-config -- --root customer-config.example
```

For a real customer package, run:

```bash
npm run smoke:p0:headless-config -- --root customer-config --require-secret-files
```
