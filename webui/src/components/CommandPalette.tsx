import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { navGroups, topLevelEntry, type NavItem } from "../app/navigation";

/**
 * M60 Sidebar Brand Navigation Polish — Command Palette MVP.
 * M61 Sidebar Brand Navigation Follow-up — search-style initial state.
 * M70 Command Palette Result Context — promote the dialog from a sidebar
 * navigation mirror to a page search result: each row carries a breadcrumb,
 * a title, an optional muted route hint and a one-line description; matched
 * substrings are wrapped in a highlight node. Scoring is deterministic and
 * uses no locale-specific segmentation so `语义资产` always outranks a
 * group-title-only match such as `业务 Wiki` under the 语义建模 group.
 */

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
};

const MAX_RESULTS = 7;
const BRAND_LABEL = "Lucy WebUI";

/**
 * Stable scoring table. Higher score wins. Ties fall back to the order of
 * `flattenEntries()` (which preserves the canonical sidebar IA), so the
 * score order is deterministic without depending on the engine's iteration
 * order or locale-aware string comparison.
 *
 * - 100: label startsWith query — the entry IS the page the user typed.
 * - 90:  label includes query — direct label hit, just not at the start.
 * - 75:  any keyword includes query — short alias the user actually searched.
 * - 55:  description includes query — matches the page summary.
 * - 40:  groupTitle includes query — only the section name matched.
 * - 20:  route includes query — last resort, so /catalog still beats nothing.
 */
const SCORE_LABEL_STARTS_WITH = 100;
const SCORE_LABEL_INCLUDES = 90;
const SCORE_KEYWORD_INCLUDES = 75;
const SCORE_DESCRIPTION_INCLUDES = 55;
const SCORE_GROUP_INCLUDES = 40;
const SCORE_ROUTE_INCLUDES = 20;
const PROTECTED_TERMS = [
  "Lucy WebUI",
  "Data Agent",
  "Catalog Reload",
  "Connection",
  "Dashboard",
  "Endpoint",
  "Manifest",
  "Markdown",
  "Workbench",
  "Whitelist",
  "Catalog",
  "Monitor",
  "Metric",
  "Schema",
  "Agent",
  "Token",
  "Table",
  "Role",
  "Wiki",
  "Case",
  "YAML",
  "Lucy",
  "MCP",
  "ACL",
  "API",
  "Run"
];

type CommandEntry = {
  /** Stable id used as the React key and by tests. */
  id: string;
  /** Owning group heading; surfaces as a breadcrumb crumb. */
  groupTitle: string;
  label: string;
  to: string;
  /** One-sentence page purpose. M70 spec §4.1. */
  description: string;
  /** Short aliases (e.g. 指标, Role, Wiki). M70 spec §4.1. */
  keywords: string[];
  /** Ordered breadcrumb chain. Top-level entries use [BRAND_LABEL]. */
  breadcrumb: string[];
};

type TextSegment = {
  text: string;
  match: boolean;
  protected: boolean;
};

function toEntry(item: NavItem, groupTitle: string, breadcrumb: string[]): CommandEntry {
  return {
    id: item.id,
    groupTitle,
    label: item.label,
    to: item.to,
    description: item.description ?? "",
    keywords: item.keywords ?? [],
    breadcrumb
  };
}

function flattenEntries(): CommandEntry[] {
  const entries: CommandEntry[] = [
    toEntry(topLevelEntry, topLevelEntry.label, [BRAND_LABEL])
  ];
  for (const group of navGroups) {
    for (const item of group.items) {
      entries.push(toEntry(item, group.title, [BRAND_LABEL, group.title]));
    }
  }
  return entries;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Deterministic page-search-result scoring. Returns 0 when no field matched
 * so empty queries (handled separately) and irrelevant matches both fall
 * out of the result list the same way.
 */
function scoreEntry(entry: CommandEntry, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  const label = entry.label.toLowerCase();
  if (label.startsWith(normalizedQuery)) return SCORE_LABEL_STARTS_WITH;
  if (label.includes(normalizedQuery)) return SCORE_LABEL_INCLUDES;
  for (const kw of entry.keywords) {
    if (kw.toLowerCase().includes(normalizedQuery)) return SCORE_KEYWORD_INCLUDES;
  }
  if (entry.description.toLowerCase().includes(normalizedQuery)) return SCORE_DESCRIPTION_INCLUDES;
  if (entry.groupTitle.toLowerCase().includes(normalizedQuery)) return SCORE_GROUP_INCLUDES;
  if (entry.to.toLowerCase().includes(normalizedQuery)) return SCORE_ROUTE_INCLUDES;
  return 0;
}

/**
 * Safe highlight helper. Splits a string into alternating plain / matched
 * segments based on a literal substring search. We deliberately avoid
 * `dangerouslySetInnerHTML` and any regex-based escape path because the
 * input is plain label / description text — the only transformation is
 * the substring match itself.
 */
function isAsciiWordChar(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_]/.test(value));
}

