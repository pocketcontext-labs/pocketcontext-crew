import { useEffect, useMemo, useState } from "react";
import { list, val, type Row } from "./crewApi";

/**
 * The Archive page (0.25.0): one category at a time with counts, title search,
 * a label (tasks) or bucket (notes) filter, sort by archived date or title,
 * compact rows that say when and by whom, 50 rows at a time, notes hidden by
 * an archived bucket grouped under that bucket, and Restore selected.
 *
 * The workspace already holds every archived record (dialogs, links and the
 * Shared page need them), so search and filters cover the whole archive, not
 * just the rows on screen; only rendering is paged. The tab, search, filter
 * and sort live in the address (#/archive?tab=notes&q=…).
 */
export const archiveTabs = ["tasks", "notes", "buckets", "agents"] as const;
export type ArchiveTab = (typeof archiveTabs)[number];
export type ArchiveCollection = ArchiveTab;
type ArchiveSort = "archived" | "title";
export type ArchiveState = {
  tab: ArchiveTab;
  query: string;
  sort: ArchiveSort;
  /** A task label (tasks tab) or a bucket ID (notes tab). */
  filter: string;
};
export const archivePageSize = 50;
const tabLabels: Record<ArchiveTab, string> = {
  tasks: "Tasks",
  notes: "Notes",
  buckets: "Buckets",
  agents: "Inactive agents",
};
const defaultState: ArchiveState = {
  tab: "tasks",
  query: "",
  sort: "archived",
  filter: "",
};

export function archiveStateFromHash(hash: string): ArchiveState {
  const query = /^#\/archive\?(.*)$/.exec(hash)?.[1];
  if (query === undefined) return defaultState;
  const params = new URLSearchParams(query);
  const tab = params.get("tab") as ArchiveTab | null;
  return {
    tab: tab && archiveTabs.includes(tab) ? tab : "tasks",
    query: (params.get("q") ?? "").slice(0, 200),
    sort: params.get("sort") === "title" ? "title" : "archived",
    filter: (params.get("filter") ?? "").slice(0, 200),
  };
}

export function archiveStateHash(state: ArchiveState): string {
  const params = new URLSearchParams();
  if (state.tab !== "tasks") params.set("tab", state.tab);
  if (state.query) params.set("q", state.query);
  if (state.sort !== "archived") params.set("sort", state.sort);
  if (state.filter && (state.tab === "tasks" || state.tab === "notes"))
    params.set("filter", state.filter);
  const query = params.toString();
  return "#/archive" + (query ? `?${query}` : "");
}

const title = (row: Row) => val(row, "title") || val(row, "name");
/** Archived time, newest first; a hidden note (not itself archived) uses its bucket's. */
const archivedTime = (row: Row) => Date.parse(val(row, "archived_at")) || 0;

