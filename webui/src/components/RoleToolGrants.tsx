import { useMemo } from "react";
import type { McpToolInfo } from "../lib/types";
import {
  ABSOLUTE_DENY_TOOL_NAMES,
  READONLY_QA_PRESET,
  READONLY_QA_WIKI_PRESET,
  matchingPresetName,
  stampPreset,
} from "../lib/rolePermissionDraft";

// ─── Group definitions (spec WO-202609-23 §5 T4) ──────────────────────────

/** 查数与解释 (DataPlane). sl_validate 旁标「建模能力」。 */
const DATA_PLANE_TOOL_NAMES: readonly string[] = [
  "lucy_query",
  "lucy_read_source",
  "lucy_explain_query",
  "lucy_freshness",
  "entity_details",
  "sl_validate",
];

/** 目录与知识 (Meta). lucy_skill_search / lucy_skill_read 若存在也归此组。 */
const META_TOOL_NAMES: readonly string[] = [
  "lucy_catalog",
  "lucy_begin_question",
  "wiki_search",
  "wiki_read",
  "dictionary_search",
  "discover_data",
  "connection_list",
  "kx_catalog",
  "lucy_skill_search",
  "lucy_skill_read",
];

const DATA_PLANE_SET = new Set<string>(DATA_PLANE_TOOL_NAMES);
const META_SET = new Set<string>(META_TOOL_NAMES);
const DENY_SET = new Set<string>(ABSOLUTE_DENY_TOOL_NAMES);

// ─── Props ──────────────────────────────────────────────────────────────────

export interface RoleToolGrantsProps {
  /** Tool candidates from /api/admin/mcp-tools. */
  candidates: McpToolInfo[];
  /** Currently selected tool names. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RoleToolGrants({
  candidates,
  value,
  onChange,
  disabled = false,
}: RoleToolGrantsProps) {
  // Exclude globalDenied + AbsoluteDeny from renderable candidates
  const grantableCandidates = useMemo(
    () => candidates.filter((t) => !t.globalDenied && !DENY_SET.has(t.name)),
    [candidates]
  );

  const grantableNameSet = useMemo(
    () => new Set(grantableCandidates.map((t) => t.name)),
    [grantableCandidates]
  );

  // Groups: intersect group definition with actual grantable candidates
  const dataPlaneGroup = useMemo(
    () =>
      DATA_PLANE_TOOL_NAMES.filter((n) => grantableNameSet.has(n)).map(
        (n) => grantableCandidates.find((t) => t.name === n)!
      ),
    [grantableCandidates, grantableNameSet]
  );

  const metaGroup = useMemo(
    () =>
      META_TOOL_NAMES.filter((n) => grantableNameSet.has(n)).map(
        (n) => grantableCandidates.find((t) => t.name === n)!
      ),
    [grantableCandidates, grantableNameSet]
  );

  // Count selected grantable tools only (no denominator)
  const selectedGrantableCount = useMemo(
    () => value.filter((n) => grantableNameSet.has(n)).length,
    [value, grantableNameSet]
  );

  const presetMatch = useMemo(() => matchingPresetName(value), [value]);

  function handlePreset(preset: readonly string[]) {
    if (disabled) return;
    onChange(stampPreset(value, preset));
  }

  function toggleTool(name: string, checked: boolean) {
    if (disabled) return;
    if (checked) {
      onChange(value.includes(name) ? value : [...value, name]);
    } else {
      onChange(value.filter((n) => n !== name));
    }
  }

  return (
    <div className="grid gap-4">
      {/* Preset buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="pl-btn pl-btn--secondary text-sm"
          onClick={() => handlePreset(READONLY_QA_PRESET)}
          disabled={disabled}
        >
          只读问答
        </button>
        <button
          type="button"
          className="pl-btn pl-btn--secondary text-sm"
          onClick={() => handlePreset(READONLY_QA_WIKI_PRESET)}
          disabled={disabled}
        >
          只读问答 + 知识库
        </button>
        {presetMatch ? (
          <span className="text-xs text-fg-muted">当前与{presetMatch}一致</span>
        ) : null}
      </div>

      {/* Selection count — 「已选 N 个」，不含分母 */}
      <p className="text-xs text-fg-muted" aria-live="polite">
        已选 {selectedGrantableCount} 个
      </p>

      {/* 查数与解释 group */}
      {dataPlaneGroup.length > 0 ? (
        <div className="grid gap-2">
          <div className="text-sm font-medium">查数与解释</div>
          <div className="grid gap-1">
            {dataPlaneGroup.map((tool) => (
              <label key={tool.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={value.includes(tool.name)}
                  onChange={(e) => toggleTool(tool.name, e.target.checked)}
                  disabled={disabled}
                />
                <span>
                  <span className="notranslate font-mono text-xs" translate="no">
                    {tool.name}
                  </span>
                  {tool.name === "sl_validate" ? (
                    <span className="ml-1 text-xs text-fg-muted">建模能力</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {/* 目录与知识 group */}
      {metaGroup.length > 0 ? (
        <div className="grid gap-2">
          <div className="text-sm font-medium">目录与知识</div>
          <div className="grid gap-1">
            {metaGroup.map((tool) => (
              <label key={tool.name} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={value.includes(tool.name)}
                  onChange={(e) => toggleTool(tool.name, e.target.checked)}
                  disabled={disabled}
                />
                <span className="notranslate font-mono text-xs" translate="no">
                  {tool.name}
                </span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {/* System-denied static sentence — no checkbox */}
      <p className="text-xs text-fg-muted">
        原始 SQL、旧版{" "}
        <span className="notranslate" translate="no">
          sl_query / sl_read_source
        </span>
        、记忆注入由系统禁止，不能授予。
      </p>
    </div>
  );
}
