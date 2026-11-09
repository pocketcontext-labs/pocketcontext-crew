import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { statuses, val, type Row } from "./crewApi";
import {
  failureText,
  matchNames,
  maxOffset,
  parseExcerpt,
  problemText,
  queryProblem,
  searchFailure,
  searchHash,
  serverQuery,
  type SearchFailure,
  type SearchHit,
  type SearchRequest,
  type SearchResult,
  searchCrew,
} from "./search";

/** Seam for tests: components call the server only through this object. */
export const searchApi: {
  search: (
    request: SearchRequest,
    signal?: AbortSignal,
  ) => Promise<SearchResult>;
} = { search: searchCrew };

export const searchDebounceMs = 250;
const popupLimit = 10;
const groupLimit = 5;
const pageSize = 20;

/** Server text is only ever rendered as React text and <mark>, never as HTML. */
export function Excerpt({ text }: { text: unknown }) {
  const parts = parseExcerpt(text);
  if (!parts.length) return null;
  return (
    <span className="crew-excerpt">
      {parts.map((part, index) =>
        part.mark ? <mark key={index}>{part.text}</mark> : part.text,
      )}
    </span>
  );
}

const statusLabel = (status?: string) =>
  statuses.find(([key]) => key === status)?.[1] ?? "Task";

/** The note's bucket or the task's status, as one short line. */
export function hitMeta(hit: SearchHit): string {
  if (hit.collection === "notes") return hit.bucket_name || "Note";
  return [statusLabel(hit.status), hit.assigned_agent_name]
    .filter(Boolean)
    .join(" · ");
}

/** True when keys typed here are text, so "/" and Cmd/Ctrl+K stay with the field. */
function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement)
    return ![
      "button",
      "checkbox",
      "radio",
      "submit",
      "reset",
      "range",
      "color",
      "file",
      "image",
    ].includes(target.type);
  return false;
}

type Option =
  | { key: string; kind: "task" | "note"; hit: SearchHit }
  | { key: string; kind: "agent" | "bucket"; row: Row }
  | { key: string; kind: "all" };

type Live = {
  text: string;
  status: "idle" | "loading" | "done" | "error";
  hits: SearchHit[];
  failure?: Exclude<SearchFailure, "aborted">;
};

