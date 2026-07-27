import { DiffViewer } from "./DiffViewer";
import { MarkdownPreview } from "./MarkdownPreview";
import type { WikiPreview } from "../lib/types";

export type WikiInspectorTab = "preview" | "diff" | "raw";

type Props = {
  activeTab: WikiInspectorTab;
  content: string;
  preview: WikiPreview | null;
  previewError: string | null;
  onTabChange: (tab: WikiInspectorTab) => void;
};

export function WikiInspector({
  activeTab,
  content,
  preview,
  previewError,
  onTabChange
}: Props) {
  return (
    <aside aria-label="业务 Wiki 检查器" className="pl-wiki-inspector">
      <div className="pl-wiki-inspector-tabs" role="tablist">
        <button
          aria-selected={activeTab === "preview"}
          className={
            activeTab === "preview"
              ? "pl-wiki-inspector-tab pl-wiki-inspector-tab--active"
              : "pl-wiki-inspector-tab"
          }
          onClick={() => onTabChange("preview")}
          role="tab"
          type="button"
        >
          渲染预览
        </button>
        <button
          aria-selected={activeTab === "diff"}
          className={
            activeTab === "diff"
              ? "pl-wiki-inspector-tab pl-wiki-inspector-tab--active"
              : "pl-wiki-inspector-tab"
          }
          onClick={() => onTabChange("diff")}
          role="tab"
          type="button"
        >
          Diff
        </button>
        <button
          aria-selected={activeTab === "raw"}
          className={
            activeTab === "raw"
              ? "pl-wiki-inspector-tab pl-wiki-inspector-tab--active"
              : "pl-wiki-inspector-tab"
          }
          onClick={() => onTabChange("raw")}
          role="tab"
          type="button"
        >
          Raw
        </button>
      </div>

      {previewError ? <p className="pl-error">{previewError}</p> : null}

      {activeTab === "preview" ? (
        <section className="pl-wiki-inspector-section">
          {content.trim() ? (
            <MarkdownPreview markdown={content} />
          ) : (
            <p className="pl-notice">正文为空，先在左侧 Markdown 编辑器中写点内容吧。</p>
          )}
        </section>
      ) : null}

      {activeTab === "diff" ? (
        <section className="pl-wiki-inspector-section">
          <DiffViewer diff={preview?.diff ?? ""} />
        </section>
      ) : null}

      {activeTab === "raw" ? (
        <section className="pl-wiki-inspector-section">
          <pre className="pl-yaml-preview">{preview?.proposedMarkdown ?? ""}</pre>
        </section>
      ) : null}
    </aside>
  );
}
