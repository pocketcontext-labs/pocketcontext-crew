import { ExcerptContent } from "./ExcerptContent";
import { markdownExcerpt } from "./markdownText";
import { val, type Row } from "./crewApi";
import { t } from "./i18n";
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
            <RelativeTime
              value={val(note, "updated")}
              fallback={t("Just now")}
            />
          </span>
          <span className="crew-note-row-snippet">
            <ExcerptContent
              excerpt={markdownExcerpt(val(note, "body"), 180)}
              resolveTitles
            />
          </span>
        </button>
      ))}
    </div>
  );
}

/** The Notes filter and sort sheet: search, sort, bucket, agent. */
export function NotesFilterSheet({
  onClose,
  search,
  onSearch,
  sort,
  onSort,
  agents,
  agent,
  onAgent,
  buckets,
  counts,
  total,
  selected,
  onSelect,
}: {
  buckets: Row[];
  counts: Map<string, number>;
  total: number;
  selected: string;
  onSelect: (id: string) => void;
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
      <div className="crew-sheet-section crew-sheet-field">
        <h3>{t("Bucket")}</h3>
        <select
          aria-label={t("Filter by bucket")}
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">
            {t("All buckets")} · {total}
          </option>
          {buckets.map((bucket) => (
            <option key={bucket.id} value={bucket.id}>
              {val(bucket, "name")} · {counts.get(bucket.id) ?? 0}
            </option>
          ))}
        </select>
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
