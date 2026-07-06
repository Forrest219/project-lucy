import assert from "node:assert/strict";
import test from "node:test";
import { parse as parseYaml } from "yaml";

import {
  buildTemporaryAccessConfig,
  localAgentCommands,
  parseArgs,
  redactText,
  stripRuntimeTokens,
  tokenHash
} from "./p1-agent-e2e-local-hermes.mjs";

const ACCESS_FIXTURE = `
roles:
  kx_readonly:
    allow:
      connections:
        - mysql-aliyun
users:
  - id: workhorse
    name: Hermes Workhorse
    enabled: true
    tokens:
      - hash: sha256:oldshared
        label: hermes-workhorse
        created: 2026-06-20
      - hash: sha256:olde2e
        label: lucy-e2e-workhorse
        created: 2026-07-06
    role: kx_readonly
`;

test("temporary access config adds runtime hashes without plaintext tokens", () => {
  const hermesPlain = "lucy_e2e_hermes_plain";
  const mozPlain = "lucy_e2e_moz_plain";
  const yaml = buildTemporaryAccessConfig(ACCESS_FIXTURE, {
    hermesHash: tokenHash(hermesPlain),
    mozHash: tokenHash(mozPlain),
    created: "2026-07-06"
  });
  assert.equal(yaml.includes(hermesPlain), false);
  assert.equal(yaml.includes(mozPlain), false);
  assert.equal(yaml.includes("sha256:olde2e"), false);

  const parsed = parseYaml(yaml);
  const workhorse = parsed.users.find((user) => user.id === "workhorse");
  const moz = parsed.users.find((user) => user.id === "moz");
  assert(workhorse.tokens.some((token) => token.label === "hermes-workhorse"));
  assert(workhorse.tokens.some((token) => token.label === "lucy-e2e-workhorse-runtime"));
  assert.equal(moz.role, "kx_readonly");
  assert.equal(moz.tokens[0].label, "lucy-e2e-moz-runtime");
});

test("runtime token stripping is label-scoped", () => {
  const tokens = stripRuntimeTokens([
    { label: "hermes-workhorse" },
    { label: "lucy-e2e-old" },
    { label: "lucy-mcp-dev-v4" }
  ]);
  assert.deepEqual(tokens.map((token) => token.label), ["hermes-workhorse", "lucy-mcp-dev-v4"]);
});

test("local Hermes command templates select workhorse and moz profiles", () => {
  const commands = localAgentCommands();
  assert(commands.hermes.includes("HERMES_HOME=/Users/forrest/.hermes/profiles/workhorse"));
  assert(commands.moz.includes("HERMES_HOME=/Users/forrest/.hermes/profiles/moz"));
  assert(commands.hermes.includes("--accept-hooks"));
  assert(commands.moz.includes("--max-turns"));
});

test("parseArgs supports repeatable local harness knobs", () => {
  const args = parseArgs([
    "node",
    "scripts/p1-agent-e2e-local-hermes.mjs",
    "--replace-existing",
    "--keep-services",
    "--agent-timeout-ms",
    "12345",
    "--html-report",
    "inbox/custom-report.html",
    "--dry-run"
  ]);
  assert.equal(args.replaceExisting, true);
  assert.equal(args.keepServices, true);
  assert.equal(args.agentTimeoutMs, 12345);
  assert.equal(args.htmlReport, "inbox/custom-report.html");
  assert.equal(args.dryRun, true);
});

test("redaction removes explicit runtime token and bearer forms", () => {
  const redacted = redactText("Authorization: Bearer abc.def token=abc.def", ["abc.def"]);
  assert.equal(redacted.includes("abc.def"), false);
  assert(redacted.includes("Bearer [REDACTED]") || redacted.includes("[REDACTED]"));
});
