# Role Admin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a WebUI Role Admin module so administrators can create, edit, preview, delete, and copy Agent roles without hand-editing `webui/config/access.yaml`.

**Architecture:** Keep `access.yaml` as the only persisted permission source. Add role CRUD routes beside the existing Agent Admin routes, reuse the current ACL role preview/resolution helpers, and implement a React role management surface under `/admin/roles` with dryRun diff confirmation for every write.

**Tech Stack:** Fastify, TypeScript, YAML, React, React Router, TanStack Query, Vitest, Testing Library.

---

## Task 1: Backend Role API Skeleton

**Files:**

- Create: `webui/server/admin/roles.ts`
- Modify: `webui/server/index.ts`
- Modify: `webui/server/admin/agents.ts` only if shared YAML helpers need to be exported
- Test: `webui/server/__tests__/admin-roles.test.ts`

**Step 1: Write failing tests**

Add tests for:

- `GET /api/admin/roles` returns `usageCount` and `users`.
- `GET /api/admin/roles/analyst` returns yaml role detail.
- `GET /api/admin/roles/template_id` returns template role detail.
- unknown role returns `404 ROLE_NOT_FOUND`.

Run:

```bash
cd webui
npm test -- admin-roles
```

Expected: FAIL because routes do not exist.

**Step 2: Extract or duplicate minimal safe read helpers**

Prefer extracting from `webui/server/admin/agents.ts` into `webui/server/admin/access-config.ts` if that keeps duplication low:

```ts
export async function readAccessYaml(projectRoot: string): Promise<{ config: YamlAccessConfig; raw: string; version: string }>;
export async function writeAccessYaml(projectRoot: string, config: YamlAccessConfig): Promise<void>;
export function makeDiff(oldYaml: string, newYaml: string): string;
```

If extracting is too broad, keep a narrow duplicate in `roles.ts` for M12 and leave refactor for a follow-up.

**Step 3: Implement read routes**

Implement:

- `GET /api/admin/roles`
- `GET /api/admin/roles/:roleId`

Reuse:

- `ROLE_TEMPLATES`
- `expandTemplate`
- `previewRolePermissionsForAdmin`

Include usage from `config.users.filter((user) => user.role === roleId)`.

**Step 4: Register routes**

In `webui/server/index.ts`, import and call:

```ts
import { registerRoleRoutes } from "./admin/roles.js";
registerRoleRoutes(app);
```

**Step 5: Run tests**

```bash
cd webui
npm test -- admin-roles
```

Expected: PASS for read routes.

**Step 6: Commit checkpoint**

```bash
git add webui/server/admin/roles.ts webui/server/index.ts webui/server/__tests__/admin-roles.test.ts
git commit -m "feat(webui): add role admin read api"
```

## Task 2: Backend Role Write API

**Files:**

- Modify: `webui/server/admin/roles.ts`
- Test: `webui/server/__tests__/admin-roles.test.ts`

**Step 1: Write failing tests**

Add tests for:

- `POST /api/admin/roles` dryRun returns diff and does not write file.
- `POST /api/admin/roles` save writes yaml role.
- duplicate role id returns `409 ROLE_ID_TAKEN`.
- wildcard tools returns `400 INVALID_ROLE`.
- missing connections for table-touching role returns `400 INVALID_ROLE`.
- empty selector returns `400 INVALID_ROLE`.

Run:

```bash
cd webui
npm test -- admin-roles
```

Expected: FAIL.

**Step 2: Implement role validation**

Implement helpers:

```ts
const ROLE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function assertRoleShape(role: unknown): YamlRole;
async function validateRoleForWrite(roleId: string, role: YamlRole): Promise<string | undefined>;
```

Use `previewRolePermissionsForAdmin(roleId, { role })` as the final validator.

**Step 3: Implement create route**

Implement `POST /api/admin/roles`.

Write path:

1. Read current yaml.
2. Validate role id and body.
3. Validate resolver preview.
4. Build new config.
5. Return diff on dryRun.
6. On save, `recordConfigChange({ changeType: "role_create" })`.
7. Write through `safeWrite` via existing helper.

**Step 4: Run tests**

```bash
cd webui
npm test -- admin-roles
```

Expected: PASS for create route.

**Step 5: Commit checkpoint**

```bash
git add webui/server/admin/roles.ts webui/server/__tests__/admin-roles.test.ts
git commit -m "feat(webui): add role create api"
```

## Task 3: Backend Role Patch, Delete, And Copy

**Files:**

- Modify: `webui/server/admin/roles.ts`
- Test: `webui/server/__tests__/admin-roles.test.ts`

**Step 1: Write failing tests**

Add tests for:

