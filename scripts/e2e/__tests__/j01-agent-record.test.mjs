// Contract tests for the J01-07 evidence record: the builder that assembles
// `results/j01-agent.json` from what a run ACTUALLY produced, and the projection
// that reads the two mainline questions out of the runner's ask records.
//
// The point of these tests is negative as much as positive: the document must
// never be assembled from gold. `executedPrompt` is the string the client was
// actually given; `finalAnswer` is the string the client actually answered.
// A builder that fills either from gold would make 防静默换题 / typed gold
// compare gold with gold and pass by construction.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  MAINLINE_FIRST_QUESTION,
  MAINLINE_FOLLOW_UP,
  computeGold,
  generateDataset
} from "../../../examples/security-e2e/gold/v025-gold.mjs";
import { REPO_ROOT } from "../lib/common.mjs";
import { loadMainlineAgentEvidence } from "../lib/j01-agent-evidence.mjs";
import {
  buildMainlineAgentDocument,
  projectMainlineAgentDocument,
  writeMainlineAgentEvidence
} from "../lib/j01-agent-record.mjs";

const gold = computeGold(generateDataset("0123456789abcdef")).questions;
const first = gold[MAINLINE_FIRST_QUESTION];
const follow = gold[MAINLINE_FOLLOW_UP];

/** The runner appends this to a question that asks for a typed answer. */
const PROMPT_SUFFIX = "请用中文回答，金额精确到分（元，保留两位小数），并说明口径。";

/** The only fields a document's ask may carry (Spec §3). */
const DOCUMENT_ASK_FIELDS = ["questionId", "executedPrompt", "transcriptText", "transcript", "finalAnswer", "clientSessionRef"];

function toolCall(questionId) {
  return { role: "assistant", tool: "lucy_query", callId: `${questionId}-call` };
}

/** A capture ask, in the DOCUMENT shape the builder consumes. */
function captureAsk(questionId, overrides = {}) {
  const question = questionId === MAINLINE_FIRST_QUESTION ? first : follow;
  return {
    questionId,
    executedPrompt: `${question.question} ${PROMPT_SUFFIX}`,
    transcriptText: "客户端调用了 lucy_query 并返回结果",
    transcript: [toolCall(questionId)],
    finalAnswer: `获客成本为 ${(question.expected.cents / 100).toFixed(2)} 元`,
    clientSessionRef: "session-1",
    ...overrides
  };
}

function capture(overrides = {}) {
  return {
    asks: [captureAsk(MAINLINE_FIRST_QUESTION), captureAsk(MAINLINE_FOLLOW_UP)],
    serverTrace: [
      { event: "tool_call", callId: `${MAINLINE_FIRST_QUESTION}-call`, tool: "lucy_query" },
      { event: "tool_call", callId: `${MAINLINE_FOLLOW_UP}-call`, tool: "lucy_query" }
    ],
    ...overrides
  };
}

