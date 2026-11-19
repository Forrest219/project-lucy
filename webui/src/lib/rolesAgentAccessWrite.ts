import { ApiError, GATEWAY_UNAVAILABLE } from "./apiClient";
import { apiGet } from "./apiClient";
import type { AccessWriteAck } from "./types";

/** Object-version dryRun / write binding (P1-59 RACS). */
export type RacsPreviewBinding = {
  baseObjectVersion: string;
  previewToken: string;
  compileInputsDigest?: string;
};

export type AccessWriteStatusOutcome = "committed" | "not_committed" | "unknown";

export type AccessWriteStatusResult = {
  operationId: string;
  outcome: AccessWriteStatusOutcome;
  objectKind?: "role" | "agent";
  objectId?: string;
  committedObjectVersion?: string;
  committedConfigDigest?: string;
  disclosure?: string;
};

export type RolesAgentWriteErrorKind =
  | "conflict_object_version"
  | "conflict_target_changed"
  | "preview_input_changed"
  | "publish_busy"
  | "auth"
  | "rate_limited"
  | "transport_uncertain"
  | "write_terminal_failure"
  | "other";

export type ClassifiedRolesAgentWriteError = {
  kind: RolesAgentWriteErrorKind;
  userMessage: string;
  code?: string;
  detail?: unknown;
  /** HTTP-layer meta for diagnostics (not primary user copy). */
  requestId?: string;
  operationId?: string;
};

export const RACS_STATUS_POLL_MAX_ATTEMPTS = 3;
export const RACS_STATUS_POLL_MAX_MS = 6000;

export const MSG_PUBLISH_BUSY = "有变更正在保存，请稍后重试";
export const MSG_OBJECT_CHANGED = "配置已变化：请比较原始值、您的修改与当前值，并重新预览后保存。";
export const MSG_SAVE_PENDING = "保存结果待确认：提交终态尚未核实，草稿已保留。";
export const MSG_DRAFT_MATCHES_CURRENT =
  "当前配置与您的草稿一致，不能据此认定本次保存已成功，请继续核对或重新预览。";

export function newRolesAgentOperationId(): string {
  return crypto.randomUUID();
}

export function isTransportUncertainError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.code === GATEWAY_UNAVAILABLE;
  }
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  return false;
}

export function classifyRolesAgentWriteError(error: unknown): ClassifiedRolesAgentWriteError {
  if (error instanceof ApiError) {
    const detail = error.detail as Record<string, unknown> | undefined;
    const conflictKind = detail?.conflictKind;
    if (error.code === "PUBLISH_COORDINATOR_BUSY") {
      return {
        kind: "publish_busy",
        userMessage: MSG_PUBLISH_BUSY,
        code: error.code,
        detail: error.detail,
        requestId: error.requestId
      };
    }
    if (error.code === "PREVIEW_INPUT_CHANGED") {
      return {
        kind: "preview_input_changed",
        userMessage: MSG_OBJECT_CHANGED,
        code: error.code,
        detail: error.detail,
        requestId: error.requestId
      };
    }
    if (error.code === "VERSION_CONFLICT" && conflictKind === "object_version") {
      return {
        kind: "conflict_object_version",
        userMessage: MSG_OBJECT_CHANGED,
        code: error.code,
        detail: error.detail,
        requestId: error.requestId
      };
    }
    if (error.code === "VERSION_CONFLICT" && conflictKind === "target_changed") {
      return {
        kind: "conflict_target_changed",
        userMessage: MSG_OBJECT_CHANGED,
        code: error.code,
        detail: error.detail,
        requestId: error.requestId
      };
    }
    if (error.httpStatus === 401 || error.httpStatus === 403 || error.code === "AUTH_REQUIRED" || error.code === "FORBIDDEN") {
      return {
        kind: "auth",
        userMessage: error.message || "需要登录或权限不足。",
        code: error.code,
        requestId: error.requestId
      };
    }
    if (error.httpStatus === 429) {
      return {
        kind: "rate_limited",
        userMessage: error.message || "请求过于频繁，请稍后重试。",
        code: error.code,
        requestId: error.requestId
      };
    }
    const data = error.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const status = (data as { status?: unknown }).status;
      if (status === "rolled_back" || status === "recovery_required" || status === "committed") {
        return {
          kind: "write_terminal_failure",
          userMessage: error.message,
          code: error.code,
          detail: data,
          requestId: error.requestId
        };
      }
    }
    return {
      kind: "other",
      userMessage: error.message,
      code: error.code,
      detail: error.detail ?? error.data,
      requestId: error.requestId
    };
  }
  if (isTransportUncertainError(error)) {
    return {
      kind: "transport_uncertain",
      userMessage: MSG_SAVE_PENDING,
      code: error instanceof ApiError ? error.code : "TRANSPORT_UNCERTAIN"
    };
  }
  return {
    kind: "other",
    userMessage: error instanceof Error ? error.message : String(error)
  };
}

