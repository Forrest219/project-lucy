/**
 * CompatConfigProfile — apply / backup / restore + fingerprint (P1-54 Wave A1).
 *
 * Authority:
 *   docs/specs/lucy-20261118-mcp-upgrade-question-bank-spec.md §0 / §3
 *   docs/plans/lucy-20261118-mcp-upgrade-question-bank-plan.md step 1
 *
 * Public API for the P1-53 runner (consume only; do not re-implement fingerprint):
 *
 *   loadCompatConfigProfile([profilePath]) -> profile object
 *   computeConfigProfileFingerprint(profile) -> `sha256:<hex>`
 *   backupCompatConfigFiles({ projectRoot, backupDir }) -> backup handle
 *   applyCompatConfigProfile({ projectRoot, profile?, profilePath?, backupDir? })
 *     -> { status: "READY"|"BLOCKED", fingerprint, backup, appliedRoleIds, problems }
 *   restoreCompatConfigProfile(backup)
 *     -> void; throws CompatConfigRestoreError on failure — caller MUST stop subsequent cases
 *
 * Filesystem apply pattern (same family as upgrade-fixture / UAT access.yaml backups):
 *   - backup `webui/config/access.yaml` (+ `ktx.yaml` when W1/W2 enabled_tables are extended)
 *   - merge fixture roles into access.yaml; never rewrite product Role bytes for deny carriers
 *   - dual-connection fixture forbids lucy_admin / connections:["*"]
 *   - frozen W0-only Role is NEVER lucy_ops_reader
 *
 * Secrets: Token plaintext / passwords stay on protected paths; this module never writes them.
 */

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as yamlStringify } from "yaml";

import { REPO_ROOT } from "./common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_COMPAT_CONFIG_PROFILE_PATH = path.join(
  HERE,
  "..",
  "contracts",
  "mcp-compat-config-profile.yaml",
);

export const CONFIG_PROFILE_ID = "lucy-mcp-compat-demo";
export const CONFIG_PROFILE_VERSION = 1;

export const FROZEN_W0_ROLE_ID = "compat_fixture_frozen_w0_only";
export const DUAL_READONLY_ROLE_ID = "compat_fixture_dual_readonly";
export const NO_QUERY_ROLE_ID = "compat_fixture_no_lucy_query";
export const PRODUCT_OPS_READER_ROLE_ID = "lucy_ops_reader";
export const FORBIDDEN_ADMIN_ROLE_ID = "lucy_admin";

const ACCESS_REL = path.join("webui", "config", "access.yaml");
const KTX_REL = "ktx.yaml";

export class CompatConfigRestoreError extends Error {
  /**
   * @param {string} message
   * @param {{ stage?: string, problems?: string[] }} [detail]
   */
  constructor(message, detail = {}) {
    super(message);
    this.name = "CompatConfigRestoreError";
    this.stage = detail.stage ?? "restore";
    this.problems = detail.problems ?? [message];
  }
}

export class CompatConfigApplyError extends Error {
  /**
   * @param {string} message
   * @param {{ problems?: string[] }} [detail]
   */
  constructor(message, detail = {}) {
    super(message);
    this.name = "CompatConfigApplyError";
    this.problems = detail.problems ?? [message];
  }
}

/**
 * Stable JSON for fingerprinting: sorted object keys; arrays keep order.
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

/**
 * @param {string} [profilePath]
 * @returns {object}
 */
export function loadCompatConfigProfile(profilePath = DEFAULT_COMPAT_CONFIG_PROFILE_PATH) {
  const absolute = path.isAbsolute(profilePath) ? profilePath : path.join(REPO_ROOT, profilePath);
  if (!existsSync(absolute)) {
    throw new CompatConfigApplyError(`CompatConfigProfile missing: ${absolute}`, {
      problems: [`missing profile file: ${absolute}`],
    });
  }
  const raw = readFileSync(absolute, "utf8");
  const profile = parseYaml(raw);
  if (!profile || typeof profile !== "object") {
    throw new CompatConfigApplyError("CompatConfigProfile is not a mapping", {
      problems: ["profile root must be a YAML mapping"],
    });
  }
  return profile;
}