/** An ask record in the RUNNER shape (answer / sessionId), not the document shape. */
function askRecord(questionId, overrides = {}) {
  const question = questionId === MAINLINE_FIRST_QUESTION ? first : follow;
  return {
    questionId,
    executedPrompt: `${question.question} ${PROMPT_SUFFIX}`,
    transcriptText: "客户端调用了 lucy_query 并返回结果",
    transcript: [toolCall(questionId)],
    answer: `获客成本为 ${(question.expected.cents / 100).toFixed(2)} 元`,
    sessionId: "session-1",
    serverTrace: [{ event: "tool_call", callId: `${questionId}-call`, tool: "lucy_query" }],
    ...overrides
  };
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "j01-agent-record-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("buildMainlineAgentDocument", () => {
  it("builds a document a complete capture fills, and the evidence reader reads it back", () => {
    const built = buildMainlineAgentDocument(capture());
    assert.equal(built.ok, true, built.reason);
    assert.equal(built.document.asks.length, 2);
    assert.equal(built.document.asks[0].questionId, MAINLINE_FIRST_QUESTION);
    assert.equal(built.document.asks[1].questionId, MAINLINE_FOLLOW_UP);
    assert.equal(built.document.asks[0].clientSessionRef, built.document.asks[1].clientSessionRef);
    assert.equal(built.document.serverTrace.length, 2);

    withTempDir((dir) => {
      const file = path.join(dir, "j01-agent.json");
      writeFileSync(file, `${JSON.stringify(built.document)}\n`);
      const loaded = loadMainlineAgentEvidence(file);
      assert.equal(loaded.status, "loaded");
      assert.equal(loaded.asks.length, 2);
      assert.equal(loaded.asks[0].executedPrompt, built.document.asks[0].executedPrompt);
      assert.equal(loaded.serverTrace.length, 2);
    });
  });

  it("keeps only the six document fields on every ask", () => {
    const built = buildMainlineAgentDocument(capture({
      asks: [captureAsk(MAINLINE_FIRST_QUESTION, { goldKey: "Q-CAC-28D", tokenFingerprint: "fp" }), captureAsk(MAINLINE_FOLLOW_UP)]
    }));
    assert.equal(built.ok, true, built.reason);
    for (const ask of built.document.asks) {
      assert.deepEqual(Object.keys(ask).sort(), [...DOCUMENT_ASK_FIELDS].sort());
    }
  });

  it("fails when the executed prompt is missing, and never substitutes the gold question", () => {
    const built = buildMainlineAgentDocument(capture({
      asks: [captureAsk(MAINLINE_FIRST_QUESTION, { executedPrompt: "" }), captureAsk(MAINLINE_FOLLOW_UP)]
    }));
    assert.equal(built.ok, false);
    assert.equal(built.document, undefined);
    assert.match(built.reason, /prompt/i);
    assert.doesNotMatch(JSON.stringify(built), /最近 28 天的获客成本/);
  });

  it("fails when the final answer is missing", () => {
    const built = buildMainlineAgentDocument(capture({
      asks: [captureAsk(MAINLINE_FIRST_QUESTION, { finalAnswer: "" }), captureAsk(MAINLINE_FOLLOW_UP)]
    }));
    assert.equal(built.ok, false);
    assert.equal(built.document, undefined);
    assert.match(built.reason, /answer/i);
  });

  it("fails when the transcript is missing", () => {
    const missingArray = buildMainlineAgentDocument(capture({
      asks: [captureAsk(MAINLINE_FIRST_QUESTION, { transcript: [] }), captureAsk(MAINLINE_FOLLOW_UP)]
    }));
    assert.equal(missingArray.ok, false);
    assert.equal(missingArray.document, undefined);

    const missingText = buildMainlineAgentDocument(capture({
      asks: [captureAsk(MAINLINE_FIRST_QUESTION, { transcriptText: "" }), captureAsk(MAINLINE_FOLLOW_UP)]
    }));
    assert.equal(missingText.ok, false);
    assert.equal(missingText.document, undefined);
  });

  it("fails when only one of the two questions was asked", () => {
    const built = buildMainlineAgentDocument(capture({ asks: [captureAsk(MAINLINE_FIRST_QUESTION)] }));
    assert.equal(built.ok, false);
    assert.equal(built.document, undefined);
    assert.match(built.reason, /ask/i);
  });

  it("fails when the two questions were asked in the wrong order", () => {
    const built = buildMainlineAgentDocument(capture({
      asks: [captureAsk(MAINLINE_FOLLOW_UP), captureAsk(MAINLINE_FIRST_QUESTION)]
    }));
    assert.equal(built.ok, false);
    assert.equal(built.document, undefined);
    assert.match(built.reason, new RegExp(MAINLINE_FIRST_QUESTION));
  });

  it("fails when the two questions were asked in different client sessions", () => {
    const built = buildMainlineAgentDocument(capture({
      asks: [captureAsk(MAINLINE_FIRST_QUESTION), captureAsk(MAINLINE_FOLLOW_UP, { clientSessionRef: "session-2" })]
    }));
    assert.equal(built.ok, false);
    assert.equal(built.document, undefined);
    assert.match(built.reason, /session/i);
  });
});

