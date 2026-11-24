import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, GATEWAY_UNAVAILABLE } from "../lib/apiClient";
import {
  MSG_OBJECT_CHANGED,
  MSG_PUBLISH_BUSY,
  MSG_SAVE_PENDING,
  RACS_STATUS_POLL_MAX_ATTEMPTS,
  RACS_STATUS_POLL_MAX_MS,
  buildRacsWriteBody,
  classifyRolesAgentWriteError,
  extractRacsPreviewBinding,
  newRolesAgentOperationId,
  pollAccessWriteStatusBounded,
  shouldOfferThreeWayCompare
} from "../lib/rolesAgentAccessWrite";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifyRolesAgentWriteError (P1-59 / 58-ERR)", () => {
  it("maps publish coordinator busy to contract copy", () => {
    const err = new ApiError({ code: "PUBLISH_COORDINATOR_BUSY", message: "busy" });
    const classified = classifyRolesAgentWriteError(err);
    expect(classified.kind).toBe("publish_busy");
    expect(classified.userMessage).toBe(MSG_PUBLISH_BUSY);
  });

  it("maps object version conflict to 配置已变化", () => {
    const err = new ApiError({
      code: "VERSION_CONFLICT",
      message: "stale",
      detail: { conflictKind: "object_version" }
    });
    const classified = classifyRolesAgentWriteError(err);
    expect(classified.kind).toBe("conflict_object_version");
    expect(classified.userMessage).toContain("配置已变化");
  });

  it("maps transport uncertainty to 保存结果待确认", () => {
    const classified = classifyRolesAgentWriteError(new TypeError("Failed to fetch"));
    expect(classified.kind).toBe("transport_uncertain");
    expect(classified.userMessage).toBe(MSG_SAVE_PENDING);
  });

  it.each([502, 503])("treats an HTML gateway %s as an uncertain write, preserving status diagnostics", (status) => {
    const error = new ApiError({ code: GATEWAY_UNAVAILABLE, message: "gateway" });
    error.httpStatus = status;
    const result = classifyRolesAgentWriteError(error);
    expect(result.kind).toBe("transport_uncertain");
    expect(result.userMessage).toBe(MSG_SAVE_PENDING);
    expect(result.code).toBe(GATEWAY_UNAVAILABLE);
  });

  it("does not treat 401 as transport uncertain", () => {
    const err = new ApiError({ code: "AUTH_REQUIRED", message: "login" });
    err.httpStatus = 401;
    expect(classifyRolesAgentWriteError(err).kind).toBe("auth");
  });
});

describe("RACS write helpers", () => {
  it("extracts preview binding only when both token fields exist", () => {
    expect(
      extractRacsPreviewBinding({ previewToken: "pt", baseObjectVersion: "role/x@d" })
    ).toEqual({ previewToken: "pt", baseObjectVersion: "role/x@d" });
    expect(extractRacsPreviewBinding({ previewToken: "pt" })).toBeUndefined();
  });

  it("buildRacsWriteBody omits legacy version and injects operationId", () => {
    const body = buildRacsWriteBody(
      { previewToken: "pt", baseObjectVersion: "role/x@d" },
      "550e8400-e29b-41d4-a716-446655440000",
      { dryRun: false, version: "v1", patch: { description: "x" } }
    );
    expect(body.version).toBeUndefined();
    expect(body.previewToken).toBe("pt");
    expect(body.operationId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("generates UUID operation ids", () => {
    const id = newRolesAgentOperationId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("offers three-way compare only on object conflict classes", () => {
    expect(shouldOfferThreeWayCompare("conflict_object_version")).toBe(true);
    expect(shouldOfferThreeWayCompare("publish_busy")).toBe(false);
  });
});

describe("pollAccessWriteStatusBounded", () => {
  it("caps automatic read polls", async () => {
    expect(RACS_STATUS_POLL_MAX_ATTEMPTS).toBe(3);
    expect(RACS_STATUS_POLL_MAX_MS).toBe(6000);
    const fetchMock = vi.fn(async () => ({ operationId: "550e8400-e29b-41d4-a716-446655440000", outcome: "unknown" as const }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ ok: true, data: await fetchMock() }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );
    const result = await pollAccessWriteStatusBounded("550e8400-e29b-41d4-a716-446655440000");
    expect(result.outcome).toBe("unknown");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});