/**
 * Fingerprint of the non-secret profile contract (id / version / connections /
 * roles / source allowlists / constraints / govFilterRules). Paths and secrets
 * are excluded by construction of the contract YAML.
 *
 * @param {object} profile
 * @returns {string} `sha256:<hex>`
 */
export function computeConfigProfileFingerprint(profile) {
  if (!profile || typeof profile !== "object") {
    throw new CompatConfigApplyError("computeConfigProfileFingerprint requires a profile object");
  }
  const payload = {
    configProfileId: profile.configProfileId,
    version: profile.version,
    connections: profile.connections,
    productRoles: profile.productRoles,
    fixtureRoles: profile.fixtureRoles,
    sources: profile.sources,
    constraints: profile.constraints,
    govFilterRules: profile.govFilterRules,
    lifecycle: profile.lifecycle,
  };
  const digest = createHash("sha256").update(stableStringify(payload)).digest("hex");
  return `sha256:${digest}`;
}

/**
 * Validate profile shape for apply gates (no admin dual-conn; frozen ≠ ops reader).
 * @param {object} profile
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function validateCompatConfigProfile(profile) {
  const problems = [];
  if (profile.configProfileId !== CONFIG_PROFILE_ID) {
    problems.push(`configProfileId must be ${CONFIG_PROFILE_ID}, got ${JSON.stringify(profile.configProfileId)}`);
  }
  if (profile.version !== CONFIG_PROFILE_VERSION) {
    problems.push(`version must be ${CONFIG_PROFILE_VERSION}, got ${JSON.stringify(profile.version)}`);
  }
  const connections = profile.connections ?? [];
  if (!connections.includes("demo-mysql") || !connections.includes("lucy-ops")) {
    problems.push('connections must include "demo-mysql" and "lucy-ops"');
  }

  const fixtures = profile.fixtureRoles ?? {};
  if (!fixtures[FROZEN_W0_ROLE_ID]) {
    problems.push(`missing frozen W0 fixture role ${FROZEN_W0_ROLE_ID}`);
  } else {
    if (FROZEN_W0_ROLE_ID === PRODUCT_OPS_READER_ROLE_ID) {
      problems.push("frozen W0 role id collides with lucy_ops_reader");
    }
    if (fixtures[FROZEN_W0_ROLE_ID].permanentDenyCarrier !== true) {
      problems.push(`${FROZEN_W0_ROLE_ID} must set permanentDenyCarrier: true`);
    }
  }

  const forbidCarrier = profile.constraints?.permanentDenyCarrierMustNotBe ?? PRODUCT_OPS_READER_ROLE_ID;
  if (forbidCarrier !== PRODUCT_OPS_READER_ROLE_ID) {
    problems.push(`permanentDenyCarrierMustNotBe must be ${PRODUCT_OPS_READER_ROLE_ID}`);
  }
  if (Object.prototype.hasOwnProperty.call(fixtures, PRODUCT_OPS_READER_ROLE_ID)) {
    problems.push("fixtureRoles must not redefine lucy_ops_reader as a fixture deny carrier");
  }

  const dual = fixtures[DUAL_READONLY_ROLE_ID];
  if (!dual) {
    problems.push(`missing dual-connection fixture ${DUAL_READONLY_ROLE_ID}`);
  } else {
    const allow = dual.allow ?? {};
    const dualConnections = allow.connections ?? [];
    if (dualConnections.includes("*") || dualConnections.includes(FORBIDDEN_ADMIN_ROLE_ID)) {
      problems.push("dual-connection fixture must not use connections:['*'] or lucy_admin");
    }
    const sorted = [...dualConnections].sort();
    if (sorted.join(",") !== ["demo-mysql", "lucy-ops"].sort().join(",")) {
      problems.push("dual-connection fixture connections must be exactly demo-mysql + lucy-ops");
    }
    if (dual.forbidAdmin !== true) {
      problems.push(`${DUAL_READONLY_ROLE_ID} must set forbidAdmin: true`);
    }
  }

  const forbidRoles = profile.constraints?.dualConnectionForbidRoles ?? [];
  if (!forbidRoles.includes(FORBIDDEN_ADMIN_ROLE_ID)) {
    problems.push('constraints.dualConnectionForbidRoles must include "lucy_admin"');
  }

  for (const roleId of Object.keys(fixtures)) {
    if (roleId === FORBIDDEN_ADMIN_ROLE_ID) {
      problems.push("fixtureRoles must not include lucy_admin");
    }
    const tools = fixtures[roleId]?.allow?.tools ?? [];
    if (roleId === NO_QUERY_ROLE_ID && tools.includes("lucy_query")) {
      problems.push(`${NO_QUERY_ROLE_ID} must not allow lucy_query`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Backup mutable project files before apply.
 *
 * @param {{ projectRoot: string, backupDir: string }} args
 * @returns {{ backupDir: string, files: Array<{ relative: string, present: boolean }> }}
 */