describe("projectMainlineAgentDocument", () => {
  it("returns null when the records do not carry the two mainline questions", () => {
    const records = [
      askRecord("Q-CAC-28D", { executedPrompt: "最近 28 天的获客成本是多少？默认口径是什么？" }),
      askRecord("Q-CAC-EAST", { executedPrompt: "按华东区域呢？" })
    ];
    assert.equal(projectMainlineAgentDocument(records), null);
    assert.equal(projectMainlineAgentDocument([]), null);
    assert.equal(projectMainlineAgentDocument(undefined), null);
  });

  it("returns null when a record misses its own evidence instead of filling it from gold", () => {
    const noPrompt = [askRecord(MAINLINE_FIRST_QUESTION, { executedPrompt: "" }), askRecord(MAINLINE_FOLLOW_UP)];
    assert.equal(projectMainlineAgentDocument(noPrompt), null);

    const noAnswer = [askRecord(MAINLINE_FIRST_QUESTION, { answer: "" }), askRecord(MAINLINE_FOLLOW_UP)];
    assert.equal(projectMainlineAgentDocument(noAnswer), null);

    const noTranscript = [askRecord(MAINLINE_FIRST_QUESTION, { transcript: [] }), askRecord(MAINLINE_FOLLOW_UP)];
    assert.equal(projectMainlineAgentDocument(noTranscript), null);

    const noSession = [askRecord(MAINLINE_FIRST_QUESTION, { sessionId: null }), askRecord(MAINLINE_FOLLOW_UP)];
    assert.equal(projectMainlineAgentDocument(noSession), null);
  });

  it("takes every field from the records, not from gold", () => {
    const records = [
      askRecord(MAINLINE_FIRST_QUESTION, {
        executedPrompt: `${first.question} ${PROMPT_SUFFIX}`,
        answer: "口径为 SUM(spend_cents)/SUM(new_customers)，28 天合计 1234.56 元",
        sessionId: "session-7"
      }),
      askRecord(MAINLINE_FOLLOW_UP, {
        executedPrompt: `${follow.question} ${PROMPT_SUFFIX}`,
        answer: "沿用上一轮口径，7 天合计 789.01 元",
        sessionId: "session-7"
      })
    ];
    const document = projectMainlineAgentDocument(records);
    assert.ok(document, "the projection must produce a document for two complete records");
    assert.equal(document.asks.length, 2);
    assert.equal(document.asks[0].questionId, MAINLINE_FIRST_QUESTION);
    assert.equal(document.asks[1].questionId, MAINLINE_FOLLOW_UP);
    // the executed prompt is the string the record carries — byte for byte, not gold.question
    assert.equal(document.asks[0].executedPrompt, records[0].executedPrompt);
    assert.notEqual(document.asks[0].executedPrompt, first.question);
    assert.equal(document.asks[1].executedPrompt, records[1].executedPrompt);
    // the final answer is the ask's own answer, not anything derived from gold.expected
    assert.equal(document.asks[0].finalAnswer, records[0].answer);
    assert.equal(document.asks[1].finalAnswer, records[1].answer);
    // the session reference is the ask's own session id
    assert.equal(document.asks[0].clientSessionRef, "session-7");
    assert.equal(document.asks[1].clientSessionRef, "session-7");
    assert.deepEqual(document.asks[0].transcript, records[0].transcript);
    assert.deepEqual(document.asks[1].transcript, records[1].transcript);
    assert.equal(document.serverTrace.length, 2);
  });

  it("refuses two records that were answered in different sessions", () => {
    const records = [
      askRecord(MAINLINE_FIRST_QUESTION, { sessionId: "session-1" }),
      askRecord(MAINLINE_FOLLOW_UP, { sessionId: "session-2" })
    ];
    assert.equal(projectMainlineAgentDocument(records), null);
  });
});

describe("writeMainlineAgentEvidence", () => {
  it("writes no file when the records do not carry the two mainline questions", () => {
    withTempDir((dir) => {
      const result = writeMainlineAgentEvidence(dir, [askRecord("Q-CAC-28D"), askRecord("Q-CAC-EAST")]);
      assert.equal(result.written, false);
      assert.equal(existsSync(path.join(dir, "results", "j01-agent.json")), false);
    });
  });

  it("writes the document when the records carry both questions", () => {
    withTempDir((dir) => {
      const result = writeMainlineAgentEvidence(dir, [askRecord(MAINLINE_FIRST_QUESTION), askRecord(MAINLINE_FOLLOW_UP)]);
      assert.equal(result.written, true);
      const file = path.join(dir, "results", "j01-agent.json");
      assert.equal(existsSync(file), true);
      const loaded = loadMainlineAgentEvidence(file);
      assert.equal(loaded.status, "loaded");
      assert.equal(loaded.asks.length, 2);
      assert.equal(loaded.asks[0].questionId, MAINLINE_FIRST_QUESTION);
    });
  });

  it("is called by the agent runner after it writes agent.json", () => {
    const source = readFileSync(path.join(REPO_ROOT, "scripts/e2e/run-agent-journey.mjs"), "utf8");
    const agentJson = source.indexOf('"results", "agent.json"');
    const writer = source.indexOf("writeMainlineAgentEvidence(run.paths.runDir");
    assert.ok(agentJson >= 0, "the runner writes results/agent.json");
    assert.ok(writer >= 0, "the runner calls writeMainlineAgentEvidence");
    assert.ok(writer > agentJson, "the J01 evidence is written after agent.json");
  });
});
