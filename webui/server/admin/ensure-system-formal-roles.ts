/**
 * 客户默认系统正式 Role — 启动期缺则写入。
 *
 * 合同：docs/specs/lucy-20261105-customer-default-system-roles-spec.md §3。
 * 写前必须 `readAccessRecoveryState(projectRoot)` 再把该状态交给
 * `assertAccessWritesAllowed(state)`。禁止只调无参内存闸。
 * 恢复闸拒绝、解析失败、原子写失败都不抛到进程外，并保留原 access.yaml 字节。
 */

import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { assertAccessWritesAllowed, readAccessRecoveryState } from "../access-recovery.js";
import { OPS_EVIDENCE_FROZEN, OPS_EVIDENCE_ROLE_ID } from "../ops-evidence/contract.js";
import type { YamlRole } from "./access-config.js";
import { expandTemplate, LUCY_ADMIN_ROLE_ID, LUCY_ADMIN_TOOLS } from "./role-templates.js";

const ACCESS_YAML_REL = "webui/config/access.yaml";
const LOG = "system_ensure_formal_roles";

export interface EnsureFormalRoleResult {
  wrote: boolean;
  reason?: string;
  branch?: "A" | "B" | "C" | "D";
}

type AccessDoc = Record<string, unknown>;

function warnEnsure(message: string): void {
  console.warn(`[${LOG}] ${message}`);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is AccessDoc {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  const out: AccessDoc = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = canonicalize(value[key]);
  }
  return out;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

/** 恢复准入：完整状态读盘后再断言。抛错或 IO 不可判定都视为不可写。 */
export async function accessWritesAllowed(projectRoot: string): Promise<boolean> {
  try {
    const state = await readAccessRecoveryState(projectRoot);
    assertAccessWritesAllowed(state);
    return true;
  } catch (error) {
    warnEnsure(`access writes blocked: ${errorText(error)}`);
    return false;
  }
}

export function normativeLucyAdminRole(): YamlRole {
  const role = expandTemplate(LUCY_ADMIN_ROLE_ID);
  if (!role?.allow) throw new Error("lucy_admin template missing");
  delete (role as { id?: string }).id;
  return role;
}

export function normativeLucyOpsReaderRole(): YamlRole {
  const role = expandTemplate(OPS_EVIDENCE_ROLE_ID);
  if (!role?.allow?.tableSelectors || role.allow.tableSelectors.length !== 1) {
    throw new Error("lucy_ops_reader template missing");
  }
  const selector = role.allow.tableSelectors[0];
  if (!selector || !("names" in selector)) throw new Error("lucy_ops_reader names missing");
  selector.names = [...Object.values(OPS_EVIDENCE_FROZEN.sourceName)];
  if (role.allow.source_scope !== undefined) {
    throw new Error("lucy_ops_reader must not set source_scope");
  }
  delete (role as { id?: string }).id;
  return role;
}

function accessPath(projectRoot: string): string {
  return path.join(projectRoot, ACCESS_YAML_REL);
}

async function readAccessText(
  filePath: string
): Promise<{ ok: true; raw: string } | { ok: false; reason: string }> {
  try {
    return { ok: true, raw: await readFile(filePath, "utf8") };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ok: true, raw: "" };
    warnEnsure(`access.yaml unreadable: ${errorText(error)}`);
    return { ok: false, reason: "read_failed" };
  }
}

function parseAccessDoc(raw: string): { ok: true; doc: AccessDoc } | { ok: false } {
  try {
    const parsed = raw.trim().length === 0 ? {} : parse(raw);
    if (parsed == null) return { ok: true, doc: {} };
    if (!isRecord(parsed)) {
      warnEnsure("access.yaml root is not a map");
      return { ok: false };
    }
    return { ok: true, doc: parsed };
  } catch (error) {
    warnEnsure(`access.yaml parse failed: ${errorText(error)}`);
    return { ok: false };
  }
}

function rolesOf(doc: AccessDoc): AccessDoc | undefined {
  if (!Object.prototype.hasOwnProperty.call(doc, "roles")) return undefined;
  return isRecord(doc.roles) ? doc.roles : undefined;
}

