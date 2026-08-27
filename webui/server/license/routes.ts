import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { recordConfigChange } from "../admin/audit.js";
import { actorIdFromRequest, requireOwner } from "../auth/guard.js";
import {
  decodeActivationCode,
  isActivationPayloadExpired
} from "./codec.js";
import { assertLicenseAllowsAgentCreate, loadLicenseSnapshot, resolveVerifySecret } from "./entitlement.js";
import { licenseYamlRelPath, resetLicenseCache, writeLicenseRecord } from "./store.js";

function mapActivationError(error: unknown): { code: string; message: string; status: number } {
  const msg = error instanceof Error ? error.message : String(error);
  switch (msg) {
    case "LICENSE_VERIFY_SECRET_MISSING":
      return {
        code: "LICENSE_VERIFY_SECRET_MISSING",
        message: "部署许可校验密钥未配置，无法激活",
        status: 503
      };
    case "INVALID_ACTIVATION_FORMAT":
    case "INVALID_ACTIVATION_SIGNATURE":
    case "INVALID_ACTIVATION_PAYLOAD":
    case "INVALID_ACTIVATION_VERSION":
    case "INVALID_ACTIVATION_CUSTOMER":
    case "INVALID_ACTIVATION_TIER":
    case "INVALID_ACTIVATION_MAX_AGENTS":
    case "INVALID_ACTIVATION_ISSUED_AT":
    case "INVALID_ACTIVATION_EXPIRES_AT":
      return { code: "INVALID_ACTIVATION_CODE", message: "激活码无效或已被篡改", status: 400 };
    default:
      return { code: "INVALID_ACTIVATION_CODE", message: "激活码无效或已被篡改", status: 400 };
  }
}

export function registerLicenseRoutes(app: FastifyInstance): void {
  app.get("/api/admin/license", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const snapshot = await loadLicenseSnapshot();
    return { ok: true, data: snapshot };
  });

  app.post<{
    Body: { activationCode?: string };
  }>("/api/admin/license/activate", async (request, reply) => {
    if (!requireOwner(request, reply)) return;
    const activationCode = request.body?.activationCode?.trim();
    if (!activationCode) {
      return reply.status(400).send({
        ok: false,
        error: { code: "BAD_REQUEST", message: "activationCode 为必填项" }
      });
    }
    const verifySecret = resolveVerifySecret();
    if (!verifySecret) {
      return reply.status(503).send({
        ok: false,
        error: {
          code: "LICENSE_VERIFY_SECRET_MISSING",
          message: "部署许可校验密钥未配置，无法激活"
        }
      });
    }

    let decoded;
    try {
      decoded = decodeActivationCode(activationCode, verifySecret);
    } catch (error) {
      const mapped = mapActivationError(error);
      return reply.status(mapped.status).send({
        ok: false,
        error: { code: mapped.code, message: mapped.message }
      });
    }

    if (isActivationPayloadExpired(decoded.payload)) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "ACTIVATION_CODE_EXPIRED",
          message: "激活码已过期，请联系厂商获取新的激活码"
        }
      });
    }

    const activatedAt = new Date().toISOString();
    const record = await writeLicenseRecord({
      payload: decoded.payload,
      normalizedActivationCode: decoded.normalized,
      activatedAt
    });
    resetLicenseCache();

    await recordConfigChange({
      actor: actorIdFromRequest(request),
      changeType: "license_activate",
      filePath: licenseYamlRelPath(),
      targetId: record.entitlement.customer_id,
      newSummary: {
        customerId: record.entitlement.customer_id,
        tier: record.entitlement.tier,
        maxAgents: record.entitlement.max_agents,
        expiresAt: record.entitlement.expires_at
      },
      writeStatus: "committed"
    });

    const snapshot = await loadLicenseSnapshot();
    return { ok: true, data: snapshot };
  });
}

export async function enforceAgentSeatLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  nextEnabledAgentCount: number
): Promise<boolean> {
  const snapshot = await loadLicenseSnapshot();
  const decision = assertLicenseAllowsAgentCreate(snapshot, nextEnabledAgentCount);
  if (decision.allowed) return true;
  void reply.status(decision.httpStatus).send({
    ok: false,
    error: {
      code: decision.code,
      message: decision.message
    }
  });
  return false;
}