export function backupCompatConfigFiles({ projectRoot, backupDir }) {
  if (!projectRoot || !backupDir) {
    throw new CompatConfigApplyError("backupCompatConfigFiles requires projectRoot and backupDir");
  }
  mkdirSync(backupDir, { recursive: true });
  const files = [];
  for (const relative of [ACCESS_REL, KTX_REL]) {
    const source = path.join(projectRoot, relative);
    const dest = path.join(backupDir, relative);
    mkdirSync(path.dirname(dest), { recursive: true });
    const present = existsSync(source);
    if (present) {
      copyFileSync(source, dest);
    } else {
      // Marker so restore knows the file was absent.
      writeFileSync(`${dest}.absent`, "1", "utf8");
    }
    files.push({ relative, present });
  }
  writeFileSync(
    path.join(backupDir, "backup-manifest.json"),
    JSON.stringify({ contract: "lucy-mcp-compat-backup-v1", files }, null, 2),
    "utf8",
  );
  return { backupDir, files };
}

/**
 * @param {object} accessDoc
 * @param {object} profile
 * @returns {object}
 */
function mergeFixtureRoles(accessDoc, profile) {
  const next = { ...(accessDoc ?? {}) };
  const roles = { ...(next.roles ?? {}) };
  for (const [roleId, fixture] of Object.entries(profile.fixtureRoles ?? {})) {
    const allow = fixture.allow ?? {};
    const roleBody = {
      description: `MCP compat fixture: ${fixture.purpose ?? roleId}`,
      allow: {
        connections: [...(allow.connections ?? [])],
        tableSelectors: structuredClone(allow.tableSelectors ?? []),
        tools: [...(allow.tools ?? [])],
      },
    };
    if (allow.permission_model_version != null) {
      roleBody.permission_model_version = allow.permission_model_version;
    } else if (
      allow.tableSelectors?.some(
        (sel) =>
          sel &&
          (sel.row_access === "scoped" ||
            typeof sel.row_access === "object" ||
            sel.row_policy != null)
      )
    ) {
      roleBody.permission_model_version = 2;
    }
    roles[roleId] = roleBody;
  }
  next.roles = roles;
  return next;
}

/**
 * Extend lucy-ops enabled_tables for W1/W2 when ktx.yaml is present.
 * @param {object} ktxDoc
 * @param {object} profile
 * @returns {object}
 */
function extendOpsEnabledTables(ktxDoc, profile) {
  const next = structuredClone(ktxDoc ?? { connections: {} });
  next.connections = next.connections ?? {};
  const ops = next.connections["lucy-ops"] ?? { driver: "sqlite", schemas: ["main"] };
  const sources = profile.sources?.["lucy-ops"] ?? {};
  const required = [
    ...(sources.w0 ?? []),
    ...(sources.w1 ?? []),
    ...(sources.w2 ?? []),
  ];
  const existing = new Set(ops.enabled_tables ?? []);
  for (const name of required) {
    // Prefer bare names (lucy-ops SQLite catalog); also accept main.<name> if already present.
    if (![...existing].some((entry) => entry === name || entry === `main.${name}` || entry.endsWith(`.${name}`))) {
      existing.add(name);
    }
  }
  ops.enabled_tables = [...existing].sort();
  next.connections["lucy-ops"] = ops;
  return next;
}

