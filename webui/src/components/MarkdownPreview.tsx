/**
 * Tiny, dependency-free Markdown renderer for the Wiki preview tab.
 *
 * Scope is intentionally small (matches the design doc §7.2):
 *   - H1-H6 headings
 *   - paragraphs
 *   - unordered and ordered lists
 *   - bold, italic, inline code
 *   - fenced code blocks
 *   - blockquotes
 *   - links
 *   - GFM pipe tables
 *
 * Source markdown is split into lines first; each block (paragraph /
 * list / code / quote) is then re-joined to escaped HTML with a small
 * tag whitelist.
 */
import { ensureUniqueHeadingId, slugifyHeading } from "../lib/wiki";

type TableAlignment = "left" | "center" | "right";

type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string | null; text: string }
  | { kind: "quote"; text: string }
  | { kind: "table"; headers: string[]; alignments: TableAlignment[]; rows: string[][] };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^```(\S+)?\s*$/;
const UL_ITEM_RE = /^[-*+]\s+(.*)$/;
const OL_ITEM_RE = /^\d+\.\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^-{3,}$|^\*{3,}$$/;

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownAnchorId(text: string): string {
  // Source of truth lives in `lib/wiki.ts` so this renderer and the
  // Wiki TOC extract the same slug.
  return slugifyHeading(text);
}

function renderInline(text: string): string {
  let safe = escapeHtml(text);
  const codePlaceholders: string[] = [];
  // Inline code first (before bold/italic) so underscores inside config keys
  // such as LUCY_AGENT_TOKEN stay literal.
  safe = safe.replace(/`([^`]+)`/g, (_match, code: string) => {
    const token = `\u0000CODE${codePlaceholders.length}\u0000`;
    codePlaceholders.push(`<code class="notranslate" translate="no">${code}</code>`);
    return token;
  });
  // Bold: **text** or __text__
  safe = safe.replace(/\*\*([^*]+)\*\*/g, (_match, body: string) => `<strong>${body}</strong>`);
  safe = safe.replace(/__([^_]+)__/g, (_match, body: string) => `<strong>${body}</strong>`);
  // Italic: *text* or _text_ (skip when adjacent to a closing tag boundary)
  safe = safe.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_match, prefix: string, body: string) => `${prefix}<em>${body}</em>`);
  safe = safe.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, (_match, prefix: string, body: string) => `${prefix}<em>${body}</em>`);
  // Links: [text](url) — only allow http(s) and relative paths to avoid javascript: etc.
  safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
    const cleaned = url.trim();
    if (/^(https?:|\/|#|\?)/i.test(cleaned) || /^[a-zA-Z0-9_./-]+$/.test(cleaned)) {
      const href = escapeHtml(cleaned);
      if (/^(#|\?)/.test(cleaned)) {
        return `<a href="${href}">${label}</a>`;
      }
      return `<a href="${href}" rel="noopener noreferrer" target="_blank">${label}</a>`;
    }
    return label;
  });
  return safe.replace(/\u0000CODE(\d+)\u0000/g, (_match, index: string) => codePlaceholders[Number(index)] ?? "");
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && trimmed.length > 0;
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseTableAlignment(cell: string): TableAlignment {
  const trimmed = cell.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.endsWith(":")) return "right";
  return "left";
}

function normalizeTableRow(cells: string[], width: number): string[] {
  if (cells.length === width) return cells;
  if (cells.length > width) return cells.slice(0, width);
  return [...cells, ...Array.from({ length: width - cells.length }, () => "")];
}

function tryParseTable(lines: string[], startIndex: number): { block: Block; nextIndex: number } | null {
  const headerLine = lines[startIndex] ?? "";
  const separatorLine = lines[startIndex + 1] ?? "";
  if (!isTableRow(headerLine) || !isTableRow(separatorLine)) {
    return null;
  }
  const headers = splitTableRow(headerLine);
  const separators = splitTableRow(separatorLine);
  if (headers.length === 0 || !isTableSeparator(separators)) {
    return null;
  }

  const width = headers.length;
  const alignments = normalizeTableRow(separators, width).map(parseTableAlignment);
  const rows: string[][] = [];
  let i = startIndex + 2;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || !isTableRow(line)) {
      break;
    }
    rows.push(normalizeTableRow(splitTableRow(line), width));
    i += 1;
  }

  return {
    block: {
      kind: "table",
      headers,
      alignments,
      rows
    },
    nextIndex: i
  };
}