function ensureRoles(doc: AccessDoc): AccessDoc | undefined {
  if (!Object.prototype.hasOwnProperty.call(doc, "roles")) {
    doc.roles = {};
  }
  return rolesOf(doc);
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${randomUUID()}`);
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, filePath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeIfChanged(
  filePath: string,
  before: AccessDoc,
  doc: AccessDoc,
  branch: "A" | "B" | "C",
  reason: string
): Promise<EnsureFormalRoleResult> {
  if (sameValue(before, doc)) {
    return { wrote: false, reason: "unchanged", branch: "D" };
  }
  const rendered = stringify(doc, { lineWidth: 0 });
  const content = rendered.endsWith("\n") ? rendered : `${rendered}\n`;
  try {
    await atomicWrite(filePath, content);
  } catch (error) {
    warnEnsure(`write failed (${branch}): ${errorText(error)}`);
    return { wrote: false, reason: "write_failed", branch: "D" };
  }
  return { wrote: true, reason, branch };
}

function denied(): EnsureFormalRoleResult {
  return { wrote: false, reason: "recovery_denied", branch: "D" };
}

function invalid(message: string): EnsureFormalRoleResult {
  warnEnsure(message);
  return { wrote: false, reason: "invalid_role", branch: "D" };
}

export async function ensureLucyAdminFormalRole(input: {
  projectRoot: string;
}): Promise<EnsureFormalRoleResult> {
  const result = await ensureLucyAdminFormalRoleUnlogged(input);
  console.log(`[${LOG}] lucy_admin wrote=${result.wrote} branch=${result.branch ?? "-"}`);
  return result;
}

async function ensureLucyAdminFormalRoleUnlogged(input: {
  projectRoot: string;
}): Promise<EnsureFormalRoleResult> {
  try {
    if (!(await accessWritesAllowed(input.projectRoot))) return denied();
    const filePath = accessPath(input.projectRoot);
    const read = await readAccessText(filePath);
    if (!read.ok) return { wrote: false, reason: read.reason, branch: "D" };
    const parsed = parseAccessDoc(read.raw);
    if (!parsed.ok) return { wrote: false, reason: "parse_failed", branch: "D" };

    const before = structuredClone(parsed.doc);
    const roles = ensureRoles(parsed.doc);
    if (!roles) return invalid("access.yaml roles is not a map; lucy_admin was not written");

    const existing = roles[LUCY_ADMIN_ROLE_ID];
    if (existing === undefined) {
      const normative = normativeLucyAdminRole();
      if (!sameValue(normative, expandTemplate(LUCY_ADMIN_ROLE_ID))) {
        return invalid("lucy_admin normative block drifted from the template; not written");
      }
      roles[LUCY_ADMIN_ROLE_ID] = normative;
      return await writeIfChanged(filePath, before, parsed.doc, "A", "created");
    }

    if (!isRecord(existing)) {
      return invalid("existing lucy_admin is not a map; left unchanged");
    }
    const allow = existing.allow;
    if (!isRecord(allow)) {
      return invalid("existing lucy_admin.allow is not a map; left unchanged");
    }
    const originalTools = allow.tools;
    if (originalTools !== undefined && !Array.isArray(originalTools)) {
      return invalid("existing lucy_admin.allow.tools is not a list; left unchanged");
    }
    if (Array.isArray(originalTools) && originalTools.some((tool) => typeof tool !== "string")) {
      return invalid("existing lucy_admin.allow.tools contains a non-string; left unchanged");
    }

    const tools = Array.isArray(originalTools) ? originalTools : [];
    if (!Array.isArray(originalTools)) allow.tools = tools;
    const present = new Set(tools);
    for (const tool of LUCY_ADMIN_TOOLS) {
      if (present.has(tool)) continue;
      tools.push(tool);
      present.add(tool);
    }
    return await writeIfChanged(filePath, before, parsed.doc, "B", "tools_appended");
  } catch (error) {
    warnEnsure(`lucy_admin ensure failed: ${errorText(error)}`);
    return { wrote: false, reason: "write_failed", branch: "D" };
  }
}

export async function ensureLucyOpsReaderFormalRole(input: {
  projectRoot: string;
}): Promise<EnsureFormalRoleResult> {
  const result = await ensureLucyOpsReaderFormalRoleUnlogged(input);
  console.log(`[${LOG}] lucy_ops_reader wrote=${result.wrote} branch=${result.branch ?? "-"}`);
  return result;
}

async function ensureLucyOpsReaderFormalRoleUnlogged(input: {
  projectRoot: string;
}): Promise<EnsureFormalRoleResult> {
  try {
    if (!(await accessWritesAllowed(input.projectRoot))) return denied();
    const filePath = accessPath(input.projectRoot);
    const read = await readAccessText(filePath);
    if (!read.ok) return { wrote: false, reason: read.reason, branch: "D" };
    const parsed = parseAccessDoc(read.raw);
    if (!parsed.ok) return { wrote: false, reason: "parse_failed", branch: "D" };

    const before = structuredClone(parsed.doc);
    const roles = ensureRoles(parsed.doc);
    if (!roles) return invalid("access.yaml roles is not a map; lucy_ops_reader was not written");
    if (Object.prototype.hasOwnProperty.call(roles, OPS_EVIDENCE_ROLE_ID)) {
      return { wrote: false, reason: "exists", branch: "D" };
    }

    const normative = normativeLucyOpsReaderRole();
    if (normative.allow?.source_scope !== undefined) {
      return invalid("lucy_ops_reader normative block set source_scope; not written");
    }
    if (!sameValue(normative, expandTemplate(OPS_EVIDENCE_ROLE_ID))) {
      return invalid("lucy_ops_reader normative block drifted from the frozen template; not written");
    }
    roles[OPS_EVIDENCE_ROLE_ID] = normative;
    return await writeIfChanged(filePath, before, parsed.doc, "C", "created");
  } catch (error) {
    warnEnsure(`lucy_ops_reader ensure failed: ${errorText(error)}`);
    return { wrote: false, reason: "write_failed", branch: "D" };
  }
}
