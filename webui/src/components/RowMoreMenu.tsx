import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";

export type RowMoreMenuItem =
  | { kind: "link"; label: string; href: string; testId?: string }
  | {
      kind: "action";
      label: string;
      onSelect: () => void;
      testId?: string;
      /** Keeps the item focusable. Activation explains the block and does not call onSelect. */
      disabled?: boolean;
      disabledReason?: string;
      onBlocked?: () => void;
    };

type Props = {
  ariaLabel: string;
  items: RowMoreMenuItem[];
  disabled?: boolean;
};

/**
 * Lightweight accessible "more" menu for table rows. Click the trigger to open,
 * click anywhere outside or press Escape to close. Uses native button + Link
 * semantics so screen readers announce menu items correctly. Anchored to its
 * trigger via absolute positioning; callers should leave room to the right.
 */
export function RowMoreMenu({ ariaLabel, items, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(event: MouseEvent) {
      const container = containerRef.current;
      if (container && !container.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="pl-row-more" ref={containerRef}>
      <button
        type="button"
        className="pl-row-more-trigger"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        data-testid="row-more-trigger"
      >
        <MoreHorizontal aria-hidden="true" focusable="false" className="pl-row-more-icon" />
      </button>
      {open && !disabled ? (
        <ul className="pl-row-more-menu" role="menu" data-testid="row-more-menu">
          {items.map((item, index) => {
            const testId = item.testId ?? `row-more-item-${index}`;
            if (item.kind === "link") {
              return (
                <li key={item.label} role="none">
                  <Link
                    role="menuitem"
                    to={item.href}
                    onClick={() => setOpen(false)}
                    className="pl-row-more-item"
                    data-testid={testId}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            }
            const reasonId = item.disabled && item.disabledReason ? `${testId}-reason` : undefined;
            return (
              <li key={item.label} role="none">
                <button
                  role="menuitem"
                  type="button"
                  aria-label={item.label}
                  aria-disabled={item.disabled || undefined}
                  aria-describedby={reasonId}
                  onClick={() => {
                    if (item.disabled) {
                      setOpen(false);
                      item.onBlocked?.();
                      return;
                    }
                    item.onSelect();
                    setOpen(false);
                  }}
                  className={`pl-row-more-item${item.disabled ? " pl-row-more-item--blocked" : ""}`}
                  data-testid={testId}
                >
                  {item.label}
                  {reasonId ? (
                    <span id={reasonId} className="pl-row-more-item-reason notranslate" translate="no">
                      {item.disabledReason}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
