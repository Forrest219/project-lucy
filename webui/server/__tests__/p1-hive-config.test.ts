/**
 * P1-4 Hive 直连（编译侧）— H1 连接配置模型 / H2 统一连接视图。
 *
 * 权威 Spec：docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §3.2
 * 实施计划：docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2（H1、H2）
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HIVE_CONNECTIONS_REL_PATH,
  mergeUnifiedConnections,
  parseHiveConnectionsYaml,
  serializeHiveConnections
} from "../hive/config";
import type { ConnectionInfo } from "../model";

function ktxConnection(id: string, overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
  return {
    id,
    schemas: ["public"],
    enabledTables: [],
    ...overrides
  };
}

describe("H1 Hive 连接配置模型", () => {
  it("把连接写到 webui/config/hive-connections.yaml，不进 ktx.yaml", () => {
    expect(HIVE_CONNECTIONS_REL_PATH).toBe("webui/config/hive-connections.yaml");
    expect(HIVE_CONNECTIONS_REL_PATH).not.toContain("ktx.yaml");
  });

  it("NONE 与 NOSASL 分开建模，不共用一个免密分支", () => {
    const none = parseHiveConnectionsYaml(`
version: 1
connections:
  lab_none:
    host: h.example.com
    port: 10000
    transport: tcp
    auth:
      kind: none
`);
    const nosasl = parseHiveConnectionsYaml(`
version: 1
connections:
  lab_nosasl:
    host: h.example.com
    port: 10000
    transport: tcp
    auth:
      kind: nosasl
`);
    expect(none.ok).toBe(true);
    expect(nosasl.ok).toBe(true);
    if (!none.ok || !nosasl.ok) return;
    expect(none.value.connections[0]!.auth).toEqual({ kind: "none" });
    expect(nosasl.value.connections[0]!.auth).toEqual({ kind: "nosasl" });
    expect(none.value.connections[0]!.auth.kind).not.toBe(nosasl.value.connections[0]!.auth.kind);
  });

  it("拒绝把明文秘密写进配置文件（password / token / keytab）", () => {
    const inlinePassword = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: h.example.com
    port: 10000
    transport: tcp
    auth:
      kind: ldap
      username: reader
      password: hunter2
`);
    expect(inlinePassword.ok).toBe(false);
    if (inlinePassword.ok) return;
    expect(inlinePassword.reason).toBe("hive_config_secret_inline_forbidden");

    const inlineToken = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: h.example.com
    port: 10000
    transport: tcp
    auth:
      kind: none
    token: abc123
`);
    expect(inlineToken.ok).toBe(false);
    if (inlineToken.ok) return;
    expect(inlineToken.reason).toBe("hive_config_secret_inline_forbidden");
  });

  it("接受凭据引用，并保留 transport / TLS / 启用表范围", () => {
    const parsed = parseHiveConnectionsYaml(`
version: 1
connections:
  prod_hive:
    host: hive.example.com
    port: 10000
    default_database: finance
    allowed_databases: [finance, sales]
    enabled_tables:
      - finance.orders
      - sales.orders
    transport: tcp
    auth:
      kind: kerberos
      principal: lucy@EXAMPLE.COM
      keytab_ref: secret://hive/prod.keytab
    tls:
      trust_material_ref: secret://hive/truststore.p12
      verify_server_certificate: true
`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const connection = parsed.value.connections[0]!;
    expect(connection.transport).toBe("tcp");
    expect(connection.allowedDatabases).toEqual(["finance", "sales"]);
    expect(connection.enabledTables).toEqual(["finance.orders", "sales.orders"]);
    expect(connection.auth.kind).toBe("kerberos");
    expect(connection.tls?.trustMaterialRef).toBe("secret://hive/truststore.p12");
    expect(connection.tls?.verifyServerCertificate).toBe(true);
    // 序列化后仍然只有引用，没有明文秘密。
    const serialized = serializeHiveConnections(parsed.value.connections);
    expect(serialized).toContain("keytab_ref");
    expect(serialized).not.toContain("password:");
  });

  it("HTTP transport 必须给 http_path；TCP transport 不得给 http_path", () => {
    const missingPath = parseHiveConnectionsYaml(`
version: 1
connections:
  reporting:
    host: knox.example.com
    port: 8443
    transport: http
    auth:
      kind: none
`);
    expect(missingPath.ok).toBe(false);

    const tcpWithPath = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    http_path: /cliservice
    auth:
      kind: none
`);
    expect(tcpWithPath.ok).toBe(false);
  });

  it("启用表必须是 database.table 全限定名，且落在 allowed_databases 内", () => {
    const bareTable = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    enabled_tables:
      - orders
    auth:
      kind: none
`);
    expect(bareTable.ok).toBe(false);

    const outsideScope = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    allowed_databases: [finance]
    enabled_tables:
      - sales.orders
    transport: tcp
    auth:
      kind: none
`);
    expect(outsideScope.ok).toBe(false);
  });

  it("仓库里的示例配置本身必须能被严格解析器接受", async () => {
    const examplePath = path.join(process.cwd(), "config", "hive-connections.example.yaml");
    const text = await readFile(examplePath, "utf8");
    const parsed = parseHiveConnectionsYaml(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // 示例覆盖 NONE / NOSASL 两种分开的认证形态。
    const kinds = parsed.value.connections.map((connection) => connection.auth.kind).sort();
    expect(kinds).toContain("none");
    expect(kinds).toContain("nosasl");
    // 示例里不出现明文秘密。
    expect(text).not.toMatch(/password\s*:/);
    expect(text).not.toMatch(/keytab\s*:/);
  });

  it("未知字段、未知认证方式、非法端口都显式失败", () => {
    const unknownField = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    auth:
      kind: none
    surprise: 1
`);
    expect(unknownField.ok).toBe(false);
    if (unknownField.ok) return;
    expect(unknownField.reason).toBe("hive_config_invalid");

    const unknownAuth = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    auth:
      kind: magic
`);
    expect(unknownAuth.ok).toBe(false);

    const badPort = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 99999
    transport: tcp
    auth:
      kind: none
`);
    expect(badPort.ok).toBe(false);
  });
});

describe("H2 统一连接视图", () => {
  it("合并 KTX 与 Hive 连接，连接 ID 全局唯一", () => {
    const merged = mergeUnifiedConnections(
      [ktxConnection("postgres_main")],
      [
        {
          id: "prod_hive",
          host: "hive.example.com",
          port: 10000,
          allowedDatabases: ["finance"],
          enabledTables: ["finance.orders"],
          transport: "tcp",
          auth: { kind: "none" }
        }
      ]
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.connections.map((connection) => connection.id)).toEqual([
      "postgres_main",
      "prod_hive"
    ]);
    expect(merged.connections.find((c) => c.id === "prod_hive")?.origin).toBe("hive");
    expect(merged.connections.find((c) => c.id === "postgres_main")?.origin).toBe("ktx");
  });

  it("连接 ID 冲突时失败关闭：不覆盖、不按优先级隐藏", () => {
    const merged = mergeUnifiedConnections(
      [ktxConnection("shared_id")],
      [
        {
          id: "shared_id",
          host: "hive.example.com",
          port: 10000,
          allowedDatabases: [],
          enabledTables: [],
          transport: "tcp",
          auth: { kind: "none" }
        }
      ]
    );
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.reason).toBe("hive_connection_id_conflict");
    expect(merged.conflictingId).toBe("shared_id");
    expect(merged.origins).toEqual(["ktx", "hive"]);
    // 冲突时不得给出任何一份"已合并"的视图。
    expect("connections" in merged).toBe(false);
  });
});

describe("H1 LDAP url 的形式校验", () => {
  const LDAP_WITH_INLINE_PASSWORD = `
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    auth:
      kind: ldap
      username: admin
      password_ref: secret://hive/ldap
      url: ldap://admin:s3cret@ldap.corp
`;

  it("url 里夹带的 user:pass@ 被判为非法配置，且理由码不泄露口令", () => {
    const parsed = parseHiveConnectionsYaml(LDAP_WITH_INLINE_PASSWORD);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    // 沿用仓库既有的理由码：内联秘密 → hive_config_secret_inline_forbidden。
    expect(parsed.reason).toBe("hive_config_secret_inline_forbidden");
    // 失败详情本身不得复述口令。
    expect(parsed.detail).not.toContain("s3cret");
    expect(parsed.detail).not.toContain("admin");
  });

  it("url 里的用户名也被拒绝：身份走 username 字段", () => {
    const parsed = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    auth:
      kind: ldap
      username: admin
      password_ref: secret://hive/ldap
      url: ldap://admin@ldap.corp
`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("hive_config_invalid");
    expect(parsed.detail).not.toContain("s3cret");
  });

  it("非 ldap/ldaps 的 url 与非法 url 都判为非法配置", () => {
    const wrongScheme = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    auth:
      kind: ldap
      username: admin
      password_ref: secret://hive/ldap
      url: http://ldap.corp
`);
    expect(wrongScheme.ok).toBe(false);
    if (wrongScheme.ok) return;
    expect(wrongScheme.reason).toBe("hive_config_invalid");

    const notAUrl = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    auth:
      kind: ldap
      username: admin
      password_ref: secret://hive/ldap
      url: ldap corp
`);
    expect(notAUrl.ok).toBe(false);
    if (notAUrl.ok) return;
    expect(notAUrl.reason).toBe("hive_config_invalid");
  });

  it("干净的 LDAP url 被接受，序列化后仍然没有明文口令", () => {
    const parsed = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    auth:
      kind: ldap
      username: reader
      password_ref: secret://hive/ldap
      url: ldaps://ldap.corp:389/dc=example,dc=com
`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const auth = parsed.value.connections[0]!.auth;
    expect(auth.kind).toBe("ldap");
    if (auth.kind !== "ldap") return;
    expect(auth.url).toBe("ldaps://ldap.corp:389/dc=example,dc=com");
    expect(auth.passwordRef).toBe("secret://hive/ldap");

    const serialized = serializeHiveConnections(parsed.value.connections);
    expect(serialized).toContain("ldaps://ldap.corp:389/dc=example,dc=com");
    expect(serialized).not.toContain("password:");
    expect(serialized).not.toContain("s3cret");
  });

  it("内嵌凭据的 url 也被通用值级扫描挡住（键名之外的藏法）", () => {
    // 同样的秘密藏在别的字段里：键名不是 password，值里却有 user:pass@。
    const parsed = parseHiveConnectionsYaml(`
version: 1
connections:
  prod:
    host: hive.example.com
    port: 10000
    transport: tcp
    auth:
      kind: ldap
      username: admin
      password_ref: secret://hive/ldap
      base_dn: "ldap://admin:s3cret@ldap.corp"
`);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toBe("hive_config_secret_inline_forbidden");
    expect(parsed.detail).not.toContain("s3cret");
  });
});
