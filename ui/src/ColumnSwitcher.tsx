import { useEffect, useId, useRef, useState } from "react";
import { t, tn } from "./i18n";
import { icons } from "./MobileChrome";

export type SwitcherColumn = { status: string; label: string; count: number };

/**
 * The phone's one fixed switcher: `‹  To do · 6  (1 of 4)  ›` on the board and
 * `‹  All · 402  (1 of 10)  ›` on Notes, identical apart from the name, live
 * count and position. The row has a fixed height with the plain label centred
 * between previous and next, which stay in place and turn disabled at the
 * ends; the name opens a picker listing every option with its live count.
 * There is no swipe and there are no dots.
 */
export default function ColumnSwitcher({
  columns,
  current,
  onSelect,
  item = "column",
  pickerLabel = "Columns",
  noun = ["task", "tasks"],
  className = "",
}: {
  columns: SwitcherColumn[];
  current: string;
  onSelect: (status: string) => void;
  /** What one option is called in labels: "column", "bucket". */
  item?: string;
  pickerLabel?: string;
  noun?: [string, string];
  className?: string;
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
  // Whole sentences per kind of option, so each language orders them.
  const bucket = item === "bucket";
  const previous = bucket ? t("Previous bucket") : t("Previous column");
  const next = bucket ? t("Next bucket") : t("Next column");
  const count =
    noun[0] === "note"
      ? tn(column.count, "{n} note", "{n} notes")
      : tn(column.count, "{n} task", "{n} tasks");
  const where = { name: column.label, count, i: index + 1, total: columns.length };
  const nameLabel = bucket
    ? t("Bucket {name}, {count}, {i} of {total}. Choose a bucket", where)
    : t("Column {name}, {count}, {i} of {total}. Choose a column", where);
  const go = (to: number) => {
    const next = columns[to];
    if (next) onSelect(next.status);
  };
  return (
    <div className={`crew-column-switcher ${className}`.trim()} ref={root}>
      <button
        type="button"
        className="crew-switch-step"
        aria-label={previous}
        title={previous}
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
        aria-label={nameLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="crew-switch-title">
          <strong>{column.label}</strong>
          <span className="crew-switch-count">· {column.count}</span>
          <span className="crew-switch-of">
            {t("({i} of {total})", { i: index + 1, total: columns.length })}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="crew-switch-step"
        aria-label={next}
        title={next}
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
          aria-label={t(pickerLabel)}
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