export function GlobalSearch({
  agents,
  buckets,
  pageText,
  disabled,
  onOpenHit,
  onOpenAgent,
  onOpenBucket,
}: {
  agents: Row[];
  buckets: Row[];
  /** The query of the Search page while it is shown, to prefill the field. */
  pageText: string | null;
  /** A dialog is open: shortcuts do nothing. */
  disabled: boolean;
  onOpenHit: (hit: SearchHit) => void;
  onOpenAgent: (row: Row) => void;
  onOpenBucket: (row: Row) => void;
}) {
  const id = useId();
  const listId = `${id}-results`;
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(pageText ?? "");
  const [open, setOpen] = useState(false);
  // Phones show only an icon until the field is opened.
  const [expanded, setExpanded] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [active, setActive] = useState(-1);
  const [live, setLive] = useState<Live>({
    text: "",
    status: "idle",
    hits: [],
  });
  const ticket = useRef(0);

  useEffect(() => {
    if (pageText !== null) {
      setText(pageText);
      setOpen(false);
    }
  }, [pageText]);

  // Debounced live results. Every change invalidates the previous request, so
  // an older response can never replace a newer one.
  useEffect(() => {
    const mine = ++ticket.current;
    if (!open || queryProblem(text)) {
      setLive({ text, status: "idle", hits: [] });
      return;
    }
    setLive((current) => ({ ...current, status: "loading" }));
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchApi
        .search(
          { query: serverQuery(text), limit: popupLimit },
          controller.signal,
        )
        .then(
          (result) => {
            if (mine === ticket.current)
              setLive({ text, status: "done", hits: result.items });
          },
          (error) => {
            const failure = searchFailure(error);
            if (failure === "aborted" || mine !== ticket.current) return;
            setLive({ text, status: "error", hits: [], failure });
          },
        );
    }, searchDebounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, open]);

  useEffect(() => {
    if (!focusTick) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTick]);

  // A layout effect: once a dialog is shown, no key can reach a listener that
  // still thinks the page is free.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || e.defaultPrevented || e.altKey) return;
      const shortcut =
        (e.key === "/" && !e.metaKey && !e.ctrlKey) ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k");
      if (!shortcut || typingIn(e.target)) return;
      e.preventDefault();
      setExpanded(true);
      setFocusTick((tick) => tick + 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [disabled]);

  const problem = queryProblem(text);
  const agentMatches = useMemo(
    () => (problem ? [] : matchNames(agents, text).slice(0, groupLimit)),
    [agents, text, problem],
  );
  const bucketMatches = useMemo(
    () => (problem ? [] : matchNames(buckets, text).slice(0, groupLimit)),
    [buckets, text, problem],
  );
  const hits = problem ? [] : live.hits;
  const groups: { label: string; options: Option[] }[] = [
    {
      label: "Tasks",
      options: hits
        .filter((hit) => hit.collection === "tasks")
        .slice(0, groupLimit)
        .map((hit) => ({ key: `task-${hit.id}`, kind: "task", hit })),
    },
    {
      label: "Notes",
      options: hits
        .filter((hit) => hit.collection === "notes")
        .slice(0, groupLimit)
        .map((hit) => ({ key: `note-${hit.id}`, kind: "note", hit })),
    },
    {
      label: "Agents",
      options: agentMatches.map((row) => ({
        key: `agent-${row.id}`,
        kind: "agent",
        row,
      })),
    },
    {
      label: "Buckets",
      options: bucketMatches.map((row) => ({
        key: `bucket-${row.id}`,
        kind: "bucket",
        row,
      })),
    },
  ];
  const options: Option[] = [
    ...groups.flatMap((group) => group.options),
    ...(problem ? [] : [{ key: "all", kind: "all" } as Option]),
  ];
  const optionKeys = options.map((option) => option.key).join("|");
  useEffect(() => setActive(-1), [optionKeys]);
  const optionId = (index: number) => `${id}-option-${index}`;
  useEffect(() => {
    if (active < 0) return;
    document
      .getElementById(optionId(active))
      ?.scrollIntoView?.({ block: "nearest" });
    // optionId depends only on id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const showPopup = open && text.trim() !== "";
  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const seeAll = () => {
    close();
    setExpanded(false);
    const target = searchHash(text);
    if (location.hash !== target) location.hash = target;
  };
  const choose = (option: Option) => {
    if (option.kind === "all") return seeAll();
    close();
    setExpanded(false);
    if ("hit" in option) onOpenHit(option.hit);
    else if (option.kind === "agent") onOpenAgent(option.row);
    else onOpenBucket(option.row);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!showPopup) {
        if (text.trim()) setOpen(true);
        return;
      }
      if (!options.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        index < 0
          ? step > 0
            ? 0
            : options.length - 1
          : (index + step + options.length) % options.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (showPopup && active >= 0 && options[active]) choose(options[active]);
      else if (!problem) seeAll();
    } else if (e.key === "Escape") {
      // Also stops the browser clearing a search field.
      e.preventDefault();
      if (showPopup) close();
      else if (expanded) {
        setExpanded(false);
        toggleRef.current?.focus();
      }
    } else if (e.key === "Tab") close();
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    close();
    if (!text.trim()) setExpanded(false);
  };

  const status = problem
    ? problem === "empty"
      ? ""
      : problemText[problem]
    : live.status === "error" && live.failure
      ? failureText[live.failure]
      : live.status === "loading" && !hits.length
        ? "Searching…"
        : live.status === "done" && options.length === 1
          ? `No tasks, notes, agents or buckets match “${text.trim()}”.`
          : "";
  let index = -1;
  const renderOption = (option: Option) => {
    index += 1;
    const mine = index;
    const props = {
      id: optionId(mine),
      role: "option" as const,
      "aria-selected": mine === active,
      className:
        mine === active ? "crew-search-option active" : "crew-search-option",
      // Keep focus in the field; the click chooses.
      onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault(),
      onClick: () => choose(option),
      onMouseMove: () => {
        if (active !== mine) setActive(mine);
      },
    };
    if (option.kind === "all")
      return (
        <div key={option.key} {...props} className={`${props.className} all`}>
          See all results for “{text.trim()}”
        </div>
      );
    if ("row" in option)
      return (
        <div key={option.key} {...props}>
          <strong>{val(option.row, "name")}</strong>
          <small>
            {option.kind === "agent"
              ? "Agent"
              : val(option.row, "purpose") || "Bucket"}
          </small>
        </div>
      );
    return (
      <div key={option.key} {...props}>
        <strong>{option.hit.title || "Untitled"}</strong>
        <small>{hitMeta(option.hit)}</small>
        <Excerpt text={option.hit.excerpt} />
      </div>
    );
  };

  return (
    <div
      className={
        expanded ? "crew-global-search expanded" : "crew-global-search"
      }
      onBlur={onBlur}
    >
      <button
        ref={toggleRef}
        type="button"
        className="crew-search-toggle"
        aria-label="Search"
        title="Search"
        aria-expanded={expanded}
        onClick={() => {
          setExpanded(true);
          setFocusTick((tick) => tick + 1);
        }}
      >
        <span aria-hidden="true">⌕</span>
      </button>
      <div className="crew-global-field">
        <span aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search Crew"
          aria-autocomplete="list"
          aria-expanded={showPopup}
          aria-controls={listId}
          aria-activedescendant={
            showPopup && active >= 0 ? optionId(active) : undefined
          }
          aria-keyshortcuts="/ Control+K Meta+K"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="Search tasks, notes, agents…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <kbd aria-hidden="true">/</kbd>
        <button
          type="button"
          className="crew-search-close"
          aria-label="Close search"
          onClick={() => {
            close();
            setExpanded(false);
            toggleRef.current?.focus();
          }}
        >
          ×
        </button>
      </div>
      <div className="crew-search-popup" hidden={!showPopup}>
        <p role="status" className="crew-search-status" hidden={!status}>
          {showPopup ? status : ""}
        </p>
        <div id={listId} role="listbox" aria-label="Search results">
          {showPopup &&
            groups.map(
              (group) =>
                group.options.length > 0 && (
                  <div
                    key={group.label}
                    role="group"
                    aria-labelledby={`${id}-${group.label}`}
                  >
                    <div
                      id={`${id}-${group.label}`}
                      role="presentation"
                      className="crew-search-group"
                    >
                      {group.label}
                    </div>
                    {group.options.map(renderOption)}
                  </div>
                ),
            )}
          {showPopup && !problem && renderOption(options[options.length - 1])}
        </div>
      </div>
    </div>
  );
}