/**
 * Apply CompatConfigProfile to a Lucy project root (filesystem).
 *
 * @param {{
 *   projectRoot: string,
 *   profile?: object,
 *   profilePath?: string,
 *   backupDir?: string,
 * }} args
 * @returns {{
 *   status: "READY"|"BLOCKED",
 *   fingerprint: string|null,
 *   backup: object|null,
 *   appliedRoleIds: string[],
 *   problems: string[],
 * }}
 */
export function applyCompatConfigProfile({
  projectRoot,
  profile: profileArg,
  profilePath,
  backupDir,
} = {}) {
  const problems = [];
  if (!projectRoot) {
    return {
      status: "BLOCKED",
      fingerprint: null,
      backup: null,
      appliedRoleIds: [],
      problems: ["projectRoot is required"],
    };
  }

  let profile;
  try {
    profile = profileArg ?? loadCompatConfigProfile(profilePath);
  } catch (error) {
    return {
      status: "BLOCKED",
      fingerprint: null,
      backup: null,
      appliedRoleIds: [],
      problems: [error?.message ?? String(error)],
    };
  }

  const validated = validateCompatConfigProfile(profile);
  if (!validated.ok) {
    return {
      status: "BLOCKED",
      fingerprint: null,
      backup: null,
      appliedRoleIds: [],
      problems: validated.problems,
    };
  }

  const fingerprint = computeConfigProfileFingerprint(profile);
  const resolvedBackupDir =
    backupDir ??
    path.join(projectRoot, ".lucy-mcp-compat-backup", String(Date.now()));

  let backup;
  try {
    backup = backupCompatConfigFiles({ projectRoot, backupDir: resolvedBackupDir });
  } catch (error) {
    return {
      status: "BLOCKED",
      fingerprint,
      backup: null,
      appliedRoleIds: [],
      problems: [`backup failed: ${error?.message ?? String(error)}`],
    };
  }

  const accessPath = path.join(projectRoot, ACCESS_REL);
  mkdirSync(path.dirname(accessPath), { recursive: true });
  const accessDoc = existsSync(accessPath)
    ? parseYaml(readFileSync(accessPath, "utf8")) ?? {}
    : { roles: {}, users: [], defaults: { deny_tools: [] } };

  // Never turn product lucy_ops_reader into the permanent deny carrier.
  if (accessDoc.roles?.[PRODUCT_OPS_READER_ROLE_ID] && FROZEN_W0_ROLE_ID === PRODUCT_OPS_READER_ROLE_ID) {
    problems.push("refusing to overwrite lucy_ops_reader as frozen deny carrier");
  }

  const merged = mergeFixtureRoles(accessDoc, profile);
  const dualRole = merged.roles?.[DUAL_READONLY_ROLE_ID];
  if (dualRole?.allow?.connections?.includes("*")) {
    problems.push("applied dual-connection role must not grant connections:['*']");
  }
  if (merged.roles?.[FORBIDDEN_ADMIN_ROLE_ID] && Object.keys(profile.fixtureRoles ?? {}).includes(FORBIDDEN_ADMIN_ROLE_ID)) {
    problems.push("apply must not introduce lucy_admin as a fixture");
  }

  if (problems.length > 0) {
    return {
      status: "BLOCKED",
      fingerprint,
      backup,
      appliedRoleIds: [],
      problems,
    };
  }

  const tmpAccess = `${accessPath}.compat-tmp`;
  writeFileSync(tmpAccess, yamlStringify(merged, { aliasDuplicateObjects: false }), "utf8");
  renameSync(tmpAccess, accessPath);

  const ktxPath = path.join(projectRoot, KTX_REL);
  if (existsSync(ktxPath)) {
    const ktxDoc = parseYaml(readFileSync(ktxPath, "utf8")) ?? {};
    const extended = extendOpsEnabledTables(ktxDoc, profile);
    const tmpKtx = `${ktxPath}.compat-tmp`;
    writeFileSync(tmpKtx, yamlStringify(extended, { aliasDuplicateObjects: false }), "utf8");
    renameSync(tmpKtx, ktxPath);
  }

  const appliedRoleIds = Object.keys(profile.fixtureRoles ?? {}).sort();
  return {
    status: "READY",
    fingerprint,
    backup: { ...backup, fingerprint, configProfileId: profile.configProfileId, version: profile.version },
    appliedRoleIds,
    problems: [],
  };
}

