/**
 * audit-trust-2026-10-19-r1 / T05b — CredentialPrincipalCell
 *
 * Contract §5.2 item 3. Renders the credential principal (user_id) with a
 * copy-to-clipboard action and explanatory text. NOT a software identity —
 * "身份已验证" wording is forbidden when only UA / client-family is shown
 * (per Contract §5 "仅根据 User-Agent 显示的客户端家族不能写「身份已验证」").
 */

import { toast } from "sonner";
import { CLIPBOARD_COPY_FAILED_MESSAGE, copyTextToClipboard } from "../../lib/clipboard";

export type CredentialPrincipalCellProps = {
  userId: string;
  /** Optional descriptive label rendered next to the userId (e.g. role hint). */
  hint?: string;
};

export function CredentialPrincipalCell({ userId, hint }: CredentialPrincipalCellProps) {
  const handleCopy = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    void copyTextToClipboard(userId).then((result) => {
      // The cell has no success affordance of its own; only a failure needs to
      // be surfaced, otherwise a failed copy looks identical to a successful one.
      if (!result.ok) {
        toast.error(CLIPBOARD_COPY_FAILED_MESSAGE);
      }
    });
  };

  return (
    <div
      className="pl-credential-principal-cell"
      data-testid="credential-principal-cell"
      data-user-id={userId}
    >
      <span
        className="pl-credential-principal-value font-mono notranslate"
        translate="no"
        data-testid="credential-principal-value"
      >
        {userId}
      </span>
      <button
        type="button"
        className="pl-credential-principal-copy"
        data-testid="credential-principal-copy"
        onClick={handleCopy}
        aria-label="复制凭证主体"
      >
        复制
      </button>
      {hint ? (
        <span className="pl-credential-principal-hint" data-testid="credential-principal-hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}