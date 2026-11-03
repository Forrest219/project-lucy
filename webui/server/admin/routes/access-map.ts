/**
 * Lucy v0.25 P1-3 — 访问关系图 Admin 路由（只读）。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §6.1  端点     §6.2  响应结构     §6.3  URL 参数
 *
 * 一个端点：`GET /api/admin/access-map`。
 *
 * 鉴权沿用现有 admin 路由：`server/index.ts` 的全局 `requireWebuiAuthHook`
 * 已经覆盖 `/api/*`，本路由不另起一套鉴权逻辑。
 *
 * 装配位置（由 W6 主持者接线，`webui/server/index.ts`）：
 *
 *   import { registerAccessMapRoutes } from "./admin/routes/access-map.js";
 *   registerAccessMapRoutes(app);
 */
import type { FastifyInstance } from "fastify";
import {
  buildAccessMap,
  createAdminAccessMapProvider,
  parseAccessMapQuery,
  type AccessMapProvider
} from "../access-map.js";

/**
 * 注册访问关系图路由。
 *
 * `provider` 可注入，便于路由层测试用固定依赖断言 400 / 降级行为，
 * 而不依赖真实项目目录。
 */
export function registerAccessMapRoutes(
  app: FastifyInstance,
  provider: AccessMapProvider = createAdminAccessMapProvider()
): void {
  app.get("/api/admin/access-map", async (request, reply) => {
    const parsed = parseAccessMapQuery(
      (request.query ?? {}) as Record<string, string | undefined>
    );
    if (!parsed.ok) {
      // 非法参数值 → 400，且**不**静默纠正成默认值：被悄悄改写的分享链接
      // 会让用户以为「这个 Agent 没有授权路径」，而真相只是拼错了一个参数。
      return reply.status(400).send({
        ok: false,
        error: { code: parsed.error.code, message: parsed.error.message },
        data: { param: parsed.error.param }
      });
    }

    try {
      const response = await buildAccessMap(provider, parsed.query);
      return reply.send({ ok: true, data: response });
    } catch (error) {
      // 守恒自检失败等实现缺陷：明确报错，不返回空图冒充正常结果。
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        ok: false,
        error: { code: "ACCESS_MAP_BUILD_FAILED", message: `访问关系图构建失败：${message}` }
      });
    }
  });
}
