import { Link } from "react-router-dom";
import clsx from "clsx";
import { useState } from "react";
import { splitSlRef } from "../lib/slRef";
import type { SourceSummary } from "../lib/types";

export type LinkedSemanticObjectsProps = {
  refs: string[];
  knownSources: ReadonlySet<string>;
  knownTables: SourceSummary[];
};

const SUMMARY_THRESHOLD = 3;

function summaryLabel(refs: { state: "known" | "unknown" }[]): {
  total: string;
  unknown: string;
} {
  const total = refs.length;
  const unknown = refs.filter((entry) => entry.state === "unknown").length;
  return {
    total: `${total} 个`,
    unknown: unknown > 0 ? `${unknown} 未识别` : "全部已识别"
  };
}

/**
 * Linked semantic object list with summary collapse for large ref sets.
 *
 * - ≤ SUMMARY_THRESHOLD refs render as inline chips.
 * - > SUMMARY_THRESHOLD refs render as a summary button + inline list,
 *   so the article body never gets pushed below the fold by a wall of
 *   unknown-object chips.
 */
export function LinkedSemanticObjects({
  refs,
  knownSources,
  knownTables
}: LinkedSemanticObjectsProps) {
  const [expanded, setExpanded] = useState(false);
  const enriched = refs.map((ref) => {
    const split = splitSlRef(ref);
    const known = split ? knownSources.has(ref) : false;
    const table = known
      ? knownTables.find(
          (entry) => `${entry.conn}/${entry.schema}/${entry.table}` === ref
        )
      : undefined;
    return { ref, split, known, table };
  });

  if (enriched.length === 0) {
    return null;
  }

  if (enriched.length <= SUMMARY_THRESHOLD) {
    return (
      <ul
        aria-label="关联语义对象"
        className="pl-wiki-read-refs"
        data-testid="wiki-read-refs"
      >
        {enriched.map((entry) => (
          <LinkedChip entry={entry} key={entry.ref} />
        ))}
      </ul>
    );
  }

  const label = summaryLabel(
    enriched.map((entry) => ({ state: entry.known ? "known" : "unknown" }))
  );

  return (
    <div
      className="pl-wiki-read-refs-summary"
      data-testid="wiki-read-refs-summary"
    >
      <button
        aria-controls="wiki-read-refs-summary-list"
        aria-expanded={expanded}
        className="pl-wiki-read-refs-summary-button"
        data-testid="wiki-read-refs-summary-toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span>关联 {label.total}语义实体</span>
        <span
          className={clsx(
            "pl-wiki-read-refs-summary-unknown",
            label.unknown.includes("未识别") &&
              "pl-wiki-read-refs-summary-unknown--warn"
          )}
        >
          {label.unknown}
        </span>
        <span aria-hidden className="pl-wiki-read-refs-summary-caret">
          {expanded ? "▴" : "▾"}
        </span>
      </button>
      {expanded ? (
        <ul
          className="pl-wiki-read-refs"
          data-testid="wiki-read-refs"
          id="wiki-read-refs-summary-list"
        >
          {enriched.map((entry) => (
            <LinkedChip entry={entry} key={entry.ref} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type ChipEntry = {
  ref: string;
  split: ReturnType<typeof splitSlRef>;
  known: boolean;
  table: SourceSummary | undefined;
};

function LinkedChip({ entry }: { entry: ChipEntry }) {
  const { ref, split, known, table } = entry;
  const label = split ? `${split.schema}.${split.table}` : ref;
  const dotClass = known
    ? "pl-wiki-read-ref-dot pl-wiki-read-ref-dot--known"
    : "pl-wiki-read-ref-dot pl-wiki-read-ref-dot--unknown";
  const dotLabel = known ? "已识别语义对象" : "未知语义对象";
  const content = (
    <>
      <span aria-hidden className={dotClass} />
      <span
        aria-label={known ? `已识别语义对象 ${ref}` : `未知语义对象 ${ref}`}
        className="pl-wiki-read-ref-label notranslate"
        title={known ? ref : `未知语义对象：${ref}`}
        translate="no"
      >
        {label}
      </span>
    </>
  );
  return (
    <li
      className={clsx(
        "pl-wiki-read-ref",
        known ? "pl-wiki-read-ref--known" : "pl-wiki-read-ref--unknown"
      )}
      data-sl-ref-state={known ? "known" : "unknown"}
      data-testid="wiki-read-ref"
      key={ref}
    >
      {known && split && table ? (
        <Link
          aria-label={`打开 ${table.table} 表语义编辑器`}
          className="pl-wiki-read-ref-link"
          to={`/sources/${encodeURIComponent(split.conn)}/${encodeURIComponent(split.schema)}/${encodeURIComponent(split.table)}`}
        >
          {content}
          <span className="sr-only pl-wiki-read-ref-sr">{dotLabel}</span>
        </Link>
      ) : (
        <span className="pl-wiki-read-ref-text">
          {content}
          <span className="sr-only pl-wiki-read-ref-sr">{dotLabel}</span>
        </span>
      )}
    </li>
  );
}