export async function fetchAccessWriteStatus(operationId: string): Promise<AccessWriteStatusResult> {
  return apiGet<AccessWriteStatusResult>(`/api/admin/access-write-status/${encodeURIComponent(operationId)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded read-only status poll — no write replay (P1-59 §4). */
export async function pollAccessWriteStatusBounded(operationId: string): Promise<AccessWriteStatusResult> {
  const started = Date.now();
  let attempts = 0;
  let last: AccessWriteStatusResult = { operationId, outcome: "unknown" };
  while (attempts < RACS_STATUS_POLL_MAX_ATTEMPTS && Date.now() - started < RACS_STATUS_POLL_MAX_MS) {
    attempts += 1;
    last = await fetchAccessWriteStatus(operationId);
    if (last.outcome === "committed" || last.outcome === "not_committed") return last;
    if (attempts < RACS_STATUS_POLL_MAX_ATTEMPTS && Date.now() - started < RACS_STATUS_POLL_MAX_MS) {
      await sleep(Math.min(250, Math.max(50, RACS_STATUS_POLL_MAX_MS / RACS_STATUS_POLL_MAX_ATTEMPTS)));
    }
  }
  return last;
}

export type DryRunRacsFields = {
  baseObjectVersion?: string;
  previewToken?: string;
  compileInputsDigest?: string;
  version?: string;
};

export function extractRacsPreviewBinding(data: DryRunRacsFields): RacsPreviewBinding | undefined {
  if (typeof data.previewToken !== "string" || !data.previewToken.trim()) return undefined;
  if (typeof data.baseObjectVersion !== "string" || !data.baseObjectVersion.trim()) return undefined;
  return {
    baseObjectVersion: data.baseObjectVersion.trim(),
    previewToken: data.previewToken.trim(),
    compileInputsDigest:
      typeof data.compileInputsDigest === "string" && data.compileInputsDigest.trim()
        ? data.compileInputsDigest.trim()
        : undefined
  };
}

export function buildRacsWriteBody(
  binding: RacsPreviewBinding,
  operationId: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const { version: _legacy, baseObjectVersion: _old, previewToken: _pt, operationId: _op, compileInputsDigest: _cid, ...rest } =
    body;
  return {
    ...rest,
    dryRun: false,
    baseObjectVersion: binding.baseObjectVersion,
    previewToken: binding.previewToken,
    operationId,
    ...(binding.compileInputsDigest ? { compileInputsDigest: binding.compileInputsDigest } : {})
  };
}

export function accessWriteAckFromCommittedStatus(status: AccessWriteStatusResult): AccessWriteAck | null {
  if (status.outcome !== "committed") return null;
  return {
    written: true,
    status: "committed",
    runtimeAck: true
  };
}

export function shouldOfferThreeWayCompare(kind: RolesAgentWriteErrorKind): boolean {
  return kind === "conflict_object_version" || kind === "conflict_target_changed" || kind === "preview_input_changed";
}