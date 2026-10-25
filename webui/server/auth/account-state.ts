import { createHash, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  findAdmin,
  findAdminByUid,
  loadAdminsConfig,
  saveAdminsConfig,
  type WebuiAdminRecord
} from "./admins-store.js";
import {
  newSessionJti,
  parseSessionClaims,
  readSessionClaims,
  sealSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SessionKeyError,
  type SessionClaims
} from "./session.js";
import { getSecurityStore } from "../security/instance.js";
import { hashSessionJti, type SecurityStore } from "../security/store.js";
import type { SecurityFailure } from "../security/types.js";

/**
 * Durable admin session + account state (Spec §3.2, §2 admin_account_state / admin_sessions).
 *
 * Every protected request consults the security store and a fresh read of admins.yaml;
 * the 5-second admins display cache is never used for a security decision.
 * Any store failure is `unavailable` (503), never "not logged in" and never "allowed".
 */

/** `lastSeenAt` is refreshed at most this often, so a busy session does not fsync on every request. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export type AuthState =
  | { kind: "none" }
  | { kind: "unavailable" }
  | { kind: "ok"; claims: SessionClaims; admin: WebuiAdminRecord };

async function openStore(): Promise<SecurityStore | null> {
  const store = await getSecurityStore();
  return store.ok ? store.value : null;
}

/** Resolve the request cookie to a live session and a currently enabled account. */
export async function authenticateSession(request: FastifyRequest): Promise<AuthState> {
  let claims: SessionClaims | null;
  try {
    claims = await readSessionClaims(request);
  } catch (error) {
    if (error instanceof SessionKeyError) return { kind: "unavailable" };
    throw error;
  }
  if (!claims) return { kind: "none" };

  const store = await openStore();
  if (!store) return { kind: "unavailable" };
  const jtiHash = hashSessionJti(claims.jti);
  const validation = store.validateSession(jtiHash);
  if (!validation.ok) return { kind: "unavailable" };
  if (!validation.value.valid) return { kind: "none" };

  const session = validation.value.session;
  if (session.accountUid !== claims.uid || session.issuedEpoch !== claims.ep) return { kind: "none" };

  const now = Date.now();
  if (now - session.lastSeenAt >= SESSION_IDLE_MS) {
    // Idle expiry is final: revoke so a later clock change cannot revive the cookie.
    return store.revokeSession(jtiHash).ok ? { kind: "none" } : { kind: "unavailable" };
  }

  let admin: WebuiAdminRecord | undefined;
  try {
    admin = findAdminByUid(await loadAdminsConfig({ fresh: true }), claims.uid);
  } catch {
    return { kind: "none" }; // corrupt/unreadable admins config: nobody is authenticated (fail closed)
  }
  if (!admin || !admin.enabled) return { kind: "none" };

  if (now - session.lastSeenAt >= TOUCH_INTERVAL_MS && !store.touchSession(jtiHash).ok) {
    return { kind: "unavailable" };
  }
  return { kind: "ok", claims, admin };
}

export type IssueOutcome =
  | { ok: true; token: string; exp: number }
  | { ok: false; status: 401 | 503 };

/** Local password is the only credential v2.0 can fingerprint. */
export type LocalPasswordCredential = {
  kind: "local_password";
  passwordHash: string;
};

export type IssueSessionInput = {
  credential?: LocalPasswordCredential;
  /**
   * Reserved for a future identity-provider logout hint.
   * The security store stays on schema v1, so this value is not persisted and is never sealed into the v2 cookie.
   */
  logoutHint?: string;
};

const credentialFingerprint = (passwordHash: string) =>
  createHash("sha256").update(passwordHash).digest("hex").slice(0, 32);

function localPasswordHash(admin: WebuiAdminRecord, input: IssueSessionInput): string | undefined {
  if (input.credential?.kind === "local_password") return input.credential.passwordHash;
  return admin.password_hash;
}

/** Persist a new session row (and the account row if needed), then sign the cookie that points at it. */
export async function issueSession(admin: WebuiAdminRecord, input: IssueSessionInput = {}): Promise<IssueOutcome> {
  const accountUid = admin.account_uid;
  if (!accountUid) return { ok: false, status: 503 };
  const store = await openStore();
  if (!store) return { ok: false, status: 503 };

  const passwordHash = localPasswordHash(admin, input);
  // logoutHint stays off the cookie and out of schema v1. v2.5 can persist it on admin_sessions.
  void input.logoutHint;
  const account = store.upsertAccount({
    accountUid,
    displayId: admin.id,
    ...(passwordHash ? { credentialFingerprint: credentialFingerprint(passwordHash) } : {})
  });
  if (!account.ok) return refusal(account);

  const jti = newSessionJti();
  const jtiHash = hashSessionJti(jti);
  const absoluteExpiry = Date.now() + SESSION_ABSOLUTE_MS;
  const created = store.createSession({ jtiHash, accountUid, absoluteExpiry });
  if (!created.ok) return refusal(created);

  try {
    const exp = Math.floor(absoluteExpiry / 1000);
    const token = await sealSession({
      v: 2,
      jti,
      uid: accountUid,
      ep: created.value.issuedEpoch,
      iat: Math.floor(Date.now() / 1000),
      exp
    });
    return { ok: true, token, exp };
  } catch (error) {
    store.revokeSession(jtiHash);
    if (error instanceof SessionKeyError) return { ok: false, status: 503 };
    throw error;
  }
}

