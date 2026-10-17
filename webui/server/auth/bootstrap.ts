import { randomUUID } from "node:crypto";
import {
  ADMIN_ID_RE,
  AdminsConfigError,
  enabledAdmins,
  loadAdminsConfig,
  saveAdminsConfig,
  type AdminsConfig,
  type WebuiAdminRecord
} from "./admins-store.js";
import { checkBootstrapToken } from "./bootstrap-token.js";
import { resolveDeploymentMode } from "./deployment-mode.js";
import { assertPasswordPolicy, hashPassword } from "./password.js";
import { getSecurityStore, securityStoreExists } from "../security/instance.js";
import type { SecurityStore } from "../security/store.js";

const BOOTSTRAP_KIND = "admin_bootstrap";

export type BootstrapInput = {
  adminId: string;
  displayName: string;
  password: string;
  tokenHeader: string | string[] | undefined;
  requestId?: string;
};

export type BootstrapOutcome =
  | { ok: true; record: WebuiAdminRecord }
  | { ok: false; status: 400 | 401 | 409 | 503; code: string; message: string };

const fail = (status: 400 | 401 | 409 | 503, code: string, message: string): BootstrapOutcome => ({
  ok: false,
  status,
  code,
  message
});

const stateUnavailable = () =>
  fail(503, "AUTH_STATE_UNAVAILABLE", "认证状态暂不可用，请稍后重试或联系部署人员");

// In-process mutex. Spec §1.1: single replica, so a process-wide chain is the whole critical section.
let tail: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}

/**
 * Finish a bootstrap that crashed between "write admins" and "consume".
 * - Owner present on disk → consume the bootstrap and commit (never leaves a claimable window).
 * - No owner on disk → the effect never happened; abort so the (still unused) key can be used.
 * Returns false when the store or config could not be reconciled (callers fail closed).
 */
async function reconcilePending(store: SecurityStore): Promise<boolean> {
  const pending = store.listOperations("pending");
  if (!pending.ok) return false;
  const stale = pending.value.filter((op) => op.kind === BOOTSTRAP_KIND);
  if (stale.length === 0) return true;
  let config: AdminsConfig;
  try {
    config = await loadAdminsConfig({ fresh: true });
  } catch {
    return false;
  }
  const applied = enabledAdmins(config).length > 0;
  for (const op of stale) {
    if (!applied) {
      if (!store.abortOperation(op.operationId, "recovered: admins were never written", "recovery").ok) return false;
      continue;
    }
    const consumed = store.consumeBootstrap(config.admins[0].id);
    // "bootstrap_consumed" means a previous run already consumed it; anything else is a store failure.
    if (!consumed.ok && !(consumed.code === "SECURITY_CONFLICT" && consumed.reason === "bootstrap_consumed")) {
      return false;
    }
    if (!store.commitOperation(op.operationId, "recovery").ok) return false;
  }
  return true;
}

/** Run once at server start so an interrupted bootstrap is closed before anything can clear admins.yaml. */
export async function reconcileBootstrapOnStartup(): Promise<void> {
  if (!(await securityStoreExists())) return;
  await exclusive(async () => {
    const store = await getSecurityStore();
    if (store.ok) await reconcilePending(store.value);
  });
}

async function createOwner(store: SecurityStore, input: BootstrapInput, passwordHash: string): Promise<BootstrapOutcome> {
  const record: WebuiAdminRecord = {
    id: input.adminId,
    display_name: input.displayName,
    password_hash: passwordHash,
    role: "owner",
    enabled: true,
    created_at: new Date().toISOString()
  };
  const operationId = `bootstrap-${randomUUID()}`;
  const prepared = store.prepareOperation({
    operationId,
    kind: BOOTSTRAP_KIND,
    direction: "widen",
    actor: "bootstrap",
    actorType: "bootstrap"
  });
  if (!prepared.ok) return stateUnavailable();
  try {
    await saveAdminsConfig(
      { version: "1", admins: [record] },
      {
        changeType: "admin_bootstrap",
        actor: input.adminId,
        targetId: input.adminId,
        oldSummary: { count: 0 },
        newSummary: { count: 1, id: input.adminId, role: "owner" },
        requestId: input.requestId
      }
    );
  } catch (error) {
    store.abortOperation(operationId, "admins write failed");
    throw error;
  }
  // The owner exists now. If consume/commit fail the pending operation is reconciled on next start.
  if (!store.consumeBootstrap(input.adminId).ok) return stateUnavailable();
  if (!store.commitOperation(operationId).ok) return stateUnavailable();
  return { ok: true, record };
}

/**
 * Spec §3.1 items 3–4: fresh read → verify key → write owner → consume bootstrap → commit,
 * all inside one mutual-exclusion region, so a concurrent second request sees the finished
 * result and gets 409. Ordering of refusals: state/unavailable, already configured, consumed,
 * key, then request validation.
 */
export function runBootstrap(input: BootstrapInput): Promise<BootstrapOutcome> {
  return exclusive(async () => {
    const store = await getSecurityStore();
    if (!store.ok) return stateUnavailable();
    if (!(await reconcilePending(store.value))) return stateUnavailable();

    let config: AdminsConfig;
    try {
      config = await loadAdminsConfig({ fresh: true });
    } catch (error) {
      if (error instanceof AdminsConfigError) {
        return fail(503, "AUTH_CONFIG_UNAVAILABLE", "管理员配置不可用，请联系部署人员修复后重试");
      }
      throw error;
    }
    if (enabledAdmins(config).length > 0) {
      return fail(409, "ADMINS_ALREADY_CONFIGURED", "管理员已配置，请直接登录");
    }
    const state = store.value.getBootstrapState();
    if (!state.ok) return stateUnavailable();
    if (state.value.state === "consumed") {
      return fail(409, "BOOTSTRAP_CONSUMED", "首次引导已完成，不能再次创建首个所有者；如需恢复请由部署人员按维护流程处理");
    }

    if (resolveDeploymentMode() === "customer") {
      const tokenCheck = await checkBootstrapToken(input.tokenHeader);
      if (tokenCheck === "not_provisioned") {
        return fail(503, "BOOTSTRAP_NOT_PROVISIONED", "部署侧尚未配置引导密钥，暂不能创建首个所有者");
      }
      if (tokenCheck === "invalid") return fail(401, "BOOTSTRAP_TOKEN_INVALID", "引导密钥不正确");
    }

    if (!ADMIN_ID_RE.test(input.adminId)) {
      return fail(400, "ADMIN_ID_INVALID", "管理员 id 需为 2–32 位小写字母开头的字母数字/_/-");
    }
    try {
      assertPasswordPolicy(input.password);
    } catch (error) {
      return fail(400, "PASSWORD_TOO_SHORT", error instanceof Error ? error.message : "密码不符合要求");
    }
    return createOwner(store.value, input, await hashPassword(input.password));
  });
}
