// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseMysqlAliyunCredentialsFile, parseWebuiLoginFile } from "./external-secrets";

describe("parseMysqlAliyunCredentialsFile", () => {
  it("keeps passwords that contain # (must not truncate at hash)", () => {
    const text = [
      "# 有效",
      "",
      "Hostname:",
      "",
      "db.example.internal",
      "Port:3306",
      "",
      "Username:reader_bot",
      "Password:AbC#def!99",
      "",
      "",
      "# 以下已失效",
      "",
      "Hostname:",
      "old.example.internal",
      "Port:3306",
      "",
      "Username:old_user",
      "Password: OldSecret!"
    ].join("\n");

    const creds = parseMysqlAliyunCredentialsFile(text);
    expect(creds.host).toBe("db.example.internal");
    expect(creds.port).toBe(3306);
    expect(creds.username).toBe("reader_bot");
    expect(creds.password).toBe("AbC#def!99");
    expect(creds.password.includes("#")).toBe(true);
  });

  it("ignores the expired section after # 有效", () => {
    const text = `# 有效
Hostname:
live.host
Port:3307
Username:u1
Password:p1#x

# 以下已失效
Hostname:
dead.host
Username:u2
Password:p2`;
    const creds = parseMysqlAliyunCredentialsFile(text);
    expect(creds.host).toBe("live.host");
    expect(creds.port).toBe(3307);
    expect(creds.username).toBe("u1");
    expect(creds.password).toBe("p1#x");
  });
});

describe("parseWebuiLoginFile", () => {
  it("reads adminId from the first non-empty line and password from the third", () => {
    const login = parseWebuiLoginFile("\nadmin_one\n\nspare@example.com\n\nsecret-value-10\n");
    expect(login.adminId).toBe("admin_one");
    expect(login.password).toBe("secret-value-10");
  });
});
