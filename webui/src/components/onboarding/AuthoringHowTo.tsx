import { useEffect, useRef, useState } from "react";
import {
  authoringHowToNotes,
  downloadAuthoringHowTo,
  type AuthoringHowToKind
} from "../../lib/authoringHowTo";

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
    await navigator.clipboard.writeText(authoringHowToNotes(kind));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const testId = kind === "schema_manifest" ? "setup-howto-schema-manifest" : "setup-howto-business-wiki";

  return (
    <details
      ref={detailsRef}
      className="rounded-lg border border-border-default bg-bg-surface px-3 py-2"
      data-testid={testId}
    >
      <summary className="cursor-pointer text-xs font-medium text-fg-default notranslate" translate="no">
        {kind === "schema_manifest" ? "如何生成 Schema Manifest" : "如何写业务 Wiki"}
      </summary>
      <div className="mt-2 space-y-2 text-xs text-fg-muted">
        {kind === "schema_manifest" ? (
          <>
            <p>
              能读取这套数据库时，点「从数据库读取表结构」。写入的{" "}
              <span className="notranslate" translate="no">Schema Manifest</span> 包含表名、字段和类型。
            </p>
            <p>
              不能读取，或你要自己准备文件时，把编写说明交给你的{" "}
              <span className="notranslate" translate="no">Agent</span>
              。让它连接同一套数据库并生成{" "}
              <span className="notranslate" translate="no">YAML</span>
              ，再把文件拖到本页或粘贴到下面。
            </p>
          </>
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
