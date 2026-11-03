# Lucy Helm Chart — Rollback Guide

## When to rollback

- `helm upgrade --atomic` timed out and auto-rolled back, but the cluster is still unhealthy.
- New pod starts but fails acceptance (`scripts/gates/k8s-acceptance.sh`).
- Wrong image digest was deployed under a reused mutable tag.
- v1/v2 package upgrade failed — roll back to last known-good revision, then plan v3 retry.

## Lucy 2.0 authentication migration

Use the instance directory's filled `RECOVERY.md` (template at package-root
`examples/RECOVERY.open-mode.md`). It includes access isolation, original image/revision and
backup validation, failed-state preservation, full PVC restore with numeric ownership, rollback,
and security/business verification. Keep `.deployment/baseline.json`, `baseline-values.json`,
`initial-backup.json`, and the original `backup-*.tgz`. An existing initial backup is never replaced
by a retry against the candidate version.

Helm rollback alone leaves the new admins and security database on the PVC. Reopening an old
open-mode service requires explicit review of the access boundary and any later permission/token
revocations that the old snapshot would undo.

## Helm rollback (after the volume recovery decision)

```bash
helm history lucy-starrocks -n lucy-test
helm rollback lucy-starrocks <REVISION> -n lucy-test --wait --timeout 15m
```

Verify the rolled-back revision uses the **expected immutable image tag and digest**:

```bash
kubectl -n lucy-test get deploy lucy -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

If the tag is mutable and was overwritten in containerd/docker, rollback to an old Helm
revision may still pull the **new** image. In that case:

1. Re-import the known-good image tar with its original immutable tag, or
2. Pin `image.digest` in values to the last known-good digest and upgrade again.

### Rolling back from chart 0.2.3 to an older chart revision

Older charts mount the Secret **over** `/data/lucy/.ktx/secrets` (read-only). After such a rollback:

- Connections whose password key is in the Secret keep working.
- Password files created through the WebUI **after** the 0.2.3 upgrade exist only on the PVC. They are shadowed by
  the Secret mount, so those connections fail their `connection test` until you upgrade to 0.2.3 again.
  Nothing is deleted: the files stay on the PVC underneath the mount.
- The old chart does not set `LUCY_CONTENT_ROOT`; on a pre-M31 PVC that is the state the old release was already
  running in.

Roll forward again with the same `helm upgrade` command to restore WebUI-created connections.

## After atomic upgrade failure

Names below use the lucy-test profile (release `lucy-starrocks`, Deployment `lucy`, `fullnameOverride: lucy`).

```bash
helm status lucy-starrocks -n lucy-test
kubectl -n lucy-test get pods -l app.kubernetes.io/instance=lucy-starrocks
kubectl -n lucy-test describe pod -l app.kubernetes.io/instance=lucy-starrocks | tail -40
kubectl -n lucy-test logs deploy/lucy -c lucy --tail=100
kubectl -n lucy-test logs deploy/lucy -c secrets-sync --tail=20     # counts only, never secret values
kubectl -n lucy-test logs deploy/lucy -c project-migrate --tail=20
```

Common failure signatures:

| Symptom | Likely cause | Fix |
|---|---|---|
| `EROFS` creating a data source | chart < 0.2.3 (Secret over `.ktx/secrets`) | Upgrade to 0.2.3 |
| `Init:Error` on `secrets-sync` | `existingSecret` missing in namespace | Create it, `rollout restart deploy/lucy` |
| `ErrImageNeverPull` | image not imported into containerd | `sudo k3s ctr images import ...` |
| Empty semantic layer / wiki | pre-M31 PVC without `LUCY_CONTENT_ROOT` | `env.LUCY_CONTENT_ROOT: "."` |
| `Startup probe failed: command timed out` | Chart 0.1.x exec probe | Upgrade to chart 0.2.x+ |
| `k8s-preflight.sh: No such file` | stale init container | Remove `runtime-preflight`; use v3 chart |
| `dubious ownership in repository at '/data/lucy'` | root pod vs UID 10001 `.git` | v3 image + Chart 0.2.1; enable `projectMigrate` |
| Pod CrashLoop, no `.git` on PVC | missing git init | v3 entrypoint + `project-migrate` init |
| `GIT_CONFIG_COUNT ... not permitted` | invalid Git env | Remove `GIT_CONFIG_*` from values |
| Pod Running but not Ready | probe timeout / wrong port | Check HTTP probe on `webui:5174` |
| Pod Running but 8276/8277 down | ClusterIP Service | Use LoadBalancer / NodePort |
| MCP fallback in WebUI | missing `LUCY_PUBLIC_MCP_URL` in Helm values | set in values, re-upgrade |
| Pod not-ready after a rollback that had SMTP enabled | the customer-managed SMTP Secret was removed from the namespace | recreate the Secret, then `rollout restart deploy/lucy` |
| Notifications stopped but no error is shown | the rolled-back chart has no SMTP wiring, or `smtp.enabled` is false | expected: queued rows are kept and not delivered; see the SMTP section above |

## Optional SMTP notifications (chart 0.2.8+)

This section is the one referenced by the system handbook §5.4.5 ("回滚到不识别 `notification_outbox` 表的旧版本前,
按升级回滚 Runbook 清理或保留兼容该表"). It applies only when the deployment had `smtp.enabled: true`.

Rolling back to a chart **older than 0.2.8** removes the SMTP wiring from the Deployment: the `LUCY_SMTP_*` env
vars, the profile ConfigMap mount, the password mount and the CA mount all disappear. The rollout is otherwise
identical to any other rollback — the PVC, the audit ledger, ACLs, tokens and the recovery key are untouched.

### The `notification_outbox` table: keep it by default

The notification queue lives in the audit database (`audit.sqlite`) as `notification_outbox`, and chart 0.2.8
registers audit schema version **4** (3 before it). The old version neither reads nor writes that table.

- **Keep the table (default).** It is inert under the old version and the audit ledger's authority facts are
  unaffected — authentication, ACLs, token issuance and the audit trail do not regress. Rolling forward again
  reuses it, and rows that were queued but never delivered are still there.
- **Clean the table up** only if the customer requires the old audit database to be byte-identical. Dropping it
  loses the queued notifications and nothing else. Do this while Lucy is stopped, against a backup copy, and
  never as part of an automated rollback.

The audit schema version row in `audit_meta` is **not** a compatibility gate: it is written on the startup path and
read by no guard, so an old version running on a newer audit database does not refuse to start.

### What rollback does not touch

- The customer's own SMTP Secret (and CA Secret) — the chart never owned them, so `helm rollback` does not delete
  them. Recreate the wiring later by pointing `smtp.existingSecret` at the same Secret.
- Login accounts, the audit ledger's authority facts, ACLs, tokens and the recovery key.
- The SMTP password never entered a backup plain-text attachment in the first place.

### Queue behaviour while notifications are off

With `smtp.enabled: false` (or under an older chart), queued rows **stay in the queue and are not delivered** —
disabling notifications stops new deliveries, it does not discard history. Rows that pass their validity window
while the channel is off are never delivered; they are moved to `dead` with reason `expired`.

### Post-rollback check

```bash
# No SMTP wiring remains in the rolled-back revision:
kubectl -n lucy-test get deploy lucy -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}{"\n"}{end}' | grep LUCY_SMTP || echo "no SMTP env (expected)"
```

With SMTP previously enabled, confirm the `notification_outbox` table still exists in the audit database and that
the audit ledger is intact — the rollback must not have produced an auth or audit semantic regression.

## PVC and data safety

Rollback **does not** delete the PVC or `/data/lucy` contents. Tokens, semantic layer,
wiki, and ACL config should remain intact. It also does not undo `admins.yaml` or
`.ktx-ui/security.sqlite` written by a 2.0 upgrade. Restore the quiesced PVC backup
to return to the old open-mode disk.

**Do not run** unless intentionally resetting the environment:

```bash
kubectl delete pvc lucy -n lucy-test
helm uninstall lucy-starrocks -n lucy-test   # only when decommissioning
```

## Rollback verification

```bash
export LUCY_MCP_TOKEN="<bearer-token>"
bash scripts/acceptance.sh \
  --namespace lucy-test \
  --release lucy-starrocks --deployment lucy --service lucy \
  --public-mcp-url "http://<node-ip>:8277/mcp" \
  --connection kc-starrocks --connection rds-test --connection zijin
unset LUCY_MCP_TOKEN
```

If you rolled back to a pre-0.2.3 chart, add `--skip-secrets-check`: the old chart mounts the Secret over
`.ktx/secrets`, which is the very defect 0.2.3 fixes, so the owner/mode/mount checks are expected to fail.
Judge that rollback by health, MCP and connection tests.

Confirm:

- `/api/health` → 200
- External WebUI and MCP ports reachable (8276 / 8277)
- StarRocks connection test passes
- MCP `tools/list` succeeds with token

## Recording rollback evidence

For customer deliveries, archive:

- `helm history` output
- Pod image digest before and after
- Acceptance script output
- Timestamp and operator

Store under `inbox/` or your release evidence package per
[`docs/runbooks/customer-delivery-preflight-checklist.md`](../../../../docs/runbooks/customer-delivery-preflight-checklist.md).
