/**
 * P0-3 SC-17 生产 HTTP：同一 MCP Bearer 不得经 /mcp/host/source-ambiguity/confirm 自证选表。
 * 覆盖：automation／缺 actor_kind／person 缺宿主头 → 403；确认失败后 lucy_query 仍 deny（零上游）。
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LUCY_HOST_ATTESTATION_HEADER } from "../proxy/source-ambiguity-journey";

const AGENT_TOKEN = "sag-agent-confirm-token";
const PERSON_TOKEN = "sag-person-confirm-token";
const AUTOMATION_TOKEN = "sag-auto-confirm-token";
const CONNECTION = "demo-mysql";
const SESSION_ID = "sag-confirm-session";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ACCESS_YAML = `users:
  - id: sag_agent
    name: SAG Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(AGENT_TOKEN)}"
        label: agent-token
        created: 2026-11-13
      - hash: "${tokenHash(AUTOMATION_TOKEN)}"
        label: auto-token
        actor_id: bot-1
        actor_kind: automation
        created: 2026-11-13
      - hash: "${tokenHash(PERSON_TOKEN)}"
        label: person-token
        actor_id: user-1
        actor_kind: person
        created: 2026-11-13
    allow:
      tables:
        - s.a
        - s.b
      tools:
        - lucy_query
        - lucy_explain_query
        - lucy_begin_question
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  a:
    table: s.a
    descriptions:
      db: 销售收入金额
  b:
    table: s.b
    descriptions:
      db: 营业收入金额
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;
let previousBudget: string | undefined;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "sag-host-confirm-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  const schemaDir = path.join(projectRoot, "semantic-layer", CONNECTION, "_schema");
  await mkdir(schemaDir, { recursive: true });
  await writeFile(path.join(schemaDir, "dataforai.yaml"), SCHEMA_YAML, "utf8");

  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  previousBudget = process.env.LUCY_QUESTION_BUDGET;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_QUESTION_BUDGET = "off";
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousUpstreamHost === undefined) delete process.env.LUCY_PROXY_UPSTREAM_HOST;
  else process.env.LUCY_PROXY_UPSTREAM_HOST = previousUpstreamHost;
  if (previousUpstreamPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
  else process.env.LUCY_PROXY_UPSTREAM_PORT = previousUpstreamPort;
  if (previousBudget === undefined) delete process.env.LUCY_QUESTION_BUDGET;
  else process.env.LUCY_QUESTION_BUDGET = previousBudget;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

async function withProxy(run: (port: number, upstreamHits: () => number) => Promise<void>) {
  let hits = 0;
  const upstream = createServer(async (_req: IncomingMessage, res) => {
    hits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: { content: [{ type: "text", text: "upstream-ok" }] }
      })
    );
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

  const { buildProxy } = await import("../proxy/mcp-proxy");
  const { resetEffectivePolicyForTests } = await import("../proxy/acl");
  resetEffectivePolicyForTests();
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(port, () => hits);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}

describe("P0-3 SC-17 host confirm HTTP", () => {
  it("same Bearer without person+host attestation gets 403; query still deny with zero upstream", async () => {
    await withProxy(async (port, upstreamHits) => {
      const { SOURCE_AMBIGUITY_CONFIRM_PATH } = await import("../proxy/mcp-proxy");
      const confirmUrl = `http://127.0.0.1:${port}${SOURCE_AMBIGUITY_CONFIRM_PATH}`;
      const selectedIdentity = {
        connectionId: CONNECTION,
        schema: "dataforai",
        sourceName: "a",
        physicalTable: "s.a"
      };
      const confirmBody = JSON.stringify({
        sessionId: SESSION_ID,
        generation: 1,
        selectedIdentity
      });

      // Agent token（无 actor_kind）+ 伪造宿主头 → 仍 403
      const agentRes = await fetch(confirmUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${AGENT_TOKEN}`,
          "x-lucy-session-id": SESSION_ID,
          [LUCY_HOST_ATTESTATION_HEADER]: "webui"
        },
        body: confirmBody
      });
      expect(agentRes.status).toBe(403);
      const agentJson = (await agentRes.json()) as { reason?: string };
      expect(agentJson.reason).toBe("host_confirm_requires_person");

      // automation + 宿主头 → 403
      const autoRes = await fetch(confirmUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${AUTOMATION_TOKEN}`,
          "x-lucy-session-id": SESSION_ID,
          [LUCY_HOST_ATTESTATION_HEADER]: "webui"
        },
        body: confirmBody
      });
      expect(autoRes.status).toBe(403);

      // person 缺宿主头 → 403
      const personNoHeader = await fetch(confirmUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${PERSON_TOKEN}`,
          "x-lucy-session-id": SESSION_ID
        },
        body: confirmBody
      });
      expect(personNoHeader.status).toBe(403);
      const personJson = (await personNoHeader.json()) as { reason?: string };
      expect(personJson.reason).toBe("host_attestation_header_missing");

      // person + 宿主头：准入通过（可能 409 缺快照），不得 403
      const personOk = await fetch(confirmUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${PERSON_TOKEN}`,
          "x-lucy-session-id": SESSION_ID,
          [LUCY_HOST_ATTESTATION_HEADER]: "webui"
        },
        body: confirmBody
      });
      expect(personOk.status).not.toBe(403);
      expect([200, 409]).toContain(personOk.status);

      // Agent 自证失败后：begin + query 仍因歧义 deny，零上游
      const before = upstreamHits();
      await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${AGENT_TOKEN}`,
          "x-lucy-session-id": SESSION_ID
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "begin-1",
          method: "tools/call",
          params: {
            name: "lucy_begin_question",
            arguments: { intentSummary: "今年收入是多少", question: "今年收入是多少" }
          }
        })
      });
      const queryRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${AGENT_TOKEN}`,
          "x-lucy-session-id": SESSION_ID
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "query-1",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: CONNECTION,
              sourceName: "a",
              measures: ["a.amt"]
            }
          }
        })
      });
      const queryBody = (await queryRes.json()) as {
        result?: { isError?: boolean; content?: Array<{ text?: string }> };
      };
      const text = queryBody.result?.content?.[0]?.text ?? JSON.stringify(queryBody);
      expect(queryBody.result?.isError === true || /source_ambiguity_gate|表级歧义/.test(text)).toBe(
        true
      );
      expect(upstreamHits()).toBe(before);
    });
  });
});
