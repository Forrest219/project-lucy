import {
  wikiAccessPrimaryStatus,
  wikiAccessSecondaryStatus,
  wikiAclRoleIds,
  wikiAclStateLabel
} from "../lib/wikiAccess";
import type { WikiAccessListEntry } from "../lib/types";

export type WikiAccessSummaryProps = {
  /** The aggregate list entry of this document. */
  access: WikiAccessListEntry;
  testId?: string;
};

/**
 * Spec 193 §6.1 — the compact authorization summary of the read view.
 *
 * `可访问角色：finance、test-fc · 1 个角色缺少读取通道`
 *
 * The declared roles and the missing-channel count are two different facts
 * and are rendered as two different fragments.
 */
export function WikiAccessSummary({
  access,
  testId = "wiki-access-summary"
}: WikiAccessSummaryProps) {
  const roles = wikiAclRoleIds(access.acl);
  const roleText =
    access.acl.state === "roles" ? roles.join("、") : wikiAclStateLabel(access.acl);
  const secondary = wikiAccessSecondaryStatus(access);

  return (
    <p className="pl-wiki-access-summary" data-testid={testId}>
      <span className="pl-wiki-access-summary-label">可访问角色：</span>
      <code className="notranslate" translate="no">
        {roleText}
      </code>
      {secondary ? (
        <span className="pl-wiki-access-summary-warning" data-testid={`${testId}-warning`}>
          {" · "}
          {secondary}
        </span>
      ) : null}
    </p>
  );
}

export type WikiAccessStatusBadgeProps = {
  access: WikiAccessListEntry;
  testId?: string;
};

/**
 * Spec 193 §6.1 — the list row status.
 *
 * The primary status is exactly one of 无人可见 / N 个角色 / 所有角色可见 /
 * 授权异常; the optional secondary status is `N 个角色缺少读取通道`.
 */
export function WikiAccessStatusBadge({
  access,
  testId = "wiki-access-status"
}: WikiAccessStatusBadgeProps) {
  const primary = wikiAccessPrimaryStatus(access);
  const secondary = wikiAccessSecondaryStatus(access);

  return (
    <span className="pl-wiki-access-status" data-testid={testId}>
      <span className="pl-wiki-access-status-primary" data-testid={`${testId}-primary`}>
        {primary}
      </span>
      {secondary ? (
        <span
          className="pl-wiki-access-status-secondary"
          data-testid={`${testId}-secondary`}
        >
          {secondary}
        </span>
      ) : null}
    </span>
  );
}