type Paged = {
  status: "idle" | "loading" | "ready" | "error";
  items: SearchHit[];
  next: number | null;
  generation: string;
  capped: boolean;
  restarted: boolean;
  loadingMore: boolean;
  failure?: Exclude<SearchFailure, "aborted">;
  moreFailure?: Exclude<SearchFailure, "aborted">;
};
const idle: Paged = {
  status: "idle",
  items: [],
  next: null,
  generation: "",
  capped: false,
  restarted: false,
  loadingMore: false,
};

/** Continuation of a page, or null when there is none the server will accept. */
function nextOf(result: SearchResult, offset: number) {
  const next =
    result.hasMore && result.nextOffset !== null && result.nextOffset > offset
      ? result.nextOffset
      : null;
  return {
    next: next !== null && next <= maxOffset ? next : null,
    capped: next !== null && next > maxOffset,
  };
}

/**
 * All matches, page by page. Pages after the first carry the first page's
 * generation; a 409 means the content changed, so the list starts again.
 */
export function usePagedSearch(
  text: string | null,
  archived: boolean,
  enabled: boolean,
  refreshKey: number,
) {
  const [state, setState] = useState<Paged>(idle);
  const ticket = useRef(0);
  const start = useCallback(
    (restarted: boolean) => {
      const mine = ++ticket.current;
      if (!enabled || text === null || queryProblem(text)) {
        setState(idle);
        return;
      }
      setState({ ...idle, status: "loading", restarted });
      searchApi
        .search({ query: serverQuery(text), limit: pageSize, archived })
        .then(
          (result) => {
            if (mine !== ticket.current) return;
            setState({
              ...idle,
              status: "ready",
              items: result.items,
              generation: result.generation,
              restarted,
              ...nextOf(result, 0),
            });
          },
          (error) => {
            if (mine !== ticket.current) return;
            const failure = searchFailure(error);
            setState({
              ...idle,
              status: "error",
              failure: failure === "aborted" ? "failed" : failure,
            });
          },
        );
    },
    [text, archived, enabled],
  );
  useEffect(() => {
    start(false);
    return () => {
      ticket.current++;
    };
  }, [start, refreshKey]);
  const more = () => {
    if (state.status !== "ready" || state.next === null || state.loadingMore)
      return;
    const mine = ++ticket.current;
    const offset = state.next;
    setState((current) => ({
      ...current,
      loadingMore: true,
      moreFailure: undefined,
    }));
    searchApi
      .search({
        query: serverQuery(text ?? ""),
        limit: pageSize,
        offset,
        archived,
        generation: state.generation,
      })
      .then(
        (result) => {
          if (mine !== ticket.current) return;
          setState((current) => {
            const seen = new Set(current.items.map((hit) => hit.id));
            return {
              ...current,
              items: [
                ...current.items,
                ...result.items.filter((hit) => !seen.has(hit.id)),
              ],
              generation: result.generation || current.generation,
              restarted: false,
              loadingMore: false,
              ...nextOf(result, offset),
            };
          });
        },
        (error) => {
          if (mine !== ticket.current) return;
          const failure = searchFailure(error);
          if (failure === "changed") return start(true);
          setState((current) => ({
            ...current,
            loadingMore: false,
            moreFailure: failure === "aborted" ? "failed" : failure,
          }));
        },
      );
  };
  return { state, more, retry: () => start(false) };
}

