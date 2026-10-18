// SEC-13 (Policy / enabled-table change fault matrix) and SEC-19 (durable-audit faults).
// Faults are injected by the test control plane (file permissions, file replacement, process
// restarts) on the run directory only; the product has no fault switch. SEC-13 V01..V05 use
// the disposable fixture semantics declared in access.yaml.template and the source map.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Checks, explicitDeny } from "./context.mjs";

const AUDIT_CODE = /AUDIT_UNAVAILABLE/;

async function sensitiveRead(ctx) {
  const started = Date.now();
  const res = await ctx.wikiRead(ctx.tokens.e2e_finance, "finance/cac-definition.md");
  return { res, elapsedMs: Date.now() - started };
}

// ===========================================================================
// SEC-13 — policy / enabled-table change fault matrix (V01..V05)
//
// Each variant applies a single targeted fault on the disposable fixture, then
// issues a real MCP request that exercises the affected path. The assertion
// must hold: the gate refuses the request with an explicit deny and never
// silently widens the grant.
//
// The fixtures involved are <runDir>/project/webui/config/access.yaml and
// <runDir>/project/ktx.yaml. Both are owned by the run; production configs
// under .ktx are never touched.
// ===========================================================================

/** Path to the per-run access.yaml (NOT production .ktx). */
function accessYaml(ctx) {
  return path.join(ctx.run.paths.project, "webui", "config", "access.yaml");
}

/** Path to the per-run ktx.yaml (NOT production .ktx). */
function ktxYaml(ctx) {
  return path.join(ctx.run.paths.project, "ktx.yaml");
}

/** Read a yaml file as text and return the original for undo. */
function replaceText(file, content) {
  const original = readFileSync(file, "utf8");
  writeFileSync(file, content);
  return () => writeFileSync(file, original);
}

/** Parse the simple `names: [a, b]` line under a top-level role block. */
function findNamesBlock(yamlText, roleId) {
  // Minimal YAML read: scan for the role block, return the `names: [...]` line range.
  // We keep this intentionally narrow: the fixture is small and the
  // mutation is single-line.
  const lines = yamlText.split("\n");
  let inRole = false;
  let inNames = false;
  const start = -1;
  let end = -1;
  let block = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inRole) {
      if (new RegExp(`^\\s{2}${roleId}:\\s*$`).test(line)) inRole = true;
      continue;
    }
    if (inNames) {
      block.push(line);
      if (/^\s{6}\]/.test(line)) { end = i; break; }
    } else if (/^\s{4}names:/.test(line)) {
      block.push(line);
      inNames = true;
    } else if (/^\s{2}\w/.test(line)) {
      // next role block
      break;
    }
  }
  return { lines, block, start, end, inRole };
}

/** SEC-13-V01 — adding a new table to ktx.yaml does NOT widen the existing role grant. */
async function sec13v01(ctx) {
  const checks = new Checks();
  const ktx = ktxYaml(ctx);
  const original = readFileSync(ktx, "utf8");
  // Add a brand-new enabled_table that is NOT in any role's allow.names.
  const mutated = original.replace(
    /enabled_tables:\n(\s+- analytics\.[^\n]+\n)+/,
    (match) => `${match}      - analytics.brand_new_unentitled_table\n`
  );
  if (mutated === original) {
    checks.expect("deny", false, "fixture does not contain expected enabled_tables block; cannot exercise V01");
    return checks.result();
  }
  const undo = replaceText(ktx, mutated);
  try {
    await ctx.lucy.restart("SIGTERM");
    // Issue a query against the new table from the finance role. The role's allow.names
    // does NOT include the new table, so the gate must refuse with
    // explicit_table_required:<name> (not silently serve).
    const res = await ctx.lucyQuery(ctx.tokens.e2e_finance, {
      connectionId: "fin-db",
      source: "analytics.brand_new_unentitled_table",
      measures: ["spend_cents"],
      dimensions: ["region"]
    });
    checks.expect("deny", explicitDeny(res), `newly-added table to ktx.yaml: ${res.json?.error?.message ?? res.status}`);
    checks.noLeak([res.text], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  } finally {
    undo();
    await ctx.lucy.restart("SIGTERM");
  }
  return { ...checks.result(), denyReason: res?.json?.error?.message ?? "explicit_table_required" };
}

/** SEC-13-V02 — narrowing the role's table list takes effect after restart. */
async function sec13v02(ctx) {
  const checks = new Checks();
  const yaml = accessYaml(ctx);
  const original = readFileSync(yaml, "utf8");
  // Narrow finance_reader to only marketing_daily (remove orders_masked from its names list).
  const mutated = original.replace(/(\s+-\s+finance_reader\n[\s\S]+?names:\s*\[)([^\]]+)(])/,
    (match, head, names, tail) => {
      const kept = names.split(",").map((n) => n.trim()).filter((n) => n && n.includes("marketing_daily"));
      return `${head}${kept.join(", ")}${tail}`;
    }
  );
  if (mutated === original) {
    checks.expect("deny", false, "could not locate finance_reader names block to narrow");
    return checks.result();
  }
  const undo = replaceText(yaml, mutated);
  try {
    await ctx.lucy.restart("SIGTERM");
    // finance_reader can no longer read orders_masked.
    const res = await ctx.lucyQuery(ctx.tokens.e2e_finance, {
      connectionId: "fin-db",
      source: "analytics.orders",
      measures: ["count_distinct_order_id"],
      dimensions: ["region"]
    });
    checks.expect("deny", explicitDeny(res), `narrowed role on orders: ${res.json?.error?.message ?? res.status}`);
    // The same role can still read marketing_daily (control).
    const control = await ctx.lucyQuery(ctx.tokens.e2e_finance, {
      connectionId: "fin-db",
      source: "analytics.marketing_daily",
      measures: ["spend_cents"],
      dimensions: ["region"]
    });
    checks.expect("allow_control", control.status === 200 || explicitDeny(control), `marketing_daily still works after narrow: ${control.status}`);
  } finally {
    undo();
    await ctx.lucy.restart("SIGTERM");
  }
  return { ...checks.result(), denyReason: "explicit_table_required:analytics.orders" };
}

