import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { computeGold, generateDataset, MAINLINE_FIRST_QUESTION, MAINLINE_FOLLOW_UP } from "../../../examples/security-e2e/gold/v025-gold.mjs";
import { REPO_ROOT } from "../lib/common.mjs";
import { judgeMainlineAgent, loadMainlineAgentEvidence } from "../lib/j01-agent-evidence.mjs";

const gold = computeGold(generateDataset("0123456789abcdef")).questions;
const first = gold[MAINLINE_FIRST_QUESTION];
const follow = gold[MAINLINE_FOLLOW_UP];
const yuan = (cents) => (cents / 100).toFixed(2);

const binding = {
  runId: "run-1",
  instanceId: "inst-1",
  agentId: "agent-1",
  tokenLabel: "j25-label",
  semanticVersion: "sem-1",
  policyVersion: "pol-1"
};

function traceFor(callId, overrides = {}) {
  return {
    event: "tool_call",
    callId,
    tool: "lucy_query",
    ...binding,
    ...overrides
  };
}

function ask(question, questionId, extra = {}) {
  return {
    questionId,
    executedPrompt: question.question,
    transcriptText: "查询已返回",
    transcript: [{ role: "assistant", tool: "lucy_query", callId: `${questionId}-call` }],
    finalAnswer: `获客成本为 ${yuan(question.expected.cents)} 元`,
    clientSessionRef: "session-1",
    ...extra
  };
}

function passingFile() {
  return {
    asks: [ask(first, MAINLINE_FIRST_QUESTION), ask(follow, MAINLINE_FOLLOW_UP)],
    serverTrace: [traceFor(`${MAINLINE_FIRST_QUESTION}-call`), traceFor(`${MAINLINE_FOLLOW_UP}-call`)]
  };
}

function judgeFile(doc, bindingOverride = binding) {
  const dir = mkdtempSync(path.join(tmpdir(), "j01-agent-"));
  const file = path.join(dir, "j01-agent.json");
  writeFileSync(file, `${JSON.stringify(doc)}\n`);
  try {
    const loaded = loadMainlineAgentEvidence(file);
    return judgeMainlineAgent(loaded, gold, loaded.serverTrace, bindingOverride);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("SC-07 prompt evidence", () => {
  it("fails a prompt that differs from gold by one space after load", () => {
    const doc = passingFile();
    doc.asks[0].executedPrompt = `${first.question} `;
    const judged = judgeFile(doc);
    assert.equal(judged.status, "failed");
    assert.match(judged.reason, /prompt|换题/);
  });

  it("does not let the browser spec call the three asserts or read gold.expected", () => {
    const source = readFileSync(path.join(REPO_ROOT, "webui/tests/real-e2e/journey-v025.spec.ts"), "utf8");
    const agentLeg = source.split('test("J25-01 J01-07')[1] ?? "";
    assert.match(agentLeg, /loadMainlineAgentEvidence/);
    assert.match(agentLeg, /judgeMainlineAgent/);
    assert.doesNotMatch(agentLeg, /assertPromptUnchanged|assertNoGoldLeak|assertAgentOwnedCalls/);
    assert.doesNotMatch(source, /gold\.expected|first\.expected/);
    assert.doesNotMatch(source, /executedPrompt:\s*first\.question/);
  });
});

describe("SC-08 leak surfaces", () => {
  it("fails when transcriptText contains the gold amount", () => {
    const doc = passingFile();
    doc.asks[0].transcriptText = `查询结果 ${yuan(first.expected.cents)}`;
    const judged = judgeFile(doc);
    assert.equal(judged.status, "failed");
    assert.match(judged.reason, /leak|泄露/);
  });

  it("passes the leak check and the stage when only finalAnswer contains the amount", () => {
    const judged = judgeFile(passingFile());
    assert.equal(judged.status, "passed", judged.reason);
  });
});

describe("SC-09 stage conditions", () => {
  it("does not pass the listed failures, and a missing file is blocked", () => {
    const noTools = passingFile();
    noTools.asks[0].transcript = [];
    noTools.asks[1].transcript = [];
    assert.equal(judgeFile(noTools).status, "failed");

    const badId = passingFile();
    badId.asks[0].transcript = [{ role: "assistant", tool: "lucy_query", callId: "other-call" }];
    assert.equal(judgeFile(badId).status, "failed");

    const impersonated = passingFile();
    impersonated.asks[0].transcript = [{ ...traceFor(`${MAINLINE_FIRST_QUESTION}-call`), role: "assistant" }];
    assert.equal(judgeFile(impersonated).status, "failed");

    const wrongLabel = passingFile();
    wrongLabel.serverTrace = [
      traceFor(`${MAINLINE_FIRST_QUESTION}-call`, { tokenLabel: "other-label" }),
      traceFor(`${MAINLINE_FOLLOW_UP}-call`)
    ];
    assert.equal(judgeFile(wrongLabel).status, "failed");

    const wrongPolicy = passingFile();
    wrongPolicy.serverTrace = [
      traceFor(`${MAINLINE_FIRST_QUESTION}-call`, { policyVersion: "other-policy" }),
      traceFor(`${MAINLINE_FOLLOW_UP}-call`)
    ];
    assert.equal(judgeFile(wrongPolicy).status, "failed");

    const { tokenLabel, ...missingLabel } = binding;
    assert.equal(judgeFile(passingFile(), missingLabel).status, "failed");
    assert.equal(judgeFile(passingFile(), { ...missingLabel, tokenSecretRef: "secret://run/token" }).status, "failed");

    const wrongAnswer = passingFile();
    wrongAnswer.asks[0].finalAnswer = "获客成本为 1.00 元";
    assert.equal(judgeFile(wrongAnswer).status, "failed");

    const oneAsk = passingFile();
    oneAsk.asks = [oneAsk.asks[0]];
    assert.equal(judgeFile(oneAsk).status, "failed");

    const missing = loadMainlineAgentEvidence(path.join(tmpdir(), "missing-j01-agent.json"));
    assert.equal(missing.status, "blocked");
    assert.equal(judgeMainlineAgent(missing, gold, [], binding).status, "blocked");
  });
});
