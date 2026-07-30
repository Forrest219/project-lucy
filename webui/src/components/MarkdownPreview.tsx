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
 *
 * Source markdown is split into lines first; each block (paragraph /
 * list / code / quote) is then re-joined to escaped HTML with a small
 * tag whitelist.
 */

type Block =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string | null; text: string }
  | { kind: "quote"; text: string };

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
  return text
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-")
    .replace(/^-+|-+$/g, "");
}

function renderInline(text: string): string {
  let safe = escapeHtml(text);
  // Inline code first (before bold/italic) so we don't break backticks.
  safe = safe.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`);
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
  return safe;
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
  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const id = markdownAnchorId(block.text);
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
        out.push(`<pre${lang}><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      }
      case "quote": {
        out.push(`<blockquote><p>${renderInline(block.text)}</p></blockquote>`);
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
