import { describe, expect, it } from "vitest";
import {
  classifyConnectionError,
  formatConnectionErrorMessage
} from "../connection-errors";

describe("connection-errors", () => {
  it("classifies StarRocks max_execution_time", () => {
    const g = classifyConnectionError(
      "Project: /data/lucy\nUnknown system variable 'max_execution_time'"
    );
    expect(g.category).toBe("starrocks_max_execution_time");
    expect(g.actions[0]).toMatch(/补丁/);
  });

  it("classifies uv runtime download failure", () => {
    const g = classifyConnectionError("ktx could not download uv 0.11.21");
    expect(g.category).toBe("ktx_runtime_uv");
  });

  it("formatConnectionErrorMessage includes actionable hint", () => {
    const msg = formatConnectionErrorMessage("Unknown system variable 'max_execution_time'");
    expect(msg).toMatch(/max_execution_time|StarRocks/);
    expect(msg).toMatch(/建议/);
  });

  // T12 — DNS vs transport vs auth must stay split so a refused connection is
  // never misreported as a credential failure, and a successful DNS lookup that
  // later gets ECONNREFUSED lands in the network bucket, not the DNS one.
  it("T12: ENOTFOUND lands in dns, ECONNREFUSED stays in network, auth is independent", () => {
    const dns = classifyConnectionError("Error: getaddrinfo ENOTFOUND warehouse.local");
    expect(dns.category).toBe("dns");
    expect(dns.title).toBe("DNS 解析失败");
    expect(dns.actions.some((a) => a.includes("nslookup") || a.includes("search domain"))).toBe(true);

    const transport = classifyConnectionError("connect ECONNREFUSED 10.0.0.5:3306");
    expect(transport.category).toBe("network");
    expect(transport.title).toBe("网络连通");

    const timeout = classifyConnectionError("connect ETIMEDOUT 10.0.0.5:3306");
    expect(timeout.category).toBe("network");

    const auth = classifyConnectionError("Access denied for user 'reader'@'10.0.0.5' (using password: YES)");
    expect(auth.category).toBe("auth");
    expect(auth.title).toBe("认证失败");
  });

  it("T12: missing library / missing table is its own category, not network", () => {
    const missingTable = classifyConnectionError("ERROR 1146 (42S02): Table 'warehouse.orders' doesn't exist");
    expect(missingTable.category).toBe("missing_target");
    expect(missingTable.title).toBe("目标对象缺失");
    expect(missingTable.actions[0]).toContain("启用表范围");
    // T12 — never use 白名单 in user-facing titles / actions.
    expect(JSON.stringify(missingTable)).not.toContain("白名单");

    const missingLibrary = classifyConnectionError("library not found: libmysqlclient.so.21");
    expect(missingLibrary.category).toBe("missing_target");
  });

  it("T12: no user-facing string writes 白名单", () => {
    for (const raw of [
      "ECONNREFUSED 1.2.3.4:3306",
      "Access denied for user",
      "ENOTFOUND db.local",
      "Table 'x' doesn't exist",
      "Unknown system variable 'max_execution_time'",
      "could not download uv"
    ]) {
      const g = classifyConnectionError(raw);
      const dump = `${g.title} ${g.summary} ${g.actions.join(" ")}`;
      expect(dump).not.toContain("白名单");
    }
  });
});
