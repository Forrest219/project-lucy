import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMcpClientConfig, loadRepoMcpJson } from "./mcp-client-config-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("rejects legacy lucy-skills /mcp/skills client entry", () => {
  assert.throws(
    () =>
      assertMcpClientConfig({
        mcpServers: {
          "lucy-skills": {
            type: "http",
            url: "http://localhost:7879/mcp/skills",
            headers: { Authorization: "Bearer ${LUCY_LOCAL_TOKEN}" }
          }
        }
      }),
    /mcp\/skills|lucy-skills/
  );
});

test("accepts single lucy server on /mcp", () => {
  assert.doesNotThrow(() =>
    assertMcpClientConfig({
      mcpServers: {
        lucy: {
          type: "http",
          url: "http://127.0.0.1:57881/mcp",
          headers: { Authorization: "Bearer ${LUCY_LOCAL_TOKEN}" }
        }
      }
    })
  );
});

test("repo .mcp.json passes the guard", () => {
  const cfg = loadRepoMcpJson(repoRoot);
  assert.doesNotThrow(() => assertMcpClientConfig(cfg));
  const lucy = cfg.mcpServers.lucy;
  assert.equal(typeof lucy.url, "string");
  assert.match(lucy.url, /\/mcp$/);
  assert.doesNotMatch(lucy.url, /\/mcp\/skills/);
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.mcpServers, "lucy-skills"), false);
});
