import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SC-08 of lucy-20261101-token-default-ttl-365-spec:
 * Admin New Token default 365 must not change Onboarding Step6 short window (7 days).
 */
describe("token-default-ttl-365 SC-08 Step6 short window", () => {
  it("Step6ConnectAgent keeps useState(7) and does not default to 365", () => {
    const src = readFileSync(
      join(__dirname, "../components/onboarding/Step6ConnectAgent.tsx"),
      "utf8"
    );
    expect(src).toMatch(/useState\(\s*7\s*\)/);
    expect(src).not.toMatch(/useState\(\s*365\s*\)/);
  });
});
