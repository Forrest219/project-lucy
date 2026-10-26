import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  authoringHowToNotes,
  downloadAuthoringHowTo,
  type AuthoringHowToKind
} from "../../lib/authoringHowTo";
import { CLIPBOARD_COPY_FAILED_MESSAGE, copyTextToClipboard } from "../../lib/clipboard";

export type AuthoringHowToProps = {
  kind: AuthoringHowToKind;
  autoOpen?: boolean;
};

export function AuthoringHowTo({ kind, autoOpen = false }: AuthoringHowToProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const autoOpened = useRef(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!autoOpen || autoOpened.current) return;
    autoOpened.current = true;
    if (detailsRef.current) detailsRef.current.open = true;
  }, [autoOpen]);

  async function copyNotes() {
    const result = await copyTextToClipboard(authoringHowToNotes(kind));
    if (!result.ok) {
      toast.error(CLIPBOARD_COPY_FAILED_MESSAGE);
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const testId = kind === "schema_manifest" ? "setup-howto-schema-manifest" : "setup-howto-business-wiki";

  return (
    <details
      ref={detailsRef}
      className="text-xs"
      data-testid={testId}
    >
      <summary className="cursor-pointer font-medium text-fg-muted hover:text-fg-default notranslate" translate="no">
        {kind === "schema_manifest" ? "如何生成 Schema Manifest" : "如何写业务 Wiki"}
      </summary>
      <div className="mt-1.5 space-y-1.5 text-fg-muted">
        {kind === "schema_manifest" ? (
          <p>
            要自己准备文件时，把编写说明交给你的{" "}
            <span className="notranslate" translate="no">Agent</span>。
          </p>
        ) : (
          <>
            <p>
              可以直接在下面写口径，或上传一份{" "}
              <span className="notranslate" translate="no">Markdown</span>
              。暂时没有也可以跳过。
            </p>
            <p>
              还不知道写什么时，把编写说明交给你的{" "}
              <span className="notranslate" translate="no">Agent</span>
              ，让它按已启用的表写成中文口径，再贴回本页。
            </p>
          </>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            onClick={() => void copyNotes()}
            data-testid={`${testId}-copy`}
          >
            {copied ? "已复制" : "复制说明"}
          </button>
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            onClick={() => downloadAuthoringHowTo(kind)}
            data-testid={`${testId}-download`}
          >
            下载编写说明
          </button>
        </div>
      </div>
    </details>
  );
}
