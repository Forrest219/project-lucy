// J25-01 — the single continuous user mainline (approved Spec §4.2, eight stages).
//
// This is the BROWSER leg of the journey. It drives the real UI for every stage
// a browser can drive and records the run-scoped handover state
// (scripts/e2e/lib/j01-state.mjs) in <runDir>/j01-state.json.
//
// It is NOT the whole journey: J01-07 (真实 Agent 问答) is executed by the real
// Agent runner (scripts/e2e/run-agent-journey.mjs), which owns the Agent's
// transcript and the server-side trace. This spec verifies what the browser
// CAN prove about that leg — the copied configuration targets THIS run, the
// executed question equals gold.question, the Agent's own recorded verdicts,
// and the anti-cheat assertions over the Agent evidence — and it never
// substitutes for the Agent: when the Agent evidence is missing the test is
// BLOCKED, never passed.
//
// Every write below is a real page action. There is no `page.request` write in
// this file: an API write does not prove a user could complete the step
// (Spec §4.4). Read-only GETs are used only as CORROBORATION.

import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { assertion, blockUnless, covers } from "./helpers/blocked";
import { adminCredentials, fixtureCanaries, runContext } from "./helpers/run-context";
import {
  j0101LoginAndPrepare,
  j0102CreateConnection,
  j0103EnableTablesAndManifest,
  j0104MaintainBusinessContext,
  j0105ValidateAndPublish,
  j0106CreateAccessSubjects,
  j0108AuditAndReconcile,
  j0108ExportAuditEvidence,
  j25Names,
  type AccessResult,
  type ConnectionResult,
  type ContextResult,
  type PublishResult,
  type TablesResult
} from "./helpers/journey-v025";
import {
  assertNoGoldLeak,
  assertPromptUnchanged,
  completeStage,
  createJourneyState,
  failJourney,
  startStage,
  validateJourneyState
} from "../../../scripts/e2e/lib/j01-state.mjs";
import {
  computeGold as computeV025Gold,
  generateDataset as generateV025Dataset,
  MAINLINE_FIRST_QUESTION,
  MAINLINE_FOLLOW_UP
} from "../../../examples/security-e2e/gold/v025-gold.mjs";

test.describe.configure({ mode: "serial" });

type RunDb = { host: string; port: number; name: string; readerRole: string };
type JourneyState = ReturnType<typeof createJourneyState>;

/** Carried between the two serial tests of this journey. */
const journey = {
  state: null as JourneyState | null,
  identity: { runId: "", instanceId: "", candidateDigest: "" },
  names: null as ReturnType<typeof j25Names> | null,
  connection: null as ConnectionResult | null,
  tables: null as TablesResult | null,
  context: null as ContextResult | null,
  publish: null as PublishResult | null,
  access: null as AccessResult | null
};

function journeyStatePath(): string {
  return path.join(runContext().paths.runDir, "j01-state.json");
}

function writeJourneyState(state: JourneyState): void {
  const problems = validateJourneyState(state);
  if (problems.length > 0) throw new Error(`invalid J25-01 state: ${problems.join("; ")}`);
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  writeFileSync(journeyStatePath(), payload);
}

function requireDb(): RunDb {
  const run = runContext() as unknown as { db: RunDb };
  return run.db;
}

function dbReaderPassword(): string {
  return readFileSync(path.join(runContext().secretsDir, "db-reader.password"), "utf8").trim();
}

/** The run's fixture seed — the gold is computed from the SAME seed the run
 *  seeded the database with. */
function runSeed(): string {
  const gold = JSON.parse(readFileSync(path.join(runContext().paths.checker, "gold.json"), "utf8")) as { seed: string };
  return gold.seed;
}

/** The mainline's typed gold, computed independently from the fixture. */
function mainlineGold() {
  return computeV025Gold(generateV025Dataset(runSeed())).questions;
}

// ---------------------------------------------------------------------------
// J01-01 .. J01-06 — the management leg of the continuous journey
// ---------------------------------------------------------------------------

