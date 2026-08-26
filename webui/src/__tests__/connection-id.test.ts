import { describe, expect, it } from "vitest";
import {
  CONNECTION_ID_PATTERN,
  CONNECTION_ID_RULE_HINT,
  defaultPortForDriver,
  validateConnectionId
} from "../lib/connectionId";

describe("connectionId helpers", () => {
  it("accepts valid ids and rejects empty / pattern / duplicate", () => {
    expect(validateConnectionId("demo-mysql")).toBeNull();
    expect(validateConnectionId("")).toMatchObject({ code: "empty" });
    expect(validateConnectionId("1bad")).toMatchObject({
      code: "pattern",
      message: "连接 ID 不符合命名规则"
    });
    expect(validateConnectionId("1bad")?.message).not.toMatch(/\^\[/);
    expect(validateConnectionId("demo_mysql", ["Demo_MySQL"])).toMatchObject({
      code: "duplicate"
    });
  });

  it("exports the server-aligned pattern, human hint, and default ports", () => {
    expect(CONNECTION_ID_PATTERN).toBe("^[a-z][a-z0-9_-]{1,63}$");
    expect(CONNECTION_ID_RULE_HINT).toContain("小写字母开头");
    expect(defaultPortForDriver("mysql")).toBe(3306);
    expect(defaultPortForDriver("postgres")).toBe(5432);
  });
});
