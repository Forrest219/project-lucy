import { resolveLucyVersion } from "../lucy-version.js";
import { TOKEN_EXPIRES_IN_PRESETS } from "./token-expiry-policy.js";

/**
 * Hand-written Admin OpenAPI contract (D2).
 * Operations are enumerated one method + path at a time. Do not add a method
 * that Fastify does not register (there is no GET /api/auth/login).
 */

type JsonSchema = Record<string, unknown>;

const errorSchema: JsonSchema = {
  type: "object",
  required: ["ok", "error"],
  properties: {
    ok: { type: "boolean", enum: [false] },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        detail: { type: "object", additionalProperties: true }
      }
    }
  }
};

const successSchema: JsonSchema = {
  type: "object",
  required: ["ok", "data"],
  properties: {
    ok: { type: "boolean", enum: [true] },
    data: { type: "object", additionalProperties: true }
  }
};

const overrideSchema: JsonSchema = {
  type: "object",
  description: "Access Governance Gate override。decision 为 override_required 时，确认写入必须带齐。",
  properties: {
    reason: { type: "string" },
    rollbackPlan: { type: "string" },
    expiresAt: { type: "string" },
    approvers: { type: "array", items: { type: "object", additionalProperties: true } }
  }
};

const dryRunPreview: JsonSchema = {
  type: "boolean",
  default: true,
  description: "省略或 true 为预览，不落盘，响应不含 after。仅 false 确认写入。"
};

const dryRunCommit: JsonSchema = {
  type: "boolean",
  default: false,
  description: "仅 true 为预览，不生成明文、不落盘、不含 clientConfigs。省略即为真实写入。"
};

function jsonBody(schema: JsonSchema, required = true): JsonSchema {
  return {
    required,
    content: { "application/json": { schema } }
  };
}

function responses(extra: Record<string, JsonSchema> = {}): Record<string, JsonSchema> {
  return {
    "200": {
      description: "成功信封 { ok:true, data }。",
      content: { "application/json": { schema: successSchema } }
    },
    "400": {
      description: "请求不合法。",
      content: { "application/json": { schema: errorSchema } }
    },
    "401": {
      description: "未登录。code 为现行 AUTH_REQUIRED 或 AUTH_BOOTSTRAP_REQUIRED。",
      content: { "application/json": { schema: errorSchema } }
    },
    "403": {
      description: "已登录但被拒绝。跨站写方法可能先返回 CSRF_ORIGIN_DENIED；owner 门禁为 OWNER_REQUIRED。",
      content: { "application/json": { schema: errorSchema } }
    },
    "409": {
      description: "冲突。含 GOVERNANCE_GATE_BLOCKED、GOVERNANCE_GATE_OVERRIDE_REQUIRED、VERSION_CONFLICT 或资源已占用。",
      content: { "application/json": { schema: errorSchema } }
    },
    default: {
      description: "其他错误信封 { ok:false, error:{ code, message, detail? } }。",
      content: { "application/json": { schema: errorSchema } }
    },
    ...extra
  };
}

const sessionSecurity = [{ lucyAdminSession: [] }];

const pathParam = (name: string, description: string): JsonSchema => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" },
  description
});

