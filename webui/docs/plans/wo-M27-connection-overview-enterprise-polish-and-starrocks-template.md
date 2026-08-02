# M27 Connection Overview Enterprise Polish And StarRocks Template Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish `/connections` into an enterprise-grade operations surface and include StarRocks in template / fixture coverage without promoting it to live-certified support.

**Architecture:** Frontend-first cleanup over the existing Connection Overview and Catalog Reload flows. Keep `ktx.yaml`, `semantic-layer/**`, static Catalog reload, Add Schema, and controlled Manifest upload on their current backends; adjust presentation, copy, fixtures, and regression tests so connection state, source-of-truth metadata, read-only intent, and missing Manifest diagnostics are explicit and low-noise.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing CSS utility layer. No new runtime dependency is required.

**Source Specs:** [../25-connection-module-terminology-ia-refresh-spec.md](../25-connection-module-terminology-ia-refresh-spec.md), [../28-catalog-reload-result-ops-ux-spec.md](../28-catalog-reload-result-ops-ux-spec.md), [../00-product-terminology-standard.md](../00-product-terminology-standard.md)

---

## Context For Developer

Read these documents before editing:

- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/25-connection-module-terminology-ia-refresh-spec.md`
- `webui/docs/28-catalog-reload-result-ops-ux-spec.md`
- `docs/starrocks-r1-support-plan.md`
- `docs/DEVELOPMENT.md`

Inspect these implementation files:

- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/components/catalog/CatalogReloadButton.tsx`
- `webui/src/components/catalog/CatalogReloadResultPanel.tsx`
- `webui/src/components/AddSchemaDrawer.tsx`
- `webui/src/app/app.css`
- `webui/src/lib/types.ts`
- `webui/server/project.ts`

Inspect these tests and fixtures:

- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/catalog-reload-components.test.tsx`
- `webui/server/__tests__/project.ktx-yaml.test.ts`
- `examples/docker-demo/project-template/ktx.yaml`
- `ktx.yaml.example`

Non-negotiable boundaries:

- Do not add physical database scanning to WebUI.
- Do not change Catalog Reload semantics; it remains local YAML reload only.
- Do not edit `.ktx/secrets/**`.
- Do not expose password values through `/api/project` or `/api/connections`.
- Do not claim StarRocks is release verified. Template / fixture tests only prove config expression, parsing, and UI display.
- Do not introduce a new global notification system unless one already exists and can be reused safely.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Task 1: Add StarRocks Template And API Contract Coverage

**Files:**

- Modify: `examples/docker-demo/project-template/ktx.yaml` if demo template coverage is required by the selected test path.
- Modify: `ktx.yaml.example` if shared template coverage is the safer fixture.
- Modify: `webui/server/__tests__/project.ktx-yaml.test.ts`
- Modify: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Decide the fixture boundary**

Use the smallest fixture that proves StarRocks template support without requiring a live StarRocks cluster:

- Preferred: `ktx.yaml.example` or a test-local YAML fixture.
- Use `examples/docker-demo/project-template/ktx.yaml` only if product intentionally wants the running demo to display StarRocks.

Document the decision in the test name or a short test comment. Do not add secrets for StarRocks.

**Step 2: Add backend parsing coverage**

Add or extend a test so a StarRocks connection with:

```yaml
driver: mysql
engine: starrocks
wire_protocol: mysql
readonly: true
r1_target: true
```

is parsed as:

```ts
expect(conn.engine).toBe("starrocks");
expect(conn.wireProtocol).toBe("mysql");
expect(conn.readOnlyExpected).toBe(true);
expect(conn.r1Target).toBe(true);
```

Also assert the response does not include password values.

**Step 3: Add frontend display coverage**

In `connection-overview.test.tsx`, ensure the StarRocks card displays:

- `StarRocks` engine badge.
- The connection id, host, and database.
- `预期只读`, not `Read-only expected`.

**Step 4: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/project.ktx-yaml.test.ts src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 2: Localize Read-Only And Write-Risk Status Copy

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/__tests__/connection-overview.test.tsx`
- Modify: `webui/src/app/app.css` only if a reusable Badge class is needed.

**Step 1: Write the failing assertions**

Add assertions that:

```ts
expect(card).toHaveTextContent("预期只读");
expect(card).not.toHaveTextContent("Read-only expected");
```

For `readOnlyExpected === false`, assert either:

```ts
expect(card).toHaveTextContent("未声明只读");
```

or:

```ts
expect(card).toHaveTextContent("存在写入风险");
```

Pick one status and keep it consistent with the UI copy.

**Step 2: Implement the copy mapping**

Replace card text:

```tsx
conn.readOnlyExpected === false ? "Write-risk" : "Read-only expected"
```

with localized copy. Recommended mapping:

- `true` -> `预期只读`
- `false` -> `未声明只读`

Add a Tooltip or accessible title explaining:

```text
来自 ktx.yaml 的 readonly 标记；真实只读能力由数据库账号权限保证。
```

**Step 3: Preserve translation defense**

Keep `translate="no"` and `notranslate` only where needed for technical terms. Do not wrap ordinary Chinese text unnecessarily.

**Step 4: Run focused test**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 3: Replace Long Config Source Copy With Compact Metadata

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/__tests__/connection-overview.test.tsx`
- Modify: `webui/src/app/app.css` only if compact metadata styling needs support.

**Step 1: Capture current regression**

Add a test that the card no longer repeats the full sentence:

```ts
expect(card).not.toHaveTextContent("配置来源：ktx.yaml。凭据不在 WebUI 中编辑。");
```

Assert the compact replacement exists:

```ts
expect(card).toHaveTextContent("配置：ktx.yaml");
```

If `passwordSource` is displayed, assert the demo inline credential source is visible as a risk state:

```ts
expect(card).toHaveTextContent("凭据：inline");
```

Only add that assertion if the UX chooses to expose credential source on the card.

**Step 2: Implement compact metadata**

Replace the long meta paragraph with a compact label or metadata row:

```text
配置：ktx.yaml
```

Use a Tooltip or `title` to expose:

```text
连接基础配置与凭据来源由 ktx.yaml 管理，WebUI 不直接编辑凭据。
```

If credential source is shown, use:

- `凭据：file`
- `凭据：env`
- `凭据：inline`

Use a warning tone for `inline`.

**Step 3: Keep layout quiet**

The metadata should not compete visually with the connection id, engine badge, host, or primary operations. Prefer small text or compact tags.

**Step 4: Run focused test**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 4: Reduce Catalog Reload And Missing Manifest Visual Noise

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/app/app.css`
- Modify: `webui/src/__tests__/connection-overview.test.tsx`
- Modify: `webui/src/__tests__/catalog-reload-components.test.tsx` if shared components expose visual result copy.

**Step 1: Write visual hierarchy assertions**

In `connection-overview.test.tsx`, assert the reading order:

```ts
const table = within(card).getByTestId("schema-asset-table-demo-mysql");
const warning = within(card).getByTestId("catalog-reload-warning-demo-mysql-openclaw_db");
expect(table.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

Assert the persistent status remains compact:

```ts
expect(within(card).getByTestId("catalog-reload-status-demo-mysql")).toHaveTextContent("本地目录已刷新");
expect(within(card).getByTestId("catalog-reload-status-demo-mysql")).toHaveTextContent("1 个提示");
```

Avoid brittle CSS color assertions unless the project already has stable class names for warning tone.

**Step 2: Implement one lightweight status row**

Keep the persistent reload result as:

```text
本地目录已刷新 · 12:17   已完成   3 张表   1 个提示
```

Do not render a full-width amber status bar immediately followed by a full-width amber warning panel.

**Step 3: Attach Missing Manifest diagnosis to the Schema context**

Use one of these patterns:

- Expandable row detail directly below `openclaw_db`.
- Compact inline alert immediately below the Schema table.

The diagnostic must show:

```text
缺少 Manifest：openclaw_db
openclaw_db 已在连接配置中启用，但本地 schema 文件不存在。
路径：semantic-layer/demo-mysql/_schema/openclaw_db.yaml
```

**Step 4: Preserve actions**

Keep:

- Row-level `上传 Manifest`.
- Diagnostic `展开详情` with `aria-expanded`.
- Diagnostic `重新检查`.
- Path copy or open-directory fallback.

**Step 5: Run focused tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx src/__tests__/catalog-reload-components.test.tsx
```

Expected: PASS.

---

## Task 5: Terminology And Build Verification

**Files:**

- Modify tests only if terminology lint reveals missed user-visible copy.

**Step 1: Run terminology lint**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
```

Expected: PASS. Fix any `Read-only expected`, `Write-risk`, banned Manifest translation, or Schema mistranslation in user-visible text and tests.

**Step 2: Run focused regression suite**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx src/__tests__/catalog-reload-components.test.tsx server/__tests__/project.ktx-yaml.test.ts
```

Expected: PASS.

**Step 3: Run build**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run build
```

Expected: PASS. Existing Vite chunk-size warnings are acceptable if unrelated.

**Step 4: Manual smoke**

Open `/connections` and verify:

- StarRocks appears when the active project root contains a StarRocks template / fixture connection.
- `预期只读` appears instead of `Read-only expected`.
- `配置：ktx.yaml` is compact and has explanatory help.
- Reload success is a quiet status row.
- Missing Manifest does not create two prominent amber boxes.
- `+ 添加 Schema` and upload actions remain visually connected to the Schema table.

---

## Done Definition

- Existing specs remain the source of truth; no duplicate `31-*` spec is created.
- StarRocks template / fixture coverage proves config parsing and UI display only.
- `/connections` no longer exposes developer-facing English status copy for read-only state.
- Config source copy is compact and discoverable.
- Catalog reload success and missing Manifest warnings follow enterprise SaaS visual hierarchy.
- Focused tests, terminology lint, and build pass or any unrun command is explicitly reported with reason.
