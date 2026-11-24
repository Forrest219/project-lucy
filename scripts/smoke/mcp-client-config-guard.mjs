import fs from "node:fs";
import path from "node:path";

export function loadRepoMcpJson(repoRoot) {
  const file = path.join(repoRoot, ".mcp.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Fail closed on legacy lucy-skills /mcp/skills client entries.
 * Spec: docs/specs/lucy-20261111-mcp-client-skill-endpoint-fix-spec.md D1–D2.
 */
export function assertMcpClientConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("mcp client config must be an object");
  }
  const servers = config.mcpServers;
  if (!servers || typeof servers !== "object") {
    throw new Error("mcpServers missing");
  }
  for (const [name, server] of Object.entries(servers)) {
    if (name === "lucy-skills") {
      throw new Error("legacy server name lucy-skills is forbidden in repo client config");
    }
    const url = server && typeof server.url === "string" ? server.url : "";
    if (!url) throw new Error(`mcp server ${name} missing url`);
    let pathname;
    try {
      pathname = new URL(url).pathname.replace(/\/+$/, "") || "/";
    } catch {
      throw new Error(`mcp server ${name} has invalid url: ${url}`);
    }
    if (pathname === "/mcp/skills" || pathname.startsWith("/mcp/skills/")) {
      throw new Error(`mcp server ${name} must not target legacy /mcp/skills (got ${url})`);
    }
    if (name === "lucy" && pathname !== "/mcp") {
      throw new Error(`mcp server lucy url pathname must be /mcp (got ${pathname})`);
    }
  }
  if (!servers.lucy) {
    throw new Error("repo client config must define mcpServers.lucy");
  }
}