function ResultList({
  label,
  archived,
  paged,
  onOpenHit,
}: {
  label: string;
  archived: boolean;
  paged: ReturnType<typeof usePagedSearch>;
  onOpenHit: (hit: SearchHit, archived: boolean) => void;
}) {
  const { state, more, retry } = paged;
  if (state.status === "loading") return <p role="status">Searching…</p>;
  if (state.status === "error")
    return (
      <div className="crew-alert" role="alert">
        {failureText[state.failure ?? "failed"]}{" "}
        <button onClick={retry}>Try again</button>
      </div>
    );
  if (state.status !== "ready") return null;
  return (
    <>
      {state.restarted && (
        <p className="crew-notice" role="status">
          Crew changed while you were looking, so the results started again from
          the top.
        </p>
      )}
      {!state.items.length ? (
        <p className="crew-search-none">
          {archived
            ? "No archived tasks or notes match."
            : "No tasks or notes match. Try fewer or different words."}
        </p>
      ) : (
        <ol className="crew-search-results" aria-label={label}>
          {state.items.map((hit) => (
            <li key={hit.id}>
              <button
                className="crew-search-result"
                onClick={() => onOpenHit(hit, archived)}
              >
                <span className="crew-search-kind">
                  {hit.collection === "tasks" ? "Task" : "Note"}
                </span>
                <strong>{hit.title || "Untitled"}</strong>
                <small>{hitMeta(hit)}</small>
                <Excerpt text={hit.excerpt} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {state.moreFailure && (
        <div className="crew-alert" role="alert">
          {failureText[state.moreFailure]}
        </div>
      )}
      {state.next !== null && (
        <button
          className="crew-search-more"
          disabled={state.loadingMore}
          onClick={more}
        >
          {state.loadingMore ? "Loading more…" : "Show more results"}
        </button>
      )}
      {state.capped && (
        <p className="crew-footnote">
          That's as far as search goes. Add words to narrow it down.
        </p>
      )}
    </>
  );
}

export function SearchPage({
  text,
  agents,
  buckets,
  refreshKey,
  onOpenHit,
  onOpenAgent,
  onOpenBucket,
}: {
  /** The address's query; null when the address is not a valid search. */
  text: string | null;
  agents: Row[];
  buckets: Row[];
  refreshKey: number;
  onOpenHit: (hit: SearchHit, archived: boolean) => void;
  onOpenAgent: (row: Row) => void;
  onOpenBucket: (row: Row) => void;
}) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const problem = text === null ? "invalid" : queryProblem(text);
  const current = usePagedSearch(text, false, !problem, refreshKey);
  const old = usePagedSearch(
    text,
    true,
    !problem && includeArchived,
    refreshKey,
  );
  if (problem)
    return (
      <div className="crew-search-page">
        <p className="crew-search-prompt">
          {text === null
            ? "This search address isn't complete. Type what you're looking for in the search box at the top."
            : problem === "empty"
              ? "Type what you're looking for in the search box at the top. Crew searches task and note text, and agent and bucket names."
              : problemText[problem]}
        </p>
      </div>
    );
  const query = text ?? "";
  const agentMatches = matchNames(agents, query);
  const bucketMatches = matchNames(buckets, query);
  return (
    <div className="crew-search-page">
      <div className="crew-search-summary">
        <p>
          Results for <strong>“{query.trim()}”</strong>
        </p>
        <label>
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Include archived
        </label>
      </div>
      {agentMatches.length > 0 && (
        <section aria-labelledby="search-agents">
          <h2 id="search-agents">Agents</h2>
          <ul className="crew-search-names">
            {agentMatches.map((row) => (
              <li key={row.id}>
                <button onClick={() => onOpenAgent(row)}>
                  <strong>{val(row, "name")}</strong>
                  <small>Agent</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {bucketMatches.length > 0 && (
        <section aria-labelledby="search-buckets">
          <h2 id="search-buckets">Buckets</h2>
          <ul className="crew-search-names">
            {bucketMatches.map((row) => (
              <li key={row.id}>
                <button onClick={() => onOpenBucket(row)}>
                  <strong>{val(row, "name")}</strong>
                  <small>{val(row, "purpose") || "Bucket"}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="search-items">
        <h2 id="search-items">Tasks and notes</h2>
        <ResultList
          label="Tasks and notes"
          archived={false}
          paged={current}
          onOpenHit={onOpenHit}
        />
      </section>
      {includeArchived && (
        <section aria-labelledby="search-archived">
          <h2 id="search-archived">Archived tasks and notes</h2>
          <ResultList
            label="Archived tasks and notes"
            archived
            paged={old}
            onOpenHit={onOpenHit}
          />
        </section>
      )}
    </div>
  );
}
