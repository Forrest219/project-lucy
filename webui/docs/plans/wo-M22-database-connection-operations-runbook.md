# M22 Database Connection Operations Runbook Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update Lucy's system handbook and Help Center so operations users can safely add any supported database connection through `ktx.yaml` and secrets, while understanding exactly what WebUI does and does not manage.

**Architecture:** This is a documentation and Help Center governance task. Do not implement WebUI connection creation. Keep `ktx.yaml` and secret files as the source of truth for new physical database connections; WebUI remains the management surface for declared connections, Schema, table whitelist, YAML assets, local Catalog status, tests, and ACL observability.

**Tech Stack:** Markdown, existing Help API, existing Help Center route, Vitest, `scripts/lint-spec.mjs`. No new runtime dependency, no database access, no secret access.

**Source Spec:** [../26-database-connection-operations-runbook-spec.md](../26-database-connection-operations-runbook-spec.md)

---

## Context For Developer

Read these documents before editing:

- `webui/docs/26-database-connection-operations-runbook-spec.md`
- `docs/SYSTEM_HANDBOOK.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/25-connection-module-terminology-ia-refresh-spec.md`
- `webui/docs/17-static-catalog-loading-spec.md`
- `webui/docs/21-connection-catalog-upload-ux-spec.md`
- `webui/docs/24-yaml-delivery-runbook-spec.md`
- `docs/customer-deployment-guide.md`
- `docs/admin-guide.md`
- `docs/design-db-connection.md`
- `docs/design-schema-onboarding.md`
- `docs/DEVELOPMENT.md`

Read these Help files:

- `webui/server/help.ts`
- `webui/server/__tests__/help.test.ts`
- `webui/src/pages/HelpCenter.tsx`
- `webui/src/__tests__/help-center.test.tsx`

Non-negotiable boundaries:

