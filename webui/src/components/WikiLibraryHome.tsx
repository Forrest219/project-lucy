import { pagesUnderDirectory, wikiTitleFromKey } from "../lib/wiki";
import type { WikiDirectorySummary, WikiSummary } from "../lib/types";

export type WikiLibraryHomeProps = {
  pages: WikiSummary[];
  directories?: WikiDirectorySummary[];
  /** Spec 105: when set, list only documents under this directory prefix. */
  selectedDirectory?: string | null;
  onSelect: (key: string) => void;
};

/**
 * Right-panel Markdown list for the Business Wiki explorer.
 *
 * Spec 105 (Attu-aligned): without a selected directory, show a select
 * prompt instead of a flat whole-library dump. With a directory, filter
 * to that prefix. The sidebar tree remains the only directory hierarchy.
 */
export function WikiLibraryHome({
  pages,
  selectedDirectory = null,
  onSelect
}: WikiLibraryHomeProps) {
  const directory = selectedDirectory?.trim() || "";
  const scopedPages = directory ? pagesUnderDirectory(pages, directory) : [];

  if (!directory) {
    return (
      <section
        aria-label="Markdown 文档库"
        className="pl-wiki-library-home"
        data-testid="wiki-library-home"
      >
        <div
          className="pl-wiki-library-select-prompt"
          data-testid="wiki-library-select-prompt"
        >
          <p className="pl-wiki-library-select-prompt-title">从左侧选择目录或文档</p>
          <p className="pl-wiki-library-select-prompt-hint">
            选择 Wiki 目录后，将在此列出该目录下的 <span className="notranslate" translate="no">Markdown</span> 文档。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Markdown 文档库"
      className="pl-wiki-library-home"
      data-directory={directory}
      data-testid="wiki-library-home"
    >
      <p className="pl-wiki-library-summary" data-testid="wiki-library-summary">
        当前目录{" "}
        <code className="notranslate" translate="no">
          wiki/{directory}
        </code>
        {" · "}
        <strong>{scopedPages.length}</strong> 篇
      </p>

      {scopedPages.length === 0 ? (
        <div
          className="pl-wiki-library-empty"
          data-testid="wiki-library-directory-empty"
        >
          <p>此目录还没有 Markdown 文档。</p>
        </div>
      ) : (
        <ul className="pl-wiki-library-documents" data-testid="wiki-library-documents">
          {scopedPages.map((page) => {
            const title = page.summary?.trim() || wikiTitleFromKey(page.key);
            return (
              <li
                className="pl-wiki-library-document"
                data-testid="wiki-library-document"
                key={page.key}
              >
                <button
                  className="pl-wiki-library-document-button"
                  data-testid={`wiki-library-document-button-${page.key}`}
                  onClick={() => onSelect(page.key)}
                  type="button"
                >
                  <span
                    className="pl-wiki-library-md-icon notranslate"
                    aria-hidden
                    translate="no"
                  >
                    MD
                  </span>
                  <span className="pl-wiki-library-document-main">
                    <span
                      className="pl-wiki-library-document-title"
                      data-testid="wiki-library-document-title"
                    >
                      {title}
                    </span>
                    <code
                      className="pl-wiki-library-document-path notranslate"
                      data-testid="wiki-library-document-path"
                      translate="no"
                    >
                      wiki/{page.key}
                    </code>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
