/**
 * P1-4 Hive 直连（编译侧）— Hive 连接管理接口行为测试。
 *
 * 权威 Spec：docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §3.2
 * 实施计划：docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2（H1、H2）
 *
 * 断言针对行为：写入落盘、冲突拒绝、明文秘密拒绝、删除生效。
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => {}),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

const { registerHiveConnectionRoutes } = await import("../admin/routes/hive.js");
const { HIVE_CONNECTIONS_REL_PATH } = await import("../hive/config.js");

const KTX_YAML = `connections:
  postgres_main:
    driver: postgres
    host: db.example.com
    port: 5432
    database: app
    schemas:
      - public
    enabled_tables:
      - public.orders
`;

let projectRoot = "";
let previousProjectRoot: string | undefined;

function buildApp() {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    request.lucyAdmin = {
      session: null,
      admin: { id: "admin-1", account_uid: null, role: "owner" } as never,
      stateUnavailable: false,
      authMode: "required"
    };
  });
  registerHiveConnectionRoutes(app);
  return app;
}

async function readHiveYaml(): Promise<string> {
  return readFile(path.join(projectRoot, HIVE_CONNECTIONS_REL_PATH), "utf8");
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "hive-routes-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML, "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml").replace(/\/$/, ""), "roles: {}\n", "utf8").catch(
    async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
      await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "roles: {}\n", "utf8");
    }
  );
  previousProjectRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(() => {
  if (previousProjectRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousProjectRoot;
});

const VALID_CONNECTION = {
  id: "prod_hive",
  host: "hive.example.com",
  port: 10000,
  default_database: "finance",
  allowed_databases: ["finance"],
  enabled_tables: ["finance.orders"],
  transport: "tcp",
  auth: { kind: "kerberos", principal: "lucy@EXAMPLE.COM", keytab_ref: "secret://hive/prod.keytab" }
};

describe("Hive 连接管理接口", () => {
  it("GET 返回统一连接视图，KTX 与 Hive 连接合并呈现", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/admin/hive/connections" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.data.unified.map((entry: { id: string }) => entry.id)).toEqual(["postgres_main"]);

    await app.close();
  });

  it("POST 创建连接：写入 hive-connections.yaml，不写 ktx.yaml", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/hive/connections",
      payload: { connection: VALID_CONNECTION }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.data.connection.id).toBe("prod_hive");

    const written = await readHiveYaml();
    expect(written).toContain("prod_hive");
    expect(written).toContain("keytab_ref");
    // ktx.yaml 不含 Hive 连接。
    const ktx = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
    expect(ktx).not.toContain("prod_hive");

    // 读回来时统一视图里两个来源都在。
    const listed = await app.inject({ method: "GET", url: "/api/admin/hive/connections" });
    expect(listed.json().data.unified.map((entry: { id: string }) => entry.id)).toEqual([
      "postgres_main",
      "prod_hive"
    ]);

    await app.close();
  });

  it("POST 拒绝明文凭据，不落盘", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/hive/connections",
      payload: {
        connection: {
          ...VALID_CONNECTION,
          auth: { kind: "ldap", username: "reader", password: "hunter2" }
        }
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().ok).toBe(false);
    await expect(readHiveYaml()).rejects.toThrow();

    await app.close();
  });

  it("POST 拒绝与 KTX 连接同 ID 的连接", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/hive/connections",
      payload: { connection: { ...VALID_CONNECTION, id: "postgres_main" } }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("HIVE_CONNECTION_ID_CONFLICT");

    await app.close();
  });

  it("DELETE 删除连接后读视图不再包含它", async () => {
    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/api/admin/hive/connections",
      payload: { connection: VALID_CONNECTION }
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/admin/hive/connections/prod_hive"
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().data.connectionId).toBe("prod_hive");

    const written = await readHiveYaml();
    expect(written).not.toContain("prod_hive");

    const listed = await app.inject({ method: "GET", url: "/api/admin/hive/connections" });
    expect(listed.json().data.unified.map((entry: { id: string }) => entry.id)).toEqual(["postgres_main"]);

    await app.close();
  });

  it("DELETE 不存在的连接返回 404", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "DELETE",
      url: "/api/admin/hive/connections/ghost"
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("HIVE_CONNECTION_NOT_FOUND");

    await app.close();
  });
});

describe("Hive 连接管理接口 — 凭据与并发", () => {
  it("LDAP url 里的明文口令被拒：不落盘、响应里不回显口令", async () => {
    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/hive/connections",
      payload: {
        connection: {
          ...VALID_CONNECTION,
          auth: {
            kind: "ldap",
            username: "admin",
            password_ref: "secret://hive/ldap",
            url: "ldap://admin:s3cret@ldap.corp"
          }
        }
      }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().ok).toBe(false);
    // 拒绝信息本身不得复述口令。
    expect(response.body).not.toContain("s3cret");
    // 也不落盘。
    await expect(readHiveYaml()).rejects.toThrow();

    await app.close();
  });

  it("GET 视图与落盘文件里都没有明文口令", async () => {
    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/hive/connections",
      payload: {
        connection: {
          ...VALID_CONNECTION,
          auth: {
            kind: "ldap",
            username: "reader",
            password_ref: "secret://hive/ldap",
            url: "ldap://ldap.corp"
          }
        }
      }
    });
    expect(created.statusCode).toBe(200);

    const written = await readHiveYaml();
    expect(written).not.toContain("s3cret");
    // 落盘的只有引用。
    expect(written).toContain("password_ref");

    const listed = await app.inject({ method: "GET", url: "/api/admin/hive/connections" });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain("s3cret");

    await app.close();
  });

  it("并发 upsert 不丢更新：每个连接都写进文件", async () => {
    const app = buildApp();
    const ids = ["c_one", "c_two", "c_three", "c_four", "c_five", "c_six"];

    const responses = await Promise.all(
      ids.map((id) =>
        app.inject({
          method: "POST",
          url: "/api/admin/hive/connections",
          payload: {
            connection: { ...VALID_CONNECTION, id, enabled_tables: [`finance.${id}`] }
          }
        })
      )
    );
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
    }

    // 读-改-写必须在同一把锁内，否则并发写会互相覆盖。
    const written = await readHiveYaml();
    for (const id of ids) {
      expect(written).toContain(id);
    }

    const listed = await app.inject({ method: "GET", url: "/api/admin/hive/connections" });
    const hiveIds = listed.json().data.hive.map((entry: { id: string }) => entry.id);
    expect(hiveIds.sort()).toEqual([...ids].sort());

    await app.close();
  });

  it("并发删除与新增交错时，最终文件与串行执行的结果一致", async () => {
    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/api/admin/hive/connections",
      payload: { connection: { ...VALID_CONNECTION, id: "c_keep" } }
    });

    await Promise.all([
      app.inject({ method: "DELETE", url: "/api/admin/hive/connections/c_keep" }),
      app.inject({
        method: "POST",
        url: "/api/admin/hive/connections",
        payload: { connection: { ...VALID_CONNECTION, id: "c_new" } }
      })
    ]);

    const listed = await app.inject({ method: "GET", url: "/api/admin/hive/connections" });
    const hiveIds = listed.json().data.hive.map((entry: { id: string }) => entry.id);
    // 顺序无关：删掉 c_keep、加上 c_new，两次操作各自在自己的临界区内完成，
    // 最终集合恒为 {c_new}。读在锁外时，删除或新增会被对方覆盖掉。
    expect(hiveIds).toEqual(["c_new"]);

    await app.close();
  });
});
