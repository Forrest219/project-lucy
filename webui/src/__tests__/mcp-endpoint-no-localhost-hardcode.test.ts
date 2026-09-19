import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HARDCODED_LOCAL_MCP = /https?:\/\/(localhost|127\.0\.0\.1):7879(?:\/mcp)?/g;

/** Production frontend surfaces that must not invent local MCP Advertise URLs. */
const SCOPES = [
  "lib/mcpEndpoint.ts",
  "lib/setupAssistant.ts",
  "components/onboarding/Step6ConnectAgent.tsx",
  "pages/Onboarding.tsx",
  "pages/admin/NewToken.tsx",
  "pages/admin/AgentList.tsx"
];

function collectFiles(relPaths: string[]): string[] {
  const out: string[] = [];
  for (const rel of relPaths) {
    const abs = path.join(SRC_ROOT, rel);
    const st = statSync(abs);
    if (st.isFile()) out.push(abs);
  }
  return out;
}

describe("MCP config surfaces must not hardcode localhost Advertise URLs", () => {
  it("keeps agent-facing MCP builders free of localhost/127.0.0.1:7879 defaults", () => {
    const offenders: string[] = [];
    for (const file of collectFiles(SCOPES)) {
      const text = readFileSync(file, "utf8");
      const matches = text.match(HARDCODED_LOCAL_MCP);
      if (matches?.length) {
        offenders.push(`${path.relative(SRC_ROOT, file)}: ${matches.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not leave stray localhost:7879 literals under webui/src outside tests", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "__tests__" || name === "node_modules") continue;
        const abs = path.join(dir, name);
        const st = statSync(abs);
        if (st.isDirectory()) {
          walk(abs);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(abs, "utf8");
        if (/localhost:7879/.test(text)) {
          offenders.push(path.relative(SRC_ROOT, abs));
        }
      }
    };
    walk(SRC_ROOT);
    expect(offenders).toEqual([]);
  });
});