function hasTermBoundary(text: string, start: number, length: number): boolean {
  const before = text[start - 1];
  const after = text[start + length];
  return !isAsciiWordChar(before) && !isAsciiWordChar(after);
}

function findNextProtectedRange(text: string, cursor: number): { start: number; end: number } | undefined {
  const lowerText = text.toLowerCase();
  let best: { start: number; end: number } | undefined;
  for (const term of PROTECTED_TERMS) {
    const lowerTerm = term.toLowerCase();
    let start = lowerText.indexOf(lowerTerm, cursor);
    while (start !== -1) {
      if (hasTermBoundary(text, start, term.length)) {
        const candidate = { start, end: start + term.length };
        if (
          !best ||
          candidate.start < best.start ||
          (candidate.start === best.start && candidate.end > best.end)
        ) {
          best = candidate;
        }
        break;
      }
      start = lowerText.indexOf(lowerTerm, start + 1);
    }
  }
  return best;
}

function splitHighlightedText(
  text: string,
  normalizedQuery: string,
  protectedTerm: boolean
): TextSegment[] {
  if (!text) return [{ text: "", match: false, protected: protectedTerm }];
  if (!normalizedQuery) return [{ text, match: false, protected: protectedTerm }];
  const lowerText = text.toLowerCase();
  const segments: TextSegment[] = [];
  let cursor = 0;
  let next = lowerText.indexOf(normalizedQuery, cursor);
  while (next !== -1) {
    if (next > cursor) {
      segments.push({ text: text.slice(cursor, next), match: false, protected: protectedTerm });
    }
    segments.push({
      text: text.slice(next, next + normalizedQuery.length),
      match: true,
      protected: protectedTerm
    });
    cursor = next + normalizedQuery.length;
    next = lowerText.indexOf(normalizedQuery, cursor);
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false, protected: protectedTerm });
  }
  return segments;
}

function textSegments(text: string, normalizedQuery: string): TextSegment[] {
  if (!text) return [{ text: "", match: false, protected: false }];
  const segments: TextSegment[] = [];
  let cursor = 0;
  let nextProtected = findNextProtectedRange(text, cursor);
  while (nextProtected) {
    if (nextProtected.start > cursor) {
      segments.push(
        ...splitHighlightedText(text.slice(cursor, nextProtected.start), normalizedQuery, false)
      );
    }
    segments.push(
      ...splitHighlightedText(text.slice(nextProtected.start, nextProtected.end), normalizedQuery, true)
    );
    cursor = nextProtected.end;
    nextProtected = findNextProtectedRange(text, cursor);
  }
  if (cursor < text.length) {
    segments.push(...splitHighlightedText(text.slice(cursor), normalizedQuery, false));
  }
  return segments;
}

