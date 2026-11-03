import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ObjectAclField, useAssignableRoleState } from "./ObjectAclField";
import type { AssignableRoleState } from "./ObjectAclField";
import { WikiAccessEffectList } from "./WikiAccessEffectList";
import type { WikiAccessEffectStatus } from "./WikiAccessEffectList";
import type { WikiAccessRoleEffect } from "../lib/types";

/**
 * Where the authorization of this editor comes from.
 * - `uploaded`: 来自上传文件 (the uploaded file's own declaration)
 * - `current`:  保留现有授权 (the persisted authorization is kept)
 * - `reset`:    重新设置 (the owner re-set it explicitly)
 */
export type WikiAccessSource = "uploaded" | "current" | "reset";

export const WIKI_ACCESS_SOURCE_LABELS: Record<WikiAccessSource, string> = {
  uploaded: "来自上传文件",
  current: "保留现有授权",
  reset: "重新设置"
};

/** Two role lists describe the same declaration when they hold the same ids. */
function sameRoleIds(left: readonly string[], right: readonly string[] | undefined): boolean {
  const a = [...(left ?? [])].sort();
  const b = [...(right ?? [])].sort();
  return a.length === b.length && a.every((role, index) => role === b[index]);
}

export type WikiAccessEditorProps = {
  testId: string;
  /** The draft authorization as role ids; `["*"]` means 所有角色可见. */
  value: string[] | undefined;
  onChange: (next: string[]) => void;
  /** The stored declaration is corrupt and may not be adopted silently. */
  corrupt?: boolean;
  source?: WikiAccessSource;
  /** Per-Role channel effects of the current selection. */
  effects?: readonly WikiAccessRoleEffect[];
  effectsStatus?: WikiAccessEffectStatus;
  effectsError?: string | null;
  declaredRoleCount?: number | null;
  /** Require an explicit confirmation before an empty authorization commits. */
  requireEmptyConfirmation?: boolean;
  emptyConfirmed?: boolean;
  onEmptyConfirmedChange?: (next: boolean) => void;
  emptyConfirmationLabel?: ReactNode;
  /** Externally owned "所有角色可见" confirmation. */
  allConfirmed?: boolean;
  onAllConfirmedChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Reports the Role query state so a caller can block its commit. */
  onRoleStateChange?: (state: AssignableRoleState) => void;
};

/**
 * Spec 193 — the Wiki-specific authorization editor.
 *
 * It composes the generic `ObjectAclField` and owns the Wiki-only facts:
 * the authorization source, the empty (无人可见) confirmation, the
 * independent 所有角色可见 confirmation, the corrupt-declaration handling
 * and the channel effect / affected Agent projection.
 */
export function WikiAccessEditor({
  testId,
  value,
  onChange,
  corrupt = false,
  source = "reset",
  effects = [],
  effectsStatus = "ready",
  effectsError = null,
  declaredRoleCount,
  requireEmptyConfirmation = false,
  emptyConfirmed = false,
  onEmptyConfirmedChange,
  emptyConfirmationLabel,
  allConfirmed,
  onAllConfirmedChange,
  disabled = false,
  onRoleStateChange
}: WikiAccessEditorProps) {
  const roleState = useAssignableRoleState();
  const [internalAllConfirmed, setInternalAllConfirmed] = useState(false);
  const effectiveAllConfirmed = allConfirmed ?? internalAllConfirmed;

  useEffect(() => {
    onRoleStateChange?.(roleState);
  }, [onRoleStateChange, roleState]);

  function setAllConfirmed(next: boolean) {
    setInternalAllConfirmed(next);
    onAllConfirmedChange?.(next);
  }

  function handleChange(next: string[]) {
    // A confirmation that does not change the declaration (e.g. confirming an
    // already declared wildcard) must not rewrite the authorization source.
    if (sameRoleIds(next, value)) {
      return;
    }
    if (!next.includes("*")) {
      setInternalAllConfirmed(false);
      onAllConfirmedChange?.(false);
    }
    onChange(next);
  }

  return (
    <div className="pl-wiki-access-editor" data-testid={testId}>
      <div className="pl-wiki-access-editor-head">
        <span className="pl-eyebrow">授权来源</span>
        <span
          className="pl-wiki-access-source"
          data-source={source}
          data-testid={`${testId}-source`}
        >
          {WIKI_ACCESS_SOURCE_LABELS[source]}
        </span>
      </div>
      <ObjectAclField
        allConfirmation={{
          confirmed: effectiveAllConfirmed,
          onConfirmedChange: setAllConfirmed
        }}
        corrupt={corrupt}
        disabled={disabled}
        onChange={handleChange}
        requireExplicitChoice={corrupt}
        roleState={roleState}
        testId={`${testId}-field`}
        value={value}
      />
      {requireEmptyConfirmation ? (
        <label className="pl-wiki-access-confirm" data-testid={`${testId}-empty-confirm`}>
          <input
            checked={emptyConfirmed}
            disabled={disabled}
            onChange={(event) => onEmptyConfirmedChange?.(event.target.checked)}
            type="checkbox"
          />
          <span>
            {emptyConfirmationLabel ?? (
              <>
                我确认保持无人可见，<span className="notranslate" translate="no">Agent</span>{" "}
                暂时无法访问该文档
              </>
            )}
          </span>
        </label>
      ) : null}
      <WikiAccessEffectList
        declaredRoleCount={declaredRoleCount}
        effects={effects}
        error={effectsError}
        status={effectsStatus}
        testId={`${testId}-effects`}
      />
    </div>
  );
}
