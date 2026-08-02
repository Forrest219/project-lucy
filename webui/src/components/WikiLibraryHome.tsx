import { buildWikiDirectoryTree, wikiTitleFromKey } from "../lib/wiki";
import type { WikiDirectoryNode } from "../lib/wiki";
import type { WikiDirectorySummary, WikiSummary } from "../lib/types";

export type WikiLibraryHomeProps = {
  pages: WikiSummary[];
  directories?: WikiDirectorySummary[];
  onSelect: (key: string) => void;
};

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
      <header className="pl-wiki-library-hero">
        <div className="pl-wiki-library-copy">
          <p className="pl-wiki-library-kicker">Markdown 文档库</p>
          <h2 className="pl-wiki-library-title">按目录管理业务口径文档</h2>
          <p className="pl-wiki-library-description">
            当前收录 {total} 篇 Markdown 文档，分布在 {directoryCount} 个目录中。
          </p>
        </div>
      </header>

      {directoryTree.length === 0 ? (
        <div className="pl-wiki-library-empty" data-testid="wiki-library-empty">
          <p>还没有 Wiki 文档。</p>
        </div>
      ) : (
        <div className="pl-wiki-library-groups" data-testid="wiki-library-groups">
          {directoryTree.map((node) => (
            <DirectorySection
              key={node.path || "__root__"}
              node={node}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function countDirectories(nodes: WikiDirectoryNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + 1 + countDirectories(node.children),
    0
  );
}

function DirectorySection({
  node,
  onSelect
}: {
  node: WikiDirectoryNode;
  onSelect: (key: string) => void;
}) {
  return (
    <section className="pl-wiki-library-group">
      <header className="pl-wiki-library-group-header">
        <span className="pl-wiki-library-folder-icon" aria-hidden>
          ▾
        </span>
        <h3
          className="pl-wiki-library-group-title notranslate"
          translate="no"
        >
          {node.path || node.name}
        </h3>
        <span className="pl-wiki-library-count">{node.documentCount} 篇</span>
      </header>
      <ul className="pl-wiki-library-list">
        {node.pages.map((page) => (
          <li className="pl-wiki-library-item" key={page.key}>
            <button
              className="pl-wiki-library-item-button"
              onClick={() => onSelect(page.key)}
              type="button"
            >
              <span className="pl-wiki-library-md-icon notranslate" translate="no">
                MD
              </span>
              <span className="pl-wiki-library-item-main" title={page.key}>
                <span className="pl-wiki-library-item-title">
                  {page.summary?.trim() || wikiTitleFromKey(page.key)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {node.children.length > 0 ? (
        <div className="pl-wiki-library-children">
          {node.children.map((child) => (
            <DirectorySection key={child.path} node={child} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
