import { useMemo, useState, type ReactNode } from "react";

export type CheckboxCandidateItem = {
  id: string;
  label: ReactNode;
  description?: string;
  disabled?: boolean;
  /** Extra text used for local filter matching (in addition to id). */
  filterText?: string;
};

type Props = {
  items: CheckboxCandidateItem[];
  value: string[];
  onChange: (next: string[]) => void;
  ariaLabel: string;
  testIdPrefix: string;
  disabled?: boolean;
  /** Show filter input when candidate count reaches this threshold. Default 10. */
  filterThreshold?: number;
  filterPlaceholder?: string;
  listClassName?: string;
  itemClassName?: string;
};

function toggleInList(list: string[], id: string, enabled: boolean): string[] {
  if (enabled) {
    return list.includes(id) ? list : [...list, id];
  }
  return list.filter((item) => item !== id);
}

export function CheckboxCandidatePicker({
  items,
  value,
  onChange,
  ariaLabel,
  testIdPrefix,
  disabled = false,
  filterThreshold = 10,
  filterPlaceholder = "筛选…",
  listClassName = "grid max-h-72 gap-1 overflow-auto rounded-md border border-border-default bg-bg-base p-3",
  itemClassName = "flex items-start gap-2 text-sm"
}: Props) {
  const [filter, setFilter] = useState("");

  const selectableIds = useMemo(
    () => items.filter((item) => !item.disabled).map((item) => item.id),
    [items]
  );

  const visibleItems = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const haystack = `${item.id} ${item.filterText ?? ""} ${item.description ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [filter, items]);

  const visibleSelectableIds = useMemo(
    () => visibleItems.filter((item) => !item.disabled).map((item) => item.id),
    [visibleItems]
  );

  const selectedAmongSelectable = selectableIds.filter((id) => value.includes(id)).length;
  const showFilter = items.length >= filterThreshold;

  function selectAllVisible() {
    if (disabled || visibleSelectableIds.length === 0) return;
    const next = [...value];
    for (const id of visibleSelectableIds) {
      if (!next.includes(id)) next.push(id);
    }
    onChange(next);
  }

  function clearAllVisible() {
    if (disabled || visibleSelectableIds.length === 0) return;
    const remove = new Set(visibleSelectableIds);
    onChange(value.filter((id) => !remove.has(id)));
  }

  return (
    <div className="grid gap-2" data-testid={`${testIdPrefix}-picker`}>
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid={`${testIdPrefix}-batch-actions`}
      >
        <span
          className="text-xs text-fg-muted"
          aria-live="polite"
          data-testid={`${testIdPrefix}-selection-summary`}
        >
          已选 {selectedAmongSelectable}/{selectableIds.length}
        </span>
        <button
          type="button"
          className="pl-btn pl-btn--secondary text-xs"
          onClick={selectAllVisible}
          disabled={disabled || visibleSelectableIds.length === 0}
          data-testid={`${testIdPrefix}-select-all`}
        >
          全选
        </button>
        <button
          type="button"
          className="pl-btn pl-btn--secondary text-xs"
          onClick={clearAllVisible}
          disabled={disabled || visibleSelectableIds.length === 0}
          data-testid={`${testIdPrefix}-clear-all`}
        >
          取消全选
        </button>
      </div>
      {showFilter ? (
        <input
          type="search"
          className="pl-input text-sm"
          placeholder={filterPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={`${ariaLabel} 筛选`}
          data-testid={`${testIdPrefix}-filter`}
          disabled={disabled}
        />
      ) : null}
      <div
        className={listClassName}
        role="group"
        aria-label={ariaLabel}
        data-testid={`${testIdPrefix}-list`}
      >
        {visibleItems.length === 0 ? (
          <p className="text-xs text-fg-muted">无匹配项</p>
        ) : (
          visibleItems.map((item) => (
            <label
              key={item.id}
              className={`${itemClassName} ${item.disabled ? "opacity-60" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={value.includes(item.id)}
                disabled={disabled || item.disabled}
                onChange={(e) => onChange(toggleInList(value, item.id, e.target.checked))}
              />
              <span>
                {item.label}
                {item.description ? (
                  <span className="mt-0.5 block text-xs text-fg-muted">{item.description}</span>
                ) : null}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