function alignStyle(align: TableAlignment): string {
  return align === "left" ? "" : ` style="text-align: ${align}"`;
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  let buffer: string[] = [];
  let listItems: string[] | null = null;
  let listOrdered: boolean | null = null;
  let quoteBuffer: string[] | null = null;
  let codeBuffer: string[] | null = null;
  let codeLanguage: string | null = null;

  function flushParagraph() {
    if (buffer.length === 0) {
      return;
    }
    const text = buffer.join(" ").trim();
    if (text) {
      blocks.push({ kind: "paragraph", text });
    }
    buffer = [];
  }
  function flushList() {
    if (listItems && listItems.length > 0) {
      blocks.push({ kind: "list", ordered: listOrdered === true, items: listItems });
    }
    listItems = null;
    listOrdered = null;
  }
  function flushQuote() {
    if (quoteBuffer && quoteBuffer.length > 0) {
      blocks.push({ kind: "quote", text: quoteBuffer.join(" ") });
    }
    quoteBuffer = null;
  }
  function flushCode() {
    if (codeBuffer !== null) {
      blocks.push({ kind: "code", language: codeLanguage, text: codeBuffer.join("\n") });
    }
    codeBuffer = null;
    codeLanguage = null;
  }

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = line.match(FENCE_RE);
    if (codeBuffer !== null) {
      if (fence) {
        flushCode();
      } else {
        codeBuffer.push(line);
      }
      i += 1;
      continue;
    }
    if (fence) {
      flushParagraph();
      flushList();
      flushQuote();
      codeBuffer = [];
      codeLanguage = fence[1] ?? null;
      i += 1;
      continue;
    }
    if (HR_RE.test(line.trim())) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push({ kind: "paragraph", text: "---" });
      i += 1;
      continue;
    }
    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      flushList();
      flushQuote();
      const hashes = heading[1] ?? "";
      const text = heading[2] ?? "";
      const level = Math.min(hashes.length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: "heading", level, text });
      i += 1;
      continue;
    }
    const table = tryParseTable(lines, i);
    if (table) {
      flushParagraph();
      flushList();
      flushQuote();
      blocks.push(table.block);
      i = table.nextIndex;
      continue;
    }
    const ul = line.match(UL_ITEM_RE);
    const ol = line.match(OL_ITEM_RE);
    if (ul || ol) {
      flushParagraph();
      flushQuote();
      const ordered = Boolean(ol);
      if (listOrdered !== ordered) {
        flushList();
        listItems = [];
        listOrdered = ordered;
      } else if (!listItems) {
        listItems = [];
        listOrdered = ordered;
      }
      listItems?.push(((ul?.[1] ?? ol?.[1]) ?? "").trim());
      i += 1;
      continue;
    }
    const quote = line.match(QUOTE_RE);
    if (quote) {
      flushParagraph();
      flushList();
      if (!quoteBuffer) {
        quoteBuffer = [];
      }
      quoteBuffer.push((quote[1] ?? "").trim());
      i += 1;
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      flushQuote();
      i += 1;
      continue;
    }
    flushList();
    flushQuote();
    buffer.push(line);
    i += 1;
  }
  flushParagraph();
  flushList();
  flushQuote();
  flushCode();
  return blocks;
}

function renderBlocks(blocks: Block[]): string {
  const out: string[] = [];
  // Track used anchor ids so duplicate headings get a deterministic
  // suffix (`-2`, `-3`, …) that matches the suffix emitted by
  // `extractWikiToc`. Without this, two `## Notes` headings would
  // render the same DOM id and the TOC link would scroll to the
  // wrong section.
  const usedIds = new Set<string>();
  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const id = ensureUniqueHeadingId(markdownAnchorId(block.text), usedIds);
        const idAttr = id ? ` id="${escapeHtml(id)}"` : "";
        out.push(`<h${block.level}${idAttr}>${renderInline(block.text)}</h${block.level}>`);
        break;
      }
      case "paragraph": {
        if (block.text === "---") {
          out.push("<hr />");
        } else {
          out.push(`<p>${renderInline(block.text)}</p>`);
        }
        break;
      }
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const items = block.items.map((item) => `<li>${renderInline(item)}</li>`).join("");
        out.push(`<${tag}>${items}</${tag}>`);
        break;
      }
      case "code": {
        const lang = block.language ? ` data-lang="${escapeHtml(block.language)}"` : "";
        out.push(`<pre${lang} class="notranslate" translate="no"><code class="notranslate" translate="no">${escapeHtml(block.text)}</code></pre>`);
        break;
      }
      case "quote": {
        out.push(`<blockquote><p>${renderInline(block.text)}</p></blockquote>`);
        break;
      }
      case "table": {
        const headers = block.headers
          .map((header, index) => `<th scope="col"${alignStyle(block.alignments[index] ?? "left")}>${renderInline(header)}</th>`)
          .join("");
        const rows = block.rows
          .map((row) => {
            const cells = row
              .map((cell, index) => `<td${alignStyle(block.alignments[index] ?? "left")}>${renderInline(cell)}</td>`)
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("");
        out.push(
          `<div class="pl-markdown-table-wrap"><table class="pl-markdown-table notranslate" translate="no"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`
        );
        break;
      }
    }
  }
  return out.join("");
}

type Props = {
  markdown: string;
};

/**
 * Render Markdown to a small escaped HTML whitelist, then inject the
 * generated string. Scripts / iframes / style tags are never produced.
 */
export function MarkdownPreview({ markdown }: Props) {
  const html = renderBlocks(parseBlocks(markdown));
  return (
    <div
      className="pl-markdown-preview"
      data-testid="wiki-markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