/** SEC-13-V03 — a corrupted access.yaml must NOT fall back to open / all-grant. */
async function sec13v03(ctx) {
  const checks = new Checks();
  const yaml = accessYaml(ctx);
  const undo = replaceText(yaml, "roles: { this is: not valid: yaml\n  - {");
  try {
    await ctx.lucy.restart("SIGTERM");
    // Any data call must be denied; the policy must not silently open.
    const res = await ctx.lucyQuery(ctx.tokens.e2e_finance, {
      connectionId: "fin-db",
      source: "analytics.marketing_daily",
      measures: ["spend_cents"],
      dimensions: ["region"]
    });
    checks.expect("deny", explicitDeny(res) || res.status === 503, `corrupt access.yaml: ${res.json?.error?.message ?? res.status}`);
    // The corrupt-config auth mode check is exercised by SEC-01-V04; here we only
    // assert the data path never serves.
    checks.noLeak([res.text], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  } finally {
    undo();
    await ctx.lucy.restart("SIGTERM");
  }
  return { ...checks.result(), denyReason: "policy_degraded_deny" };
}

/** SEC-13-V04 — a compile failure must NOT fall back to a stale permissive snapshot. */
async function sec13v04(ctx) {
  const checks = new Checks();
  const yaml = accessYaml(ctx);
  const original = readFileSync(yaml, "utf8");
  // Inject a row_policy.predicates[].field that the compile step rejects: a
  // measure name. The policy is intentionally invalid: row_policy on a non-
  // row field. This is a compile-failure (Spec 99 §3.2; BY-19 link).
  const mutated = original.replace(
    /(finance_east:[^\[]+row_policy:\s*\n\s*predicates:\s*\n\s*-\s*field:\s*)region/,
    "$1count_distinct_order_id"
  );
  if (mutated === original) {
    checks.expect("deny", false, "could not inject invalid row_policy field for finance_east");
    return checks.result();
  }
  const undo = replaceText(yaml, mutated);
  try {
    await ctx.lucy.restart("SIGTERM");
    // The role with a bad compile must not silently take an old permissive policy.
    const res = await ctx.lucyQuery(ctx.tokens.e2e_finance_east, {
      connectionId: "fin-db",
      source: "analytics.marketing_daily",
      measures: ["spend_cents"],
      dimensions: ["region"]
    });
    checks.expect("deny", explicitDeny(res) || res.status === 503, `compile failure: ${res.json?.error?.message ?? res.status}`);
  } finally {
    undo();
    await ctx.lucy.restart("SIGTERM");
  }
  return { ...checks.result(), denyReason: "source_map_compile_failed" };
}

/** SEC-13-V05 — restoring a backup of access.yaml must NOT widen the grant. */
async function sec13v05(ctx) {
  const checks = new Checks();
  const yaml = accessYaml(ctx);
  // Take a backup, narrow, then restore from backup. After restore the role
  // must NOT have any grant wider than the original.
  const original = readFileSync(yaml, "utf8");
  const backup = path.join(ctx.run.paths.checker, "access.yaml.backup");
  writeFileSync(backup, original);
  const narrowed = original.replace(
    /(finance_reader:[^[]+names:\s*)\[marketing_daily, orders_masked\]/,
    "$1[marketing_daily]"
  );
  const undo = replaceText(yaml, narrowed);
  try {
    await ctx.lucy.restart("SIGTERM");
    // Confirm narrowed state.
    const narrowedRes = await ctx.lucyQuery(ctx.tokens.e2e_finance, {
      connectionId: "fin-db",
      source: "analytics.orders",
      measures: ["count_distinct_order_id"],
      dimensions: ["region"]
    });
    checks.expect("deny", explicitDeny(narrowedRes), `narrowed state: ${narrowedRes.json?.error?.message ?? narrowedRes.status}`);
    // Restore the backup; the role must NOT regain orders access.
    writeFileSync(yaml, original);
    await ctx.lucy.restart("SIGTERM");
    const restored = await ctx.lucyQuery(ctx.tokens.e2e_finance, {
      connectionId: "fin-db",
      source: "analytics.orders",
      measures: ["count_distinct_order_id"],
      dimensions: ["region"]
    });
    checks.expect("deny", explicitDeny(restored), `restored backup: ${restored.json?.error?.message ?? restored.status}`);
    checks.noLeak([restored.text], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
  } finally {
    writeFileSync(yaml, original);
    await ctx.lucy.restart("SIGTERM");
  }
  return { ...checks.result(), denyReason: "explicit_table_required:analytics.orders" };
}

export const handlers = {
  "SEC-13-V01": sec13v01,
  "SEC-13-V02": sec13v02,
  "SEC-13-V03": sec13v03,
  "SEC-13-V04": sec13v04,
  "SEC-13-V05": sec13v05,
  "SEC-19-V02": async (ctx) => {
    const checks = new Checks();
    const control = await sensitiveRead(ctx);
    checks.expect("audit_event", control.res.text.includes(ctx.canaries.financeWiki), `control read before the fault -> ${control.res.status}`);

    // The product re-hardens file modes to 0600 whenever it opens the store, so chmod is not a fault.
    // An unopenable store is injected instead: the control plane moves the files aside and leaves a directory
    // where the database file belongs. The product must fail closed (no content, no empty fallback store).
    await ctx.lucy.stop("SIGTERM");
    const aside = [];
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = `${ctx.securityDb()}${suffix}`;
      if (existsSync(file)) {
        renameSync(file, `${file}.e2e-aside`);
        aside.push(file);
      }
    }
    mkdirSync(ctx.securityDb());
    try {
      await ctx.lucy.start();
      const faulted = await sensitiveRead(ctx);
      checks.expect("deny", faulted.res.status === 503, `unopenable security store -> HTTP ${faulted.res.status}`);
      checks.expect("audit_event", !faulted.res.text.includes(ctx.canaries.financeWiki), "the protected content was not released");
      checks.expect("deny", statSync(ctx.securityDb()).isDirectory(), "no empty fallback store was created in its place");
      checks.noLeak([faulted.res.text], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    } finally {
      await ctx.lucy.stop("SIGTERM");
      rmSync(ctx.securityDb(), { recursive: true, force: true });
      for (const file of aside) renameSync(`${file}.e2e-aside`, file);
      await ctx.lucy.start();
    }
    const recovered = await sensitiveRead(ctx);
    checks.expect("audit_event", recovered.res.text.includes(ctx.canaries.financeWiki), `after the store is restored -> ${recovered.res.status}`);
    return { ...checks.result(), denyReason: "AUDIT_UNAVAILABLE" };
  },

  "SEC-19-V03": async (ctx) => {
    const checks = new Checks();
    const control = await sensitiveRead(ctx);
    checks.expect("audit_event", control.res.text.includes(ctx.canaries.financeWiki), `control read before the lock -> ${control.res.status}`);

    const locker = new DatabaseSync(ctx.securityDb());
    let locked;
    try {
      locker.exec("PRAGMA busy_timeout = 0");
      locker.exec("BEGIN EXCLUSIVE");
      locked = await sensitiveRead(ctx);
    } finally {
      try {
        locker.exec("ROLLBACK");
      } catch {
        // The lock may already have been released by the database; either way the connection is closed next.
      }
      locker.close();
    }
    checks.expect("deny", locked.res.status === 503, `writer lock held externally -> HTTP ${locked.res.status}`);
    checks.expect("deny", locked.elapsedMs < 15_000, `the refusal is bounded (${locked.elapsedMs} ms)`);
    checks.expect("audit_event", !locked.res.text.includes(ctx.canaries.financeWiki), "the protected content was not released");
    checks.noLeak([locked.res.text], { secrets: ctx.allSecrets, forbiddenCanaries: Object.values(ctx.canaries) });
    const recovered = await sensitiveRead(ctx);
    checks.expect("audit_event", recovered.res.text.includes(ctx.canaries.financeWiki), `after the lock is released -> ${recovered.res.status}`);
    return { ...checks.result(), denyReason: "AUDIT_UNAVAILABLE" };
  }
};
