import { groupWikiPages, wikiTitleFromKey } from "../lib/wiki";
import type { WikiSummary } from "../lib/types";

export type WikiLibraryHomeProps = {
  pages: WikiSummary[];
  onNew: () => void;
  onSelect: (key: string) => void;
  onUpload: () => void;
};

export function WikiLibraryHome({
  pages,
  onNew,
  onSelect,
  onUpload
}: WikiLibraryHomeProps) {
  const groups = groupWikiPages(pages);
  const total = pages.length;

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
            当前收录 {total} 篇 Markdown 文档。选择左侧目录中的文件查看正文，或上传本地 `.md` 文件新建文档。
          </p>
        </div>
        <div className="pl-wiki-library-actions">
          <button
            className="pl-btn pl-btn--primary"
            data-testid="wiki-library-upload"
            onClick={onUpload}
            type="button"
          >
            上传 Markdown
          </button>
          <button
            className="pl-btn pl-btn--ghost"
            data-testid="wiki-library-new"
            onClick={onNew}
            type="button"
          >
            新建文档
          </button>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="pl-wiki-library-empty" data-testid="wiki-library-empty">
          <p>还没有 Wiki 文档。</p>
          <button className="pl-btn pl-btn--primary" onClick={onUpload} type="button">
            上传 Markdown
          </button>
        </div>
      ) : (
        <div className="pl-wiki-library-groups" data-testid="wiki-library-groups">
          {groups.map((group) => (
            <section className="pl-wiki-library-group" key={group.directory || "__root__"}>
              <header className="pl-wiki-library-group-header">
                <span className="pl-wiki-library-folder-icon" aria-hidden>
                  ▾
                </span>
                <h3
                  className="pl-wiki-library-group-title notranslate"
                  translate="no"
                >
                  {group.directoryLabel}
                </h3>
                <span className="pl-wiki-library-count">{group.pages.length}</span>
              </header>
              <ul className="pl-wiki-library-list">
                {group.pages.map((page) => (
                  <li className="pl-wiki-library-item" key={page.key}>
                    <button
                      className="pl-wiki-library-item-button"
                      onClick={() => onSelect(page.key)}
                      type="button"
                    >
                      <span className="pl-wiki-library-md-icon notranslate" translate="no">
                        MD
                      </span>
                      <span className="pl-wiki-library-item-main">
                        <span className="pl-wiki-library-item-title">
                          {page.summary?.trim() || wikiTitleFromKey(page.key)}
                        </span>
                        <span
                          className="pl-wiki-library-item-path notranslate"
                          title={page.key}
                          translate="no"
                        >
                          {page.key}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
