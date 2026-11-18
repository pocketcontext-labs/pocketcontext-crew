import { useEffect, useId, useRef, useState } from "react";
import { icons } from "./MobileChrome";

export type SwitcherColumn = { status: string; label: string; count: number };

/**
 * The phone's fixed switcher: `‹  To do · 6  (1 of 4)  ›`, on the board (one
 * dot per column) and on Notes (buckets, no dots). Previous and next stay in
 * place and turn disabled at the ends; the name opens a picker listing every
 * option with its live count. There is no swipe.
 */
export default function ColumnSwitcher({
  columns,
  current,
  onSelect,
  dots = true,
  item = "column",
  pickerLabel = "Columns",
  noun = ["task", "tasks"],
  className = "",
}: {
  columns: SwitcherColumn[];
  current: string;
  onSelect: (status: string) => void;
  /** One dot per option; off when there are too many to tell apart. */
  dots?: boolean;
  /** What one option is called in labels: "column", "bucket". */
  item?: string;
  pickerLabel?: string;
  noun?: [string, string];
  className?: string;
}) {
  const Item = item.charAt(0).toUpperCase() + item.slice(1);
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const index = Math.max(
    0,
    columns.findIndex((c) => c.status === current),
  );
  const column = columns[index];
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  if (!column) return null;
  const go = (to: number) => {
    const next = columns[to];
    if (next) onSelect(next.status);
  };
  return (
    <div
      className={`crew-column-switcher${dots ? "" : " is-dotless"} ${className}`.trim()}
      ref={root}
    >
      <button
        type="button"
        className="crew-switch-step"
        aria-label={`Previous ${item}`}
        title={`Previous ${item}`}
        disabled={index === 0}
        onClick={() => go(index - 1)}
      >
        {icons.chevronLeft}
      </button>
      <button
        type="button"
        ref={toggle}
        className="crew-switch-name"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? `${id}-picker` : undefined}
        aria-label={`${Item} ${column.label}, ${column.count} ${column.count === 1 ? noun[0] : noun[1]}, ${index + 1} of ${columns.length}. Choose a ${item}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="crew-switch-title">
          <strong>{column.label}</strong>
          <span className="crew-switch-count">· {column.count}</span>
          <span className="crew-switch-of">
            ({index + 1} of {columns.length})
          </span>
        </span>
        {dots && (
          <span className="crew-switch-dots" aria-hidden="true">
            {columns.map((c, i) => (
              <i
                key={c.status}
                className={i === index ? "is-current" : undefined}
              />
            ))}
          </span>
        )}
      </button>
      <button
        type="button"
        className="crew-switch-step"
        aria-label={`Next ${item}`}
        title={`Next ${item}`}
        disabled={index === columns.length - 1}
        onClick={() => go(index + 1)}
      >
        {icons.chevronRight}
      </button>
      {open && (
        <div
          id={`${id}-picker`}
          className="crew-switch-picker"
          role="group"
          aria-label={pickerLabel}
        >
          {columns.map((c) => (
            <button
              type="button"
              key={c.status}
              aria-current={c.status === column.status ? "true" : undefined}
              onClick={() => {
                setOpen(false);
                onSelect(c.status);
                toggle.current?.focus();
              }}
            >
              <span>{c.label}</span>
              <span className="crew-switch-pick-count">{c.count}</span>
              <span className="crew-switch-check" aria-hidden="true">
                {c.status === column.status ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
