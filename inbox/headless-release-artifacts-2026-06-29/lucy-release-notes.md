# Lucy headless-local-2026-06-29

- Git commit: 31b61c3b41528e680447aaa084f8fde775cc7375
- Docker image: project-lucy:headless-local-2026-06-29
- Docker image id: not-built-in-this-environment
- Bundled KTX: @kaelio/ktx 0.13.0
- Verified databases: MySQL demo, PostgreSQL demo
- Customer headless gates: npm run security:baseline; npm run smoke:p0:docker; npm run smoke:p0:demo; npm run smoke:p0:postgres-demo; npm run smoke:p0:business-eval
- Repository quality gates: npm run lint:spec; npm run smoke:p0; npm run security:baseline; npm audit --json (root, webui); npm run audit:ktx-diff
- npm audit summary: {"info":0,"low":0,"moderate":2,"high":1,"critical":0,"total":3}

## Customer Deployment

Use docs/customer-deployment-guide.md and docs/deployment-docker.md for Docker Compose deployment. The customer standard entry is Lucy MCP Proxy plus an Agent MCP client config; WebUI checks, when present, are repository quality gates and not the customer operating path.
Full P0/P1/P2 test case matrix: docs/lucy-test-cases.md (bundled as release/lucy-test-cases.md).

## Non-Delivery Scope

This release does not deliver a WebUI management console as the customer entry point, Skill Editor / Skill versioning UI, MCP endpoint lifecycle UI, Kubernetes/Helm, or system metrics/alerting/log aggregation.

## Artifacts

- lucy-release-metadata.json
- lucy-release-notes.md
- lucy-sbom.json (production/runtime dependencies; dev dependencies omitted)
- lucy-docker-source-bundle.tar.gz (installable Docker Compose source bundle)
- lucy-customer-deployment-guide.md (copy of docs/customer-deployment-guide.md)
- lucy-deployment-docker.md (copy of docs/deployment-docker.md)
- lucy-test-cases.md (copy of docs/lucy-test-cases.md)
