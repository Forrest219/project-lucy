# M66 Business Wiki Access Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let administrators assign Wiki access during upload, inspect and edit one document's access without editing Markdown, and safely update up to 100 explicitly selected Wiki documents in one recoverable batch.

**Architecture:** Keep `allowed_roles` in each Markdown file as the only authorization source. Add a shared in-process Wiki write queue with non-reentrant unlocked helpers, preview-bound ACL mutation services, durable widening holds, and recoverable per-file batch journals in `security.sqlite`. Route every ACL-changing write—including the existing combined Markdown editor—through one audited mutation coordinator. Reuse the current `authorizeContext` decision and expose a Wiki-to-Role effect projection for UI explanations.

**Tech Stack:** TypeScript, Fastify, React, TanStack Query, Radix Dialog/Drawer patterns, Vitest, Testing Library, existing safe-write/config-audit/security-store infrastructure.

**Source Spec:** [../193-business-wiki-access-management-spec.md](../193-business-wiki-access-management-spec.md)

---

## Context For Developer

Work in `/Users/zhangxingchen/Projects/project-lucy`.

Read before editing:

- `AGENTS.md`
- `docs/governance/DEVELOPMENT.md`
- `docs/specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md` §4.1–4.3
- `docs/access-control/adr-20261018-security-ledger-and-context-acl.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/03-api-spec.md`
- `webui/docs/55-business-wiki-version-history-restore-spec.md`
- `webui/docs/193-business-wiki-access-management-spec.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/13-components-toast.md`
- `webui/docs/design-system/20-patterns-page-layout.md`

Inspect these implementation anchors:

- `webui/server/wiki.ts`
- `webui/server/index.ts`
- `webui/server/proxy/context-acl.ts`
- `webui/server/proxy/context-inventory.ts`
- `webui/server/proxy/wiki-acl.ts`
- `webui/server/proxy/context-policy.ts`
- `webui/server/admin/config-audit-write.ts`
- `webui/server/security/store.ts`
- `webui/server/security/recovery.ts`
- `webui/server/security/request-actor.ts`
- `webui/server/fs-safe.ts`
- `webui/src/pages/WikiEditor.tsx`
- `webui/src/components/ObjectAclField.tsx`
- `webui/src/components/WikiUploadPreflight.tsx`
- `webui/src/components/WikiReadView.tsx`
- `webui/src/components/WikiLibraryHome.tsx`
- `webui/src/components/WikiTree.tsx`
- `webui/src/lib/wiki.ts`
- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/app/app.css`

Relevant tests:

- `webui/server/__tests__/wiki-acl-concurrency.test.ts`
- `webui/server/__tests__/context-acl-matrix.test.ts`
- `webui/server/__tests__/context-policy-invalidation.test.ts`
- `webui/server/__tests__/context-channel-parity.test.ts`
- `webui/server/__tests__/security-store.test.ts`
- `webui/server/__tests__/wiki.test.ts`
- `webui/src/__tests__/wiki.test.tsx`

## Non-Negotiable Boundaries

- Do not change `authorizeContext()` allow semantics, external deny shape, or same-Role closure.
- Do not add a database ACL, directory inheritance, implicit future-document grants, or a second authorization field.
- Do not infer access from directory, `visibility`, `sl_refs`, body text, file name, uploader, or currently signed-in administrator.
- Keep missing/empty ACL as no-Agent-access. Exact `["*"]` is not anonymous access and needs independent confirmation.
- Preserve unknown Role IDs; never remap them to a newly created same-name Role.
- Keep version restore from restoring historical ACL, and require `expected_version` for restore/move/delete plus per-document baselines for directory rename.
- Batch selection contains explicit Wiki keys only, has a hard server limit of 1–100 after normalization/deduplication, and is not a cross-file transaction.
- All Wiki writes that can touch a document or shared history must share one in-process queue, rebuild candidates from the same in-queue read, and recheck versions/target state inside the queue. Composite operations use unlocked helpers and never reacquire the queue.
- Direct filesystem edits and multiple writer processes remain unsupported; do not claim cross-process CAS or distributed transactions.
- A pending or unresolved widening denies the whole Wiki key to Agent search/read and blocks all other mutations of that key. Never auto-replay or auto-commit widening after a crash, even when target bytes and committed config audit are present.
- Use trusted request actor context. Never accept actor identity from the request body.
- Write Wiki Markdown/history only through `fs-safe.ts` / audited safe-write helpers, and write security operations/journals only through `SecurityStore`. Do not read or print secrets.
- Do not modify `ktx.yaml`, `webui/config/access.yaml`, `.ktx/secrets/**`, KTX source, or runtime data-QA instructions.
- Do not run browser or mobile narrow-screen tests. Use Vitest, Testing Library, build, terminology and spec gates.
- Treat existing dirty files as user-owned; the pre-existing untracked `config/` directory is outside this work order.

## API Target

```text
GET  /api/wiki/:key/access
POST /api/wiki/:key/access/preview
PUT  /api/wiki/:key/access
POST /api/wiki/access/batch/preview
POST /api/wiki/access/batch/commit
GET  /api/wiki/access/batches/:operationId
```

Existing upload routes remain, but their payloads gain explicit access selection and preview digest binding.

---

## Task 1: Register Terminology And Shared Frontend Contracts

**Files:**

- Modify: `webui/docs/00-product-terminology-standard.md`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/lib/queryKeys.ts`
- Test: `webui/src/__tests__/lint-terminology-scan.test.ts`

**Step 1: Write the failing terminology and type tests**

Add assertions for the five terms registered by Spec 193 and type fixtures covering:

```ts
type WikiUploadAccessSelection =
  | { mode: "preserve_current" }
  | { mode: "use_uploaded" }
  | { mode: "set"; allowed_roles: string[] };

type WikiBatchAccessAction =
  | { mode: "add"; role_ids: string[] }
  | { mode: "replace"; allowed_roles: string[] };
```

Add query-key builders for single access and batch result. Reuse `queryKeys.wiki` for the access-aware aggregate list; POST previews are mutations and do not get cached query keys. Extend `WikiVersionOperation` with `access_update`.

**Step 2: Run the focused tests and verify failure**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run src/__tests__/lint-terminology-scan.test.ts --maxWorkers=1
```

Expected: FAIL because the new terms/contracts do not exist.

**Step 3: Add shared frontend types and terminology**

Register 管理访问权限、批量管理权限、添加角色、替换可访问角色、缺少 Wiki 访问通道. Use existing `ObjectAcl` state names and the Spec 193 summary/request/response shapes. Keep Role/Agent/Wiki/Markdown identifiers protected in rendered DOM. Do not update `03-api-spec.md` yet; Task 12 documents the implemented routes after the API behavior exists.

**Step 4: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npx vitest run src/__tests__/lint-terminology-scan.test.ts --maxWorkers=1
```

Expected: PASS.

## Task 2: Add The Shared Wiki Write Queue

**Files:**

- Create: `webui/server/wiki-write-queue.ts`
- Modify: `webui/server/wiki.ts`
- Modify: `webui/server/index.ts`
- Test: `webui/server/__tests__/wiki-write-queue.test.ts`
- Test: `webui/server/__tests__/wiki-acl-concurrency.test.ts`
- Test: `webui/server/__tests__/wiki.test.ts`

**Step 1: Write failing queue tests**

Cover:

1. two same-key writers execute serially;
2. different keys use the single process queue deterministically;
3. a rejected writer does not poison later writes;
4. `writeWiki`, upload commit, restore, move and delete re-read/recheck the current version inside the queue;
5. a stale content save cannot overwrite an ACL-only save and vice versa;
6. create rechecks target absence, replace rechecks target presence, and directory rename rechecks every document baseline plus source/target state;
7. a composite operation calling an unlocked helper does not recursively acquire the queue.

The initial implementation may use the same promise-tail pattern as `ktx-yaml-write-lock.ts`, but name it for Wiki and keep its scope process-local.

**Step 2: Verify failure**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run server/__tests__/wiki-write-queue.test.ts server/__tests__/wiki-acl-concurrency.test.ts server/__tests__/wiki.test.ts --maxWorkers=1
```

Expected: FAIL before the shared queue and structural-write baselines exist.

**Step 3: Implement the queue and move checks inside it**

Export only a narrow API such as:

```ts
export function withWikiWriteQueue<T>(fn: () => Promise<T>): Promise<T>;
```

Wrap document create/save, upload commit and restore. Extract `...Unlocked` helpers that require the caller to hold the queue, and build each candidate from the same current bytes used for the version check; do not call the public preview and then write a separately read candidate.

Add `expected_version` to restore, move and delete commits (428 missing / 409 stale). Directory rename preview returns per-document versions and a digest; commit binds and rechecks them. Empty-directory delete also uses the queue and rechecks emptiness.

**Step 4: Extend coverage to every structural write**

Route M56 move/delete/rename and all shared `.lucy-history` / directory-metadata critical sections through the same queue without changing directory ACL semantics. Add regressions that structural writes cannot interleave with content/ACL saves. Pending-widening guards are added centrally in Task 4, not duplicated here.

**Step 5: Verify**

Run the same focused tests. Expected: PASS.

## Task 3: Build Wiki-To-Role Access Effects

**Files:**

- Create: `webui/server/wiki-access-effects.ts`
- Modify: `webui/server/proxy/context-inventory.ts`
- Modify: `webui/server/wiki.ts`
- Test: `webui/server/__tests__/wiki-access-effects.test.ts`

**Step 1: Write failing effect tests**

Use synthetic Roles/Agents only. Cover:

- no roles, exact roles, all roles, corrupt ACL;
- known/unknown Role IDs;
- search+read, search-only, read-only and neither;
- assigned Agent counts and IDs;
- deterministic sorting and `role_channel_version`;
- no Token, body or credential fields in output.

**Step 2: Implement a pure resolver**

The resolver accepts normalized ACL plus one fresh access-config snapshot and returns `WikiAccessSummary`. Reuse `CONTEXT_CHANNEL_TOOLS.wiki`, `resolveRoleIds()` and existing assignable-role rules. Count only enabled Agents with an actual formal Role binding; `all` expands formal Roles and unknown IDs stay `known=false`. Compute global `role_channel_version` from normalized Role channels plus Agent enablement/bindings, not from one Agent's `snapshotHash`. Do not duplicate allow decisions or call `authorizeContext` with fabricated identities.

**Step 3: Extend Wiki list metadata**

Add `file_version`, canonical `acl`, missing-channel counts and pending state to `WikiSummary` using one access-config read per `GET /api/wiki` request. Return the aggregate in the existing list response, with no per-row access API calls, Markdown body, full Agent ID lists or repeated config reads.

**Step 4: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run server/__tests__/wiki-access-effects.test.ts server/__tests__/context-channel-parity.test.ts --maxWorkers=1
```

Expected: PASS.

## Task 4: Add Durable ACL Mutation Coordination And Widening Holds

**Files:**

- Create: `webui/server/wiki-access-operation.ts`
- Modify: `webui/server/wiki.ts`
- Modify: `webui/server/security/schema.ts`
- Modify: `webui/server/security/types.ts`
- Modify: `webui/server/security/store.ts`
- Modify: `webui/server/security/recovery.ts`
- Modify: `webui/server/proxy/wiki-acl.ts`
- Modify: `webui/server/proxy/context-policy.ts`
- Modify: `webui/server/admin/config-audit-write.ts` only if a small reusable option/result is required
- Test: `webui/server/__tests__/wiki-access-operation.test.ts`
- Test: `webui/server/__tests__/wiki-acl-concurrency.test.ts`
- Test: `webui/server/__tests__/context-acl-matrix.test.ts`
- Test: `webui/server/__tests__/security-store.test.ts`

**Step 1: Write failing direction and hold tests**

Cover the Spec 193 §4.3 matrix, including mixed changes and corrupt-to-nonempty as `widen`. Assert a held Wiki key or an unavailable hold projection is denied across search and read even if target bytes have reached disk. Add combined-editor, upload, restore, move/delete and directory-rename cases proving a pending key rejects other mutations and cannot move the uncommitted widening to another key.

**Step 2: Add a per-key durable hold projection**

Reuse the existing security store operation primitives. Add the smallest projection needed to answer with a fail-closed result:

```ts
isWikiAccessWideningHeld(key): SecurityResult<boolean>
```

Persist operation ID, key, old hash, target hash, direction and state; never persist body text. Preparing a widening operation and activating its hold is one transaction; committing the operation and deactivating the hold is another single transaction, so there is no crash window between durable commit and hold release. Ensure startup reconstruction happens before Wiki Agent channels accept requests.

**Step 3: Implement the coordinated unlocked mutation helper**

Expose a public queue wrapper plus `mutateWikiAccessUnlocked` for callers that already hold the queue. Required order:

1. reject pending/needs_review keys and recheck the current version;
2. build the target from the same bytes; for an ACL-only mutation, return no-op without writes when canonical ACL is unchanged, while a combined save with changed body and unchanged ACL continues through the neutral content-write path;
3. prepare durable security operation and widening hold atomically;
4. create required config-audit intent;
5. atomic Markdown write;
6. durable audit terminal with rollback on failure;
7. version snapshot / journal result;
8. commit security operation and release hold atomically;
9. respond success.

Use `requireIntent: true` and `rollbackOnTerminalFailure: true` for ACL changes. Preserve exact body and unknown frontmatter values. Extend the version union with `access_update`. Route the existing combined `writeWiki` ACL-changing branch through this coordinator as well as single/batch access saves; restore keeps the current ACL and never becomes a widening shortcut. Map audit infrastructure failures to the stable lower-snake `config_audit_unavailable` API error without hiding `needs_review` state.

**Step 4: Implement recovery without replay or automatic widening commit**

Reconcile old/target/current hash, operation state and audit terminal state. Old hash aborts. Applied narrow/neutral may follow the existing recovery rule. Applied widening with an uncommitted security operation always becomes `needs_review` and remains held—even if config audit is committed. Unknown evidence stays denied. Add fault-injection tests for crashes before write, after write, after audit terminal and before security commit; no test may expect automatic widening ratification or write replay.

**Step 5: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run server/__tests__/wiki-access-operation.test.ts server/__tests__/wiki-acl-concurrency.test.ts server/__tests__/context-acl-matrix.test.ts server/__tests__/security-store.test.ts --maxWorkers=1
```

Expected: PASS.

## Task 5: Implement Upload Access Selection

**Files:**

- Modify: `webui/server/wiki.ts`
- Modify: `webui/server/index.ts`
- Test: `webui/server/__tests__/wiki-upload-access.test.ts`
- Test: `webui/server/__tests__/wiki-acl-concurrency.test.ts`

**Step 1: Write the failing decision matrix**

Cover create/replace against uploaded ACL states missing, empty, roles, all and corrupt. Assert:

- create can explicitly use uploaded or set a replacement;
- replace defaults to preserve current;
- uploaded differences are reported but not adopted by preserve mode;
- empty/all require server-side confirmations;
- commit requires the original Markdown, exact access selection and preview digest;
- stale target version, target existence or role-channel version produces zero writes;
- create cannot silently become replace and replace cannot silently become create;
- the response never asks the client to resubmit `proposedMarkdown` as source.

**Step 2: Extend upload input/preview types**

Add required commit fields `access`, `confirmed_empty`, `confirmed_all` and `preview_digest`. Preview may suggest a selection, but commit without `access` returns 400 `wiki_upload_access_required`. Return current, uploaded and final ACL summaries, direction, channel effects, blocking issues and warnings. `preserve_current` carries the exact current ACL declaration, including a corrupt deny-state declaration.

**Step 3: Implement preview-bound commit**

Recompute the candidate inside the write queue from original Markdown and the same current bytes used for the version check. Bind digest to target key, mode, upload content hash, expected version, normalized selection/final ACL and role-channel version. Recheck create target absence or replace target presence. Route ACL-changing uploads through Task 4's coordinator.

**Step 4: Preserve compatibility intentionally**

Reject old commits that omit access selection rather than inferring from uploaded frontmatter. Update existing tests and the frontend together; do not retain silent adoption of an uploaded ACL on replace or add a time-limited fallback with different security semantics.

**Step 5: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run server/__tests__/wiki-upload-access.test.ts server/__tests__/wiki-acl-concurrency.test.ts --maxWorkers=1
```

Expected: PASS.

## Task 6: Implement Single-Document Access APIs

**Files:**

- Create: `webui/server/wiki-access.ts`
- Modify: `webui/server/index.ts`
- Test: `webui/server/__tests__/wiki-access-routes.test.ts`

**Step 1: Write failing route tests**

Cover GET, preview and PUT; required auth actor; exact summary; 428 missing version; 409 stale page; 409 stale role graph/digest; invalid ACL; pending widening; audit/security-store failure; successful narrow/widen; exact body and unknown-frontmatter preservation; and canonical no-op producing no file write, audit or version.

**Step 2: Implement preview**

Return deterministic old/new ACL, direction, Role/Agent effects and digest. The digest must include key, `file_version`, normalized candidate and global `role_channel_version`. PUT repeats the candidate calculation inside the queue and never trusts a client-supplied direction.

**Step 3: Implement PUT**

Run inside the shared queue and use Task 4's unlocked mutation coordinator. Snapshot a version with operation `access_update` only after the audited file write succeeds. Return `noop` for a canonical no-op, otherwise return the committed summary and new `file_version`.

**Step 4: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run server/__tests__/wiki-access-routes.test.ts server/__tests__/wiki-acl-concurrency.test.ts --maxWorkers=1
```

Expected: PASS.

## Task 7: Implement Recoverable Batch Access APIs

**Files:**

- Create: `webui/server/wiki-access-batch.ts`
- Create: `webui/server/wiki-access-batch-journal.ts`
- Modify: `webui/server/index.ts`
- Modify: `webui/server/security/schema.ts`
- Modify: `webui/server/security/types.ts`
- Modify: `webui/server/security/store.ts`
- Test: `webui/server/__tests__/wiki-access-batch.test.ts`
- Test: `webui/server/__tests__/wiki-access-batch-faults.test.ts`
- Test: `webui/server/__tests__/security-store.test.ts`

**Step 1: Write failing validation tests**

Cover identical duplicate keys, the same normalized key with conflicting versions, zero keys, 100 and 101 unique keys, add with empty roles, add with `*`, replace with empty/all confirmations, unknown/missing files, corrupt current ACL, stable ordering and plan digest. Enforce 1–100 after normalization/deduplication; blocking preview issues cannot produce a committable plan.

**Step 2: Write failing execution tests**

Cover:

- pre-entry stale baseline causes whole-batch 409, zero writes and zero journal;
- add performs per-file union and all remains all;
- replace repairs corrupt ACL and writes exact value;
- no-op items do not create redundant file versions;
- a mid-run external conflict is per-item and later items continue;
- audit/security-store failure stops later items as `not_run` without further Wiki writes;
- same idempotency key/digest returns prior status without revalidating old file versions or repeating writes;
- same key/different digest returns conflict;
- each file audit uses the shared batch operation ID in `requestId` and the trusted actor;
- restart reconciles journal/per-file operations without continuing the loop or auto-committing widening;
- journal contains no body, secret or absolute path.

**Step 3: Implement durable journal storage**

Store journal and idempotency records in `.ktx-ui/security.sqlite`, reusing FULL persistence, 0600 permissions and trusted store error mapping; do not create a JSON ACL sidecar. Create the journal and idempotency binding atomically. Persist plan metadata and per-item statuses only, and make GET result reconstruction independent of the initiating browser connection.

**Step 4: Implement preview and commit**

Bind `plan_digest` to operation ID, action, sorted per-key versions, per-item target ACL/direction/no-op and global role-channel version. At commit entry, acquire the Wiki queue, check idempotency first, then re-read all versions plus role-channel version for a new operation and reject all before journal creation if stale. Process deterministic key order with Task 4's unlocked per-file coordinator, rechecking each item version and preview target ACL. Continue item-local conflict/validation failures; stop on systemic storage/audit failures and best-effort mark the remainder `not_run`.

**Step 5: Implement recovery and retry contracts**

At startup/GET reconciliation, use journal, per-file security operations, hashes and audit terminal evidence to preserve applied/no-op, mark unstarted old-hash items `not_run`, and mark uncertain or uncommitted-widening items `needs_review`. Never restart the execution loop. The client builds a new preview and operation containing only `conflict`, `failed` and `not_run`; `applied`, `noop`, `pending` and `needs_review` are excluded. Add tests proving applied items are not repeated and needs-review items cannot be retried.

**Step 6: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run server/__tests__/wiki-access-batch.test.ts server/__tests__/wiki-access-batch-faults.test.ts server/__tests__/security-store.test.ts --maxWorkers=1
```

Expected: PASS.

## Task 8: Refactor Reusable Access UI

**Files:**

- Modify: `webui/src/components/ObjectAclField.tsx`
- Create: `webui/src/components/WikiAccessEditor.tsx`
- Create: `webui/src/components/WikiAccessEffectList.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/wiki-access-components.test.tsx`

**Step 1: Write failing component tests**

Cover none/roles/all/corrupt, unknown Role retention/removal, independent all confirmation, empty confirmation, role-channel states, loading/error, keyboard labels and protected Role/Agent IDs. Role loading and Role-load error must be distinct from a successful empty Role list, and both loading/error block commit.

**Step 2: Refactor without changing Skill behavior**

Keep `ObjectAclField` generic and controlled. Put Wiki-specific source badges, channel effects, Agent counts and confirmation state in `WikiAccessEditor`; expose Role query status instead of reducing every query state to `[]`. Confirm existing Skill tests still pass.

**Step 3: Add scoped styles**

Use existing semantic color, spacing, focus and button tokens. Do not add raw colors, decorative cards or a second global form system.

**Step 4: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run src/__tests__/wiki-access-components.test.tsx src/__tests__/skill-list.test.tsx --maxWorkers=1
```

Expected: PASS, including the existing Skill ACL selection and confirmation behavior.

## Task 9: Upgrade Upload Preflight UI

**Files:**

- Modify: `webui/src/components/WikiUploadPreflight.tsx`
- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/wiki.test.tsx`

**Step 1: Write failing upload-flow tests**

Cover:

- new missing ACL requires empty confirmation or role selection;
- uploaded legal ACL shows source and effects;
- corrupt uploaded ACL blocks direct adoption but can be replaced explicitly;
- replace initializes from current ACL;
- different uploaded ACL is visible but not adopted until requested;
- button labels match final state;
- preview digest and explicit access selection are required, and original Markdown remains the commit source;
- stale preview responses, loading/error states and create/replace target conflicts cannot enable commit;
- conflicts keep the user's selection and request a fresh preview.

**Step 2: Add the access section before Diff**

Render `WikiAccessEditor` after parsed summary and before warnings/Diff. For replace, render current/uploaded/final comparison and a secondary `采用文件内授权` action when legal and different.

**Step 3: Re-preview on access changes**

Keep a client-side draft selection, but treat the server preview as authoritative for direction/effects/digest. Avoid request races using the existing preview request sequence guard, discard stale responses, and clear the committable digest whenever selection, target, loading or error changes.

**Step 4: Commit the bound candidate**

Stop posting `uploadPreview.proposedMarkdown` as `markdown`. Post the original selected file text, explicit mode/access selection, confirmations, expected version and preview digest. The commit payload must never omit access selection.

**Step 5: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run src/__tests__/wiki.test.tsx --maxWorkers=1
```

Expected: PASS.

## Task 10: Add Read/List Status And Independent Access Drawer

**Files:**

- Create: `webui/src/components/WikiAccessSummary.tsx`
- Create: `webui/src/components/WikiAccessDrawer.tsx`
- Modify: `webui/src/components/WikiReadView.tsx`
- Modify: `webui/src/components/WikiLibraryHome.tsx`
- Modify: `webui/src/components/WikiVersionHistoryDialog.tsx`
- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/wiki.test.tsx`

**Step 1: Write failing state/display tests**

Assert read view and list represent none/roles/all/corrupt, channel warnings, unavailable effect checks and protected IDs/paths. Add loading, error and successful-empty Role states, and prove the list uses its aggregate response without per-row access calls. Cover the `access_update` history label.

**Step 2: Add the summary and filter**

Show one primary ACL status plus optional channel-warning text from the aggregate list response. Add list filters from Spec 193 §6.1 without turning filter state into authorization state or refetching every row.

**Step 3: Add the Drawer**

Fetch GET access on open, preview controlled changes, show old/new/effects, then PUT with the same ACL, version and digest. Sequence preview requests, discard stale responses and disable commit while Role/effect data is loading or failed. Keep changes in the Drawer on 409, refresh persisted facts and require reconfirmation.

**Step 4: Protect dirty drafts and bind structural writes**

Expose `管理访问权限` from read mode. If a route/state makes it reachable while the editor has an unsaved draft, disable it with the Spec 193 explanation; do not silently save or discard Markdown. Send the loaded `expected_version` for restore/move/delete and the directory-rename preview baselines/digest added in Task 2, refreshing after conflicts instead of dropping drafts.

**Step 5: Invalidate all affected queries**

On success refresh Wiki page, list, versions, access summary and context effect queries. Show a bottom-right success Toast and leave detailed results in the Drawer. Render the `access_update` version operation with the registered `管理访问权限` label.

**Step 6: Verify**

Run `src/__tests__/wiki.test.tsx`. Expected: PASS.

## Task 11: Add Explicit Selection And Batch Drawer

**Files:**

- Create: `webui/src/components/WikiBatchAccessDrawer.tsx`
- Create: `webui/src/components/WikiBatchAccessResult.tsx`
- Modify: `webui/src/components/WikiLibraryHome.tsx`
- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/wiki-batch-access.test.tsx`

**Step 1: Write failing selection tests**

Cover enter/exit mode, per-document checkbox, select current filtered result, zero selection disabled reason, 100 limit, 101st selection refusal, filtered-result overflow, directory change clearing selection and complete path visibility. Overflow must leave selection unchanged rather than silently choosing the first 100.

**Step 2: Implement selection state**

Keep selected keys scoped to the current directory/list view. The action label is `批量管理权限`; show selected count and a clear-selection action. Disable select-current-filter when the result would exceed 100 and explain how to narrow it. Never represent a selected directory as an authorization target or silently truncate selection.

**Step 3: Write failing preview/result tests**

Cover add/replace, all/none confirmation, aggregate and per-item diff, whole-batch stale, partial result, status filters, copied unfinished keys, refresh/reopen by operation ID and retry-only-incomplete. Assert `needs_review` is visible but cannot be retried and partial success is not presented as an atomic batch.

**Step 4: Implement the Drawer and persistent result**

The Drawer has one primary submit action. Explain before submit that completed items remain if another item fails. After submit, replace the form with `WikiBatchAccessResult`; do not reduce partial results to a Toast. Retry creates a new preview/operation containing only `conflict`, `failed` and `not_run`.

**Step 5: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run src/__tests__/wiki-batch-access.test.tsx src/__tests__/wiki.test.tsx --maxWorkers=1
```

Expected: PASS.

## Task 12: Regression, Static Gates And Documentation Closure

**Files:**

- Modify: `webui/docs/03-api-spec.md`
- Modify as needed: `docs/access-control/README.md`
- Modify as needed: `docs/governance/project-overview.md`
- Modify as needed: `docs/webui/webui-impl-status.md`
- Modify as needed: `webui/docs/193-business-wiki-access-management-spec.md` status only after evidence exists
- Modify as needed: `webui/docs/plans/wo-M66-business-wiki-access-management.md` execution notes only after implementation

**Step 1: Map every acceptance criterion to behavior evidence**

The implementation note must retain this mapping and link the executed test cases. Server tests assert routes, exact file bytes, durable audit/security state and real `authorizeContext` behavior; React tests drive user interactions. Helper-only tests that merely restate the implementation are not sufficient evidence.

| SC | Required behavior evidence |
|---|---|
| SC-01 | `wiki-upload-access.test.ts` server confirmation gate + `wiki.test.tsx` new-upload interaction |
| SC-02 | `wiki-upload-access.test.ts` committed bytes + `wiki-access-effects.test.ts` + upload UI |
| SC-03 | `wiki-upload-access.test.ts` preserve/adopt matrix + replace UI |
| SC-04 | `wiki-upload-access.test.ts` corrupt rejection/repair + upload UI |
| SC-05 | `wiki-upload-access.test.ts` and `wiki-acl-concurrency.test.ts` digest, required selection, mode/version zero-write cases |
| SC-06 | `wiki-access-effects.test.ts` aggregate shape + `wiki.test.tsx` read/list states and no row calls |
| SC-07 | `wiki-access-effects.test.ts` and `context-channel-parity.test.ts` Role/channel/Agent effects |
| SC-08 | `wiki-access-routes.test.ts` exact body/frontmatter/no-op + Drawer UI |
| SC-09 | `wiki.test.tsx` dirty-draft entry and conflict behavior |
| SC-10 | `wiki-access-routes.test.ts` 428/409 and unchanged bytes |
| SC-11 | `wiki-access-batch.test.ts` dedup/limits + `wiki-batch-access.test.tsx` selection/overflow |
| SC-12 | `wiki-access-batch.test.ts` add/replace/corrupt/empty/all + batch UI |
| SC-13 | `wiki-access-batch.test.ts` plan/digest + `wiki-batch-access.test.tsx` per-item differences |
| SC-14 | `wiki-access-batch-faults.test.ts` pre-entry stale with zero file and journal writes |
| SC-15 | `wiki-access-batch-faults.test.ts` partial results/retry eligibility + result UI |
| SC-16 | `wiki-access-batch-faults.test.ts` idempotent replay and digest conflict |
| SC-17 | `wiki-access-operation.test.ts` and batch faults: actor, operation ID, ACL summaries, committed audit |
| SC-18 | `wiki-write-queue.test.ts`, `wiki-acl-concurrency.test.ts`, `wiki.test.ts` all-write concurrency and non-reentrancy |
| SC-19 | `wiki-access-operation.test.ts`, `context-acl-matrix.test.ts`, batch restart faults: hold, needs-review, no replay/ratification |
| SC-20 | `wiki-access-operation.test.ts` + `context-policy-invalidation.test.ts` next-request narrowing |
| SC-21 | `wiki-access-batch-faults.test.ts` restart/query/redaction + result UI recovery |
| SC-22 | `wiki-acl-concurrency.test.ts` and `wiki.test.ts` restore ACL/version and pending structural guards |
| SC-23 | `wiki-access-routes.test.ts` and `wiki-access-batch.test.ts` trusted actor/auth rejection |
| SC-24 | `wiki-access-components.test.tsx`, Wiki React tests and `lint-terminology-scan.test.ts` DOM defenses |

**Step 2: Run the focused server suite**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run \
  server/__tests__/wiki-write-queue.test.ts \
  server/__tests__/wiki-access-effects.test.ts \
  server/__tests__/wiki-access-operation.test.ts \
  server/__tests__/wiki-upload-access.test.ts \
  server/__tests__/wiki-access-routes.test.ts \
  server/__tests__/wiki-access-batch.test.ts \
  server/__tests__/wiki-access-batch-faults.test.ts \
  server/__tests__/wiki-acl-concurrency.test.ts \
  server/__tests__/wiki.test.ts \
  server/__tests__/security-store.test.ts \
  server/__tests__/context-acl-matrix.test.ts \
  server/__tests__/context-policy-invalidation.test.ts \
  server/__tests__/context-channel-parity.test.ts \
  --maxWorkers=1
```

Expected: PASS.

**Step 3: Run the focused frontend suite**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx vitest run \
  src/__tests__/wiki-access-components.test.tsx \
  src/__tests__/wiki-batch-access.test.tsx \
  src/__tests__/wiki.test.tsx \
  src/__tests__/skill-list.test.tsx \
  src/__tests__/lint-terminology-scan.test.ts \
  --maxWorkers=1
```

Expected: PASS, including unchanged Skill ACL behavior.

**Step 4: Run project gates**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm run lint:ia-boundary
npm run build
cd /Users/zhangxingchen/Projects/project-lucy
node scripts/lint-spec.mjs
```

Expected: all commands exit 0. Existing unrelated warnings must be recorded separately and may not be described as caused by M66 without evidence.

**Step 5: Review security invariants**

Confirm with tests and diff review:

- no implicit grant;
- no directory inheritance;
- no cross-Role stitching;
- no actor from request body;
- no raw Markdown in batch journal/audit summary;
- widening hold works for both search and read;
- uncommitted widening is never auto-committed during recovery;
- restore never revives historical ACL;
- every Wiki write path uses the shared queue without recursive acquisition;
- batch success is never reported as whole-batch atomic.

**Step 6: Design System Compliance**

In the implementation delivery note, cite:

- `01-foundations-color.md`: semantic warning/error/success states;
- `10-components-button.md`: one primary action per group and explainable disabled/loading states;
- `11-components-data-grid.md`: batch result grid contract if used;
- `13-components-toast.md`: detailed results remain in-page/Drawer;
- `20-patterns-page-layout.md`: one Wiki primary workspace.

**Step 7: Close API and status documentation after implementation**

Update `webui/docs/03-api-spec.md` from the implemented behavior: access/batch routes, upload access selection and digest binding, aggregate list fields, restore/move/delete/directory-rename baselines, `access_update`, 1–100 dedup rule and all stable errors including lower-snake Wiki/config-audit codes and existing `CONTEXT_ACL_INVALID` / `SECURITY_STORE_UNAVAILABLE`. State that access endpoints and journals never return/store Markdown body or Tokens.

Synchronize the access-control README, project overview and implementation-status index only with the evidence actually produced. Update Spec 193 status and M66 execution notes only after the SC map and gates pass.

**Step 8: Final delivery note**

List modified files, focused/full validation results, unexecuted browser tests, operation recovery limitations and any remaining review items. Do not mark Spec 193 implemented until all SC-01–SC-24 evidence is mapped and passes.

## Execution Notes

> 本节是 Plan M66 的实施记录，按实际交付结果回填。Task 1–12 全部完成；SC-01–SC-24 的逐条证据映射见 [`../193-business-wiki-access-management-spec.md`](../193-business-wiki-access-management-spec.md) §19.3。

### Task 状态

| Task | 状态 | 落点 |
|---|---|---|
| 1 术语与共享契约 | ✅ | `00-product-terminology-standard.md` §4.14；`src/lib/types.ts`；`src/lib/queryKeys.ts` |
| 2 共享写队列 | ✅ | `server/wiki-write-queue.ts`；`server/wiki.ts` 全部写路径进队列并持锁内重验 |
| 3 Wiki→Role 效果投影 | ✅ | `server/wiki-access-effects.ts`；`listWiki` 一次聚合响应 |
| 4 统一协调器与扩权 hold | ✅ | `server/wiki-access-operation.ts` · `wiki-access-holds.ts` · `security/state-changes.ts` · `security/schema.ts` v4 |
| 5 上传授权选择 | ✅ | `server/wiki.ts` `previewWikiUpload` / `commitWikiUpload` |
| 6 单篇授权 API | ✅ | `server/wiki-access.ts`；`GET/POST/PUT /api/wiki/:key/access` |
| 7 批量授权 API + journal | ✅ | `server/wiki-access-batch.ts` · `wiki-access-batch-journal.ts` · `wiki-access-recovery.ts` |
| 8–11 前端 | ✅ | `src/lib/wikiAccess.ts` · `WikiAccess*.tsx` · `WikiBatchAccess*.tsx` · `WikiUploadPreflight.tsx` · `WikiReadView.tsx` · `WikiLibraryHome.tsx` · `WikiVersionHistoryDialog.tsx` |
| 12 回归与文档 | ✅ | `03-api-spec.md` · `docs/access-control/README.md` · `docs/governance/project-overview.md` · `docs/webui/webui-impl-status.md` · Spec 193 §19 |

### 验证结果

| 门禁 | 结果 |
|---|---|
| `npx vitest run`（全量） | 365 文件 / 4450 测试全绿 |
| 新增服务端套件（7 个文件） | `wiki-write-queue` · `wiki-access-effects` · `wiki-access-operation` · `wiki-upload-access` · `wiki-access-routes` · `wiki-access-batch` · `wiki-access-batch-faults` |
| 新增鉴权套件 | `wiki-access-auth.test.ts`（SC-23：未登录 401 / operator 可维护） |
| 新增前端套件 | `wiki-access-components.test.tsx` · `wiki-batch-access.test.tsx` |
| `npm run lint:terminology` | 通过（1037 文件） |
| `npm run lint:ia-boundary` | 通过 |
| `npm run build` | 通过 |
| `node scripts/lint-spec.mjs` | 通过（2 条既有 warning 与本轮无关） |
| `npx tsc --noEmit` | 73 个**既有**错误，本轮新增 0 个 |

### 实施中修正的偏差

评审通过的实现初稿与 Spec 有四处偏差，已在交付前按 Spec 修正并补回归测试（详见 Spec 193 §19.2）：方向分类的 runtime-set 矩阵、启动恢复的 `onReady` 接线、批量 key 规范化去重、未映射审计故障的系统性停止。

### 未执行与遗留

* 浏览器与移动窄屏测试**未执行**（按 Plan 的 Non-Negotiable Boundaries 与 §13 测试策略）。
* `needs_review` 的扩权必须人工核对后才能重试；系统不会自动重放或自动确认扩权。
* 队列与 hold 只覆盖单实例单副本；跨进程写入不支持。
* 既有 4 个测试文件（`audit-actor-propagation` · `frontmatter-safety` · `oidc-reservation` · `audit-trust/audit-trust-backfill`）按新上传契约、`expected_version` 与安全库 schema v4 同步更新，断言强度未降低。

## Reviewer Checklist

- [ ] Upload replace defaults to current ACL even when the file declares a different one.
- [ ] Empty/all confirmations are enforced server-side, not only by UI state.
- [ ] Preview digests bind the relevant file and Role/channel versions.
- [ ] Single and batch ACL saves preserve body and unknown frontmatter.
- [ ] All Wiki writes recheck versions inside one process queue.
- [ ] Expansion is held until durable commit; uncertain crash recovery remains denied.
- [ ] Batch limit is enforced after deduplication and cannot be raised by request input.
- [ ] Batch pre-entry stale check is zero-write; mid-run conflicts are per-item.
- [ ] Idempotency replay cannot write an applied item twice.
- [ ] Journals/audit summaries contain no body, Token, credential or absolute path.
- [ ] UI distinguishes declared roles, channels and Agent bindings.
- [ ] Directory selection never becomes inheritance.
- [ ] Existing Skill access behavior remains unchanged.
- [ ] Restore keeps current ACL.
- [ ] No browser/mobile test was added as a default gate.

## Handoff

Kimi cross-review and requirements-owner review are closed. Product-code implementation is not authorized by this review closure or commit; a separate explicit start is still required.
