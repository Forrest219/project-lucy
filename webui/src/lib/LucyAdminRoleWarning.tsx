import {
  LUCY_ADMIN_WARNING_PRIMARY,
  LUCY_ADMIN_WARNING_SECONDARY
} from "./lucyAdminRole";

/**
 * Spec 2026-11-01 — shared high-privilege ops data-plane warning for
 * AgentDetail and AgentList (new-agent modal).
 *
 * Renders a short primary sentence plus a weaker secondary sentence;
 * the "MCP" term is protected from browser translation.
 */
export function LucyAdminRoleWarning() {
  const [beforeMcp, afterMcp] = LUCY_ADMIN_WARNING_SECONDARY.split("MCP");
  return (
    <div
      className="rounded-md border border-warning-strong bg-warning-soft p-3 text-sm text-warning-strong"
      data-testid="agent-lucy-admin-role-warning"
    >
      <div className="font-medium">{LUCY_ADMIN_WARNING_PRIMARY}</div>
      <div className="mt-1 text-xs text-warning-strong opacity-80">
        {beforeMcp}
        <span className="notranslate" translate="no">
          MCP
        </span>
        {afterMcp ?? ""}
      </div>
    </div>
  );
}
