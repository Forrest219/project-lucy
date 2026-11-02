import { describe, expect, it } from "vitest";
import { accountEmailTaken, normalizeAccountEmail } from "../auth/account-email.js";
import type { AdminsConfig } from "../auth/admins-store.js";

describe("normalizeAccountEmail", () => {
  it("treats an empty string as no email", () => {
    expect(normalizeAccountEmail("")).toEqual({ ok: true, email: null });
  });

  it("rejects any whitespace instead of trimming it away", () => {
    expect(normalizeAccountEmail(" zhang@example.com")).toEqual({
      ok: false,
      message: "邮箱不能包含空格"
    });
    expect(normalizeAccountEmail("zhang@example.com ")).toMatchObject({ ok: false, message: "邮箱不能包含空格" });
    expect(normalizeAccountEmail("zhang @example.com")).toMatchObject({ ok: false, message: "邮箱不能包含空格" });
    expect(normalizeAccountEmail("zhang@example.com\n")).toMatchObject({ ok: false, message: "邮箱不能包含空格" });
  });

  it("stores letters in lowercase", () => {
    expect(normalizeAccountEmail("Zhang@Example.COM")).toEqual({
      ok: true,
      email: "zhang@example.com"
    });
  });

  it("requires @ and a dotted suffix such as .com", () => {
    expect(normalizeAccountEmail("zhang.example.com")).toEqual({
      ok: false,
      message: "邮箱需要包含 @"
    });
    expect(normalizeAccountEmail("@example.com")).toMatchObject({ ok: false, message: "邮箱需要包含 @" });
    expect(normalizeAccountEmail("zhang@")).toMatchObject({
      ok: false,
      message: "邮箱需要包含域名后缀（如 .com）"
    });
    expect(normalizeAccountEmail("zhang@example")).toEqual({
      ok: false,
      message: "邮箱需要包含域名后缀（如 .com）"
    });
    expect(normalizeAccountEmail("zhang@example.c")).toMatchObject({
      ok: false,
      message: "邮箱需要包含域名后缀（如 .com）"
    });
    expect(normalizeAccountEmail("zhang@example.com")).toEqual({
      ok: true,
      email: "zhang@example.com"
    });
    expect(normalizeAccountEmail("zhang@example.com.cn")).toEqual({
      ok: true,
      email: "zhang@example.com.cn"
    });
  });

  it("accepts an apostrophe, a leading underscore, and a trailing plus", () => {
    expect(normalizeAccountEmail("o'connor@example.com")).toEqual({
      ok: true,
      email: "o'connor@example.com"
    });
    expect(normalizeAccountEmail("_user@example.com")).toEqual({
      ok: true,
      email: "_user@example.com"
    });
    expect(normalizeAccountEmail("user+@example.com")).toEqual({
      ok: true,
      email: "user+@example.com"
    });
    expect(normalizeAccountEmail(".user@example.com")).toMatchObject({ ok: false, message: "邮箱格式不正确" });
    expect(normalizeAccountEmail("user.@example.com")).toMatchObject({ ok: false, message: "邮箱格式不正确" });
    expect(normalizeAccountEmail("user..name@example.com")).toMatchObject({ ok: false, message: "邮箱格式不正确" });
  });

  it("rejects more than one @ and enforces the 2–24 letter suffix boundary", () => {
    expect(normalizeAccountEmail("a@b@example.com")).toMatchObject({
      ok: false,
      message: "邮箱需要包含 @"
    });
    expect(normalizeAccountEmail("user@example.abcdefghijklmnopqrstuvwx")).toEqual({
      ok: true,
      email: "user@example.abcdefghijklmnopqrstuvwx"
    });
    expect(normalizeAccountEmail("user@example.abcdefghijklmnopqrstuvwxy")).toMatchObject({
      ok: false,
      message: "邮箱需要包含域名后缀（如 .com）"
    });
  });
});

describe("accountEmailTaken", () => {
  const config: AdminsConfig = {
    version: "1",
    admins: [
      {
        id: "owner1",
        display_name: "Owner",
        role: "owner",
        enabled: true,
        created_at: "2026-11-02T00:00:00.000Z",
        email: "owner@example.com"
      }
    ]
  };

  it("matches an existing account email without regard to case", () => {
    expect(accountEmailTaken(config, "Owner@Example.COM")).toBe(true);
    expect(accountEmailTaken(config, "Owner@Example.COM", "owner1")).toBe(false);
    expect(accountEmailTaken(config, "other@example.com")).toBe(false);
  });
});
