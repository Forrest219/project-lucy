# Builder P0 Development Todo

| Item | Value |
|---|---|
| Date | 2026-06-21 |
| Source | `inbox/security-write-path-builder-contract-2026-06-21.md` |
| Scope | Package A Admin Role-First; Package B enabled_tables safe write |
| Status | In development |

## Package A: Admin Role-First

1. Expose reusable ACL permission resolution for admin.
   - Export a function from `webui/server/proxy/acl.ts` that returns effective permissions with `roleIds`, `snapshotHash`, `sourceMapVersion`, `tools`, `connections`, `sources`, and `legacyAllow`.
   - Do not duplicate role / selector parsing inside admin routes.

2. Update admin access YAML model.
   - Add `roles`, `users[].role`, and optional legacy `users[].allow`.
   - Preserve `roles:` and `defaults:` on write.
   - Strip only derived fields and migrated legacy `allow`.

3. Add role APIs.
   - `GET /api/admin/roles`
   - `GET /api/admin/agents/:userId/effective-permissions`

4. Make agent writes role-first.
   - `POST /api/admin/agents` requires `agent.role` and rejects `agent.allow`.
   - `PATCH /api/admin/agents/:userId` only accepts `name`, `note`, `enabled`, and `role`.
   - Reject enabling legacy wildcard users without a role.
   - When assigning a role to a legacy user, remove that user’s `allow`.

5. Add tests.
   - Role-first create writes `role` and no `allow`.
   - `allow` in POST/PATCH is rejected.
   - Legacy wildcard re-enable is rejected.
   - Role migration removes user `allow` while preserving `roles:` and `defaults:`.

## Package B: enabled_tables Safe Write

1. Add config audit table/helper.
   - `config_change_log` in `.ktx-ui/audit.sqlite`.
   - Actor is `local-admin`.
   - Token plaintext must never be logged.

2. Change `PUT /api/connections/:connId/enabled-tables`.
   - `dryRun` defaults to true.
   - Return diff, old enabled tables, and new enabled tables on dryRun.
   - Only write when `dryRun:false`.

3. Validate enabled tables.
   - Each item must be `schema.table`.
   - Reject empty strings, path characters, `..`, control characters, and duplicates.
   - Require each table to exist in scanned `semantic-layer/<connId>/_schema/*.yaml` physical table list.

4. Update frontend whitelist save.
   - First call dryRun.
   - Show diff / old-new count.
   - Confirm then call `dryRun:false`.
   - Refresh connections after save.

5. Add tests.
   - DryRun does not modify `ktx.yaml`.
   - Invalid input returns 400.
   - Unscanned table returns 400.
   - Write records config audit and updates `ktx.yaml`.

## Verification

Run from `webui/`:

```bash
npm test -- admin
npm test -- connection
npm test -- mcp-proxy
npm test -- kx-acl
npx tsc --noEmit
```