- Do not build a WebUI “new connection” form.
- Do not read, print, parse, or commit `.ktx/secrets/**`.
- Do not add real hostnames, usernames, passwords, tokens, cookies, or customer-specific values to docs.
- Do not edit `CLAUDE.md`.
- Do not move operations runbook content into `webui/config/data-qa-instructions.md`.
- Do not describe Catalog Reload as physical database scanning.
- Do not run destructive database commands, DDL, DML, load jobs, or admin APIs.
- Keep the runbook generic across MySQL, PostgreSQL, Doris, StarRocks, and future KTX-supported connection shapes.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Task 1: Add Handbook Boundary And TOC

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`
- Modify: `webui/server/help.ts`
- Test: `webui/server/__tests__/help.test.ts`

**Step 1: Add failing Help TOC coverage**

In `webui/server/__tests__/help.test.ts`, add or extend a test so these handbook headings receive stable IDs:

```ts
expect(parseHelpToc("#### 新增数据库连接（运维 Runbook）")).toEqual([
  {
    id: "database-connection-operations-runbook",
    level: 4,
    title: "新增数据库连接（运维 Runbook）"
  }
]);
```

Also cover these headings if the parser supports multiple headings in one fixture:

```markdown
#### WebUI 与 ktx.yaml 的职责边界
#### 连接形态与配置字段
#### Agent 可见性与 ACL 同步
```

Expected before implementation: FAIL if no stable alias exists.

**Step 2: Add stable Help aliases**

Modify `webui/server/help.ts` heading alias rules with patterns equivalent to:

```ts
[/新增数据库连接|Database Connection Operations/i, "database-connection-operations-runbook"],
[/WebUI 与 ktx\.yaml 的职责边界|职责边界/i, "database-connection-boundary"],
[/连接形态与配置字段|Connection Shape/i, "database-connection-shapes"],
[/Agent 可见性与 ACL 同步|ACL 同步/i, "database-connection-acl-sync"]
```

Keep existing aliases intact.

**Step 3: Update handbook TOC**

In `docs/SYSTEM_HANDBOOK.md`, under `3.2 数据库接入`, add nested TOC entries if the handbook TOC tracks sub-subsections:

```markdown
  - [3.2 数据库接入](#32-数据库接入)
    - [WebUI 与 ktx.yaml 的职责边界](#webui-与-ktxyaml-的职责边界)
    - [新增数据库连接（运维 Runbook）](#新增数据库连接运维-runbook)
```

If the top TOC is intentionally shallow, only update the `3.2` body.

**Step 4: Add the explicit boundary statement**

At the start of `### 3.2 数据库接入`, before the entry table, add:

```markdown
> WebUI 不负责新建物理数据库连接。新增连接的 host、port、database、username、password、driver 等字段由运维在 `ktx.yaml` 和 secret 文件中配置。
> WebUI 管理的是已声明连接：查看连接状态、测试连接、添加 Schema、维护表白名单、上传 YAML 资产、刷新本地 Catalog。
```

Also add a short capability table:

| 工作 | 操作入口 |
|---|---|
| 新增物理数据库连接 | `ktx.yaml` + secret 文件 |
| 修改连接 host / port / username / password | `ktx.yaml` + secret 文件 |
| 给已有连接添加 Schema | WebUI `/connections` 或受控 API |
| 测试连接 | WebUI 或 `ktx connection test` |
| 维护表白名单 | WebUI `/connections/whitelist` |
| 让 Agent 可见 | `webui/config/access.yaml` role / ACL |

**Step 5: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/help.test.ts
```

Expected: PASS.

---

## Task 2: Add Generic Connection Configuration Reference

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`

**Step 1: Add the “连接形态与配置字段” subsection**

Add a section under `3.2 数据库接入`:

```markdown
#### 连接形态与配置字段
```

Include the generic field table from the source spec:

- `driver`
- `engine`
- `wire_protocol`
- `readonly`
- `r1_target`
- `enabled_tables`
- `host`
- `port`
- `database`
- `username`
- `password`
- `schemas`

**Step 2: Add the supported shape matrix**

Add a generic matrix:

| 连接形态 | 推荐配置形态 | 说明 |
|---|---|---|
| MySQL | `driver: mysql`，默认端口 `3306` | 原生 MySQL |
| PostgreSQL | `driver: postgres`，默认端口 `5432` | Schema 语义按 PostgreSQL 处理 |
| Doris | `driver: mysql`、`engine: doris`、`wire_protocol: mysql` | MySQL wire protocol OLAP 源 |
| StarRocks | `driver: mysql`、`engine: starrocks`、`wire_protocol: mysql` | MySQL wire protocol OLAP 源；仍遵守 gated support 文案 |

**Step 3: Add a sanitized generic YAML template**

Use placeholders only:

```yaml
connections:
  <connection-id>:
    driver: <mysql|postgres>
    engine: <optional-engine>
    wire_protocol: <optional-wire-protocol>
    readonly: true
    enabled_tables:
      - <schema>.<table_or_view>
    host: <DB_HOST>
    port: <DB_PORT>
    database: <DATABASE>
    username: <READONLY_USERNAME>
    password: file:<ABSOLUTE_PROJECT_OR_CONTAINER_PATH>/.ktx/secrets/<connection-id>-password
    schemas:
      - <schema>
```

**Step 4: Add the Docker path variant**

Document:

```yaml
password: file:/data/lucy/.ktx/secrets/<connection-id>-password
```

Do not include any real host, username, password, token, or customer value.

---

## Task 3: Add Operations Runbook

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`

**Step 1: Add the runbook section**

Add:

```markdown
#### 新增数据库连接（运维 Runbook）
```

The runbook must be generic and ordered:

1. 收集连接信息。
2. 确认数据库账号是真只读。
3. 创建 secret 文件或环境变量。
4. 编辑 `ktx.yaml`。
5. 测试连接。
6. 生成或导入 manifest；运行 `ktx ingest` 前必须确认 `scan.enrichment`、LLM、embedding 外部数据流已获客户 / 数据 Owner 授权，未授权时改用受控 Manifest 上传或获批的无 enrichment 扫描路径。
7. 维护 `enabled_tables`。
8. 运行 `ktx admin reindex --force`。
9. 同步 `webui/config/access.yaml`。
10. 在 WebUI 与 MCP token 上做 smoke。

**Step 2: Add local commands**

Include:

```bash
cd <PROJECT_ROOT>
mkdir -p .ktx/secrets
printf '%s' '<DB_PASSWORD>' > .ktx/secrets/<connection-id>-password
ktx --project-dir <PROJECT_ROOT> connection test <connection-id>

# 生成 manifest 前必须确认 scan.enrichment / LLM / embedding 外部数据流已获授权。
# 未授权时不要执行 ingest，改用受控 Manifest 上传或获批的无 enrichment 扫描路径。
ktx --project-dir <PROJECT_ROOT> ingest <connection-id>
ktx --project-dir <PROJECT_ROOT> admin reindex --force
ktx --project-dir <PROJECT_ROOT> sl validate <source-name> --connection-id <connection-id>
```

**Step 3: Add Docker / customer-config commands**

Include:

```bash
docker compose exec lucy mkdir -p /data/lucy/.ktx/secrets
docker compose exec -T lucy sh -c 'cat > /data/lucy/.ktx/secrets/<connection-id>-password' < ./<connection-id>-password
docker compose restart lucy
docker compose exec lucy ktx --project-dir /data/lucy connection test <connection-id>

# 生成 manifest 前必须确认 scan.enrichment / LLM / embedding 外部数据流已获授权。
# 未授权时不要执行 ingest，改用受控 Manifest 上传或获批的无 enrichment 扫描路径。
docker compose exec lucy ktx --project-dir /data/lucy ingest <connection-id>

docker compose exec lucy ktx --project-dir /data/lucy admin reindex --force
docker compose exec lucy ktx --project-dir /data/lucy sl validate <source-name> --connection-id <connection-id>
```

**Step 4: Explain Catalog Reload vs ingest**

Add clear copy:

```markdown
WebUI 的“刷新本地目录”只重新读取 `ktx.yaml` 与 `semantic-layer/**` YAML。它不会连接物理数据库扫描新表，也不会替代 `ktx ingest` 或受控 manifest 上传。
```

---

## Task 4: Add ACL And Agent Visibility Guidance

**Files:**

- Modify: `docs/SYSTEM_HANDBOOK.md`

**Step 1: Add ACL subsection**

Add:

```markdown
#### Agent 可见性与 ACL 同步
```

State the two required layers:

1. `ktx.yaml`: connection, Schema, `enabled_tables`.
2. `webui/config/access.yaml`: role `allow.connections`, `tableSelectors`, `tools`.

**Step 2: Add sanitized role example**

Use:

```yaml
roles:
  <role-id>:
    description: <role-description>
    allow:
      connections:
        - <connection-id>
      tableSelectors:
        - connection: <connection-id>
          schema: <schema>
          names:
            - <table_or_view>
      tools:
        - lucy_catalog
        - lucy_query
        - lucy_read_source
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question
```

**Step 3: Add denial troubleshooting**

Document:

- `unknown_or_forbidden_connection:<connection>`
- `table_forbidden:<table>`
- `tool_forbidden`
- `raw_query_forbidden`

Point operators to `/admin/audit` and:

```bash
rg -n "roles:|tableSelectors|tools|<connection-id>|<role-id>" webui/config/access.yaml
```

---

## Task 5: Update Help Center Tests And Search Coverage

**Files:**

- Test: `webui/server/__tests__/help.test.ts`
- Test: `webui/src/__tests__/help-center.test.tsx`

**Step 1: Extend Help API tests**

Add assertions that the handbook content contains:

```ts
expect(content).toContain("WebUI 不负责新建物理数据库连接");
expect(content).toContain("新增数据库连接（运维 Runbook）");
expect(content).toContain("Agent 可见性与 ACL 同步");
```

**Step 2: Extend Help Center render/search test**

If the test suite has search helpers, assert that searching for `新增数据库连接` or `物理数据库连接` surfaces the handbook section.

If there is no search helper, assert the rendered Help Center can display the section title.

**Step 3: Run focused tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/help.test.ts
npm test -- --run src/__tests__/help-center.test.tsx
```

Expected: PASS.

---

## Task 6: Update Documentation Indexes And Run Gates

**Files:**

- Modify: `webui/docs/README.md`
- Modify: `webui/docs/plans/README.md`
- Optional Modify: `docs/product-docs-index.md` if it already tracks the latest WebUI module specs

**Step 1: Register the new spec**

Add to `webui/docs/README.md`:

```markdown
| [26-database-connection-operations-runbook-spec.md](26-database-connection-operations-runbook-spec.md) | 数据库连接运维 Runbook：明确 WebUI 不新建物理连接，给出通用 `ktx.yaml` / secret / ACL / 验收路径 | 产品 / 文档 / 运维 / 安全 |
```

If missing, also register existing `25-connection-module-terminology-ia-refresh-spec.md`.

**Step 2: Register the new work order**

Add to `webui/docs/plans/README.md`:

```markdown
| [wo-M22-database-connection-operations-runbook.md](wo-M22-database-connection-operations-runbook.md) | M22 | 数据库连接运维 Runbook：通用新增连接边界、配置、ACL 与验收 |
```

If missing, also register existing `wo-M21-connection-module-terminology-ia-refresh.md`.

**Step 3: Run gates**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
npm run lint:spec
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/help.test.ts
npm test -- --run src/__tests__/help-center.test.tsx
```

Expected:

- `lint:spec`: PASS.
- Help tests: PASS.

**Step 4: Final review checklist**

Before handing back:

- Search the modified docs for accidental secrets:

```bash
rg -n "password: [^f]|Bearer [A-Za-z0-9]|token: [A-Za-z0-9]|AKIA|sk-" docs webui/docs
```

- Search for forbidden terminology:

```bash
rg -n "财政部舱单|上传报价包|替代测试|添加架构|目标架构|模式清单|触发 ingest" docs/SYSTEM_HANDBOOK.md webui/docs/26-database-connection-operations-runbook-spec.md
```

The `触发 ingest` phrase is only acceptable when explicitly saying not to use it for Catalog Reload.

---

## Completion Criteria

- `docs/SYSTEM_HANDBOOK.md` clearly states that WebUI does not create physical database connections.
- The runbook applies generically to MySQL, PostgreSQL, Doris, StarRocks, and future KTX-supported connection shapes.
- The runbook includes both local and Docker / customer-config operations paths.
- The runbook explains secret handling without exposing secret content.
- The runbook explains manifest / Catalog Reload / `ktx ingest` boundaries.
- The runbook includes ACL / Agent visibility instructions.
- Help Center tests cover the new handbook content and anchors.
- Index files reference the new spec and work order.
- Required gates have been run and documented in the handoff.
