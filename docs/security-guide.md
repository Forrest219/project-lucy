# Lucy Security Guide

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Security Guide |
| 文档类型 | Security / Operations Guide |
| 版本 | v0.1 |
| 撰写日期 | 2026-06-22 |
| 适用范围 | Docker 部署、MCP Proxy、Agent token、ACL、audit、secrets |

## 1. Security Model

Lucy sits between agents and databases:

- Agents call Lucy MCP Proxy.
- Lucy authenticates bearer tokens.
- Lucy resolves role-based permissions.
- Lucy forwards allowed calls to bundled KTX.
- Lucy records audit logs.

Lucy does not make the source database public. Database credentials stay in the mounted KTX project data directory.

## 2. Token Lifecycle

Rules:

- Plaintext token is returned only once when created.
- `webui/config/access.yaml` stores only `sha256:<hex>` token hashes.
- Token revocation is persisted in `.ktx-ui/audit.sqlite`.
- Disabled agents must be denied before tool-level checks.
- Do not commit token plaintext, `.ktx/secrets/`, or `.ktx-ui/*.sqlite*`.

Verification:

```bash
npm run security:baseline
```

## 3. ACL Policy

Role-first ACL is the preferred policy shape:

```yaml
roles:
  analyst:
    allow:
      connections: [demo-mysql]
      tableSelectors:
        - connection: demo-mysql
          schema: dataforai
          names: [superstore_orders]
      tools: [kx_catalog, sl_query, sl_read_source, wiki_search]
```

Rules:

- Enabled users must not use wildcard legacy `allow.tables: ["*"]` or `allow.tools: ["*"]`.
- `defaults.deny_tools` must include `sql_execution`, `memory_ingest`, and `memory_ingest_status`.
- Table-touching tools must be explicitly classified.
- Unknown or newly added KTX tools require review before exposure.

## 4. Audit

Audit records are stored in SQLite under `.ktx-ui/` by default.

Audit captures:

- user id and token label/hash prefix.
- client/session metadata when available.
- tool name, table refs, decision outcome, and duration.
- permission snapshot hash.
- response row/column summary when available.

Sensitive payload handling:

- Full raw SQL/query payloads are rejected by ACL for proxy tool calls.
- Error detail is truncated before persistence.
- Token hashes are prefix-only in access logs.

## 5. Secrets

Do:

- Mount customer KTX project data at `/data/lucy`.
- Store DB passwords under `/data/lucy/.ktx/secrets/`.
- For Docker Compose environments that standardize on Docker secrets, mount `docker-compose.secrets.yml` and reference `/run/secrets/<name>` from `ktx.yaml`.
- Use read-only database users where possible.
- Rotate tokens through WebUI/Admin API when an agent is retired.

Do not:

- Bake customer credentials into the image.
- Use `KTX_INTERNAL_TOKEN` as an external agent token.
- Commit `.ktx/secrets/`, `.ktx-ui/*.sqlite*`, or generated DB files.

## 6. Release Gate

Required before customer release:

```bash
npm run r1:readiness:strict
npm run lint:spec
npm run security:baseline
npm run smoke:p0:docker
npm run smoke:p0:demo
npm run smoke:p0:postgres-demo
npm run smoke:p0:business-eval
```

For KTX upgrades:

```bash
npm run compat:ktx-upgrade -- --candidate <version>
```

R1 受控数据服务层发布还必须按 `docs/lucy-r1-release-runbook.md` 归档目标源 vertical slice evidence、Hermes QA Accuracy Report 和 `/api/r1/observability` 快照。默认目标源仍是 Doris；StarRocks 仅在显式 `--target starrocks` 且 evidence 通过时进入 P1 gated release review，live certification 通过前不得写入 verified matrix。

## 7. Residual Risks

| Risk | Current Control | Next Step |
|---|---|---|
| Registry publishing credentials | Not enabled in CI | Decide registry and credentials policy |
| Multi-admin WebUI auth | Out of current scope | Add if moving beyond local/single-admin deployment |
| High-sensitive domains | Current role/table ACL | Add domain-level isolation if business policy requires it |
| Public MCP endpoint | Bearer token + ACL | Add TLS/front-door policy before internet exposure |
