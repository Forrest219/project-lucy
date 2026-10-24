/**
 * Lucy v0.25 (L25-14 §3.2 / §5.3) — row-permission Admin routes (R2 preview).
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §3.2 (R2 最终行约束预览), §5.3 (保存前校验、预览与审计闭环), §6.1 (管理台交互),
 *   §9 (V08–V13).
 *
 * This module owns ONE endpoint:
 *
 *   POST /api/admin/roles/preview-row-policy
 *
 * The preview is read-only. It never writes configuration, never swaps the
 * committed policy in, and never takes the publish lock (a read-only preview may
 * run in parallel with a publish — spec §5.3 / D6).
 */
import type { FastifyInstance } from "fastify";
import { ROLE_ID_RE } from "./access-config.js";
import { validateRoleShape } from "./roles.js";
import { previewRowPolicyDraft } from "../proxy/row-policy-preview.js";

interface PreviewTableInput {
  connection?: unknown;
  schema?: unknown;
  name?: unknown;
}

function normalizeTables(input: unknown): Array<{ connection: string; schema: string; name: string }> {
  if (!Array.isArray(input)) return [];
  const out: Array<{ connection: string; schema: string; name: string }> = [];
  for (const item of input as PreviewTableInput[]) {
    if (!item || typeof item !== "object") continue;
    const connection = typeof item.connection === "string" ? item.connection.trim() : "";
    const schema = typeof item.schema === "string" ? item.schema.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!connection || !schema || !name) continue;
    out.push({ connection, schema, name });
  }
  return out;
}

/**
 * Register the row-permission Admin routes.
 *
 * Wiring (owned by the parent session, `webui/server/index.ts`):
 *
 *   import { registerRowPolicyRoutes } from "./admin/row-policy-routes.js";
 *   registerRowPolicyRoutes(app);
 */
export function registerRowPolicyRoutes(app: FastifyInstance): void {
  // POST /api/admin/roles/preview-row-policy — final row constraints before saving.
  app.post<{
    Body: {
      roleId?: string;
      /** The candidate Role (draft). When absent the committed Role is previewed. */
      role?: unknown;
      tables?: PreviewTableInput[];
    };
  }>("/api/admin/roles/preview-row-policy", async (request, reply) => {
    const body = request.body ?? {};
    const roleId = typeof body.roleId === "string" ? body.roleId.trim() : "";
    if (!roleId) {
      return reply.status(400).send({
        ok: false,
        error: { code: "BAD_REQUEST", message: "roleId is required" }
      });
    }
    if (!ROLE_ID_RE.test(roleId)) {
      return reply.status(400).send({
        ok: false,
        error: { code: "INVALID_ROLE_ID", message: "roleId must match ^[A-Za-z0-9_-]{1,64}$" }
      });
    }
    const tables = normalizeTables(body.tables);
    if (tables.length === 0) {
      return reply.status(400).send({
        ok: false,
        error: { code: "BAD_REQUEST", message: "tables must contain at least one table identity" }
      });
    }

    let role: unknown;
    if (body.role !== undefined && body.role !== null) {
      const shape = validateRoleShape(body.role);
      if (!shape.ok) {
        return reply.status(400).send({
          ok: false,
          error: { code: "INVALID_ROLE", message: shape.reason }
        });
      }
      role = shape.value;
    }

    const outcome = await previewRowPolicyDraft({ roleId, role, tables });
    return {
      ok: true,
      data: {
        /** False when at least one table could not be previewed. */
        ok: outcome.ok,
        /** Digest of the in-memory candidate the preview was computed from. */
        candidateDigest: outcome.candidateDigest,
        /** The policy version the preview was based on. */
        basePolicyVersion: outcome.basePolicyVersion,
        tables: outcome.tables.map((table) => ({
          requested: table.requested,
          tableKey: table.tableKey,
          catalog: table.catalog,
          preview: table.preview,
          error: table.error
        }))
      }
    };
  });
}
