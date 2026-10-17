import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { chmodSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SECURITY_SCHEMA_VERSION } from "../security/schema";
import { hashSessionJti, openSecurityStore, type SecurityStore } from "../security/store";
import type { SecurityResult } from "../security/types";

let root: string;
let clock: number;
const opened: SecurityStore[] = [];

const now = () => clock;
const dbFile = () => path.join(root, ".ktx-ui", "security.sqlite");

function open(options: { busyTimeoutMs?: number } = {}): SecurityStore {
  const result = openSecurityStore(root, { now, ...options });
  if (!result.ok) throw new Error(`open failed: ${result.reason} ${result.message}`);
  opened.push(result.value);
  return result.value;
}

function unwrap<T>(result: SecurityResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}/${result.reason}: ${result.message}`);
  return result.value;
}

async function mode(file: string): Promise<number> {
  return (await stat(file)).mode & 0o777;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-security-store-"));
  clock = 1_000_000;
});

afterEach(async () => {
  while (opened.length) opened.pop()?.close();
  await rm(root, { recursive: true, force: true });
});

describe("security store: files, WAL and permissions", () => {
  it("creates a 0700 directory and 0600 db/WAL/SHM with WAL + synchronous=FULL", async () => {
    const store = open();
    unwrap(store.upsertAccount({ accountUid: "u1", displayId: "alice" }));

    expect(await mode(path.join(root, ".ktx-ui"))).toBe(0o700);
    for (const file of [dbFile(), `${dbFile()}-wal`, `${dbFile()}-shm`]) {
      expect(existsSync(file)).toBe(true);
      expect(await mode(file)).toBe(0o600);
    }

    const probe = new Database(dbFile(), { readonly: true });
    try {
      expect(probe.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(probe.pragma("user_version", { simple: true })).toBe(SECURITY_SCHEMA_VERSION);
    } finally {
      probe.close();
    }
  });

  it("tightens a pre-existing wide directory and database file", async () => {
    await mkdir(path.join(root, ".ktx-ui"), { mode: 0o755 });
    chmodSync(path.join(root, ".ktx-ui"), 0o755);
    open().close();
    chmodSync(dbFile(), 0o644);
    chmodSync(path.join(root, ".ktx-ui"), 0o755);

    open();
    expect(await mode(path.join(root, ".ktx-ui"))).toBe(0o700);
    expect(await mode(dbFile())).toBe(0o600);
  });

  it("is idempotent across repeated initialisation and keeps data", () => {
    const first = open();
    unwrap(first.upsertAccount({ accountUid: "u1", displayId: "alice" }));
    first.close();

    const second = open();
    const third = open();
    expect(unwrap(second.getAccount("u1"))?.displayId).toBe("alice");
    expect(unwrap(third.getBootstrapState()).state).toBe("open");

    const probe = new Database(dbFile(), { readonly: true });
    try {
      expect((probe.prepare("SELECT COUNT(*) AS n FROM bootstrap_state").get() as { n: number }).n).toBe(1);
      expect(probe.pragma("user_version", { simple: true })).toBe(SECURITY_SCHEMA_VERSION);
    } finally {
      probe.close();
    }
  });
});

describe("security store: durable state across restart", () => {
  it("keeps session revocation, epoch, tombstones, bootstrap and rate buckets after reopen", () => {
    const first = open();
    unwrap(first.upsertAccount({ accountUid: "u1", displayId: "alice" }));
    unwrap(first.upsertAccount({ accountUid: "u2", displayId: "bob" }));
    const live = hashSessionJti("jti-live");
    const revoked = hashSessionJti("jti-revoked");
    const stale = hashSessionJti("jti-stale");
    unwrap(first.createSession({ jtiHash: live, accountUid: "u1", absoluteExpiry: clock + 60_000 }));
    unwrap(first.createSession({ jtiHash: revoked, accountUid: "u1", absoluteExpiry: clock + 60_000 }));
    unwrap(first.createSession({ jtiHash: stale, accountUid: "u2", absoluteExpiry: clock + 60_000 }));
    unwrap(first.revokeSession(revoked));
    expect(unwrap(first.bumpSessionEpoch("u2"))).toBe(1);
    unwrap(first.tombstoneRoleId("role-old", "deleted"));
    unwrap(first.consumeBootstrap("u1"));
    unwrap(first.hitRateBucket({ key: "login:alice:1.2.3.4", limit: 2, windowMs: 60_000 }));
    unwrap(first.hitRateBucket({ key: "login:alice:1.2.3.4", limit: 2, windowMs: 60_000 }));
    first.close();

    const second = open();
    expect(unwrap(second.validateSession(live))).toMatchObject({ valid: true });
    expect(unwrap(second.validateSession(revoked))).toEqual({ valid: false, reason: "revoked" });
    expect(unwrap(second.validateSession(stale))).toEqual({ valid: false, reason: "revoked" });
    expect(unwrap(second.getAccount("u2"))?.sessionEpoch).toBe(1);
    expect(unwrap(second.isRoleIdTombstoned("role-old"))).toBe(true);
    expect(unwrap(second.getBootstrapState())).toMatchObject({ state: "consumed", consumedByUid: "u1" });

    const denied = unwrap(second.hitRateBucket({ key: "login:alice:1.2.3.4", limit: 2, windowMs: 60_000 }));
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("rejects expired sessions and sessions after disable/tombstone, and never reuses a tombstoned UID", () => {
    const store = open();
    unwrap(store.upsertAccount({ accountUid: "u1", displayId: "alice" }));
    const jti = hashSessionJti("a");
    unwrap(store.createSession({ jtiHash: jti, accountUid: "u1", absoluteExpiry: clock + 1000 }));
    clock += 1000;
    expect(unwrap(store.validateSession(jti))).toEqual({ valid: false, reason: "expired" });

    clock += 1;
    unwrap(store.setAccountStatus("u1", "disabled"));
    expect(store.createSession({ jtiHash: hashSessionJti("b"), accountUid: "u1", absoluteExpiry: clock + 1000 })).toMatchObject({
      ok: false,
      code: "SECURITY_CONFLICT"
    });

    unwrap(store.tombstoneAccount("u1"));
    expect(store.upsertAccount({ accountUid: "u1", displayId: "alice" })).toMatchObject({
      ok: false,
      reason: "account_tombstoned"
    });
    expect(store.setAccountStatus("u1", "enabled")).toMatchObject({ ok: false, reason: "account_tombstoned" });
  });

  it("enabling a disabled account does not revive old sessions", () => {
    const store = open();
    unwrap(store.upsertAccount({ accountUid: "u1", displayId: "alice" }));
    const jti = hashSessionJti("a");
    unwrap(store.createSession({ jtiHash: jti, accountUid: "u1", absoluteExpiry: clock + 60_000 }));
    unwrap(store.setAccountStatus("u1", "disabled"));
    unwrap(store.setAccountStatus("u1", "enabled"));
    expect(unwrap(store.validateSession(jti))).toEqual({ valid: false, reason: "revoked" });
  });

  it("consumes bootstrap exactly once", () => {
    const store = open();
    unwrap(store.consumeBootstrap("u1"));
    expect(store.consumeBootstrap("u2")).toMatchObject({ ok: false, reason: "bootstrap_consumed" });
    expect(unwrap(store.getBootstrapState()).consumedByUid).toBe("u1");
  });
});

describe("security store: rate buckets", () => {
  it("prunes expired buckets, can clear them, and fails closed at capacity", () => {
    const store = open();
    expect(unwrap(store.hitRateBucket({ key: "a", limit: 1, windowMs: 1000 })).allowed).toBe(true);
    expect(unwrap(store.hitRateBucket({ key: "a", limit: 1, windowMs: 1000 }))).toMatchObject({ allowed: false });
    clock += 1001;
    expect(unwrap(store.hitRateBucket({ key: "a", limit: 1, windowMs: 1000 })).allowed).toBe(true);

    unwrap(store.clearRateBucket("a"));
    expect(unwrap(store.hitRateBucket({ key: "a", limit: 1, windowMs: 1000 })).count).toBe(1);

    expect(store.hitRateBucket({ key: "b", limit: 1, windowMs: 1000, maxBuckets: 1 })).toMatchObject({
      ok: false,
      code: "SECURITY_STORE_UNAVAILABLE",
      reason: "capacity"
    });
  });
});

describe("security store: append-only events and cursors", () => {
  const event = (id: string, op = "op1") => ({
    eventId: id,
    operationId: op,
    phase: "decision" as const,
    actor: "alice",
    actorType: "admin"
  });

  it("appends events, rejects duplicates, and blocks UPDATE/DELETE at the database level", () => {
    const store = open();
    unwrap(store.appendEvent(event("e1")));
    expect(store.appendEvent(event("e1"))).toMatchObject({ ok: false, reason: "duplicate_event" });
    expect(unwrap(store.listEventsAfter(0)).map((e) => e.eventId)).toEqual(["e1"]);

    const raw = new Database(dbFile());
    try {
      expect(() => raw.prepare("UPDATE security_events SET actor = 'mallory'").run()).toThrow(/append-only/);
      expect(() => raw.prepare("DELETE FROM security_events").run()).toThrow(/append-only/);
    } finally {
      raw.close();
    }
  });

  it("projection cursor moves forward only and never beyond durable events", () => {
    const store = open();
    unwrap(store.appendEvent(event("e1")));
    unwrap(store.appendEvent(event("e2")));
    expect(unwrap(store.advanceProjectionCursor("audit", 2))).toBe(2);
    expect(unwrap(store.advanceProjectionCursor("audit", 1))).toBe(2);
    expect(store.advanceProjectionCursor("audit", 3)).toMatchObject({ ok: false, reason: "cursor_beyond_events" });
    expect(unwrap(store.getProjectionCursor("audit"))).toBe(2);
  });
});

describe("security store: fail-closed", () => {
  it("returns structured unavailable when the database is locked and does not report success", () => {
    const store = open({ busyTimeoutMs: 50 });
    unwrap(store.upsertAccount({ accountUid: "u1", displayId: "alice" }));

    const locker = new Database(dbFile());
    locker.exec("BEGIN IMMEDIATE");
    try {
      const result = store.upsertAccount({ accountUid: "u2", displayId: "bob" });
      expect(result).toMatchObject({ ok: false, code: "SECURITY_STORE_UNAVAILABLE", reason: "busy" });
    } finally {
      locker.exec("ROLLBACK");
      locker.close();
    }
    expect(unwrap(store.getAccount("u2"))).toBeNull();
  });

  it("returns unavailable after close instead of empty data", () => {
    const store = open();
    store.close();
    expect(store.getAccount("u1")).toMatchObject({ ok: false, code: "SECURITY_STORE_UNAVAILABLE", reason: "closed" });
    expect(store.consumeBootstrap("u1")).toMatchObject({ ok: false, reason: "closed" });
  });

  it("refuses a corrupt database without replacing or emptying it", async () => {
    await mkdir(path.join(root, ".ktx-ui"));
    await writeFile(dbFile(), "this is not a sqlite database, keep me for the operator");

    const result = openSecurityStore(root, { now });
    expect(result).toMatchObject({ ok: false, code: "SECURITY_STORE_UNAVAILABLE" });
    await expect(readFile(dbFile(), "utf8")).resolves.toBe("this is not a sqlite database, keep me for the operator");
  });

  it("refuses a database from a newer schema version", () => {
    open().close();
    const raw = new Database(dbFile());
    raw.pragma(`user_version = ${SECURITY_SCHEMA_VERSION + 5}`);
    raw.close();

    expect(openSecurityStore(root, { now })).toMatchObject({
      ok: false,
      code: "SECURITY_STORE_UNAVAILABLE",
      reason: "schema_unsupported"
    });
    const probe = new Database(dbFile(), { readonly: true });
    expect(probe.pragma("user_version", { simple: true })).toBe(SECURITY_SCHEMA_VERSION + 5);
    probe.close();
  });

  it("refuses a symlinked .ktx-ui or database file and creates nothing behind it", async () => {
    const elsewhere = await mkdtemp(path.join(os.tmpdir(), "lucy-security-elsewhere-"));
    try {
      await symlink(elsewhere, path.join(root, ".ktx-ui"));
      expect(openSecurityStore(root, { now })).toMatchObject({ ok: false, reason: "path_unsafe" });
      expect(existsSync(path.join(elsewhere, "security.sqlite"))).toBe(false);

      await rm(path.join(root, ".ktx-ui"));
      await mkdir(path.join(root, ".ktx-ui"));
      await writeFile(path.join(elsewhere, "target.sqlite"), "");
      await symlink(path.join(elsewhere, "target.sqlite"), dbFile());
      expect(openSecurityStore(root, { now })).toMatchObject({ ok: false, reason: "path_unsafe" });
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("returns unavailable when .ktx-ui is not a directory", async () => {
    await writeFile(path.join(root, ".ktx-ui"), "file");
    expect(openSecurityStore(root, { now })).toMatchObject({ ok: false, reason: "path_unsafe" });
  });

  it.skipIf(process.getuid?.() === 0)("returns unavailable on a read-only project root and creates no database", async () => {
    chmodSync(root, 0o500);
    try {
      const result = openSecurityStore(root, { now });
      expect(result).toMatchObject({ ok: false, code: "SECURITY_STORE_UNAVAILABLE" });
    } finally {
      chmodSync(root, 0o700);
    }
    expect(existsSync(path.join(root, ".ktx-ui"))).toBe(false);
  });
});
