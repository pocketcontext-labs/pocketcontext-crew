import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExcerptContent } from "./ExcerptContent";
import { markdownExcerpt } from "./markdownText";
import { val, type Row } from "./crewApi";
import { t, tn } from "./i18n";
import { noteSorts, type NoteSort } from "./itemLink";
import { Sheet } from "./MobileChrome";
import { RelativeTime } from "./relativeTime";

/**
 * The phone's names for the note sorts; Title A–Z reads as Name. English,
 * translated where they render (catalog: pages.ts).
 */
export const phoneNoteSortLabels: Record<NoteSort, string> = {
  updated: "Last updated",
  created: "Newest first",
  title: "Name",
  bucket: "Bucket",
};

/** A bucket chip's ⋯: one menu item, Edit bucket. Fixed, so a scrolling row can't clip it. */
function BucketMenu({ name, onEdit }: { name: string; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Follows its button when the chips or the page scroll.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!button.current || !menu.current) return;
      const anchor = button.current.getBoundingClientRect();
      const width = menu.current.offsetWidth;
      menu.current.style.top = `${anchor.bottom + 6}px`;
      menu.current.style.left = `${Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8))}px`;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);
  return (
    <span className="crew-bucket-chip-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className="crew-bucket-chip-more"
        aria-label={t("Bucket {name} options", { name })}
        title={t("Bucket options")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="crew-bucket-chip-popup" role="menu" ref={menu}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            {t("Edit bucket")}
          </button>
        </div>
      )}
    </span>
  );
}

type ChipProps = {
  buckets: Row[];
  counts: Map<string, number>;
  total: number;
  selected: string;
  onSelect: (id: string) => void;
  onEdit: (bucket: Row) => void;
};

/**
 * Bucket chips with live counts: "All · N", then each bucket in the current
 * bucket order. A chip filters; the selected one (every one with `menus`) has
 * a ⋯ holding Edit bucket.
 */
export function BucketChips({
  buckets,
  counts,
  total,
  selected,
  onSelect,
  onEdit,
  menus = false,
  className = "",
}: ChipProps & { menus?: boolean; className?: string }) {
  return (
    <div
      className={`crew-bucket-chips ${className}`.trim()}
      role="group"
      aria-label={t("Filter by bucket")}
    >
      <span className="crew-bucket-chip">
        <button
          type="button"
          aria-pressed={!selected}
          aria-label={tn(total, "All buckets, {n} note", "All buckets, {n} notes")}
          onClick={() => onSelect("")}
        >
          {t("All")} <span className="crew-bucket-chip-count">· {total}</span>
        </button>
      </span>
      {buckets.map((bucket) => {
        const name = val(bucket, "name");
        const count = counts.get(bucket.id) ?? 0;
        const isSelected = bucket.id === selected;
        return (
          <span
            className={`crew-bucket-chip${isSelected ? " is-selected" : ""}`}
            key={bucket.id}
          >
            <button
              type="button"
              aria-pressed={isSelected}
              aria-label={tn(count, "{name}, {n} note", "{name}, {n} notes", { name })}
              title={markdownExcerpt(val(bucket, "purpose"), undefined, String).text || undefined}
              onClick={() => onSelect(isSelected ? "" : bucket.id)}
            >
              {name} <span className="crew-bucket-chip-count">· {count}</span>
            </button>
            {(menus || isSelected) && (
              <BucketMenu name={name} onEdit={() => onEdit(bucket)} />
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The phone Notes list: title, bucket and relative date, one-line snippet. */
export function NoteRows({
  notes,
  bucketName,
  onOpen,
}: {
  notes: Row[];
  bucketName: (id: string) => string;
  onOpen: (note: Row) => void;
}) {
  return (
    <div className="crew-note-rows">
      {notes.map((note) => (
        <button
          type="button"
          className="crew-note-row"
          key={note.id}
          onClick={() => onOpen(note)}
        >
          <h3>{val(note, "title")}</h3>
          <span className="crew-note-row-meta">
            <span>{bucketName(val(note, "bucket"))}</span>
            <span aria-hidden="true"> · </span>
            <RelativeTime value={val(note, "updated")} fallback={t("Just now")} />
          </span>
          <span className="crew-note-row-snippet">
            <ExcerptContent excerpt={markdownExcerpt(val(note, "body"), 180)} resolveTitles />
          </span>
        </button>
      ))}
    </div>
  );
}

/** The Notes filter and sort sheet: search, sort, bucket (with Edit), agent. */
export function NotesFilterSheet({
  onClose,
  search,
  onSearch,
  sort,
  onSort,
  agents,
  agent,
  onAgent,
  ...chips
}: ChipProps & {
  onClose: () => void;
  search: string;
  onSearch: (text: string) => void;
  sort: NoteSort;
  onSort: (sort: NoteSort) => void;
  agents: Row[];
  agent: string;
  onAgent: (id: string) => void;
}) {
  return (
    <Sheet
      title={t("Filter and sort")}
      className="crew-filter-sheet"
      onClose={onClose}
    >
      <label className="crew-search crew-sheet-search">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          aria-label={t("Search notes")}
          placeholder={t("Search notes")}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      <fieldset className="crew-sheet-section">
        <legend>{t("Sort")}</legend>
        <div className="crew-sheet-radios">
          {noteSorts.map((key) => (
            <label key={key}>
              <input
                type="radio"
                name="crew-note-sort"
                value={key}
                checked={sort === key}
                onChange={() => onSort(key)}
              />
              <span>{t(phoneNoteSortLabels[key])}</span>
              <span className="crew-sheet-check" aria-hidden="true">
                {sort === key ? "✓" : ""}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="crew-sheet-section">
        <h3>{t("Bucket")}</h3>
        <BucketChips {...chips} menus className="is-wrapped" />
      </div>
      <div className="crew-sheet-section crew-sheet-field">
        <h3>{t("Agent")}</h3>
        <select
          aria-label={t("Filter by responsible agent")}
          value={agent}
          onChange={(e) => onAgent(e.target.value)}
        >
          <option value="">{t("All agents")}</option>
          {agents.map((x) => (
            <option key={x.id} value={x.id}>
              {val(x, "name")}
            </option>
          ))}
        </select>
      </div>
    </Sheet>
  );
}