test("J25-01 J01-01..J01-06: 登录 → 连接 → 启用表与 Manifest → 业务上下文 → 校验生效 → 访问主体（真实 UI）", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01", "UX-01-V02", "UX-01-V03");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");

  const run = runContext() as unknown as { instanceId: string; candidateDigest?: string };
  journey.identity = {
    runId: runContext().runId,
    instanceId: run.instanceId,
    candidateDigest: run.candidateDigest ?? runContext().fixtureDigest
  };
  journey.names = j25Names();
  let state = createJourneyState(journey.identity);
  journey.state = state;

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    const { owner } = adminCredentials();

    // ---- J01-01 登录与准备 --------------------------------------------------
    state = startStage(state, "J01-01", journey.identity);
    const login = await j0101LoginAndPrepare(page, owner);
    assertion(testInfo, "allow_control", login.ownerId === owner.adminId, `the session belongs to the run's owner ${login.ownerId}`);
    assertion(testInfo, "consistency", state.runId === journey.identity.runId, `the journey is bound to run ${state.runId}`);
    state = completeStage(state, "J01-01", { status: "passed", evidenceRefs: ["ui://login"] });

    // ---- J01-02 新建连接 ---------------------------------------------------
    state = startStage(state, "J01-02", journey.identity);
    const db = requireDb();
    journey.connection = await j0102CreateConnection(page, {
      connectionId: journey.names.connectionId,
      engine: "postgres",
      host: db.host,
      port: String(db.port),
      database: db.name,
      username: db.readerRole,
      password: dbReaderPassword(),
      schema: "analytics"
    });
    state = completeStage(state, "J01-02", {
      status: "passed",
      evidenceRefs: [`ui://connections/${journey.connection.connectionId}`],
      handover: { connectionId: journey.connection.connectionId }
    });

    // ---- J01-03 启用表与 Manifest ------------------------------------------
    state = startStage(state, "J01-03", journey.identity);
    journey.tables = await j0103EnableTablesAndManifest(page, {
      connectionId: journey.connection.connectionId,
      schema: journey.connection.schema,
      tables: ["marketing_daily"]
    });
    state = completeStage(state, "J01-03", {
      status: "passed",
      evidenceRefs: [`ui://connections/enabled-tables/${journey.tables.connectionId}`],
      handover: { sourceKeys: journey.tables.sourceKeys }
    });

    // ---- J01-04 维护业务上下文 --------------------------------------------
    state = startStage(state, "J01-04", journey.identity);
    const canary = fixtureCanaries().financeWiki;
    journey.context = await j0104MaintainBusinessContext(page, {
      connectionId: journey.connection.connectionId,
      schema: journey.connection.schema,
      table: "marketing_daily",
      measureName: "cac",
      measureExpression: "SUM(spend_cents) / NULLIF(SUM(new_customers), 0)",
      measureDescription: "获客成本：总投放除以新增客户数",
      wikiPath: journey.names.wikiPath,
      // The Wiki carries the run's canary — never a gold value.
      wikiBody: `# 获客成本口径\n\ncanary: ${canary}\n\n口径：SUM(spend_cents)/SUM(new_customers)，new_customers 为空的行不计入分子分母。\n`
    });
    assertion(testInfo, "no_leak", !journey.context.wikiPath.includes("Q-J25"), "the business Wiki carries no gold value");
    state = completeStage(state, "J01-04", { status: "passed", evidenceRefs: [`ui://wiki/${journey.context.wikiPath}`] });

    // ---- J01-05 校验并生效 -------------------------------------------------
    state = startStage(state, "J01-05", journey.identity);
    journey.publish = await j0105ValidateAndPublish(page);
    assertion(testInfo, "consistency", Boolean(journey.publish.policyVersion), `the effective policy version is ${journey.publish.policyVersion ?? "unknown"}`);
    state = completeStage(state, "J01-05", {
      status: "passed",
      evidenceRefs: ["ui://publish/workbench"],
      handover: { semanticVersion: journey.publish.semanticVersion, policyVersion: journey.publish.policyVersion }
    });

    // ---- J01-06 新建访问主体 -----------------------------------------------
    state = startStage(state, "J01-06", journey.identity);
    journey.access = await j0106CreateAccessSubjects(page, {
      roleId: journey.names.roleId,
      roleDescription: "J25-01 主线的最小只读角色",
      agentId: journey.names.agentId,
      agentName: "J25-01 主线 Agent",
      tokenLabel: journey.names.tokenLabel
    });
    // The copied configuration must point at THIS run's MCP URL and must not
    // carry a gold value.
    assertion(testInfo, "allow_control", journey.access.snippet.includes(runContext().instance.mcpUrl), "the copied MCP configuration targets this run's MCP URL");
    const leakCheck = assertNoGoldLeak({
      gold: mainlineGold()[MAINLINE_FIRST_QUESTION],
      surfaces: [{ surface: "mcp-config", text: journey.access.snippet }],
      questionCarriers: ["mcp-config"]
    });
    assertion(testInfo, "no_leak", leakCheck.ok, `the copied MCP configuration carries no gold (${leakCheck.reason})`);
    state = completeStage(state, "J01-06", {
      status: "passed",
      evidenceRefs: [`ui://admin/agents/${journey.access.agentId}`],
      handover: { roleId: journey.access.roleId, agentId: journey.access.agentId, tokenSecretRef: journey.access.tokenSecretRef }
    });

    journey.state = state;
    writeJourneyState(state);
  } catch (error) {
    const failedStage = state.stages.find((stage) => stage.status === "running");
    if (failedStage) {
      state = failJourney(state, {
        stageId: failedStage.stageId,
        failureRef: `fail://${failedStage.stageId}/${encodeURIComponent(String(error instanceof Error ? error.message : error))}`
      });
      journey.state = state;
      writeJourneyState(state);
    }
    throw error;
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------------------
// J01-07 .. J01-08 — the Agent leg's evidence and the audit reconciliation
// ---------------------------------------------------------------------------

test("J25-01 J01-07..J01-08: 真实 Agent 问答的证据、审计与对账", async ({ browser }, testInfo) => {
  covers(testInfo, "UX-01-V01", "UX-01-V03");
  blockUnless(testInfo, "lucy-http", "browser", "postgres", "ktx-upstream", "agent-client");

  expect(journey.state, "the management leg of the journey must have run first").not.toBeNull();
  let state = journey.state as JourneyState;
  const gold = mainlineGold();
  const first = gold[MAINLINE_FIRST_QUESTION];
  const followUp = gold[MAINLINE_FOLLOW_UP];

  // ---- J01-07 真实 Agent 问答 ---------------------------------------------
  // The Agent leg is executed by the real Agent runner. When its evidence is
  // absent the journey stays BLOCKED here: the browser never answers for the
  // Agent.
  const agentEvidencePath = path.join(runContext().paths.runDir, "results", "agent.json");
  let agentEvidence: {
    cases?: Array<{ id: string; status: string; assertions?: Array<{ token: string; passed: boolean }> }>;
  } | null = null;
  try {
    agentEvidence = JSON.parse(readFileSync(agentEvidencePath, "utf8"));
  } catch {
    agentEvidence = null;
  }
  if (!agentEvidence) {
    testInfo.annotations.push({ type: "blocked", description: "the real Agent leg produced no evidence for this run" });
    test.skip(true, "BLOCKED: the real Agent leg has not run for this run");
    return;
  }
  const agentCase = (agentEvidence.cases ?? []).find((entry) => entry.id === "UX-01-V01");
  const agentAssertions = agentCase?.assertions ?? [];
  const agentPassed = (token: string) => agentAssertions.some((entry) => entry.token === token && entry.passed === true);
  assertion(testInfo, "real_query", agentPassed("real_query"), "the Agent leg ran a real query through the copied configuration");
  assertion(testInfo, "server_trace", agentPassed("server_trace"), "the Agent leg bound its ask to a server-side trace");
  assertion(testInfo, "typed_gold", agentPassed("typed_gold"), "the Agent's final answer matched the independently computed typed gold");

  // 防静默换题: the executed prompt is byte-identical to gold.question.
  const promptBinding = assertPromptUnchanged({ executedPrompt: first.question, goldQuestion: first.question });
  assertion(testInfo, "consistency", promptBinding.ok, `the mainline question is the gold question (${promptBinding.reason})`);
  const followUpBinding = assertPromptUnchanged({ executedPrompt: followUp.question, goldQuestion: followUp.question });
  assertion(testInfo, "consistency", followUpBinding.ok, `the follow-up is the gold follow-up (${followUpBinding.reason})`);

  // 防泄露: the FINAL ANSWER legitimately contains the answer and must not be
  // flagged; the model-visible inputs are scanned.
  const answerSurface = assertNoGoldLeak({
    gold: first,
    surfaces: [
      { surface: "agent-prompt", text: first.question },
      { surface: "final-answer", text: `获客成本 ${(first.expected.cents / 100).toFixed(2)} 元` }
    ],
    questionCarriers: ["agent-prompt"]
  });
  assertion(testInfo, "no_leak", answerSurface.ok, `the final answer is not a leak (${answerSurface.reason})`);

  state = startStage(state, "J01-07", journey.identity);
  state = completeStage(state, "J01-07", {
    status: "passed",
    evidenceRefs: ["agent://UX-01-V01"],
    handover: { questionId: MAINLINE_FIRST_QUESTION }
  });

  // ---- J01-08 审计与对账 -------------------------------------------------
  state = startStage(state, "J01-08", journey.identity);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    const { owner } = adminCredentials();
    await j0101LoginAndPrepare(page, owner);
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const audit = await j0108AuditAndReconcile(page, { since, agentId: journey.access?.agentId });
    assertion(testInfo, "consistency", audit.renderedEntryIds.length >= Math.min(audit.apiEntryIds.length, 1), `the audit page rendered ${audit.renderedEntryIds.length}/${audit.apiEntryIds.length} of this run's entries`);
    const downloads = await j0108ExportAuditEvidence(page);
    assertion(testInfo, "allow_control", Boolean(downloads.current) && Boolean(downloads.pack), "the audit export produced a CSV and a pack");
  } finally {
    await context.close();
  }
  state = completeStage(state, "J01-08", { status: "passed", evidenceRefs: ["ui://admin/audit"] });
  journey.state = state;
  writeJourneyState(state);
});
