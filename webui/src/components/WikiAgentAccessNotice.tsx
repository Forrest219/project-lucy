import clsx from "clsx";
import { wikiAgentAccessCopy } from "../lib/wiki";
import type { WikiAclState } from "../lib/types";

export type WikiAgentAccessNoticeProps = {
  acl: WikiAclState | undefined;
  compact?: boolean;
  onAuthorize?: () => void;
  testId: string;
};

export function WikiAgentAccessNotice({
  acl,
  compact = false,
  onAuthorize,
  testId
}: WikiAgentAccessNoticeProps) {
  const copy = wikiAgentAccessCopy(acl);
  const needsAuthorize = copy.kind === "none" || copy.kind === "corrupt";

  if (compact) {
    return (
      <span
        className={clsx(
          "pl-wiki-agent-access",
          "pl-wiki-agent-access--compact",
          `pl-wiki-agent-access--${copy.tone}`
        )}
        data-kind={copy.kind}
        data-testid={testId}
        title={copy.detail}
      >
        {copy.shortLabel}
      </span>
    );
  }

  return (
    <div
      className={clsx("pl-wiki-agent-access", `pl-wiki-agent-access--${copy.tone}`)}
      data-kind={copy.kind}
      data-testid={testId}
      role="status"
    >
      <p className="pl-wiki-agent-access-label">{copy.label}</p>
      <p className="pl-wiki-agent-access-detail">{copy.detail}</p>
      {needsAuthorize && onAuthorize ? (
        <button
          className="pl-btn pl-btn--secondary pl-wiki-agent-access-action"
          data-testid={`${testId}-authorize`}
          onClick={onAuthorize}
          type="button"
        >
          选择可访问角色
        </button>
      ) : null}
    </div>
  );
}