- `PATCH /api/admin/roles/:roleId` dryRun/save updates description and allow.
- patching template returns `400 TEMPLATE_ROLE_READONLY`.
- stale version returns `409 VERSION_CONFLICT`.
- deleting in-use role returns `409 ROLE_IN_USE` with users.
- deleting unused yaml role dryRun/save works.
- copying template writes normal YAML role and does not write `templateId`, `role-template`, `_template`, or `templateRef`.

Run:

```bash
cd webui
npm test -- admin-roles
```

Expected: FAIL.

**Step 2: Implement patch route**

Implement `PATCH /api/admin/roles/:roleId`.

Allowed patch fields:

- `description`
- `allow`

Reject:

- role id mutation
- template role mutation
- unknown top-level fields

**Step 3: Implement delete route**

Implement `DELETE /api/admin/roles/:roleId`.

Before delete:

- Find `users[].role === roleId`.
- If any, return `409 ROLE_IN_USE`.

**Step 4: Implement copy route**

Implement `POST /api/admin/roles/:roleId/copy`.

Source can be yaml or template. Target must be a new YAML role id.

**Step 5: Run tests**

```bash
cd webui
npm test -- admin-roles
```

Expected: PASS.

**Step 6: Commit checkpoint**

```bash
git add webui/server/admin/roles.ts webui/server/__tests__/admin-roles.test.ts
git commit -m "feat(webui): add role update delete and copy api"
```

## Task 4: Frontend Types And API Client Shapes

**Files:**

- Modify: `webui/src/lib/types.ts`

**Step 1: Add types**

Add:

```ts
export type RoleUserReference = {
  id: string;
  name: string;
  enabled: boolean;
  tokenCount: number;
};

export type RoleSelector =
  | { connection?: string; schema: string; names: string[] }
  | { connection?: string; schema: string; prefix: string };

export type RoleAllowConfig = {
  connections?: string[];
  tableSelectors?: RoleSelector[];
  tools?: string[];
};

export type RoleDetail = Role & {
  usageCount: number;
  users: RoleUserReference[];
  role: {
    description?: string;
    allow: RoleAllowConfig;
  };
  effectivePermissions?: EffectivePermissionsPreview;
};
```

Update existing `Role` to include optional `usageCount` and `users` if needed.

**Step 2: Run TypeScript build**

```bash
cd webui
npm run build
```

Expected: PASS.

**Step 3: Commit checkpoint**

```bash
git add webui/src/lib/types.ts
git commit -m "feat(webui): add role admin types"
```

## Task 5: Role List Page

**Files:**

- Create: `webui/src/pages/admin/RoleList.tsx`
- Modify: `webui/src/app/App.tsx`
- Test: `webui/src/__tests__/role-list.test.tsx`
- Test: `webui/src/__tests__/app-shell.test.tsx`

**Step 1: Write failing tests**

Cover:

- `/admin/roles` is reachable from sidebar label `角色配置`.
- list renders YAML role, template role, invalid warning, usage count.
- search filters by id/description.
- source filter handles all/yaml/template/invalid/in-use.
- clicking `新建 Role` navigates to `/admin/roles/new`.
- clicking `复制为 YAML Role` navigates to copy mode.

Run:

```bash
cd webui
npm test -- role-list app-shell
```

Expected: FAIL.

**Step 2: Add navigation and routes**

In `webui/src/app/App.tsx`:

- import `RoleList`
- add breadcrumb handling for `/admin/roles`
- add nav item under `访问治理`
- add route `/admin/roles`

**Step 3: Implement RoleList**

Use `useQuery(["admin", "roles"], () => apiGet("/api/admin/roles"))`.

Render:

- metrics
- search
- filter select
- cards/table
- actions based on `source`

**Step 4: Run tests**

```bash
cd webui
npm test -- role-list app-shell
```

Expected: PASS.

**Step 5: Commit checkpoint**

```bash
git add webui/src/pages/admin/RoleList.tsx webui/src/app/App.tsx webui/src/__tests__/role-list.test.tsx webui/src/__tests__/app-shell.test.tsx
git commit -m "feat(webui): add role admin list page"
```

## Task 6: Role Detail Create And Edit Flow

**Files:**

- Create: `webui/src/pages/admin/RoleDetail.tsx`
- Modify: `webui/src/app/App.tsx`
- Test: `webui/src/__tests__/role-detail.test.tsx`

**Step 1: Write failing tests**

Cover:

- `/admin/roles/new` renders create form.
- valid role create calls `POST /api/admin/roles` dryRun first.
- diff tab appears after dryRun.
- confirm create calls `dryRun:false`.
- `/admin/roles/:roleId` renders edit form for YAML role.
- template role is read-only and shows `复制为 YAML Role`.
- editing after preview clears stale diff.

Run:

```bash
cd webui
npm test -- role-detail
```

Expected: FAIL.

**Step 2: Implement form state**

Fields:

- roleId
- description
- connections text/chips
- tools text/chips
- tableSelectors rows

Keep P0 simple: text inputs accepting comma/newline-separated values are acceptable if tests prove stable behavior.