function renderTextSegments(segments: TextSegment[], keyPrefix: string) {
  return segments.map((segment, segmentIndex) => {
    const classNames = [
      segment.match ? "pl-command-palette-highlight" : "",
      segment.protected ? "notranslate" : ""
    ]
      .filter(Boolean)
      .join(" ");
    const commonProps = {
      key: `${keyPrefix}-seg-${segmentIndex}`,
      className: classNames || undefined,
      translate: segment.protected ? "no" as const : undefined
    };
    return segment.match ? (
      <mark {...commonProps}>{segment.text}</mark>
    ) : (
      <span {...commonProps}>{segment.text}</span>
    );
  });
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset transient state every time the palette opens so a previous
  // session's query / highlight don't carry over.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);

  const allEntries = useMemo(() => flattenEntries(), []);
  // M61: cap the visible result list at 7 so the dialog stays a search
  // dialog. Empty input intentionally has no hidden first result; Enter
  // before typing must keep the user where they are.
  //
  // M70: scoring is deterministic. We compute the score once per entry per
  // query and keep only matches with score > 0, sorted by score desc. Ties
  // preserve the IA order returned by flattenEntries(), which mirrors the
  // canonical `topLevelEntry + navGroups` order so the result ordering is
  // both predictable and locale-independent.
  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    const scored: Array<{ entry: CommandEntry; score: number; originalIndex: number }> = [];
    allEntries.forEach((entry, index) => {
      const score = scoreEntry(entry, q);
      if (score > 0) {
        scored.push({ entry, score, originalIndex: index });
      }
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.originalIndex - b.originalIndex;
    });
    return scored.slice(0, MAX_RESULTS).map((item) => item.entry);
  }, [allEntries, query]);
  const visible = filtered;
  const normalizedQuery = normalize(query);

  // Clamp the active index whenever the filtered list shrinks so a stale
  // highlight from a longer list never points past the end.
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(filtered.length === 0 ? 0 : filtered.length - 1);
    }
  }, [filtered.length, activeIndex]);

  // Scroll the active row into view as the user arrows through the list.
  // jsdom does not implement `scrollIntoView`; guard the call so the
  // environment-friendly default (no-op) keeps test rendering stable.
  useEffect(() => {
    if (!open || filtered.length === 0) return;
    const list = listRef.current;
    if (!list) return;
    const node = list.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, filtered.length, open]);

  const commitSelection = (index: number) => {
    const entry = filtered[index];
    if (!entry) return;
    onClose();
    navigate(entry.to);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length === 0) return;
      setActiveIndex((prev) => (prev + 1) % filtered.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filtered.length === 0) return;
      setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commitSelection(activeIndex);
    }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <Dialog.Root onOpenChange={(next) => (!next ? onClose() : null)} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="pl-command-palette-overlay" />
        <Dialog.Content
          aria-describedby="command-palette-description"
          className="pl-command-palette-content"
          data-testid="command-palette"
        >
          <Dialog.Title className="sr-only">命令面板</Dialog.Title>
          <Dialog.Description id="command-palette-description" className="sr-only">
            输入关键词快速跳转到侧栏目标。
          </Dialog.Description>
          <div className="pl-command-palette-search">
            <Search aria-hidden="true" className="size-5 text-fg-muted" />
            <input
              ref={inputRef}
              autoFocus
              className="pl-command-palette-input notranslate"
              translate="no"
              data-testid="command-palette-input"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="搜索页面、流程或配置对象"
              value={query}
              aria-label="搜索命令"
            />
            <span
              aria-hidden="true"
              className="pl-command-palette-esc-keycap"
              data-testid="command-palette-esc-keycap"
            >
              ESC
            </span>
          </div>
          <div
            className="pl-command-palette-list"
            data-testid="command-palette-list"
            ref={listRef}
            role="listbox"
          >
            {!hasQuery ? (
              <div
                className="pl-command-palette-hint"
                data-testid="command-palette-hint"
              >
                搜索页面、流程或配置对象
              </div>
            ) : visible.length === 0 ? (
              <div className="pl-command-palette-empty" data-testid="command-palette-empty">
                未找到匹配入口
                <span className="pl-command-palette-empty-suggestion">
                  试试 Connection、发布、评测、角色
                </span>
              </div>
            ) : (
              visible.map((entry, flatIndex) => {
                const isActive = flatIndex === activeIndex;
                const breadcrumbSegments = entry.breadcrumb;
                const labelSegments = textSegments(entry.label, normalizedQuery);
                const descriptionSegments = textSegments(entry.description, normalizedQuery);
                // Build breadcrumb segments with highlight once per crumb so
                // a query like 建模 (which lives in 语义建模) is still
                // explained visually.
                const breadcrumbRendered = breadcrumbSegments.map((crumb, crumbIndex) => ({
                  crumb,
                  segments: textSegments(crumb, normalizedQuery)
                }));
                const ariaLabel = [
                  entry.label,
                  breadcrumbSegments.join(" > "),
                  entry.description
                ]
                  .filter((part) => part && part.length > 0)
                  .join("，");
                return (
                  <button
                    key={entry.id}
                    className="pl-command-palette-item"
                    data-active={isActive ? "true" : "false"}
                    data-index={flatIndex}
                    data-testid={`command-palette-option-${entry.id}`}
                    onClick={() => commitSelection(flatIndex)}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    aria-label={ariaLabel}
                  >
                    <div className="pl-command-palette-breadcrumb" aria-hidden="true">
                      {breadcrumbRendered.map(({ crumb, segments }, crumbIndex) => (
                        <Fragment key={`${entry.id}-crumb-${crumbIndex}`}>
                          {crumbIndex > 0 ? (
                            <span className="pl-command-palette-breadcrumb-sep">›</span>
                          ) : null}
                          <span className="pl-command-palette-breadcrumb-crumb">
                            {renderTextSegments(segments, `${entry.id}-crumb-${crumbIndex}`)}
                          </span>
                        </Fragment>
                      ))}
                    </div>
                    <div className="pl-command-palette-title-row">
                      <span className="pl-command-palette-item-label">
                        {renderTextSegments(labelSegments, `${entry.id}-label`)}
                      </span>
                      <span
                        className="pl-command-palette-route-hint notranslate"
                        translate="no"
                        aria-hidden="true"
                      >
                        {entry.to}
                      </span>
                    </div>
                    <div className="pl-command-palette-item-description">
                      {renderTextSegments(descriptionSegments, `${entry.id}-desc`)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
