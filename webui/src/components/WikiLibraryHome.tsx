import { buildWikiDirectoryTree, wikiTitleFromKey } from "../lib/wiki";
import type { WikiDirectoryNode } from "../lib/wiki";
import type { WikiDirectorySummary, WikiSummary } from "../lib/types";

export type WikiLibraryHomeProps = {
  pages: WikiSummary[];
  directories?: WikiDirectorySummary[];
  onSelect: (key: string) => void;
};

/**
 * Renders the neutral /wiki library home: a compact statistics summary
 * plus a flat Markdown document list. The previous directory-tree
 * recap was removed (M64) because it duplicated the left sidebar and
 * pushed the documents out of the first viewport.
 */
export function WikiLibraryHome({
  directories = [],
  pages,
  onSelect
}: WikiLibraryHomeProps) {
  const directoryTree = buildWikiDirectoryTree({ pages, directories });
  const total = pages.length;
  const directoryCount = countDirectories(directoryTree);

  return (
    <section
      aria-label="Markdown 文档库"
      className="pl-wiki-library-home"
      data-testid="wiki-library-home"
    >
      <p className="pl-wiki-library-summary" data-testid="wiki-library-summary">
        {directoryCount === 0 ? (
          <>
            当前收录 <strong>{total}</strong> 篇 <span className="notranslate" translate="no">Markdown</span> 文档，全部位于根目录。
          </>
        ) : (
          <>
            当前收录 <strong>{total}</strong> 篇 <span className="notranslate" translate="no">Markdown</span>{" "}
            文档，分布在 <strong>{directoryCount}</strong> 个目录中。
          </>
        )}
      </p>

      {pages.length === 0 ? (
        <div className="pl-wiki-library-empty" data-testid="wiki-library-empty">
          <p>还没有 Wiki 文档。</p>
        </div>
      ) : (
        <ul className="pl-wiki-library-documents" data-testid="wiki-library-documents">
          {pages.map((page) => {
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

function countDirectories(nodes: WikiDirectoryNode[]): number {
  // M65: only count top-level directories, and only those that actually
  // contain (or recursively contain) Markdown documents. Empty subtrees
  // were inflating the count in seed data and contradicted the
  // user-facing summary.
  //
  // The synthetic root node (`path === ""`) represents pages that live at
  // the wiki root rather than inside a named directory. We intentionally
  // exclude it so the "N 个目录中" sentence stays consistent with the
  // "全部位于根目录" fallback when no named directories exist.
  return nodes.reduce(
    (sum, node) =>
      sum + (node.path === "" || node.documentCount === 0 ? 0 : 1),
    0
  );
}