**Step 3: Implement dryRun preview**

Create helpers:

```ts
function buildRoleFromForm(): RoleAllowConfig;
function buildCreatePayload();
function buildPatchPayload();
```

Call:

- `POST /api/admin/roles` for create
- `PATCH /api/admin/roles/:roleId` for edit

**Step 4: Implement diff save**

Store the patch/create payload that produced the diff. Save only that payload.

**Step 5: Run tests**

```bash
cd webui
npm test -- role-detail
```

Expected: PASS.

**Step 6: Commit checkpoint**

```bash
git add webui/src/pages/admin/RoleDetail.tsx webui/src/app/App.tsx webui/src/__tests__/role-detail.test.tsx
git commit -m "feat(webui): add role create and edit flow"
```

## Task 7: Delete And Copy Template UI

**Files:**

- Modify: `webui/src/pages/admin/RoleList.tsx`
- Modify: `webui/src/pages/admin/RoleDetail.tsx`
- Test: `webui/src/__tests__/role-list.test.tsx`
- Test: `webui/src/__tests__/role-detail.test.tsx`

**Step 1: Write failing tests**

Cover:

- Delete in-use role shows backend users and does not remove card.
- Delete unused role dryRun shows diff before confirm.
- Template detail is read-only.
- Copy template requires new role id.
- Copy template dryRun -> confirm writes new YAML role.

Run:

```bash
cd webui
npm test -- role-list role-detail
```

Expected: FAIL.

**Step 2: Implement delete flow**

Use modal or detail diff tab. Keep destructive action behind confirm and dryRun.

**Step 3: Implement copy flow**

Route suggestion:

```text
/admin/roles/:roleId?mode=copy
```

The form should preload source role but require editable new role id.

**Step 4: Run tests**

```bash
cd webui
npm test -- role-list role-detail
```

Expected: PASS.

**Step 5: Commit checkpoint**

```bash
git add webui/src/pages/admin/RoleList.tsx webui/src/pages/admin/RoleDetail.tsx webui/src/__tests__/role-list.test.tsx webui/src/__tests__/role-detail.test.tsx
git commit -m "feat(webui): add role delete and template copy flows"
```

## Task 8: Agent Admin Entry Links

**Files:**

- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Test: `webui/src/__tests__/agent-list.test.tsx`
- Test: `webui/src/__tests__/agent-detail.test.tsx`

**Step 1: Write failing tests**

Cover:

- New Agent modal role field shows `管理角色` link.
- Empty roles state shows `还没有可用角色` and `创建角色` link.
- Agent detail role field shows `管理角色` link.

Run:

```bash
cd webui
npm test -- agent-list agent-detail
```

Expected: FAIL.

**Step 2: Implement links and empty state**

Use React Router `Link`:

```tsx
<Link to="/admin/roles">管理角色</Link>
<Link to="/admin/roles/new">创建角色</Link>
```

**Step 3: Run tests**

```bash
cd webui
npm test -- agent-list agent-detail
```

Expected: PASS.

**Step 4: Commit checkpoint**

```bash
git add webui/src/pages/admin/AgentList.tsx webui/src/pages/admin/AgentDetail.tsx webui/src/__tests__/agent-list.test.tsx webui/src/__tests__/agent-detail.test.tsx
git commit -m "feat(webui): link agent flows to role admin"
```

## Task 9: Integration Verification

**Files:**

- Modify only files needed to fix failures.

**Step 1: Run focused backend tests**

```bash
cd webui
npm test -- admin-roles admin-agents
```

Expected: PASS.

**Step 2: Run focused frontend tests**

```bash
cd webui
npm test -- role-list role-detail agent-list agent-detail app-shell
```

Expected: PASS.

**Step 3: Run build**

```bash
cd webui
npm run build
```

Expected: PASS, allowing existing Vite chunk size warning.

**Step 4: Manual smoke**

Start WebUI and verify:

- `/admin/roles` opens from sidebar.
- Create a role with one known source and `lucy_query`.
- DryRun diff appears before save.
- New Agent modal can select the new role.
- Delete the in-use role is blocked.
- Copy a template role writes a normal YAML role.

**Step 5: Commit checkpoint**

```bash
git add webui/server/admin/roles.ts webui/server/index.ts webui/src/app/App.tsx webui/src/pages/admin/RoleList.tsx webui/src/pages/admin/RoleDetail.tsx webui/src/lib/types.ts webui/src/__tests__/role-list.test.tsx webui/src/__tests__/role-detail.test.tsx webui/server/__tests__/admin-roles.test.ts
git commit -m "test(webui): verify role admin delivery"
```

## Execution Handoff

Plan complete and saved to `webui/docs/codex/wo-M12-role-admin.md`.

Recommended execution option: run this as a dedicated M12 builder pass, task by task, with review after Task 3 and Task 7 because those are the two highest-risk points.

