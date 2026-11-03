// J01-07 reads this run's Agent evidence. The browser spec does not assemble
// the anti-cheat arguments itself.

import { existsSync, readFileSync } from "node:fs";

import { MAINLINE_FIRST_QUESTION, MAINLINE_FOLLOW_UP } from "../../../examples/security-e2e/gold/v025-gold.mjs";
import { matchTypedGold } from "../answer-assertions.mjs";
import { assertAgentOwnedCalls, assertNoGoldLeak, assertPromptUnchanged } from "./j01-state.mjs";

const QUESTION_ORDER = Object.freeze([MAINLINE_FIRST_QUESTION, MAINLINE_FOLLOW_UP]);
const BINDING_KEYS = Object.freeze(["runId", "instanceId", "agentId", "semanticVersion", "policyVersion"]);

export function loadMainlineAgentEvidence(file) {
  if (!file || !existsSync(file)) {
    return { status: "blocked", reason: "missing j01-agent.json", asks: null, serverTrace: [] };
  }
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    if (!doc || !Array.isArray(doc.asks)) {
      return { status: "blocked", reason: "j01-agent.json has no asks", asks: null, serverTrace: [] };
    }
    return { status: "loaded", asks: doc.asks, serverTrace: Array.isArray(doc.serverTrace) ? doc.serverTrace : [] };
  } catch {
    return { status: "blocked", reason: "unreadable j01-agent.json", asks: null, serverTrace: [] };
  }
}

function bindingReady(binding) {
  if (!binding || typeof binding !== "object") return false;
  for (const key of BINDING_KEYS) {
    if (typeof binding[key] !== "string" || binding[key].length === 0) return false;
  }
  const token = binding.tokenLabel || binding.tokenId;
  return typeof token === "string" && token.length > 0;
}

function comparatorBinding(binding) {
  if (!binding) return null;
  const copy = { ...binding };
  delete copy.tokenSecretRef;
  return copy;
}

function isTraceShaped(entry) {
  const kind = entry?.event ?? entry?.type ?? entry?.kind;
  return kind === "tool_call" || kind === "toolCall" || entry?.toolCall === true;
}

function isClientCall(entry) {
  return Boolean(entry && entry.role === "assistant" && typeof entry.tool === "string" && entry.tool.length > 0 && !isTraceShaped(entry));
}

export function judgeMainlineAgent(evidence, gold, serverTrace, expectedBinding) {
  if (!evidence || evidence.status === "blocked" || !Array.isArray(evidence.asks)) {
    return { status: "blocked", reason: evidence?.reason ?? "missing j01-agent.json" };
  }
  const reasons = [];
  if (!bindingReady(expectedBinding)) reasons.push("missing required binding");
  const questions = gold?.questions ?? gold ?? {};
  const asks = evidence.asks;
  const trace = serverTrace ?? evidence.serverTrace ?? [];
  if (asks.length < 2) reasons.push("missing second ask");
  else if (asks[0]?.clientSessionRef !== asks[1]?.clientSessionRef || !asks[0]?.clientSessionRef) {
    reasons.push("the two asks do not share clientSessionRef");
  }
  for (let index = 0; index < Math.min(asks.length, QUESTION_ORDER.length); index += 1) {
    const ask = asks[index] ?? {};
    const questionId = QUESTION_ORDER[index];
    const question = questions[questionId];
    if (ask.questionId !== questionId || !question) {
      reasons.push(`换题 ${questionId} is missing`);
      continue;
    }
    const prompt = assertPromptUnchanged({ executedPrompt: ask.executedPrompt, goldQuestion: question.question });
    if (!prompt.ok) reasons.push(`换题 ${prompt.reason}`);
    const leak = assertNoGoldLeak({
      gold: question,
      surfaces: [
        { surface: "transcript", text: ask.transcriptText ?? "" },
        { surface: "agent-prompt", text: ask.executedPrompt ?? "" },
        { surface: "final-answer", text: ask.finalAnswer ?? "" }
      ],
      finalAnswer: ask.finalAnswer ?? "",
      questionCarriers: ["agent-prompt"]
    });
    if (!leak.ok) reasons.push(`泄露 ${leak.reason}`);
    const answer = matchTypedGold(question.expected, ask.finalAnswer ?? "", question);
    if (!answer.passed) reasons.push(`answer ${answer.detail}`);
    const raw = Array.isArray(ask.transcript) ? ask.transcript : [];
    const clientCalls = raw.filter(isClientCall);
    if (raw.some(isTraceShaped) && clientCalls.length === 0) reasons.push("trace impersonated the client call");
    const owned = assertAgentOwnedCalls({
      transcript: clientCalls,
      serverTrace: trace,
      expectedBinding: bindingReady(expectedBinding) ? comparatorBinding(expectedBinding) : null
    });
    if (!owned.ok) reasons.push(owned.reason);
    if (!clientCalls.some((call) => call.tool === "lucy_query")) reasons.push("missing lucy_query");
  }
  if (reasons.length > 0) return { status: "failed", reason: reasons.join("; ") };
  return { status: "passed", reason: "stage conditions 1-6 hold" };
}