export function buildAdminOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "Lucy Admin API",
      version: resolveLucyVersion(),
      description:
        "Admin 开通域机器可读契约。身份只有 Cookie lucy_admin_session，没有管理员 Bearer 或 scoped Admin API Token。" +
        "dryRun 按 operation 声明，不统一默认值。Agent 与 Role 的可预览写操作省略即为预览；Token 签发与续期省略即为真实写入；无 dryRun 的 DELETE 直接执行。"
    },
    components: {
      securitySchemes: {
        lucyAdminSession: {
          type: "apiKey",
          in: "cookie",
          name: "lucy_admin_session",
          description:
            "WebUI 登录会话 Cookie。POST /api/auth/login 成功时通过 Set-Cookie 下发。不是 Authorization Bearer，也不能当作 MCP Agent Token。"
        }
      }
    },
    paths: {
      "/api/auth/login": {
        post: {
          operationId: "authLogin",
          summary: "登录账户登录",
          description:
            "必填 adminId 与 password。成功响应 Set-Cookie: lucy_admin_session，并见 security scheme lucyAdminSession。本路径没有 GET。",
          tags: ["auth"],
          security: [],
          requestBody: jsonBody({
            type: "object",
            required: ["adminId", "password"],
            properties: {
              adminId: { type: "string", description: "登录账户 id" },
              password: { type: "string", description: "密码" }
            }
          }),
          responses: responses({
            "200": {
              description: "登录成功。设置 Cookie lucy_admin_session。",
              headers: {
                "Set-Cookie": {
                  description: "lucy_admin_session=<session>; HttpOnly; SameSite=Lax",
                  schema: { type: "string" }
                }
              },
              content: { "application/json": { schema: successSchema } }
            }
          })
        }
      },
      "/api/auth/status": {
        get: {
          operationId: "authStatus",
          summary: "认证状态",
          tags: ["auth"],
          security: [],
          responses: responses()
        }
      },
      "/api/auth/me": {
        get: {
          operationId: "authMe",
          summary: "当前登录账户",
          description: "需要会话。不是公开接口。",
          tags: ["auth"],
          security: sessionSecurity,
          responses: responses()
        }
      },
      "/api/auth/logout": {
        post: {
          operationId: "authLogout",
          summary: "退出登录",
          tags: ["auth"],
          security: [],
          responses: responses()
        }
      },
      "/api/auth/bootstrap": {
        post: {
          operationId: "authBootstrap",
          summary: "创建首个所有者",
          tags: ["auth"],
          security: [],
          requestBody: jsonBody({
            type: "object",
            required: ["adminId", "displayName", "password"],
            properties: {
              adminId: { type: "string" },
              displayName: { type: "string" },
              password: { type: "string" }
            }
          }),
          responses: responses()
        }
      },
      "/api/auth/oidc/start": {
        post: {
          operationId: "authOidcStart",
          summary: "开始 OIDC 登录",
          tags: ["auth"],
          security: [],
          requestBody: jsonBody({
            type: "object",
            properties: { returnTo: { type: "string" } }
          }, false),
          responses: responses()
        }
      },
      "/api/auth/oidc/callback": {
        get: {
          operationId: "authOidcCallback",
          summary: "OIDC 回调",
          tags: ["auth"],
          security: [],
          parameters: [
            { name: "code", in: "query", required: false, schema: { type: "string" } },
            { name: "state", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: responses()
        }
      },
      "/api/admin/agents": {
        get: {
          operationId: "listAgents",
          summary: "列出 Agent",
          tags: ["admin"],
          security: sessionSecurity,
          responses: responses()
        },
        post: {
          operationId: "createAgent",
          summary: "创建 Agent",
          description:
            "省略 dryRun 或 dryRun true 为预览，响应含 gate，不含 after。dryRun false 确认写入后含 after.agent 与 after.version。after.version 是访问配置并发版本，不是 policyVersion。建立委托或授予控制面角色时需要所有者。",
          tags: ["admin"],
          security: sessionSecurity,
          requestBody: jsonBody({
            type: "object",
            required: ["agent"],
            properties: {
              dryRun: dryRunPreview,
              override: overrideSchema,
              agent: {
                type: "object",
                required: ["id", "name"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  note: { type: "string" },
                  role: { type: "string" },
                  roles: { type: "array", items: { type: "string" } },
                  delegated_from: { type: "string", description: "委托人。设置时需要所有者。" }
                }
              }
            }
          }),
          responses: responses()
        }
      },
      "/api/admin/agents/{userId}": {
        parameters: [pathParam("userId", "Agent id")],
        get: {
          operationId: "getAgent",
          summary: "读取 Agent",
          description: "data.version 与确认写入响应的 after.version 使用同一套 mtime-文件哈希算法。",
          tags: ["admin"],
          security: sessionSecurity,
          responses: responses()
        },
        patch: {
          operationId: "patchAgent",
          summary: "更新 Agent",
          description:
            "省略 dryRun 或 dryRun true 为预览，含 gate，不含 after。dryRun false 成功时 after.version 可直接作为下一次 PATCH 的 version。policyVersion 保留为独立字段。修改委托或控制面角色需要所有者。version 与当前访问配置不一致时 VERSION_CONFLICT。",
          tags: ["admin"],
          security: sessionSecurity,
          requestBody: jsonBody({
            type: "object",
            properties: {
              dryRun: dryRunPreview,
              version: { type: "string", description: "上一次 GET 或 after.version。不是 policyVersion。" },
              override: overrideSchema,
              patch: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  note: { type: "string" },
                  enabled: { type: "boolean" },
                  role: { type: "string" },
                  roles: { type: "array", items: { type: "string" } },
                  delegated_from: { type: "string", nullable: true }
                }
              }
            }
          }, false),
          responses: responses()
        },
        delete: {
          operationId: "deleteAgent",
          summary: "删除 Agent",
          description: "无 dryRun，直接执行。受 Access Governance Gate 约束。响应不新增 after。",
          tags: ["admin"],
          security: sessionSecurity,
          requestBody: jsonBody({
            type: "object",
            properties: { override: overrideSchema }
          }, false),
          responses: responses()
        }
      },
      "/api/admin/agents/{userId}/tokens": {
        parameters: [pathParam("userId", "Agent id")],
        post: {
          operationId: "issueAgentToken",
          summary: "为 Agent 签发 Token",
          description:
            "省略 dryRun 即为真实签发；仅 dryRun true 返回预览 proposed.expires_at，不生成明文、不落盘、不含 clientConfigs。" +
            "至少提供 expires_at 或 expires_in 之一。expires_in 只允许 30d、90d、180d、365d。" +
            "目标 Agent 已有 delegated_from 时，只有所有者可以签发，否则 403 OWNER_REQUIRED。" +
            "includeClientConfigs true 时先确认 resolveMcpEndpoint 为 configured 且 url 非空，否则 503 MCP_ENDPOINT_UNAVAILABLE，且不签发。" +
            "Access Governance Gate 可能返回 409，并用 override 确认。重复 label 为 409 TOKEN_LABEL_TAKEN，detail.existingToken 不含明文。",
          tags: ["admin"],
          security: sessionSecurity,
          requestBody: jsonBody({
            type: "object",
            required: ["label"],
            anyOf: [{ required: ["label", "expires_at"] }, { required: ["label", "expires_in"] }],
            properties: {
              dryRun: dryRunCommit,
              label: { type: "string" },
              device_name: { type: "string", nullable: true },
              expires_at: { type: "string", description: "ISO-8601 或 YYYY-MM-DD。与 expires_in 至少其一。" },
              expires_in: {
                type: "string",
                enum: [...TOKEN_EXPIRES_IN_PRESETS],
                description: "相对本次请求 t0 的预设。与 expires_at 规范化后必须等值。"
              },
              includeClientConfigs: {
                type: "boolean",
                default: false,
                description: "true 时在非预览签发成功后返回四键 clientConfigs。缺省不返回该键。"
              },
              override: overrideSchema
            }
          }),
          responses: responses({
            "503": {
              description: "includeClientConfigs true 且 MCP 端点不是 configured。未签发 Token。",
              content: { "application/json": { schema: errorSchema } }
            }
          })
        }
      },
      "/api/admin/agents/{userId}/tokens/{label}": {
        parameters: [pathParam("userId", "Agent id"), pathParam("label", "Token label")],
        delete: {
          operationId: "revokeAgentToken",
          summary: "撤销 Token",
          description: "无 dryRun，直接撤销。不返回 Token 明文。受 Access Governance Gate 与 override 约束。已委托 Agent 的撤销沿用所有者门禁（续期／签发面）。",
          tags: ["admin"],
          security: sessionSecurity,
          requestBody: jsonBody({
            type: "object",
            properties: { override: overrideSchema }
          }, false),
          responses: responses()
        }
      },
      "/api/admin/agents/{userId}/tokens/{label}/renew": {
        parameters: [pathParam("userId", "Agent id"), pathParam("label", "Token label")],
        post: {
          operationId: "renewAgentToken",
          summary: "续期 Token",
          description:
            "省略 dryRun 即为真实续期，只改 expires_at。dryRun true 为预览，不改过期时间、不落盘。本条不改变该默认值。已委托 Agent 续期需要所有者。",
          tags: ["admin"],
          security: sessionSecurity,
          requestBody: jsonBody({
            type: "object",
            required: ["expires_at"],
            properties: {
              dryRun: dryRunCommit,
              repair: { type: "boolean", description: "仅当磁盘过期时间已等于请求值时，用于重试运行态确认。" },
              expires_at: { type: "string" },
              override: overrideSchema
            }
          }),
          responses: responses()
        }
      },
      "/api/admin/tokens": {
        get: {
          operationId: "listTokens",
          summary: "Token 清单",
          description: "行投影含 label、created、expires_at、status，以及 tokenHint、hashPrefix。不含明文。",
          tags: ["admin"],
          security: sessionSecurity,
          parameters: [
            { name: "userId", in: "query", required: false, schema: { type: "string" } },
            { name: "search", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: responses()
        }
      },
      "/api/admin/roles": {
        get: {
          operationId: "listRoles",
          summary: "列出角色",
          tags: ["admin"],
          security: sessionSecurity,
          parameters: [
            { name: "includeTemplates", in: "query", required: false, schema: { type: "string" } }
          ],
          responses: responses()
        },
        post: {
          operationId: "createRole",
          summary: "创建角色",
          description: "省略 dryRun 或 dryRun true 为预览。dryRun false 确认写入。含 allow.ops 时需要所有者。受 gate 与 override 约束。本响应不新增 after。",
          tags: ["admin"],
          security: sessionSecurity,
          requestBody: jsonBody({
            type: "object",
            required: ["roleId", "role"],
            properties: {
              dryRun: dryRunPreview,
              roleId: { type: "string" },
              role: { type: "object", additionalProperties: true },
              override: overrideSchema,
              acknowledgeContextReferences: { type: "boolean" },
              rowPolicyConfirmation: { type: "object", additionalProperties: true }
            }
          }),
          responses: responses()
        }
      },
      "/api/admin/roles/{roleId}": {
        parameters: [pathParam("roleId", "角色标识")],
        get: {
          operationId: "getRole",
          summary: "读取角色",
          tags: ["admin"],
          security: sessionSecurity,
          responses: responses()
        },
        patch: {
          operationId: "patchRole",
          summary: "更新角色",
          description:
            "省略 dryRun 或 dryRun true 为预览。dryRun false 确认写入。可带 version 做并发校验，以及 override、rowPolicyConfirmation。授予控制面能力时需要所有者。本条不改 Role 写响应形状，不返回 Agent after。",
          tags: ["admin"],
          security: sessionSecurity,
          requestBody: jsonBody({
            type: "object",
            properties: {
              dryRun: dryRunPreview,
              version: { type: "string" },
              override: overrideSchema,
              patch: {
                type: "object",
                properties: {
                  description: {},
                  allow: { type: "object", additionalProperties: true }
                }
              },
              rowPolicyConfirmation: { type: "object", additionalProperties: true }
            }
          }, false),
          responses: responses()
        },
        delete: {
          operationId: "deleteRole",
          summary: "删除角色",
          description: "无 dryRun，直接执行。受 gate 与 override 约束。",
          tags: ["admin"],
          security: sessionSecurity,
          requestBody: jsonBody({
            type: "object",
            properties: { override: overrideSchema }
          }, false),
          responses: responses()
        }
      }
    }
  };
}