/**
 * Revokes a session that was issued but never delivered to a browser.
 *
 * Spec §6.2: when the durable login event cannot be written, the session that
 * was already persisted must not survive in the ledger.
 */
export async function revokeUndeliveredSession(token: string): Promise<boolean> {
  let claims: SessionClaims | null;
  try {
    claims = await parseSessionClaims(token);
  } catch {
    return false;
  }
  if (!claims) return false;
  const store = await openStore();
  if (!store) return false;
  return store.revokeSession(hashSessionJti(claims.jti)).ok;
}

/** A tombstoned/disabled account is a refused login (401); everything else is store unavailability. */
function refusal(result: SecurityFailure): { ok: false; status: 401 | 503 } {
  return { ok: false, status: result.code === "SECURITY_CONFLICT" ? 401 : 503 };
}

export type LogoutOutcome = "revoked" | "none" | "unavailable";

/** Durably revoke the presented session. The caller may only clear the cookie after `revoked`/`none`. */
export async function revokeRequestSession(request: FastifyRequest): Promise<LogoutOutcome> {
  let claims: SessionClaims | null;
  try {
    claims = await readSessionClaims(request);
  } catch (error) {
    if (error instanceof SessionKeyError) return "none"; // no session can have been verified under an unusable key
    throw error;
  }
  if (!claims) return "none";
  const store = await openStore();
  if (!store) return "unavailable";
  return store.revokeSession(hashSessionJti(claims.jti)).ok ? "revoked" : "unavailable";
}

// ---- account lifecycle: narrow first, then write config -------------------

export type NarrowKind = "revoke_sessions" | "disable" | "tombstone";

/**
 * Called BEFORE admins.yaml is written (Spec §3.2): raises the epoch / disables / tombstones the
 * account so old sessions are dead even if the later config write fails.
 * Returns false when the store cannot record it; the caller must refuse the change (503).
 */
export async function narrowAccount(admin: WebuiAdminRecord, kind: NarrowKind): Promise<boolean> {
  const accountUid = admin.account_uid;
  if (!accountUid) return true; // never logged in → no session can exist for it
  const store = await openStore();
  if (!store) return false;
  if (!store.upsertAccount({ accountUid, displayId: admin.id }).ok) return false;
  if (kind === "disable") return store.setAccountStatus(accountUid, "disabled").ok;
  if (kind === "tombstone") return store.tombstoneAccount(accountUid).ok;
  return store.bumpSessionEpoch(accountUid).ok;
}

/** Called AFTER the config write that enables an account; enabling never revives old sessions. */
export async function enableAccount(admin: WebuiAdminRecord): Promise<boolean> {
  const accountUid = admin.account_uid;
  if (!accountUid) return true;
  const store = await openStore();
  if (!store) return false;
  if (!store.upsertAccount({ accountUid, displayId: admin.id }).ok) return false;
  return store.setAccountStatus(accountUid, "enabled").ok;
}

// ---- legacy uid migration -------------------------------------------------

let migrationTail: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = migrationTail.then(fn, fn);
  migrationTail = run.catch(() => undefined);
  return run;
}

/**
 * Controlled, audited migration: give a legacy account its immutable `account_uid` (once).
 * Serialized so concurrent first logins cannot assign two different uids.
 */
export function ensureAccountUid(adminId: string): Promise<WebuiAdminRecord | null> {
  return exclusive(async () => {
    const config = await loadAdminsConfig({ fresh: true });
    const found = findAdmin(config, adminId);
    if (!found || found.account_uid) return found ?? null;
    const migrated: WebuiAdminRecord = { ...found, account_uid: randomUUID() };
    await saveAdminsConfig(
      { ...config, admins: config.admins.map((a) => (a.id === adminId ? migrated : a)) },
      {
        changeType: "admin_uid_migrate",
        actor: "system",
        targetId: adminId,
        oldSummary: { id: adminId, hasAccountUid: false },
        newSummary: { id: adminId, hasAccountUid: true }
      }
    );
    return migrated;
  });
}
