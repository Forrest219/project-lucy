import matter from "gray-matter";
import { parse as parseYaml } from "yaml";

/**
 * Single Markdown frontmatter entry point (V-08, Spec §4.6).
 *
 * gray-matter's default engines include `javascript`, which `eval`s `---js`
 * blocks on the server. Only an empty or `yaml` language tag is accepted here;
 * every other tag is rejected before any engine runs. This is the only file
 * under webui/server allowed to import gray-matter (enforced by
 * scripts/release/security-baseline.mjs).
 */

export const FRONTMATTER_ENGINE_FORBIDDEN = "FRONTMATTER_ENGINE_FORBIDDEN";

export class FrontmatterEngineForbiddenError extends Error {
  readonly code = FRONTMATTER_ENGINE_FORBIDDEN;

  constructor(language: string) {
    super(`Frontmatter language "${language}" is not allowed; only YAML is supported`);
    this.name = "FrontmatterEngineForbiddenError";
  }
}

export interface MarkdownFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

function forbiddenEngine(language: string) {
  return () => {
    throw new FrontmatterEngineForbiddenError(language);
  };
}

// Belt and braces for gray-matter's own parsing inside `stringify`.
const STRINGIFY_OPTIONS = {
  engines: {
    javascript: forbiddenEngine("javascript"),
    coffee: forbiddenEngine("coffee")
  }
};

/**
 * Locates an opening `---` line, mirroring gray-matter: `----` is not an
 * opener, and the language tag is everything after `---` up to the newline.
 * Returns undefined when `text` does not open a frontmatter block.
 */
function openingLine(text: string): { language: string; lineEnd: number } | undefined {
  if (!text.startsWith("---") || text.charAt(3) === "-") return undefined;
  const rest = text.slice(3);
  const newline = rest.search(/\r?\n/);
  const line = newline < 0 ? rest : rest.slice(0, newline);
  return { language: line.trim().toLowerCase(), lineEnd: newline < 0 ? -1 : 3 + newline };
}

function assertYamlOnly(text: string): void {
  const opener = openingLine(text);
  if (opener && opener.language !== "" && opener.language !== "yaml") {
    throw new FrontmatterEngineForbiddenError(opener.language);
  }
}

/**
 * Reject a non-YAML frontmatter engine WITHOUT parsing the document.
 *
 * Callers that only need the refusal (an upload preflight, an upload commit)
 * use this so the `FRONTMATTER_ENGINE_FORBIDDEN` contract is enforced before
 * any other upload validation runs.
 */
export function assertMarkdownFrontmatterEngine(text: string): void {
  assertYamlOnly(text);
}

export function parseMarkdownFrontmatter(text: string): MarkdownFrontmatter {
  assertYamlOnly(text);
  const opener = openingLine(text);
  // Block boundaries follow proxy/wiki-acl.ts parseFrontmatter: no closing `\n---` means no frontmatter.
  if (!opener || opener.lineEnd < 0) return { data: {}, content: text };
  const end = text.indexOf("\n---", opener.lineEnd);
  if (end < 0) return { data: {}, content: text };
  const raw = text.slice(opener.lineEnd, end).replace(/\r\n?/g, "\n");
  const content = text.slice(end + "\n---".length).replace(/^\r?\n/, "");
  const parsed = parseYaml(raw);
  const data = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  return { data, content };
}

export function stringifyMarkdownFrontmatter(content: string, data: Record<string, unknown>): string {
  // gray-matter's stringify re-parses `content`; reject non-YAML engines first.
  assertYamlOnly(content);
  return matter.stringify(content, data, STRINGIFY_OPTIONS);
}
