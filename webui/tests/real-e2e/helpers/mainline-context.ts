// Helpers shared by mainline-journey.spec.ts. Pure (no I/O): the J-01 8-step
// sequence is described as a list of (selector, network, assertion) tuples
// the management runner replays. The test file imports this and treats it
// as a contract; the management runner (different owner) consumes the same
// contract to actually drive the UI.
//
// Why a separate helper (vs. inline constants in the spec):
//   * the spec reads better as a Playwright test;
//   * the management runner can re-import the helper and the contract is
//     mechanically guaranteed to be the same;
//   * the helper can be unit-tested without launching a browser.

export type StepKind =
  | "real_form"
  | "real_api"
  | "real_mcp"
  | "block";

export type Step = {
  /** J-01 step number 1..8 (Spec §6.5). */
  j01Step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Catalog ids the step covers. */
  catalogIds: readonly string[];
  /** Selector or endpoint the management runner drives. */
  action: string;
  /** The kind of action: real_form (UI), real_api (fetch), real_mcp (MCP), block (capability missing). */
  kind: StepKind;
  /** Assertion tokens the step is bound to. The runner collects these into per-case evidence. */
  asserts: readonly string[];
  /** Human-readable description for the catalog doc. */
  notes: string;
};

/** The J-01 8-step user mainline as a declarative sequence. */
export const J01_STEPS: readonly Step[] = Object.freeze([
  {
    j01Step: 1,
    catalogIds: ["UX-01-V01", "UX-01-V02"],
    action: "/login (bootstrap) → /admin/admins → POST /api/admin/admins",
    kind: "real_form",
    asserts: ["allow_control", "real_query", "no_leak"],
    notes: "First-owner bootstrap through the real login form when the instance is fresh; ordinary login otherwise. Operator is created through /admin/admins."
  },
  {
    j01Step: 2,
    catalogIds: ["UX-01-V01", "UX-01-V02"],
    action: "/connections (wizard) → POST /api/connections → POST /api/connections/:id/test → POST /api/connections/:id/tables (enable schema) → POST /api/connections/:id/manifest",
    kind: "real_form",
    asserts: ["allow_control", "real_query", "no_leak"],
    notes: "Operator creates the DB connection through the real wizard, runs the live connection test, enables the schema, and uploads the Manifest that prepare-environment produced. Never uses page.route() or API-write fakes."
  },
  {
    j01Step: 3,
    catalogIds: ["UX-01-V01", "UX-01-V03"],
    action: "/catalog/:conn/:schema/:table (measure tab) → /wiki (upload + save) → /skills (create + save) → /admin/roles (ACL) → POST /api/publish/workbench",
    kind: "real_form",
    asserts: ["allow_control", "real_query", "server_trace", "consistency"],
    notes: "Edit the measure, Wiki, Skill, and Role ACL through the real UI; save→sync index and publish through the real workbench endpoint. The audit ledger must show the writes within the run's window."
  },
  {
    j01Step: 4,
    catalogIds: ["UX-01-V01", "UX-01-V02"],
    action: "/admin/roles/new (real form) → /admin/agents/:userId (real form) → /admin/agents/:userId/tokens/new (real form) → /admin/tokens (list)",
    kind: "real_form",
    asserts: ["allow_control", "real_query", "no_leak", "consistency"],
    notes: "Create the Role, the Agent, and the Agent Token through the real UI. The plaintext Token is shown once and embedded in the copyable client config; the snippet text must reference the run-scoped MCP URL."
  },
  {
    j01Step: 5,
    catalogIds: ["UX-01-V01", "UX-05-V01", "UX-05-V02"],
    action: "MCP tools/call (wiki_read + measure ask) over the run-scoped MCP URL — driven by claude-code and openclaw adapters (the agent runner owns this; the management runner only verifies the snippet text and the run-scoped endpoint).",
    kind: "real_mcp",
    asserts: ["typed_gold", "real_query", "server_trace", "no_leak", "consistency", "repeat3"],
    notes: "Each required product (claude-code + openclaw) issues the question 3 times; the agent runner records the per-ask indexed evidence (runId/instanceId/caseId/askIndex/agentId/goldKey/expectation/since/until/traceIds/...)."
  },
  {
    j01Step: 6,
    catalogIds: ["UX-04-V01", "UX-04-S03", "UX-03-V05", "UX-03-V06"],
    action: "Same-session continuation through the adapter's native flag (claude-code -c / openclaw --resume). Real MCP tools/call in the SAME session, never a synthetic transcript array.",
    kind: "real_mcp",
    asserts: ["typed_gold", "real_query", "server_trace", "no_leak", "consistency"],
    notes: "Same-session multi-turn; the agent runner wires the adapter's native continuation and verifies the filter/date/grain survives across turns. UX-04-S01/S02 templates also bind here (the template re-runs the original ask through the same MCP session)."
  },
  {
    j01Step: 7,
    catalogIds: ["UX-01-V01", "SEC-07-V13"],
    action: "/admin/tokens (吊销) → /admin/roles (停用) → /admin/agents (停用). All through the real UI buttons.",
    kind: "real_form",
    asserts: ["deny", "allow_control", "real_query", "no_leak", "server_trace"],
    notes: "Owner/operator narrows a role, deactivates an agent, or revokes a token through the real UI. The sibling Token of the same Agent MUST keep working; a revoked Token MUST be 401 on initialize + tools + resources + prompts."
  },
  {
    j01Step: 8,
    catalogIds: ["UX-01-V01", "SEC-18-V06", "SEC-20-V01", "SEC-20-V02", "SEC-20-V06"],
    action: "/admin/audit (real page) → /api/admin/audit/export (CSV) → /api/admin/audit/export-pack (zip) → /admin/audit-sources (archive).",
    kind: "real_form",
    asserts: ["consistency", "real_query", "allow_control", "server_trace"],
    notes: "Owner/operator views the audit ledger through the real /admin/audit page, exports the current view (CSV) and the full pack (zip), and triggers archive. The export must reconcile with the events THIS run produced (Spec §6.5 step 8)."
  }
]);