function archivedLine(row: Row, now: number) {
  const at = archivedTime(row);
  const by = val(row, "archived_by");
  if (!at) return by ? `Archived by ${by}` : `Revision ${row.revision}`;
  const date = new Date(at);
  const days = Math.floor((now - at) / 86400000);
  const when =
    days < 1
      ? `today at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : days < 7
        ? `${days} ${days === 1 ? "day" : "days"} ago`
        : date.toLocaleDateString();
  return `Archived ${when}${by ? ` by ${by}` : ""}`;
}

export type RestoreItem = { collection: ArchiveCollection; row: Row };

export default function Archive({
  archived,
  buckets,
  busy,
  restore,
}: {
  /** Every archived record by collection, plus notes hidden by an archived bucket. */
  archived: Record<string, Row[]>;
  /** Active buckets, to name a note's bucket. */
  buckets: Row[];
  busy: boolean;
  /** Restores the items one at a time and reports any failures. */
  restore: (items: RestoreItem[]) => void;
}) {
  const [state, setState] = useState(() => archiveStateFromHash(location.hash));
  const [shown, setShown] = useState(archivePageSize);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const now = Date.now();
  // The address follows the tab, search, filter and sort without a history
  // entry per keystroke; the page reads it back on load and on hashchange.
  useEffect(() => {
    const next = archiveStateHash(state);
    if (location.hash !== next)
      history.replaceState(
        null,
        "",
        location.pathname + location.search + next,
      );
  }, [state]);
  useEffect(() => {
    const receive = () => {
      if (/^#\/archive(?:\?|$)/.test(location.hash))
        setState(archiveStateFromHash(location.hash));
    };
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  const update = (changes: Partial<ArchiveState>) => {
    setState((current) => ({ ...current, ...changes }));
    setShown(archivePageSize);
    setSelected(new Set());
  };

  const bucketName = useMemo(() => {
    const names = new Map<string, string>();
    for (const b of [...buckets, ...(archived.buckets ?? [])])
      names.set(b.id, val(b, "name"));
    return (id: string) => names.get(id) ?? "Unknown bucket";
  }, [buckets, archived.buckets]);
  const archivedBuckets = useMemo(
    () => new Map((archived.buckets ?? []).map((b) => [b.id, b])),
    [archived.buckets],
  );
  const counts = Object.fromEntries(
    archiveTabs.map((tab) => [tab, (archived[tab] ?? []).length]),
  ) as Record<ArchiveTab, number>;

  const rows = archived[state.tab] ?? [];
  // Notes not archived themselves but hidden by an archived bucket: one group
  // per bucket, with that bucket's Restore.
  const hiddenNotes =
    state.tab === "notes" ? rows.filter((x) => !x.archived) : [];
  const own = state.tab === "notes" ? rows.filter((x) => x.archived) : rows;
  const needle = state.query.trim().toLowerCase();
  const matches = (row: Row) =>
    (!needle || title(row).toLowerCase().includes(needle)) &&
    (!state.filter ||
      (state.tab === "tasks"
        ? list(row, "labels").some(
            (l) => l.toLowerCase() === state.filter.toLowerCase(),
          )
        : state.tab === "notes"
          ? val(row, "bucket") === state.filter
          : true));
  const filtered = own
    .filter(matches)
    .sort((a, b) =>
      state.sort === "title"
        ? title(a).localeCompare(title(b), undefined, { sensitivity: "base" })
        : archivedTime(b) - archivedTime(a) || title(a).localeCompare(title(b)),
    );
  const visible = filtered.slice(0, shown);
  const byBucket = new Map<string, Row[]>();
  for (const note of hiddenNotes.filter(matches)) {
    const id = val(note, "bucket");
    byBucket.set(id, [...(byBucket.get(id) ?? []), note]);
  }
  const groups = [...byBucket.entries()].sort((a, b) =>
    bucketName(a[0]).localeCompare(bucketName(b[0])),
  );

  const filterOptions =
    state.tab === "tasks"
      ? [
          ...new Map(
            own
              .flatMap((x) => list(x, "labels"))
              .map((l) => [l.toLowerCase(), l]),
          ).values(),
        ]
          .sort((a, b) =>
            a.localeCompare(b, undefined, { sensitivity: "base" }),
          )
          .map((l) => ({ value: l, label: l }))
      : state.tab === "notes"
        ? [...new Set(rows.map((x) => val(x, "bucket")))]
            .map((id) => ({ value: id, label: bucketName(id) }))
            .sort((a, b) => a.label.localeCompare(b.label))
        : [];
  const selectedRows = filtered.filter((x) => selected.has(x.id));
  const allVisibleSelected =
    visible.length > 0 && visible.every((x) => selected.has(x.id));
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const noun =
    state.tab === "agents" ? "inactive agents" : `archived ${state.tab}`;

  return (
    <div className="crew-archive">
      <div
        className="crew-archive-tabs"
        role="tablist"
        aria-label="Archive categories"
      >
        {archiveTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`crew-archive-tab-${tab}`}
            aria-selected={state.tab === tab}
            aria-controls="crew-archive-panel"
            className={state.tab === tab ? "active" : undefined}
            onClick={() => update({ tab, filter: "" })}
          >
            {tabLabels[tab]}{" "}
            <span className="crew-archive-count">({counts[tab]})</span>
          </button>
        ))}
      </div>
      <div
        id="crew-archive-panel"
        role="tabpanel"
        aria-labelledby={`crew-archive-tab-${state.tab}`}
      >
        <div className="crew-archive-toolbar">
          <label className="crew-search">
            <input
              type="search"
              aria-label={`Search ${noun} by title`}
              placeholder="Search by title"
              value={state.query}
              onChange={(e) => update({ query: e.target.value })}
            />
          </label>
          {filterOptions.length > 0 && (
            <select
              aria-label={
                state.tab === "tasks" ? "Filter by label" : "Filter by bucket"
              }
              value={state.filter}
              onChange={(e) => update({ filter: e.target.value })}
            >
              <option value="">
                {state.tab === "tasks" ? "All labels" : "All buckets"}
              </option>
              {filterOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Sort archive"
            value={state.sort}
            onChange={(e) => update({ sort: e.target.value as ArchiveSort })}
          >
            <option value="archived">Archived, newest first</option>
            <option value="title">Title, A to Z</option>
          </select>
        </div>
        {filtered.length > 0 && (
          <div className="crew-archive-bulk">
            <label>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={(e) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const x of visible)
                      if (e.target.checked) next.add(x.id);
                      else next.delete(x.id);
                    return next;
                  })
                }
              />
              Select shown
            </label>
            <span role="status">
              {filtered.length} {filtered.length === 1 ? "item" : "items"}
              {selectedRows.length ? ` · ${selectedRows.length} selected` : ""}
            </span>
            <button
              type="button"
              disabled={busy || !selectedRows.length}
              onClick={() => {
                restore(
                  selectedRows.map((row) => ({ collection: state.tab, row })),
                );
                setSelected(new Set());
              }}
            >
              Restore selected
              {selectedRows.length ? ` (${selectedRows.length})` : ""}
            </button>
          </div>
        )}
        {groups.map(([bucketId, notes]) => {
          const bucket = archivedBuckets.get(bucketId);
          const open = openGroups.has(bucketId);
          return (
            <div className="crew-archive-group" key={bucketId}>
              <div className="crew-archive-row">
                <div>
                  <strong>
                    {notes.length} {notes.length === 1 ? "note" : "notes"}{" "}
                    hidden by archived bucket {bucketName(bucketId)}
                  </strong>
                  <button
                    type="button"
                    className="crew-link-button"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenGroups((current) => {
                        const next = new Set(current);
                        if (open) next.delete(bucketId);
                        else next.add(bucketId);
                        return next;
                      })
                    }
                  >
                    {open ? "Hide notes" : "Show notes"}
                  </button>
                </div>
                {bucket && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      restore([{ collection: "buckets", row: bucket }])
                    }
                  >
                    Restore bucket
                  </button>
                )}
              </div>
              {open && (
                <ul className="crew-archive-group-notes">
                  {notes.map((note) => (
                    <li key={note.id}>{title(note)}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {!filtered.length && !groups.length && (
          <p className="crew-archive-empty">
            {needle || state.filter
              ? `No ${noun} match${needle ? ` “${state.query.trim()}”` : " this filter"}.`
              : state.tab === "agents"
                ? "No inactive agents. Deactivated agents appear here."
                : `No ${noun}. Anything you archive appears here and can be restored.`}
          </p>
        )}
        <ul className="crew-archive-list" aria-label={tabLabels[state.tab]}>
          {visible.map((x) => (
            <li className="crew-archive-row" key={x.id}>
              <input
                type="checkbox"
                aria-label={`Select ${title(x)}`}
                checked={selected.has(x.id)}
                onChange={(e) => toggle(x.id, e.target.checked)}
              />
              <div>
                <strong>{title(x)}</strong>
                <small>
                  {archivedLine(x, now)}
                  {state.tab === "notes"
                    ? ` · ${bucketName(val(x, "bucket"))}`
                    : ""}
                </small>
              </div>
              <button
                type="button"
                disabled={busy}
                aria-label={`Restore ${title(x)}`}
                onClick={() => restore([{ collection: state.tab, row: x }])}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
        {filtered.length > visible.length && (
          <button
            type="button"
            className="crew-archive-more"
            onClick={() => setShown((n) => n + archivePageSize)}
          >
            Show more ({filtered.length - visible.length} left)
          </button>
        )}
      </div>
    </div>
  );
}