/**
 * Restore files from a backup handle. Failure throws CompatConfigRestoreError —
 * callers (P1-53 runner) MUST treat that as FAIL and stop subsequent cases.
 *
 * @param {{ backupDir: string, files?: Array<{ relative: string, present: boolean }>, projectRoot?: string }} backup
 * @param {{ projectRoot?: string }} [options]
 */
export function restoreCompatConfigProfile(backup, options = {}) {
  if (!backup?.backupDir) {
    throw new CompatConfigRestoreError("restoreCompatConfigProfile requires backup.backupDir", {
      stage: "restore",
      problems: ["missing backup.backupDir"],
    });
  }
  if (!existsSync(backup.backupDir)) {
    throw new CompatConfigRestoreError(`backup directory missing: ${backup.backupDir}`, {
      stage: "restore",
      problems: [`backup directory missing: ${backup.backupDir}`],
    });
  }

  let files = backup.files;
  const manifestPath = path.join(backup.backupDir, "backup-manifest.json");
  if (!files && existsSync(manifestPath)) {
    try {
      files = JSON.parse(readFileSync(manifestPath, "utf8")).files;
    } catch (error) {
      throw new CompatConfigRestoreError(`backup manifest unreadable: ${error?.message ?? String(error)}`, {
        stage: "restore",
        problems: ["backup-manifest.json unreadable"],
      });
    }
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new CompatConfigRestoreError("backup has no file list", {
      stage: "restore",
      problems: ["backup.files / backup-manifest.json missing"],
    });
  }

  const projectRoot = options.projectRoot ?? backup.projectRoot;
  if (!projectRoot) {
    // Infer: backupDir is typically under projectRoot/.lucy-mcp-compat-backup/<ts>
    // Callers should pass projectRoot; when absent, require backup.projectRoot.
    throw new CompatConfigRestoreError("restore requires projectRoot (options.projectRoot or backup.projectRoot)", {
      stage: "restore",
      problems: ["projectRoot missing for restore"],
    });
  }

  const problems = [];
  for (const entry of files) {
    const relative = entry.relative;
    const dest = path.join(projectRoot, relative);
    const source = path.join(backup.backupDir, relative);
    const absentMarker = `${source}.absent`;
    try {
      if (entry.present === false || existsSync(absentMarker)) {
        rmSync(dest, { force: true });
        continue;
      }
      if (!existsSync(source)) {
        problems.push(`backup blob missing for ${relative}`);
        continue;
      }
      mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.compat-restore-tmp`;
      copyFileSync(source, tmp);
      renameSync(tmp, dest);
    } catch (error) {
      problems.push(`${relative}: ${error?.message ?? String(error)}`);
    }
  }

  if (problems.length > 0) {
    throw new CompatConfigRestoreError(`fixture restore failure: ${problems.join("; ")}`, {
      stage: "restore",
      problems,
    });
  }
}

/**
 * Convenience: apply → run → restore; restore failure propagates (stops cases).
 *
 * @template T
 * @param {{ projectRoot: string, profile?: object, profilePath?: string, backupDir?: string }} args
 * @param {(ctx: { fingerprint: string, backup: object, appliedRoleIds: string[] }) => T|Promise<T>} action
 * @returns {Promise<T>}
 */
export async function withCompatConfigProfile(args, action) {
  const applied = applyCompatConfigProfile(args);
  if (applied.status !== "READY") {
    throw new CompatConfigApplyError(
      `CompatConfigProfile apply BLOCKED: ${applied.problems.join("; ")}`,
      { problems: applied.problems },
    );
  }
  try {
    return await action({
      fingerprint: applied.fingerprint,
      backup: { ...applied.backup, projectRoot: args.projectRoot },
      appliedRoleIds: applied.appliedRoleIds,
    });
  } finally {
    restoreCompatConfigProfile(
      { ...applied.backup, projectRoot: args.projectRoot },
      { projectRoot: args.projectRoot },
    );
  }
}