/** Returns the steps that bind the given catalog id, or `null` when the id is not on the J-01 chain. */
export function stepsFor(catalogId: string): readonly Step[] {
  return J01_STEPS.filter((step) => step.catalogIds.includes(catalogId));
}

/** UX-04 management variants (UX-04-V02, UX-04-V03, UX-04-S01, UX-04-S02) — these
 *  are management-runner side; the agent-runner counterpart verifies the
 *  Agent ask typed-gold + real_query + server_trace + consistency. */
export const UX04_MANAGEMENT_STEPS: readonly Step[] = Object.freeze([
  {
    j01Step: 3,
    catalogIds: ["UX-04-V02"],
    action: "POST /api/publish/workbench with kind=wiki+measure → GET /api/health (pre vs post policyVersion).",
    kind: "real_api",
    asserts: ["consistency", "real_query"],
    notes: "Capture the pre-publish policyVersion, publish a new version, capture the post-publish policyVersion. The Agent leg must read the post-publish version on a NEW session and the pre-publish version on the OLD session."
  },
  {
    j01Step: 3,
    catalogIds: ["UX-04-V03"],
    action: "POST /api/publish/restore (last version) → GET /api/health (measureHash).",
    kind: "real_api",
    asserts: ["consistency", "real_query"],
    notes: "Restore to the previous measure version; the post-recovery measureHash must equal the datasetDigest the run loaded."
  },
  {
    j01Step: 6,
    catalogIds: ["UX-04-S01", "UX-04-S02"],
    action: "PUT /api/eval/cases/:domain/:caseId/template → POST /api/eval/cases/:domain/:caseId/template/run.",
    kind: "real_api",
    asserts: ["typed_gold", "real_query", "consistency"],
    notes: "Save a report template (region/days/measure), then re-run the template; the rerun's region/days/measure must equal the original ask's, and the audit's appliedVersion must match the template's recorded version. A template that fails (denial, compilation error, missing role) MUST NOT silently swap to a different question."
  }
]);
