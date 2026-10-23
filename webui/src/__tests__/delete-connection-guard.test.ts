import { describe, expect, it } from "vitest";
import {
  connectionDeleteBlockText,
  connectionDeleteIsBlocked,
  messageForConnectionReferences,
  resolveConnectionDeleteBlockers
} from "../lib/deleteConnectionGuard";

describe("connection delete reference copy", () => {
  it("names only the hard references that are actually present", () => {
    expect(
      connectionDeleteBlockText("mysql-aliyun", [
        { kind: "role_connection", id: "finance_readonly" },
        { kind: "role_selector", id: "finance_readonly" },
        { kind: "identity", id: "demo_agent" },
        { kind: "wiki", id: "wiki/global/playbook.md" }
      ], false)
    ).toBe(
      "无法删除连接 mysql-aliyun。它仍被角色、用户和业务 Wiki 引用，需要先改掉这些引用。"
    );
  });

  it("drops local YAML from the block once deleteAssets is set, and keeps roles", () => {
    const blockers = [
      { kind: "role_connection" as const, id: "finance_readonly" },
      { kind: "semantic_asset" as const, id: "semantic-layer/mysql-aliyun/orders.yaml" }
    ];
    expect(connectionDeleteIsBlocked(blockers, false)).toBe(true);
    expect(connectionDeleteIsBlocked(blockers, true)).toBe(true);
    expect(connectionDeleteBlockText("mysql-aliyun", blockers, true)).toBe(
      "无法删除连接 mysql-aliyun。它仍被角色 引用，需要先改掉这些引用。"
    );
  });

  it("stops blocking when local YAML is the only reference and deleteAssets is set", () => {
    const blockers = [
      { kind: "semantic_asset" as const, id: "semantic-layer/mysql-aliyun/orders.yaml" }
    ];
    expect(connectionDeleteBlockText("mysql-aliyun", blockers, false)).toBe(
      "无法删除连接 mysql-aliyun。本地语义文件可勾选「同时删除本地 YAML 资产」后一并删除。"
    );
    expect(connectionDeleteIsBlocked(blockers, true)).toBe(false);
    expect(connectionDeleteBlockText("mysql-aliyun", blockers, true)).toBeNull();
  });

  it("keeps a pre-guard preview blocking when summaries still list references", () => {
    const blockers = resolveConnectionDeleteBlockers({
      aclRoleIds: ["finance_readonly"],
      wikiRefCount: 1,
      wikiSamplePaths: [],
      yamlAssetPaths: []
    });
    expect(connectionDeleteIsBlocked(blockers, true)).toBe(true);
    expect(connectionDeleteBlockText("mysql-aliyun", blockers, true)).toContain("角色");
    expect(connectionDeleteBlockText("mysql-aliyun", blockers, true)).toContain("业务 Wiki");
  });

  it("builds the rejection sentence from the 409 detail and hides the stable code", () => {
    const text = messageForConnectionReferences(
      "mysql-aliyun",
      { blockers: [{ kind: "identity", id: "demo_agent" }] },
      false
    );
    expect(text).toBe("无法删除连接 mysql-aliyun。它仍被用户 引用，需要先改掉这些引用。");
    expect(text).not.toContain("connection_references_remain");
  });
});