import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { normalizeSlRef, splitSlRef } from "../lib/slRef";
import type { SourceSummary, SourcesResponse } from "../lib/types";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
};

function canonicalFromTable(table: SourceSummary): string {
  return `${table.conn}/${table.schema}/${table.table}`;
}

function tableMatchesNeedle(table: SourceSummary, needle: string): boolean {
  if (!needle) {
    return true;
  }
  const lc = needle.toLowerCase();
  if (table.table.toLowerCase().includes(lc)) {
    return true;
  }
  if (`${table.schema}.${table.table}`.toLowerCase().includes(lc)) {
    return true;
  }
  if (`${table.conn}/${table.schema}/${table.table}`.toLowerCase().includes(lc)) {
    return true;
  }
  if (table.columnNames.some((column) => column.toLowerCase().includes(lc))) {
    return true;
  }
  return false;
}

export function SlRefPicker({ value, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });
  const tables = sourcesQuery.data?.tables ?? [];

  const knownRefs = useMemo(() => {
    const map = new Map<string, SourceSummary>();
    for (const table of tables) {
      map.set(canonicalFromTable(table), table);
    }
    return map;
  }, [tables]);

  const candidates = useMemo(() => {
    const needle = draft.trim();
    const selected = new Set(value);
    return tables
      .filter((table) => !selected.has(canonicalFromTable(table)))
      .filter((table) => tableMatchesNeedle(table, needle))
      .slice(0, 10);
  }, [draft, tables, value]);

  function addRef(ref: string) {
    const normalized = normalizeSlRef(ref);
    if (!normalized) {
      return;
    }
    if (value.includes(normalized)) {
      setDraft("");
      return;
    }
    onChange([...value, normalized]);
    setDraft("");
    setOpen(false);
  }

  function removeRef(ref: string) {
    onChange(value.filter((item) => item !== ref));
  }

  function commitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    addRef(trimmed);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (candidates.length === 0) {
        return;
      }
      setOpen(true);
      setHighlight((current) => (current + 1) % candidates.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (candidates.length === 0) {
        return;
      }
      setOpen(true);
      setHighlight((current) => (current - 1 + candidates.length) % candidates.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && candidates[highlight]) {
        addRef(canonicalFromTable(candidates[highlight]));
        return;
      }
      commitDraft();
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Backspace" && draft.length === 0 && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  useEffect(() => {
    if (highlight >= candidates.length) {
      setHighlight(0);
    }
  }, [candidates, highlight]);

  return (
    <div className="pl-slref-picker" data-state={open ? "open" : "closed"}>
      <div className="pl-slref-chips" role="list" aria-label="关联语义对象">
        {value.map((ref) => {
          const split = splitSlRef(ref);
          const known = split ? knownRefs.get(ref) : undefined;
          const state = known ? "known" : "unknown";
          const shortLabel = split ? `${split.schema}.${split.table}` : ref;
          return (
            <span
              className={clsx("pl-chip", `pl-chip--${state}`)}
              data-sl-ref-state={state}
              key={ref}
              role="listitem"
              title={ref}
            >
              <span className="pl-chip-label">{shortLabel}</span>
              {known ? (
                <Link
                  aria-label={`打开 ${split?.table ?? ""} 表语义编辑器`}
                  className="pl-chip-link"
                  to={`/catalog/${encodeURIComponent(known.conn)}/${encodeURIComponent(known.schema)}/${encodeURIComponent(known.table)}`}
                >
                  🔗
                </Link>
              ) : null}
              <button
                aria-label={`移除关联语义对象 ${ref}`}
                className="pl-chip-remove"
                data-sl-ref-state={state}
                onClick={() => removeRef(ref)}
                type="button"
              >
                ×
              </button>
            </span>
          );
        })}
        <input
          aria-label="添加关联语义对象"
          className="pl-slref-input"
          onBlur={() => {
            // Delay so a click on a candidate still registers.
            window.setTimeout(() => setOpen(false), 120);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? "输入 conn/schema/table 或从下方选择" : "继续添加…"}
          ref={inputRef}
          value={draft}
        />
      </div>
      {open && candidates.length > 0 ? (
        <ul className="pl-slref-dropdown" role="listbox">
          {candidates.map((table, index) => {
            const ref = canonicalFromTable(table);
            const active = index === highlight;
            return (
              <li
                aria-selected={active}
                className={clsx("pl-slref-option", active && "pl-slref-option--active")}
                key={ref}
                role="option"
              >
                <button
                  className="pl-slref-option-button"
                  onMouseDown={(event) => {
                    // mousedown fires before the input's blur so the selection sticks.
                    event.preventDefault();
                    addRef(ref);
                  }}
                  type="button"
                >
                  <strong>{table.table}</strong>
                  <span>{table.schema}</span>
                  <code>{ref}</code>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {open && candidates.length === 0 && draft.trim() ? (
        <p className="pl-notice pl-slref-empty">
          没有匹配项。可按 Enter 直接以 "<code>{draft.trim()}</code>" 保存（未知引用）。
        </p>
      ) : null}
    </div>
  );
}
