// The J01-07 evidence record: how `results/j01-agent.json` is assembled from
// what a run ACTUALLY produced.
//
// Three functions, one direction of truth:
//
//   buildMainlineAgentDocument(capture)       capture  -> document | reason
//   projectMainlineAgentDocument(askRecords)  records  -> document | null
//   writeMainlineAgentEvidence(runDir, ...)   records  -> the file on disk
//
// NONE of them reads gold. That is the whole point of this module: the J01-07
// stage compares the executed prompt with gold.question (防静默换题) and the
// final answer with gold.expected (typed gold). A builder that filled either
// field from gold would make those two assertions compare gold with gold and
// pass by construction — the exact laundering path the stage exists to close.
//
// The gold module is imported for the two QUESTION IDS only. The question text
// and the expected answer never enter this file.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MAINLINE_FIRST_QUESTION, MAINLINE_FOLLOW_UP } from "../../../examples/security-e2e/gold/v025-gold.mjs";
import { scanText } from "./leak-scan.mjs";

/** The two mainline questions, in the order they are asked. The second one is
 *  an anaphoric follow-up in the SAME client session. */
export const MAINLINE_ASK_ORDER = Object.freeze([MAINLINE_FIRST_QUESTION, MAINLINE_FOLLOW_UP]);

/** The only fields a document's ask may carry (Spec §3). Anything else the
 *  runner knows — Token fingerprints, digests, other cases' metadata — stays
 *  out of the evidence file. */
export const DOCUMENT_ASK_FIELDS = Object.freeze([
  "questionId",
  "executedPrompt",
  "transcriptText",
  "transcript",
  "finalAnswer",
  "clientSessionRef"
]);

function isFilledString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Assembles the J01-07 evidence document from one capture.
 *
 * A capture is `{ asks, serverTrace }` where each ask carries the six document
 * fields. The builder is deliberately strict and deliberately blind: it checks
 * that the evidence EXISTS and is in the expected shape, and it refuses to
 * invent anything. Whether the prompt really is gold.question, whether the
 * answer really matches gold.expected and whether the tool calls really
 * correlate with the server trace are the JUDGE's questions
 * (`judgeMainlineAgent`), not the builder's.
 *
 * @param {{asks?: Array<object>, serverTrace?: Array<object>}} capture
 * @returns {{ok: true, document: {asks: object[], serverTrace: object[]}} | {ok: false, reason: string}}
 */
export function buildMainlineAgentDocument(capture) {
  const asks = Array.isArray(capture?.asks) ? capture.asks : null;
  if (!asks) return { ok: false, reason: "the capture carries no asks" };
  if (asks.length !== MAINLINE_ASK_ORDER.length) {
    return { ok: false, reason: `the mainline needs exactly ${MAINLINE_ASK_ORDER.length} asks, got ${asks.length}` };
  }
  const picked = [];
  for (let index = 0; index < MAINLINE_ASK_ORDER.length; index += 1) {
    const ask = asks[index] ?? {};
    const questionId = MAINLINE_ASK_ORDER[index];
    if (ask.questionId !== questionId) {
      return { ok: false, reason: `ask ${index} is "${ask.questionId ?? "(none)"}", expected "${questionId}"` };
    }
    if (!isFilledString(ask.executedPrompt)) {
      return { ok: false, reason: `ask "${questionId}" carries no executed prompt` };
    }
    if (!isFilledString(ask.finalAnswer)) {
      return { ok: false, reason: `ask "${questionId}" carries no final answer` };
    }
    // The transcript text is the model-visible surface the leak scan reads. An
    // empty one would silently narrow that scan, so it is treated as missing.
    if (!isFilledString(ask.transcriptText)) {
      return { ok: false, reason: `ask "${questionId}" carries no transcript text` };
    }
    if (!Array.isArray(ask.transcript) || ask.transcript.length === 0) {
      return { ok: false, reason: `ask "${questionId}" carries no transcript` };
    }
    if (!isFilledString(ask.clientSessionRef)) {
      return { ok: false, reason: `ask "${questionId}" carries no client session reference` };
    }
    picked.push({
      questionId,
      executedPrompt: ask.executedPrompt,
      transcriptText: ask.transcriptText,
      transcript: [...ask.transcript],
      finalAnswer: ask.finalAnswer,
      clientSessionRef: ask.clientSessionRef
    });
  }
  if (picked[0].clientSessionRef !== picked[1].clientSessionRef) {
    return { ok: false, reason: "the two asks do not share one client session" };
  }
  const serverTrace = Array.isArray(capture?.serverTrace) ? [...capture.serverTrace] : [];
  return { ok: true, document: { asks: picked, serverTrace } };
}

/** The document shape of one ask, read out of a runner ask record. The record
 *  names the answer `answer` and the session `sessionId`; the document names
 *  them `finalAnswer` and `clientSessionRef`. Nothing else is carried over. */
function askFromRecord(record) {
  return {
    questionId: record?.questionId,
    executedPrompt: record?.executedPrompt,
    transcriptText: record?.transcriptText,
    transcript: record?.transcript,
    finalAnswer: record?.answer,
    clientSessionRef: record?.sessionId
  };
}

/**
 * Projects the runner's ask records onto the J01-07 evidence document.
 *
 * Returns `null` — never a partial document — when the records do not carry
 * BOTH mainline questions with their own prompt, answer, session and
 * transcript. A missing field is missing evidence, not an invitation to fill
 * it from gold.
 *
 * @param {Array<object>} askRecords
 * @returns {{asks: object[], serverTrace: object[]} | null}
 */
export function projectMainlineAgentDocument(askRecords) {
  const records = Array.isArray(askRecords) ? askRecords : [];
  const first = records.find((record) => record?.questionId === MAINLINE_FIRST_QUESTION);
  const followUp = records.find((record) => record?.questionId === MAINLINE_FOLLOW_UP);
  if (!first || !followUp) return null;
  const built = buildMainlineAgentDocument({
    asks: [askFromRecord(first), askFromRecord(followUp)],
    serverTrace: [
      ...(Array.isArray(first.serverTrace) ? first.serverTrace : []),
      ...(Array.isArray(followUp.serverTrace) ? followUp.serverTrace : [])
    ]
  });
  return built.ok ? built.document : null;
}

/**
 * Writes `results/j01-agent.json` for a run when — and only when — the run's
 * ask records carry the two mainline questions. When the projection is `null`
 * NO file is created: a missing evidence file is the J01-07 `blocked` verdict,
 * and an empty or invented one would be worse.
 *
 * @param {string} runDir
 * @param {Array<object>} askRecords
 * @param {{secrets?: string[]}} [options]
 * @returns {{written: boolean, path?: string, reason?: string}}
 */
export function writeMainlineAgentEvidence(runDir, askRecords, { secrets = [] } = {}) {
  const document = projectMainlineAgentDocument(askRecords);
  if (!document) {
    return { written: false, reason: "the run's ask records do not carry the two mainline questions" };
  }
  const dir = path.join(runDir, "results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "j01-agent.json");
  const body = `${JSON.stringify(document, null, 2)}\n`;
  const leaks = scanText(body, { secrets });
  if (leaks.length > 0) {
    throw new Error(`refusing to write ${file}: the evidence carries a credential`);
  }
  writeFileSync(file, body);
  return { written: true, path: file };
}
