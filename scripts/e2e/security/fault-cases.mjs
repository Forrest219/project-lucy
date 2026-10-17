// SEC-19: durable-audit faults. Faults are injected by the test control plane (file permissions, an external
// SQLite writer lock, process restarts) on the run directory only; the product has no fault switch.
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Checks } from "./context.mjs";

const AUDIT_CODE = /AUDIT_UNAVAILABLE/;

async function sensitiveRead(ctx) {
  const started = Date.now();
  const res = await ctx.wikiRead(ctx.tokens.e2e_finance, "finance/cac-definition.md");
  return { res, elapsedMs: Date.now() - started };
}

export const handlers = {
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
