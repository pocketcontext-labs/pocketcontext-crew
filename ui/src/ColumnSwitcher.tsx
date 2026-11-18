import { useEffect, useId, useRef, useState } from "react";
import { icons } from "./MobileChrome";

export type SwitcherColumn = { status: string; label: string; count: number };

/**
 * The phone board's column switcher: `‹  To do · 6  (1 of 4)  ›` with one dot
 * per column. Previous and next stay in place and turn disabled at the ends;
 * the name opens a picker listing every column with its live count. There is
 * no swipe.
 */
export default function ColumnSwitcher({
  columns,
  current,
  onSelect,
}: {
  columns: SwitcherColumn[];
  current: string;
  onSelect: (status: string) => void;
}) {
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
    <div className="crew-column-switcher" ref={root}>
      <button
        type="button"
        className="crew-switch-step"
        aria-label="Previous column"
        title="Previous column"
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
        aria-label={`Column ${column.label}, ${column.count} ${column.count === 1 ? "task" : "tasks"}, ${index + 1} of ${columns.length}. Choose a column`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="crew-switch-title">
          <strong>{column.label}</strong>
          <span className="crew-switch-count">· {column.count}</span>
          <span className="crew-switch-of">
            ({index + 1} of {columns.length})
          </span>
        </span>
        <span className="crew-switch-dots" aria-hidden="true">
          {columns.map((c, i) => (
            <i
              key={c.status}
              className={i === index ? "is-current" : undefined}
            />
          ))}
        </span>
      </button>
      <button
        type="button"
        className="crew-switch-step"
        aria-label="Next column"
        title="Next column"
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
          aria-label="Columns"
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
