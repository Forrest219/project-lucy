import { describe, expect, it } from "vitest";
import {
  CONNECTION_ID_PATTERN,
  defaultPortForDriver,
  validateConnectionId
} from "../lib/connectionId";

describe("connectionId helpers", () => {
  it("accepts valid ids and rejects empty / pattern / duplicate", () => {
    expect(validateConnectionId("demo-mysql")).toBeNull();
    expect(validateConnectionId("")).toMatchObject({ code: "empty" });
    expect(validateConnectionId("1bad")).toMatchObject({ code: "pattern" });
    expect(validateConnectionId("demo_mysql", ["Demo_MySQL"])).toMatchObject({
      code: "duplicate"
    });
  });

  it("exports the server-aligned pattern and default ports", () => {
    expect(CONNECTION_ID_PATTERN).toBe("^[a-z][a-z0-9_-]{1,63}$");
    expect(defaultPortForDriver("mysql")).toBe(3306);
    expect(defaultPortForDriver("postgres")).toBe(5432);
  });
});
