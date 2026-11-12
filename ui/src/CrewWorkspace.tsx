import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Brand from "./Brand";
import { api } from "./api";
import {
  crewApi,
  val,
  list,
  statuses,
  boardStatuses,
  lineDiff,
  type AgentSession,
  type ConnectionState,
  type Row,
} from "./crewApi";
import Connect from "./Connect";
import Guide from "./Guide";
import Help, {
  HelpField,
  HelpModeContext,
  helpIsOpenIn,
  helpMode,
} from "./Help";
import type { HelpTopic } from "./helpContent";
import Home from "./Home";
import LabelsInput from "./LabelsInput";
import { ReviewChoices, ReviewContent, ReviewDecision, ReviewRequest } from "./Review";
import { decisionSummary, objects } from "./reviews";
import { strandedWakes } from "./wakes";
import {
  approvalLine,
  doneColumn,
  isClosed,
} from "./closedTasks";
import StartSession, { SessionToast, type SessionStart } from "./StartSession";
import SessionInstructions from "./SessionInstructions";
import {
  clearedBoard,
  commitBoardSearch,
  filterChips,
  heldDuration,
  heldSince,
  isLongHeld,
  knownLabels,
  labelMatches,
  longHolds,
  parseBoardSearch,
  statusMatches,
  tokensMatch,
} from "./boardFilters";
import {
  agentKind,
  agentKindCardLabel,
  agentKindChoices,
  agentKinds,
  agentKindSuffix,
  claimOf,
  claimLabel,
  claimTitle,
  copyText,
  webhookConfigured,
  type AgentKind,
} from "./projectAgents";
import { GlobalSearch, SearchPage } from "./Search";
import { searchHash, searchTextFromHash, type SearchHit } from "./searchApi";
import "./crew.css";
import type { ServerVersion } from "./crewApi";
import {
  AttachmentsProvider,
  AttachmentsSection,
  CardThumbnail,
  eventSummary,
  fileInputHandlers,
  fileReference,
  isFileEvent,
  namePasted,
  filesOf,
  ProseImage,
  ProseLink,
  proseUrlTransform,
  useItemAttachments,
  useStagedFiles,
  withdrawnNotice,
} from "./Attachments";
import {
  attachmentsApi,
  checkFiles,
  isImage,
  replaceUploadPlaceholder,
  uploadPlaceholder,
  useFileToken,
  type CardThumb,
  type FileRefusal,
} from "./attachmentsApi";
import {
  boardColumnFromHash,
  connectSectionFromHash,
  bucketSorts,
  holdFilters,
  isItemHash,
  itemPath,
  itemShareUrl,
  itemTabPath,
  taskTabs,
  type TaskTab,
  legacyRedirect,
  noteSorts,
  parseItemHash,
  type BucketSort,
  type HoldFilter,
  type ItemKind,
  type NoteSort,
  type View,
  type ViewState,
  viewFromHash,
  viewHashes,
  viewStateFromHash,
  viewStateHash,
  sharedFocusFromHash,
} from "./itemLink";
import Shared from "./Shared";
const nav: [View, string, string][] = [
  ["home", "Home", "⌂"],
  ["board", "Tasks", "▦"],
  ["memory", "Notes", "▤"],
  ["reviews", "Approvals", "✓"],
  ["shared", "Shared", "↗"],
  ["agents", "Agents", "◎"],
  ["archive", "Archive", "↶"],
];
const pages: [View, string, string][] = [
  ...nav,
  ["connect", "Connect an agent", "⇄"],
  ["guide", "Guide", "?"],
  ["search", "Search", "⌕"],
];
const eyebrows: Record<View, string> = {
  home: "START HERE",
  board: "BOARD",
  memory: "BUCKETS AND NOTES",
  reviews: "YOUR FINAL SAY",
  agents: "YOUR TEAM",
  archive: "NOTHING IS DELETED",
  connect: "ONE CONNECTION FOR ALL YOUR AGENTS",
  guide: "HOW IT WORKS",
  search: "FIND ANYTHING",
  shared: "PAGES YOU SHARE BY LINK",
};
const viewHelp: Partial<Record<View, HelpTopic>> = {
  home: "home",
  board: "board",
  memory: "memory",
  reviews: "approvals",
  agents: "agents",
  archive: "archive",
  connect: "connect",
  search: "search",
};
const statusHelp: Record<(typeof boardStatuses)[number][0], HelpTopic> = {
  todo: "todo",
  in_progress: "in-progress",
  needs_review: "needs-review",
  done: "done",
};
type Kind = "task" | "note" | "bucket" | "agent" | "review";
type Data = Record<string, Row[]>;
/** Never fires hashchange, so writing the address cannot open a dialog. */
const setAddress = (hash: string) =>
  history.replaceState(null, "", location.pathname + location.search + hash);
/** Replaces an old page address with its current form, adding no history entry. */
const redirectLegacyAddress = () => {
  const next = legacyRedirect(location.hash);
  if (next) setAddress(next);
};
const pushAddress = (hash: string) => {
  if (location.hash !== hash)
    history.pushState(null, "", location.pathname + location.search + hash);
};
const noteSortLabels: Record<NoteSort, string> = {
  updated: "Sort: Last updated",
  created: "Sort: Newest first",
  title: "Sort: Title A–Z",
  bucket: "Sort: Bucket",
};
const bucketSortLabels: Record<BucketSort, string> = {
  name: "Sort: Name",
  notes: "Sort: Most notes",
  activity: "Sort: Last activity",
};
const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
/** Newest first; timestamps share one format, and missing ones sort last. */
const byNewest = (a: unknown, b: unknown) =>
  String(b || "").localeCompare(String(a || ""));
/** All, unassigned, invalid, or an active agent's id. */
const validAssignment = (value: string, agents: Row[]) =>
  value === "all" ||
  value === "unassigned" ||
  value === "invalid" ||
  agents.some((x) => x.id === value);
/** Whether a task shows under the board's assignment filter. */
function assignmentMatches(
  filter: string,
  task: Row,
  invalid: (task: Row) => boolean,
) {
  if (filter === "all") return true;
  // Unassigned and invalid are queues of open work.
  if (filter === "unassigned")
    return !isClosed(task) && !val(task, "assigned_agent");
  if (filter === "invalid")
    return !isClosed(task) && invalid(task);
  return val(task, "assigned_agent") === filter;
}
const holdFilterLabels: Record<HoldFilter, string> = {
  all: "On hold and Ready",
  on_hold: "On hold",
  ready: "Ready",
};
/** Whether a task shows under the board's hold filter; Done and Won't do have no hold. */
function holdMatches(filter: HoldFilter, task: Row) {
  if (filter === "all") return true;
  if (isClosed(task)) return false;
  return (val(task, "readiness") === "ready") === (filter === "ready");
}
/** Readiness as the reader names it: the API keeps `waiting` for On hold. */
const onHold = (task: Row) => val(task, "readiness") !== "ready";
const when = (raw: unknown) =>
  raw ? new Date(String(raw)).toLocaleString() : "Just now";
/** Readable card text: Markdown markers would otherwise show, and could be cut in half. */
const plainPreview = (markdown: string) =>
  markdown
    .replace(/^```.*$/gm, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+)/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)\n?/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\*(\S[^*\n]*)\*/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
/** The shortest name prefix (up to three letters) no other agent shares. */
function agentInitials(name: string, agents: Row[]) {
  const letters = name.trim();
  const others = agents
    .map((agent) => val(agent, "name").trim().toLowerCase())
    .filter((other) => other !== letters.toLowerCase());
  for (let size = 1; size < 3; size++) {
    const prefix = letters.slice(0, size).toLowerCase();
    if (!others.some((other) => other.startsWith(prefix)))
      return letters.slice(0, size);
  }
  return letters.slice(0, 3);
}
function Prose({ children }: { children: string }) {
  return (
    <div className="crew-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={proseUrlTransform}
        components={{
          // Same-item attachments only; external images never load.
          img: ({ src, alt }) => <ProseImage src={src} alt={alt} />,
          a: ({ children, href }) => <ProseLink href={href}>{children}</ProseLink>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
/** On hold (with its reason on hover) or Ready; not shown for Done tasks. */
function HoldChip({ task }: { task: Row }) {
  if (!onHold(task)) return val(task, "status") === "todo" ? <span className="crew-ready-chip">Ready</span> : null;
  const reason = val(task, "waiting_reason").trim();
  return (
    <span className="crew-hold-chip" title={reason || undefined}>
      On hold{heldDuration(task) ? ` ${heldDuration(task)}` : ""}
      {reason && <span className="sr-only">: {reason}</span>}
    </span>
  );
}
/** A coding session's claim: live with its end time on hover, or expired. */
function ClaimChip({ task, details = false }: { task: Row; details?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const claim = claimOf(task, now);
  if (!claim.state) return null;
  const title = claimTitle(claim);
  const warning = claim.state === "expired" || Date.parse(claim.until) - now < 15 * 60000;
  return (
    <span className={warning ? "crew-claim-expired" : "crew-claim-chip"} title={title}>
      {claimLabel(claim, now)}
      {details && <span className="crew-claim-details">{title}</span>}
    </span>
  );
}
const wakeMissingTitle =
  "Crew woke the assigned bot but it never confirmed receiving the wake. Check the bot's conversation, then set the task On hold and Ready again if it should run.";
function WakeMissingChip() {
  return (
    <span className="crew-human" title={wakeMissingTitle}>
      Wake not received
    </span>
  );
}
function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: HelpTopic;
  children: ReactNode;
}) {
  if (help)
    return (
      <HelpField label={label} topic={help}>
        {children as ReactElement<{ id?: string }>}
      </HelpField>
    );
  return (
    <label className="crew-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="crew-empty">
      <span aria-hidden="true">↗</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action && <div className="crew-empty-action">{action}</div>}
    </div>
  );
}
function CopyLink({
  target,
  label = "Copy link",
  copiedLabel = "Link copied",
}: {
  target: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  // One copy helper for the reader: the Clipboard API, then the copy command.
  const copy = async () => setState((await copyText(target)) ? "copied" : "failed");
  return (
    <span className="crew-copy-link">
      <button type="button" onClick={() => void copy()}>
        {state === "copied" ? copiedLabel : label}
      </button>
      {state === "failed" && (
        <span role="alert" className="crew-copy-error">
          Could not copy automatically. Copy it from here: <code>{target}</code>
        </span>
      )}
    </span>
  );
}
/** Creates a draft artifact prefilled from a note; publishing is on Shared. */
function ShareAsArtifact({
  note,
  done,
}: {
  note: Row;
  done: (id: string) => void;
}) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const share = async () => {
    setState("busy");
    try {
      const created = await crewApi.write(
        "artifact.create",
        {
          title: val(note, "title"),
          body: val(note, "body"),
          sources: [note.id],
        },
        undefined,
        "Share as artifact",
      );
      done(created.id);
    } catch {
      setState("failed");
    }
  };
  return (
    <span className="crew-copy-link">
      <button
        type="button"
        disabled={state === "busy"}
        title="Make a frozen copy of this note you can share by link"
        onClick={() => void share()}
      >
        Share as artifact
      </button>
      {state === "failed" && (
        <span role="alert" className="crew-copy-error">
          Could not create the artifact.
        </span>
      )}
    </span>
  );
}
/**
 * Grows with its content, so a long note scrolls with the dialog, not inside it.
 * The agent brief is capped (CSS max-height) and past that scrolls itself.
 */
function GrowingTextarea({ value, ...props }: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = el.closest("dialog");
    const top = scroller?.scrollTop;
    const own = el.scrollTop;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px`;
    // Past the cap the field scrolls itself; keep its place while typing.
    el.scrollTop = own;
    if (scroller && top !== undefined) scroller.scrollTop = top;
  }, []);
  useLayoutEffect(measure, [measure, value, props.hidden]);
  // A textarea in a dialog not yet shown, or hidden, measures zero; children's
  // layout effects run before the dialog's showModal(). Measure again when it
  // gets a width, and when the width changes and the text rewraps.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = 0;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <textarea
      ref={ref}
      value={value}
      {...props}
      className={`crew-grow ${props.className || ""}`}
    />
  );
}
function MarkdownField({
  label,
  help,
  required,
  className,
  value,
  onChange,
  tabs = true,
  onFiles,
  status,
}: {
  label: string;
  help?: ReactNode;
  tabs?: boolean;
  required?: boolean;
  className?: string;
  value: string;
  onChange: (value: string) => void;
  /** Pasted or dropped files at the caret; returns the inserted text. */
  onFiles?: (
    files: File[],
    range: [number, number],
    pasted: boolean,
  ) => string | void;
  /** Upload messages shown under the field. */
  status?: ReactNode;
}) {
  const id = useId();
  const [reading, setReading] = useState(tabs && Boolean(value.trim()));
  return (
    <div className="crew-md-field">
      <div className="crew-md-label">
        <label htmlFor={id}>{label}</label>
        <small>Markdown supported</small>
        {help}
      </div>
      <div className="crew-md-box">
        {tabs && (
          <div
            className="crew-md-tabs"
            role="tablist"
            aria-label={`${label} view`}
          >
            {[true, false].map((showRead) => (
              <button
                key={String(showRead)}
                type="button"
                role="tab"
                aria-selected={reading === showRead}
                onClick={() => setReading(showRead)}
              >
                {showRead ? "Read" : "Edit"}
              </button>
            ))}
          </div>
        )}
        {/* Hidden rather than removed, so undo and the height survive Read. */}
        <GrowingTextarea
          id={id}
          hidden={reading}
          required={required}
          className={className}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onInvalid={() => setReading(false)}
          {...fileInputHandlers(onFiles)}
        />
        {reading && (
          <div className="crew-md-preview">
            {value.trim() ? (
              <Prose>{value}</Prose>
            ) : (
              <p>Nothing written yet.</p>
            )}
          </div>
        )}
      </div>
      {status}
    </div>
  );
}
type Related = { id: string; kind: ItemKind; row?: Row };
/**
 * Links (0.24.0) name tasks or notes. `linked` are this record's own links in
 * order; `linkedFrom` are other records that link here and aren't linked back,
 * so a relationship shows on both sides without writing it twice.
 */
function relatedItems(
  data: Data,
  currentId: string | undefined,
  links: string[],
): { linked: Related[]; linkedFrom: Related[] } {
  const find = (id: string): Related => {
    const task = (data.tasks || []).find((x) => x.id === id);
    if (task) return { id, kind: "task", row: task };
    const note = (data.notes || []).find((x) => x.id === id);
    return { id, kind: "note", row: note };
  };
  const linked = links.map(find);
  const linkedFrom: Related[] = [];
  if (currentId)
    for (const kind of ["task", "note"] as const)
      for (const row of data[`${kind}s`] || [])
        if (
          row.id !== currentId &&
          !links.includes(row.id) &&
          list(row, "links").includes(currentId)
        )
          linkedFrom.push({ id: row.id, kind, row });
  return { linked, linkedFrom };
}
const kindName = (kind: ItemKind) => (kind === "task" ? "Task" : "Note");
/** A related task or note by title, linking to its permanent address. */
function RelatedLink({
  item,
  open,
}: {
  item: Related;
  open: (kind: ItemKind, row: Row) => void;
}) {
  const { row, kind } = item;
  if (!row) return <span className="crew-related-missing">Unavailable item</span>;
  const title = val(row, "title") || "Untitled";
  return (
    <span className="crew-related-item">
      <span className="crew-related-kind">{kindName(kind)}</span>
      <a
        href={itemPath(kind, row)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          open(kind, row);
        }}
      >
        {title}
      </a>
      {row.archived ? <span className="crew-related-archived">archived</span> : null}
    </span>
  );
}
function RelatedItems({
  data,
  currentId,
  links,
  setLinks,
  readOnly,
  open,
}: {
  data: Data;
  currentId?: string;
  links: string;
  setLinks: (next: string) => void;
  readOnly: boolean;
  open: (kind: ItemKind, row: Row) => void;
}) {
  const [query, setQuery] = useState("");
  const ids = links.split("\n").filter(Boolean);
  const { linked, linkedFrom } = relatedItems(data, currentId, ids);
  const candidates: Related[] = [
    ...(data.tasks || []).map((row) => ({ id: row.id, kind: "task" as const, row })),
    ...(data.notes || []).map((row) => ({ id: row.id, kind: "note" as const, row })),
  ].filter((x) => x.id !== currentId && !x.row.archived);
  const needle = query.trim().toLowerCase();
  const results = needle
    ? candidates
        .filter(
          (x) =>
            !ids.includes(x.id) &&
            val(x.row, "title").toLowerCase().includes(needle),
        )
        .slice(0, 8)
    : [];
  return (
    <fieldset className="crew-related" aria-label="Related">
      <legend>
        <span>Related</span>
        {!readOnly && <Help topic="related-memory" />}
      </legend>
      {linked.length > 0 && (
        <ul className="crew-related-linked" aria-label="Links">
          {linked.map((item) => (
            <li key={item.id}>
              <RelatedLink item={item} open={open} />
              {!readOnly && (
                <button
                  type="button"
                  className="crew-quiet"
                  aria-label={`Remove ${item.row ? val(item.row, "title") : "unavailable item"}`}
                  onClick={() =>
                    setLinks(ids.filter((x) => x !== item.id).join("\n"))
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {linkedFrom.length > 0 && (
        <>
          <h4 className="crew-related-heading">Linked from</h4>
          <ul className="crew-related-linked" aria-label="Linked from">
            {linkedFrom.map((item) => (
              <li key={item.id}>
                <RelatedLink item={item} open={open} />
              </li>
            ))}
          </ul>
        </>
      )}
      {!readOnly && candidates.length > 0 && (
        <label className="crew-field crew-related-search">
          <span>Link a task or note</span>
          <input
            type="search"
            placeholder="Search tasks and notes"
            value={query}
            // Searching is not an edit to the record.
            onChange={(e) => {
              e.stopPropagation();
              setQuery(e.target.value);
            }}
          />
        </label>
      )}
      {results.length > 0 && (
        <ul className="crew-related-results">
          {results.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => {
                  setLinks([...ids, x.id].join("\n"));
                  setQuery("");
                }}
              >
                <span className="crew-related-kind">{kindName(x.kind)}</span>{" "}
                {val(x.row, "title")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle && !results.length && <p>No matching tasks or notes.</p>}
      {!candidates.length && !linked.length && !linkedFrom.length && (
        <p>Nothing to link yet.</p>
      )}
    </fieldset>
  );
}
function Modal({
  title,
  actions,
  children,
  close,
  onEdit,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  close: () => void;
  onEdit: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const helpWasOpen = useRef(false);
  // Backdrop clicks target the dialog itself, as do its scrollbars, so use position.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== ref.current) return false;
    const box = ref.current.getBoundingClientRect();
    return (
      e.clientX < box.left ||
      e.clientX > box.right ||
      e.clientY < box.top ||
      e.clientY > box.bottom
    );
  };
  // A layout effect: the dialog is focused in the commit that shows it.
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal?.();
    // showModal focuses the first control; the dialog itself takes focus so
    // nothing is highlighted on open and Tab still starts at the first control.
    ref.current?.focus({ preventScroll: true });
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      open={
        typeof HTMLDialogElement.prototype.showModal !== "function"
          ? true
          : undefined
      }
      className="crew-dialog"
      tabIndex={-1}
      onChange={onEdit}
      // Runs before Help's own listener, so it still sees the popover. The first
      // click outside an open popover only dismisses the popover.
      onPointerDown={() => {
        helpWasOpen.current = helpIsOpenIn(ref.current);
      }}
      onScroll={(e) =>
        e.currentTarget.classList.toggle(
          "crew-scrolled",
          e.currentTarget.scrollTop > 0,
        )
      }
      onMouseDown={(e) => {
        pressedBackdrop.current = onBackdrop(e) && !helpWasOpen.current;
      }}
      onClick={(e) => {
        // A drag that starts inside, such as selecting text, must not close it.
        if (pressedBackdrop.current && onBackdrop(e)) close();
        pressedBackdrop.current = false;
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        {actions}
        <button onClick={close} aria-label="Close dialog">
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export default function CrewWorkspace() {
  const [view, setView] = useState<View>(() => {
      redirectLegacyAddress();
      return viewFromHash(location.hash);
    }),
    [data, setData] = useState<Data>({
      agents: [],
      buckets: [],
      notes: [],
      tasks: [],
      reviews: [],
    }),
    [archived, setArchived] = useState<Data>({
      agents: [],
      buckets: [],
      notes: [],
      tasks: [],
    });
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    // Tasks and Notes filters and sorts, kept in the address
    // (#/tasks?agent=…, #/notes?bucket=…&sort=…).
    [viewState, setViewState] = useState<ViewState>(() =>
      viewStateFromHash(location.hash),
    ),
    // The Search page's query, from its address; null for an invalid address.
    [searchText, setSearchText] = useState(() =>
      searchTextFromHash(location.hash),
    ),
    // Bumped after each save, so search results show the change.
    [saves, setSaves] = useState(0),
    // The first image of each task and note, for card thumbnails.
    [thumbs, setThumbs] = useState<Record<string, CardThumb>>({}),
    // Wake bridges, for "Wake not received" on tasks whose wake is overdue.
    [bridges, setBridges] = useState<Row[]>([]);
  const thumbToken = useFileToken(Object.keys(thumbs).length > 0);
  // "Saved." confirms an action; it should not linger on other pages.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [serverVersion, setServerVersion] = useState<ServerVersion | null>();
  const [connection, setConnection] = useState<ConnectionState>({
    kind: "checking",
  });
  useEffect(() => {
    let alive = true;
    void crewApi
      .connection()
      .catch((): ConnectionState => ({ kind: "unknown" }))
      .then((next) => {
        if (alive) setConnection(next);
      });
    return () => {
      alive = false;
    };
  }, []);
  const copyEndpoint =
    connection.kind === "mcp" ? (
      <CopyLink
        target={connection.url}
        label="Copy address"
        copiedLabel="Address copied"
      />
    ) : null;
  const [dialog, setDialog] = useState<{
      kind: Kind;
      row?: Row;
      /** A task tab asked for by the address, with a counter to repeat it. */
      tab?: TaskTab;
      tabAsk?: number;
    } | null>(null),
    // An external agent's full session instructions, read by Start a session.
    [instructions, setInstructions] = useState<{
      name: string;
      session: AgentSession;
    } | null>(null),
    // The toast after Start a session (0.24.0).
    [sessionStart, setSessionStart] = useState<SessionStart | null>(null),
    // Set per hash navigation and consumed once, so data refreshes never open a dialog.
    [pendingLink, setPendingLink] = useState(() =>
      parseItemHash(location.hash),
    ),
    // A status column a Home tile asked the board to show; consumed once, like
    // pendingLink, after the data has loaded.
    [pendingColumn, setPendingColumn] = useState(() =>
      boardColumnFromHash(location.hash),
    ),
    // A Connect page section (#/connect?section=files) to show once.
    [pendingSection, setPendingSection] = useState(() =>
      connectSectionFromHash(location.hash),
    ),
    [highlightColumn, setHighlightColumn] = useState(""),
    columnRefs = useRef<Record<string, HTMLElement | null>>({}),
    [ready, setReady] = useState(false),
    generation = useRef(0),
    edited = useRef(false),
    busyRef = useRef(false),
    loadsInFlight = useRef(0),
    loadFailed = useRef(false);
  const discardOk = () =>
    !edited.current || window.confirm("Discard your unsaved changes?");
  // A layout effect, so the reset precedes any edit to the newly shown dialog;
  // a deferred effect could run after the first change and erase it.
  useLayoutEffect(() => {
    edited.current = false;
  }, [dialog?.kind, dialog?.row?.id]);
  // A silent load is the background refresh: it changes data only when the data
  // changed, and a failure leaves the page as it is until the next attempt.
  const load = useCallback(async ({ silent = false } = {}) => {
    const ticket = ++generation.current;
    loadsInFlight.current++;
    void crewApi
      .serverVersion()
      .then((version) => {
        if (ticket === generation.current) setServerVersion(version);
      })
      .catch(() => {
        if (!silent && ticket === generation.current) setServerVersion(null);
      });
    // One query for every card thumbnail; a failure only hides thumbnails.
    void attachmentsApi
      .cardThumbnails()
      .then((next) => {
        if (ticket !== generation.current) return;
        setThumbs((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      })
      .catch(() => undefined);
    // Wake evidence is optional: a failure only hides "Wake not received".
    void crewApi
      .read("webhook_bridges", { overdue: true })
      .then((next) => {
        if (ticket !== generation.current) return;
        setBridges((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      })
      .catch(() => undefined);
    try {
      const result = await Promise.all(
        ["agents", "buckets", "notes", "tasks", "reviews"].map(
          async (c) => [c, await crewApi.read(c)] as const,
        ),
      );
      const old = await Promise.all(
        ["agents", "buckets", "notes", "tasks"].map(
          async (c) => [c, await crewApi.read(c, { archived: true })] as const,
        ),
      );
      if (ticket !== generation.current) return;
      const keep = (next: Data) => (current: Data) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next;
      setData(keep(Object.fromEntries(result)));
      setArchived(keep(Object.fromEntries(old)));
      setReady(true);
      // A background success only clears a failed load, never a save error.
      if (!silent || loadFailed.current) {
        setError("");
        loadFailed.current = false;
      }
    } catch (e) {
      if (!silent && ticket === generation.current) {
        loadFailed.current = true;
        setError(e instanceof Error ? e.message : "Could not load workspace.");
      }
    } finally {
      loadsInFlight.current--;
      if (ticket === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || busyRef.current || loadsInFlight.current) return;
      void load({ silent: true });
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  useEffect(() => {
    const receive = () => {
      redirectLegacyAddress();
      setPendingLink(parseItemHash(location.hash));
      setPendingColumn(boardColumnFromHash(location.hash));
      setPendingSection(connectSectionFromHash(location.hash));
      if (isItemHash(location.hash)) return;
      if (!discardOk()) {
        history.forward();
        return;
      }
      setView(viewFromHash(location.hash));
      setViewState(viewStateFromHash(location.hash));
      setSearchText(searchTextFromHash(location.hash));
      setQuery("");
      setDialog(null);
    };
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  // The address follows the page state; replacing it adds no history entry and
  // fires no hashchange. An open item keeps its own address.
  useEffect(() => {
    if ((view !== "board" && view !== "memory") || isItemHash(location.hash))
      return;
    setAddress(viewStateHash(view, viewState));
  }, [view, viewState]);
  // An address naming a bucket or agent that isn't active falls back to all.
  useEffect(() => {
    if (
      ready &&
      viewState.bucket &&
      !data.buckets.some((x) => x.id === viewState.bucket)
    )
      setViewState((state) => ({ ...state, bucket: "" }));
  }, [ready, data.buckets, viewState.bucket]);
  useEffect(() => {
    if (ready && !validAssignment(viewState.assignment, data.agents))
      setViewState((state) => ({ ...state, assignment: "all" }));
  }, [ready, data.agents, viewState.assignment]);
  const assignmentFilter = validAssignment(viewState.assignment, data.agents)
    ? viewState.assignment
    : "all";
  const updateBoard = (changes: Partial<ViewState>) => {
    const next = { ...viewState, ...changes };
    pushAddress(viewStateHash("board", next));
    setViewState(next);
  };
  const setAssignmentFilter = (value: string) => updateBoard({ assignment: value });
  const holdFilter = viewState.hold;
  const setHoldFilter = (value: HoldFilter) => updateBoard({ hold: value, heldOver: "" });
  // Panel filters show as chips under the toolbar; the Filters button counts them.
  const chips = filterChips(viewState);
  const boardFiltered = assignmentFilter !== "all" || chips.length > 0;
  // `label:`, `agent:` and `status:` in the search act as filters.
  const boardSearch = parseBoardSearch(query);
  const agentNames = data.agents.map((agent) => ({ id: agent.id, name: val(agent, "name") }));
  const clearBoard = () => {
    setQuery("");
    updateBoard(clearedBoard);
  };
  // The Filters panel: closes on Escape (back to its button) or a click outside.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const filtersButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const outside = (e: Event) => {
      if (!filtersRef.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [filtersOpen]);
  useEffect(() => {
    if (view !== "board") setFiltersOpen(false);
  }, [view]);
  // Older closed tasks stay folded until asked for; not part of the address.
  const [showOlderDone, setShowOlderDone] = useState(false);
  const bucket = data.buckets.some((x) => x.id === viewState.bucket)
    ? viewState.bucket
    : "";
  const setBucket = (id: string) =>
    setViewState((state) => ({ ...state, bucket: id }));
  const openTitle =
    dialog?.row && (dialog.kind === "task" || dialog.kind === "note")
      ? val(dialog.row, "title")
      : "";
  const pageTitle = openTitle || pages.find(([key]) => key === view)?.[1];
  useLayoutEffect(() => {
    document.title = `${pageTitle} · PocketContext Crew`;
    return () => {
      document.title = "PocketContext Crew";
    };
  }, [pageTitle]);
  useEffect(() => {
    if (!pendingLink || !ready) return;
    setPendingLink(null);
    const { kind, id, tab } = pendingLink;
    const collection = kind === "task" ? "tasks" : "notes";
    const row = [...data[collection], ...archived[collection]].find(
      (x) => x.id === id,
    );
    if (!row) return;
    setAddress(itemTabPath(itemPath(kind, row), tab));
    // Navigating to the open item must not disturb its in-progress edits; a
    // tab in the address still switches to it.
    setDialog((open) =>
      open?.kind === kind && open.row?.id === id
        ? tab
          ? { ...open, tab, tabAsk: (open.tabAsk || 0) + 1 }
          : open
        : { kind, row, tab },
    );
  }, [pendingLink, ready, data, archived]);
  // The section query is consumed once: drop it from the address so a refresh
  // or Back does not scroll again.
  useEffect(() => {
    if (pendingSection && view === "connect") setAddress(viewHashes.connect);
  }, [pendingSection, view]);
  const sectionShown = useCallback(() => setPendingSection(null), []);
  // Bring the asked-for column into view, focus it and highlight it briefly.
  // The address effect above has already dropped `column` from the address, so
  // a refresh or Back does not repeat this.
  useEffect(() => {
    if (!pendingColumn || !ready) return;
    setPendingColumn(null);
    const column = columnRefs.current[pendingColumn];
    if (view !== "board" || !column) return;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    column.scrollIntoView?.({
      behavior: reduce ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
    column.focus({ preventScroll: true });
    setHighlightColumn(pendingColumn);
  }, [pendingColumn, ready, view]);
  useEffect(() => {
    if (!highlightColumn) return;
    const timer = setTimeout(() => setHighlightColumn(""), 1200);
    return () => clearTimeout(timer);
  }, [highlightColumn]);
  const dismissSessionStart = useCallback(() => setSessionStart(null), []);
  const openItem = (kind: ItemKind, row: Row) => {
    pushAddress(itemPath(kind, row));
    setDialog({ kind, row });
  };
  const closeDialog = () => {
    if (isItemHash(location.hash))
      pushAddress(
        view === "search" && searchText
          ? searchHash(searchText)
          : viewStateHash(view, viewState),
      );
    setDialog(null);
  };
  // A hit is compact, so open the loaded record; one newer than the last load
  // is read by id first.
  const openHit = async (hit: SearchHit, inArchive = false) => {
    const kind: ItemKind = hit.collection === "tasks" ? "task" : "note";
    const row = [...data[hit.collection], ...archived[hit.collection]].find(
      (x) => x.id === hit.id,
    );
    if (row) return openItem(kind, row);
    try {
      const [fresh] = await crewApi.read(hit.collection, {
        id: hit.id,
        archived: inArchive,
      });
      if (!fresh) throw new Error("missing");
      openItem(kind, fresh);
      void load({ silent: true });
    } catch {
      setNotice(`That ${kind} couldn't be opened. It may have just changed; try again.`);
    }
  };
  const perform = async (work: () => Promise<unknown>, message = "Saved.") => {
    setBusy(true);
    busyRef.current = true;
    loadFailed.current = false;
    setError("");
    setNotice("");
    try {
      await work();
      await load();
      setSaves((n) => n + 1);
      setNotice(message);
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Refresh and try again.",
      );
      return false;
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };
  const save = async (
    action: string,
    fields: Record<string, unknown>,
    row?: Row,
    reason = "",
  ) => {
    // A changed draft withdraws a pending approval; say so, as file changes do.
    const withdraws =
      action === "task.update" &&
      !!row &&
      typeof fields.draft === "string" &&
      fields.draft !== val(row, "draft") &&
      data.reviews.some(
        (x) => val(x, "task") === row.id && val(x, "status") === "pending",
      );
    if (
      await perform(
        () => crewApi.write(action, fields, row, reason),
        withdraws ? `Saved. ${withdrawnNotice}` : "Saved.",
      )
    )
      closeDialog();
  };
  // After a file change withdrew an approval the task has a new revision; the
  // open form takes it so its next save does not conflict.
  const refreshDialogRow = async (kind: ItemKind, id: string) => {
    try {
      const [fresh] = await crewApi.read(kind === "task" ? "tasks" : "notes", {
        id,
      });
      if (fresh)
        setDialog((open) =>
          open && open.kind === kind && open.row?.id === id
            ? { ...open, row: fresh }
            : open,
        );
    } catch {
      /* The next save reports a conflict instead. */
    }
  };
  const name = (id: string, c = "agents") =>
    val(
      [...data[c], ...(archived[c] || [])].find((x) => x.id === id),
      "name",
    ) || (id ? "Unavailable agent" : "Unassigned");
  const invalidAssignment = (task: Row) => {
    const id = val(task, "assigned_agent");
    return !!id && !data.agents.some((agent) => agent.id === id);
  };
  const openTasks = data.tasks.filter((task) => !isClosed(task));
  const unassignedCount = openTasks.filter(
    (task) => !val(task, "assigned_agent"),
  ).length;
  const invalidCount = openTasks.filter(invalidAssignment).length;
  const onHoldCount = openTasks.filter(onHold).length;
  const wakeMissing = new Set(
    strandedWakes(bridges, data.tasks, data.agents).map((x) => x.task.id),
  );
  // One filter option per active agent; its count is the cards it shows.
  const agentOptions = [...data.agents]
    .sort((a, b) => byName(val(a, "name"), val(b, "name")))
    .map((agent) => ({
      agent,
      count: data.tasks.filter((x) => val(x, "assigned_agent") === agent.id)
        .length,
    }));
  const labelsAvailable = knownLabels(data.tasks);
  const pending = data.reviews.filter((x) => val(x, "status") === "pending");
  const matches = (x: Row) =>
    [
      val(x, "title"),
      val(x, "description"),
      val(x, "body"),
      ...list(x, "labels"),
    ]
      .join(" ")
      .toLowerCase()
      .includes(boardSearch.text.toLowerCase()) &&
    tokensMatch(boardSearch.tokens, x, agentNames);
  // Every filter but the column; the columns split these by status.
  const boardTasks = data.tasks.filter(
    (x) =>
      matches(x) &&
      assignmentMatches(assignmentFilter, x, invalidAssignment) &&
      holdMatches(holdFilter, x) &&
      labelMatches(viewState.label, x) &&
      statusMatches(viewState.status, x) &&
      (!viewState.heldOver || isLongHeld(x)),
  );
  const boardSearched = boardSearch.text !== "" || boardSearch.tokens.length > 0;
  // A label chosen (filter or search) shows its older closed tasks too, so a
  // release-0.21.0 label finds that release's work.
  const labelChosen =
    viewState.label !== "" || boardSearch.tokens.some((t) => t.key === "label");
  // Note count and latest note update per bucket, for the cards and their sorts.
  const bucketStats = new Map<string, { count: number; latest: string }>();
  for (const note of data.notes) {
    const id = val(note, "bucket");
    const stats = bucketStats.get(id) ?? { count: 0, latest: "" };
    stats.count++;
    if (String(note.updated || "") > stats.latest)
      stats.latest = String(note.updated || "");
    bucketStats.set(id, stats);
  }
  const sortedBuckets = [...data.buckets].sort((a, b) => {
    const [sa, sb] = [bucketStats.get(a.id), bucketStats.get(b.id)];
    const order =
      viewState.bucketSort === "notes"
        ? (sb?.count ?? 0) - (sa?.count ?? 0)
        : viewState.bucketSort === "activity"
          ? byNewest(sa?.latest, sb?.latest)
          : 0;
    return order || byName(val(a, "name"), val(b, "name"));
  });
  const shownNotes = data.notes
    .filter((x) => !bucket || val(x, "bucket") === bucket)
    .sort((a, b) => {
      const sort = viewState.noteSort;
      const order =
        sort === "title"
          ? byName(val(a, "title"), val(b, "title"))
          : sort === "created"
            ? byNewest(a.created, b.created)
            : sort === "bucket"
              ? byName(
                  name(val(a, "bucket"), "buckets"),
                  name(val(b, "bucket"), "buckets"),
                )
              : 0;
      return (
        order ||
        byNewest(a.updated, b.updated) ||
        byName(val(a, "title"), val(b, "title"))
      );
    });
  const seed = () =>
    perform(async () => {
      for (const [n, purpose] of [
        ["Build", "Product plans, priorities and technical decisions."],
        ["Deploy", "Release preparation and deployment decisions."],
        ["Design", "Brand, voice and visual direction."],
        ["Learn", "Research, trusted sources and useful findings."],
        ["Network", "Audience, messaging, outreach and posting voice."],
      ]) {
        const agents = await crewApi.read("agents");
        const agent =
          agents.find((x) => val(x, "name") === n) ||
          (await crewApi.write("agent.create", {
            name: n,
            brief: `Read relevant notes before work. Maintain ${n.toUpperCase()}; request changes elsewhere through tasks. Record progress in tasks and save durable decisions and findings only. Submit drafts for human review. The owner performs external actions.`,
          }));
        const buckets = await crewApi.read("buckets");
        const b =
          buckets.find((x) => val(x, "name") === n.toUpperCase()) ||
          (await crewApi.write("bucket.create", {
            name: n.toUpperCase(),
            purpose,
            responsible_agent: agent.id,
          }));
        const notes = await crewApi.read("notes");
        if (
          !notes.some(
            (x) =>
              val(x, "bucket") === b.id &&
              val(x, "title") === "About this bucket",
          )
        )
          await crewApi.write("note.create", {
            bucket: b.id,
            title: "About this bucket",
            body: `${purpose}\n\nResponsible agent: ${n}. All agents can read this bucket. Save durable decisions and useful findings.`,
            links: [],
          });
      }
    }, "Your five starter agents and their buckets are ready.");
  const archivedRow =
    dialog?.row && (dialog.kind === "task" || dialog.kind === "note")
      ? archived[`${dialog.kind}s`].find((x) => x.id === dialog.row?.id)
      : undefined;
  const archiveNotice = !archivedRow
    ? ""
    : dialog?.kind === "note" && !archivedRow.archived
      ? "This note is read-only because its bucket is archived. Restore the bucket from the Archive view to make changes."
      : `This ${dialog?.kind} is archived and read-only. Restore it from the Archive view to make changes.`;
  const descriptions = {
    home: "Where you and your AI agents share tasks and notes. Agents do the work; you decide what's approved.",
    board: "Follow each task from request to finished work. Agents draft; you decide what's approved.",
    memory: "Decisions, preferences and findings every agent can find.",
    reviews:
      "Review the exact draft. Approval never sends or publishes anything.",
    agents:
      "Give each agent a name and a brief that says what it works on and what to remember.",
    archive: "Restore notes, tasks and buckets without losing their history.",
    connect: "Crew needs one connection to your agent platform before agents can work here.",
    guide: "What Crew does, what each page is for, and the words it uses.",
    search: "Every task, note, agent and bucket that matches your words.",
    shared:
      "Frozen copies of notes, shared by a secret link with no sign-in. Agents draft them; only you publish, update, expire, revoke or archive them. Editing a source note never changes a published page.",
  };
  const titleHelp = viewHelp[view];
  return (
    <HelpModeContext.Provider value={helpMode(connection)}>
    <div className="crew-app">
      <aside className="crew-sidebar">
        <a
          className="crew-logo"
          href={viewHashes.home}
          aria-label="PocketContext Crew, go to Home"
        >
          <Brand />
          <strong>Crew</strong>
        </a>
        <nav aria-label="Workspace">
          {nav.map(([key, label, icon]) => (
            <a
              key={key}
              href={viewHashes[key]}
              aria-current={view === key ? "page" : undefined}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {key === "reviews" && pending.length > 0 && (
                <b>{pending.length}</b>
              )}
            </a>
          ))}
        </nav>
        <div className="crew-sidebar-bottom">
          <a
            className="crew-sidebar-link"
            href={viewHashes.connect}
            aria-current={view === "connect" ? "page" : undefined}
          >
            Connect an agent
          </a>
          <a
            className="crew-sidebar-link"
            href={viewHashes.guide}
            aria-current={view === "guide" ? "page" : undefined}
          >
            Guide
          </a>
          <span />
          One owner. One shared context.
          <button onClick={() => api.logout()}>Sign out</button>
        </div>
      </aside>
      <main className="crew-main">
        <header className="crew-topbar">
          <span>POCKETCONTEXT / CREW</span>
          <div>
            <GlobalSearch
              agents={data.agents}
              buckets={data.buckets}
              pageText={view === "search" ? searchText : null}
              disabled={dialog !== null}
              onOpenHit={(hit) => void openHit(hit)}
              onOpenAgent={(row) => setDialog({ kind: "agent", row })}
              onOpenBucket={(row) => setDialog({ kind: "bucket", row })}
            />
            <button
              className="crew-refresh"
              aria-label="Refresh"
              title="Refresh"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              <span aria-hidden="true">↻</span>
            </button>
          </div>
        </header>
        <section className="crew-content">
          <div className="crew-heading">
            <div>
              <p className="crew-eyebrow">{eyebrows[view]}</p>
              <div className="crew-title-row">
                <h1>{pages.find((x) => x[0] === view)?.[1]}</h1>
                {titleHelp && <Help topic={titleHelp} />}
              </div>
              <p>{descriptions[view]}</p>
            </div>
            {view === "board" && (
              <button
                className="crew-primary"
                onClick={() => setDialog({ kind: "task" })}
              >
                ＋ New task
              </button>
            )}
            {view === "memory" && (
              <div className="crew-actions">
                <button onClick={() => setDialog({ kind: "bucket" })}>
                  New bucket
                </button>
                <button
                  className="crew-primary"
                  disabled={!data.buckets.length}
                  onClick={() => setDialog({ kind: "note" })}
                >
                  ＋ New note
                </button>
              </div>
            )}
            {view === "agents" && (
              <button
                className="crew-primary"
                onClick={() => setDialog({ kind: "agent" })}
              >
                ＋ New agent
              </button>
            )}
          </div>
          {error && (
            <div className="crew-alert" role="alert">
              {error}{" "}
              <button onClick={() => void load()}>Reload workspace</button>
            </div>
          )}
          {notice && (
            <p className="crew-notice" role="status">
              {notice}
            </p>
          )}
          {loading && view !== "guide" && (
            <p role="status">Loading your workspace…</p>
          )}
          {!loading &&
            !data.agents.length &&
            !data.buckets.length &&
            view !== "archive" &&
            view !== "home" &&
            view !== "search" &&
            view !== "guide" && (
              <div className="crew-welcome">
                <div>
                  <span className="crew-eyebrow">START WITH A SMALL CREW</span>
                  <h2>A shared brief for every agent.</h2>
                  <p>
                    Create Build, Deploy, Design, Learn and Network with a
                    bucket each. Edit their briefs to fit your work.
                  </p>
                </div>
                <button
                  className="crew-primary"
                  disabled={busy}
                  onClick={() => void seed()}
                >
                  Set up starter crew
                </button>
              </div>
            )}
          {view === "board" && (
            <div className="crew-toolbar">
              <label className="crew-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  aria-label="Search tasks"
                  placeholder="Search tasks, or label:bug…"
                  title="Search titles, descriptions and labels. label:, agent: and status: filter; Enter turns them into filter chips."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const { text, changes } = commitBoardSearch(query, agentNames);
                    if (!Object.keys(changes).length) return;
                    e.preventDefault();
                    setQuery(text);
                    updateBoard(changes);
                  }}
                />
              </label>
              <select
                aria-label="Filter by assignment"
                value={assignmentFilter}
                onChange={(e) => setAssignmentFilter(e.target.value)}
              >
                <option value="all">All tasks</option>
                <option value="unassigned">
                  Unassigned ({unassignedCount})
                </option>
                <option value="invalid">
                  Invalid assignments ({invalidCount})
                </option>
                {agentOptions.length > 0 && (
                  <optgroup label="By agent">
                    {agentOptions.map(({ agent, count }) => (
                      <option key={agent.id} value={agent.id}>
                        {val(agent, "name")}
                        {agentKindSuffix[agentKind(agent)]} ({count})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div
                className="crew-filters"
                ref={filtersRef}
                onKeyDown={(e) => {
                  if (e.key !== "Escape" || !filtersOpen) return;
                  e.stopPropagation();
                  setFiltersOpen(false);
                  filtersButton.current?.focus();
                }}
              >
                <button
                  type="button"
                  ref={filtersButton}
                  className={chips.length ? "crew-filters-button active" : "crew-filters-button"}
                  aria-expanded={filtersOpen}
                  aria-controls="crew-filters-panel"
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  Filters{chips.length ? ` · ${chips.length}` : ""}
                </button>
                {filtersOpen && (
                  <div
                    id="crew-filters-panel"
                    className="crew-filters-panel"
                    role="group"
                    aria-label="Task filters"
                  >
                    <label className="crew-field">
                      <span>Readiness</span>
                      <select
                        aria-label="Filter by hold"
                        value={holdFilter}
                        onChange={(e) => setHoldFilter(e.target.value as HoldFilter)}
                      >
                        {holdFilters.map((key) => (
                          <option key={key} value={key}>
                            {holdFilterLabels[key]}
                            {key === "on_hold"
                              ? ` (${onHoldCount})`
                              : key === "ready"
                                ? ` (${openTasks.length - onHoldCount})`
                                : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="crew-filters-check">
                      <input
                        type="checkbox"
                        checked={!!viewState.heldOver}
                        onChange={(e) =>
                          updateBoard(
                            e.target.checked
                              ? { hold: "on_hold", heldOver: "3d" }
                              : { heldOver: "" },
                          )
                        }
                      />
                      On hold over 3 days ({longHolds(data.tasks).length})
                    </label>
                    <label className="crew-field">
                      <span>Label</span>
                      <select
                        aria-label="Filter by label"
                        value={viewState.label.toLowerCase()}
                        onChange={(e) => updateBoard({ label: e.target.value })}
                      >
                        <option value="">All labels</option>
                        {viewState.label &&
                          !labelsAvailable.some(
                            (x) => x.label.toLowerCase() === viewState.label.toLowerCase(),
                          ) && (
                            <option value={viewState.label.toLowerCase()}>
                              {viewState.label} (0)
                            </option>
                          )}
                        {labelsAvailable.map(({ label, count }) => (
                          <option key={label.toLowerCase()} value={label.toLowerCase()}>
                            {label} ({count})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="crew-field">
                      <span>Status</span>
                      <select
                        aria-label="Filter by status"
                        value={viewState.status}
                        onChange={(e) => updateBoard({ status: e.target.value })}
                      >
                        <option value="">All statuses</option>
                        {boardStatuses.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="crew-field">
                      <span>Sort</span>
                      <select
                        aria-label="Sort tasks"
                        value={viewState.taskSort}
                        onChange={(e) =>
                          updateBoard({ taskSort: e.target.value as ViewState["taskSort"] })
                        }
                      >
                        <option value="updated">Last updated, newest first</option>
                        <option value="held">Oldest hold first</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="crew-filters-done"
                      onClick={() => {
                        setFiltersOpen(false);
                        filtersButton.current?.focus();
                      }}
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {view === "board" && (boardFiltered || boardSearched) && (
            <div className="crew-filter-chips" role="group" aria-label="Active filters">
              {chips.map((chip) => (
                <span className="crew-chip crew-filter-chip" key={chip.key}>
                  {chip.label}
                  <button
                    type="button"
                    aria-label={`Remove filter ${chip.label}`}
                    onClick={() => updateBoard(chip.clear)}
                  >
                    ×
                  </button>
                </span>
              ))}
              <span className="crew-filter-count" role="status">
                {boardTasks.length} {boardTasks.length === 1 ? "task" : "tasks"}
              </span>
              <button type="button" className="crew-clear-filters" onClick={clearBoard}>
                Clear all
              </button>
            </div>
          )}
          {view === "home" && (
            <Home
              data={data}
              archived={archived}
              pending={pending}
              ready={ready}
              busy={busy}
              seed={() => void seed()}
              newTask={() => setDialog({ kind: "task" })}
              openItem={openItem}
              openReview={(row) => setDialog({ kind: "review", row })}
              invalidAssignment={invalidAssignment}
              connection={connection}
              copyEndpoint={copyEndpoint}
              onStartSession={setSessionStart}
            />
          )}
          {view === "guide" && <Guide />}
          {view === "shared" && (
            <Shared
              notes={[...data.notes, ...archived.notes]}
              tasks={[...data.tasks, ...archived.tasks]}
              focus={sharedFocusFromHash(location.hash)}
              Prose={Prose}
            />
          )}
          {view === "search" && (
            <SearchPage
              text={searchText}
              agents={data.agents}
              buckets={data.buckets}
              refreshKey={saves}
              onOpenHit={(hit, inArchive) => void openHit(hit, inArchive)}
              onOpenAgent={(row) => setDialog({ kind: "agent", row })}
              onOpenBucket={(row) => setDialog({ kind: "bucket", row })}
            />
          )}
          {view === "connect" && (
            <Connect
              agents={[...data.agents, ...archived.agents]}
              tasks={[...data.tasks, ...archived.tasks]}
              notes={[...data.notes, ...archived.notes]}
              connection={connection}
              copyEndpoint={copyEndpoint}
              section={pendingSection}
              onSectionShown={sectionShown}
            />
          )}
          {view === "board" && (
            <div className="crew-board">
              {boardStatuses.map(([status, label]) => {
                // The Done column holds every closed task: Done and Won't do.
                const tasks = boardTasks.filter((x) =>
                  status === "done" ? isClosed(x) : val(x, "status") === status,
                );
                tasks.sort((a, b) => viewState.taskSort === "held"
                  ? (onHold(a) && !isClosed(a) ? heldSince(a) || Infinity : Infinity) - (onHold(b) && !isClosed(b) ? heldSince(b) || Infinity : Infinity)
                  : val(b, "updated").localeCompare(val(a, "updated")));
                // Older closed tasks fold away unless a label is chosen or
                // the owner asks for them.
                const done =
                  status === "done"
                    ? doneColumn(tasks, showOlderDone || labelChosen || viewState.status === "done")
                    : null;
                const card = (x: Row) => (
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openItem("task", x); }
                    }}
                    className="crew-task-card"
                    key={x.id}
                    onClick={() => openItem("task", x)}
                  >
                    <div className="crew-tags">
                      {val(x, "status") === "wont_do" && (
                        <span className="crew-wont-do">Won't do</span>
                      )}
                      {!isClosed(x) && <HoldChip task={x} />}
                      <ClaimChip task={x} />
                      {wakeMissing.has(x.id) && <WakeMissingChip />}
                      {pending.some((r) => val(r, "task") === x.id) && (
                        <span className="crew-human">Human</span>
                      )}
                      {x.handoff_limited === true && (
                        <span
                          className="crew-human"
                          title="Stopped after too many consecutive agent reassignments. Review it, then set Ready."
                        >
                          Handoff limit
                        </span>
                      )}
                      {Number(x.comment_wake_generation) > 0 &&
                        Number(x.comment_wake_generation) ===
                          Number(x.wake_generation) && (
                          <span title="Your comment wakes the assignee when the current execution finishes.">
                            Comment wake pending
                          </span>
                        )}
                      {list(x, "labels").filter((l) => !val(x, "assigned_agent") || l.toLowerCase() !== name(val(x, "assigned_agent")).toLowerCase()).map((l) => (
                        <button type="button" className="crew-chip crew-label-filter" key={l}
                          aria-label={`Filter by label ${l}`}
                          onClick={(e) => { e.stopPropagation(); updateBoard({ label: l }); }}>
                          {l}
                        </button>
                      ))}
                    </div>
                    {thumbs[x.id] && (
                      <CardThumbnail
                        thumb={thumbs[x.id]}
                        token={thumbToken}
                      />
                    )}
                    <h3>{val(x, "title")}</h3>
                    <p>{plainPreview(val(x, "description")).slice(0, 150)}</p>
                    {invalidAssignment(x) && (
                      <p className="crew-assignment-warning">
                        Assigned agent is inactive or unavailable. Reassign
                        this task.
                      </p>
                    )}
                    <footer>
                      <span className="crew-avatar">
                        {name(val(x, "assigned_agent")).slice(0, 1)}
                      </span>
                      {name(val(x, "assigned_agent"))}
                    </footer>
                  </div>
                );
                return (
                  <section
                    className={
                      highlightColumn === status
                        ? "crew-column crew-column-highlight"
                        : "crew-column"
                    }
                    key={status}
                    ref={(el) => {
                      columnRefs.current[status] = el;
                    }}
                    tabIndex={-1}
                    aria-labelledby={`crew-column-${status}`}
                  >
                    <div className="crew-column-head">
                      <h2 id={`crew-column-${status}`}>
                        <i className={status} />
                        {label}
                        <span>{tasks.length}</span>
                      </h2>
                      <Help topic={statusHelp[status]} />
                    </div>
                    {(done ? done.tasks : tasks).map(card)}
                    {done && done.older > 0 && (
                      <button
                        type="button"
                        className="crew-show-older"
                        onClick={() => setShowOlderDone(true)}
                        title="Closed tasks not changed in the last 7 days"
                      >
                        Show older ({done.older})
                      </button>
                    )}
                    {!tasks.length && (
                      <div className="crew-column-empty">
                        {boardSearched || boardFiltered ? (
                          "No matching tasks"
                        ) : status === "todo" ? (
                          <>
                            <p>New tasks start here.</p>
                            <button onClick={() => setDialog({ kind: "task" })}>
                              ＋ Add a task
                            </button>
                          </>
                        ) : status === "in_progress" ? (
                          "Tasks being worked on appear here."
                        ) : status === "needs_review" ? (
                          "Drafts sent for your approval appear here."
                        ) : (
                          "Finished tasks appear here."
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {view === "memory" && (
            <>
              <div className="crew-section-title crew-section-title-first">
                <h2>Buckets</h2>
                <Help topic="bucket" />
                <span>Groups of notes</span>
                <div className="crew-section-tools">
                  <select
                    aria-label="Sort buckets"
                    value={viewState.bucketSort}
                    onChange={(e) =>
                      setViewState((state) => ({
                        ...state,
                        bucketSort: e.target.value as BucketSort,
                      }))
                    }
                  >
                    {bucketSorts.map((key) => (
                      <option key={key} value={key}>
                        {bucketSortLabels[key]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="crew-buckets">
                {sortedBuckets.map((x) => {
                  const selected = x.id === bucket;
                  const count = bucketStats.get(x.id)?.count ?? 0;
                  return (
                    // Two sibling buttons: the card filters, Edit opens the bucket.
                    <div
                      className={`crew-bucket-card${selected ? " selected" : ""}`}
                      key={x.id}
                    >
                      <button
                        type="button"
                        className="crew-bucket-filter"
                        aria-pressed={selected}
                        title={val(x, "purpose") || undefined}
                        onClick={() => setBucket(selected ? "" : x.id)}
                      >
                        <span aria-hidden="true">▤</span>
                        <h2>{val(x, "name")}</h2>
                        <small>
                          {name(val(x, "responsible_agent"))} · responsible
                          agent
                        </small>
                        <small className="crew-bucket-count">
                          {count} {count === 1 ? "note" : "notes"}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="crew-bucket-edit"
                        aria-label={`Edit bucket ${val(x, "name")}`}
                        onClick={() => setDialog({ kind: "bucket", row: x })}
                      >
                        Edit
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="crew-section-title">
                <h2>Notes</h2>
                <Help topic="note" />
                <span>Useful context, with a history</span>
                <div className="crew-section-tools">
                  <select
                    aria-label="Filter by bucket"
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                  >
                    <option value="">All buckets</option>
                    {data.buckets.map((x) => (
                      <option key={x.id} value={x.id}>
                        {val(x, "name")}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Sort notes"
                    value={viewState.noteSort}
                    onChange={(e) =>
                      setViewState((state) => ({
                        ...state,
                        noteSort: e.target.value as NoteSort,
                      }))
                    }
                  >
                    {noteSorts.map((key) => (
                      <option key={key} value={key}>
                        {noteSortLabels[key]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="crew-notes">
                {shownNotes.map((x) => (
                  <button
                    className="crew-note-card"
                    key={x.id}
                    onClick={() => openItem("note", x)}
                  >
                    <span className="crew-eyebrow">
                      {name(val(x, "bucket"), "buckets")}
                    </span>
                    {thumbs[x.id] && (
                      <CardThumbnail thumb={thumbs[x.id]} token={thumbToken} />
                    )}
                    <h3>{val(x, "title")}</h3>
                    <p>{plainPreview(val(x, "body")).slice(0, 180)}</p>
                    <small>
                      Revision {x.revision} · {when(x.updated)}
                    </small>
                  </button>
                ))}
              </div>
              {!shownNotes.length && (
                <Empty
                  title={bucket ? "No notes in this bucket" : "No notes yet"}
                  action={
                    bucket ? (
                      <button onClick={() => setBucket("")}>
                        Show all buckets
                      </button>
                    ) : data.buckets.length ? (
                      <button
                        className="crew-primary"
                        onClick={() => setDialog({ kind: "note" })}
                      >
                        Add your first note
                      </button>
                    ) : (
                      <button onClick={() => setDialog({ kind: "bucket" })}>
                        New bucket
                      </button>
                    )
                  }
                >
                  {bucket
                    ? "Add one with New note, or show the notes in every bucket."
                    : data.buckets.length
                      ? "Notes hold decisions, preferences and findings your agents should remember."
                      : "Notes live in buckets. Create a bucket first, then add notes to it."}
                </Empty>
              )}
            </>
          )}
          {view === "reviews" && (
            <>
              <div className="crew-review-list">
                {pending.map((x) => {
                  const title =
                    val(
                      data.tasks.find((t) => t.id === val(x, "task")),
                      "title",
                    ) || "Task draft";
                  return (
                    // The whole card opens the review; nothing inside is interactive.
                    <button
                      type="button"
                      className="crew-review-card"
                      key={x.id}
                      aria-label={`Review draft: ${title}`}
                      aria-describedby={`review-preview-${x.id}`}
                      onClick={() => setDialog({ kind: "review", row: x })}
                    >
                      <small className="crew-review-date">
                        {when(x.created)}
                      </small>
                      <h2>{title}</h2>
                      <p
                        className="crew-review-preview"
                        id={`review-preview-${x.id}`}
                      >
                        {plainPreview(val(x, "draft")).slice(0, 600)}
                      </p>
                    </button>
                  );
                })}
              </div>
              {!pending.length && (
                <Empty
                  title="Nothing waiting for your review"
                  action={<a href={viewHashes.board}>Go to Tasks</a>}
                >
                  Drafts sent for approval will appear here. Your approval does
                  not perform the external action.
                </Empty>
              )}
              <details className="crew-history-list">
                <summary>
                  Past decisions ({data.reviews.length - pending.length})
                </summary>
                {data.reviews
                  .filter((x) => val(x, "status") !== "pending")
                  .map((x) => (
                    <button
                      key={x.id}
                      onClick={() => setDialog({ kind: "review", row: x })}
                    >
                      <span>
                        {val(
                          data.tasks.find((t) => t.id === val(x, "task")),
                          "title",
                        ) || "Task draft"}
                      </span>
                      <span>{val(x, "status").replaceAll("_", " ")}</span>
                    </button>
                  ))}
              </details>
            </>
          )}
          {view === "agents" && (
            <>
              <div className="crew-callout">
                Every connected agent can read and write all notes. Each agent's
                brief says where it should add things.
              </div>
              {!data.agents.length && !!data.buckets.length && (
                <Empty
                  title="No agents yet"
                  action={
                    <button
                      className="crew-primary"
                      onClick={() => setDialog({ kind: "agent" })}
                    >
                      Add your first agent
                    </button>
                  }
                >
                  An agent is a role with a brief that tells it what to work on.
                </Empty>
              )}
              <div className="crew-agents">
                {data.agents.map((x) => (
                  <div className="crew-agent-tile" key={x.id}>
                    <button
                      className="crew-agent-card"
                      onClick={() => setDialog({ kind: "agent", row: x })}
                    >
                      <span className="crew-avatar">
                        {agentInitials(val(x, "name"), data.agents)}
                      </span>
                      <h2>{val(x, "name")}</h2>
                      {agentKindCardLabel[agentKind(x)] && (
                        <small className="crew-agent-kind">
                          {agentKindCardLabel[agentKind(x)]}
                        </small>
                      )}
                      {/* A preview: one paragraph clamped to whole lines. */}
                      <p title={val(x, "brief") || undefined}>
                        {val(x, "brief").replace(/\s+/g, " ").trim()}
                      </p>
                    </button>
                    {agentKind(x) === "external" && (
                      <StartSession agent={x} onStart={setSessionStart} />
                    )}
                  </div>
                ))}
              </div>
              <a className="crew-agents-connect" href={viewHashes.connect}>
                Connect these agents to your platform →
              </a>
            </>
          )}
          {view === "archive" && (
            <>
              {(["notes", "tasks", "buckets", "agents"] as const).map((c) => (
                <section className="crew-archive-section" key={c}>
                  <h2>
                    {c === "agents" ? "Inactive agents" : `Archived ${c}`}
                  </h2>
                  {!archived[c].length && (
                    <p>
                      {c === "agents"
                        ? "No inactive agents. Deactivated agents appear here."
                        : `No archived ${c}. Anything you archive appears here and can be restored.`}
                    </p>
                  )}
                  {archived[c].map((x) => (
                    <div className="crew-archive-row" key={x.id}>
                      <div>
                        <strong>{val(x, "title") || val(x, "name")}</strong>
                        <small>
                          {c === "notes" && !x.archived
                            ? "Hidden by its archived bucket. Restore the bucket first."
                            : `Revision ${x.revision}`}
                        </small>
                      </div>
                      <button
                        disabled={busy || (c === "notes" && !x.archived)}
                        onClick={() =>
                          void perform(
                            () =>
                              crewApi.write(
                                `${c === "buckets" ? "bucket" : c === "agents" ? "agent" : c === "tasks" ? "task" : "note"}.update`,
                                { archived: false },
                                x,
                              ),
                            "Restored. Prior approvals were not reactivated.",
                          )
                        }
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </section>
              ))}
              <p className="crew-footnote">
                Archived records remain in history and backups. Permanent
                deletion is not available.
              </p>
            </>
          )}
        </section>
        <footer
          className="crew-server-version"
          role="contentinfo"
          aria-label="Running server"
        >
          <span>
            {serverVersion === undefined ? (
              "Checking server version…"
            ) : serverVersion === null ? (
              "Server version unavailable"
            ) : (
              <>
                Server {serverVersion.version}
                {serverVersion.commit && (
                  <>
                    {" · Build "}
                    <span
                      title={serverVersion.commit}
                      role="note"
                      aria-label={`Build ${serverVersion.commit}`}
                    >
                      {serverVersion.commit.slice(0, 12)}
                    </span>
                  </>
                )}
              </>
            )}
          </span>
          <button className="crew-footer-signout" onClick={() => api.logout()}>
            Sign out
          </button>
        </footer>
      </main>
      {sessionStart && (
        <SessionToast
          key={`${sessionStart.name}-${sessionStart.state}-${sessionStart.prompt}`}
          start={sessionStart}
          dismiss={dismissSessionStart}
          view={() => {
            const { name, session } = sessionStart;
            setSessionStart(null);
            void session?.then(
              (next) => setInstructions({ name, session: next }),
              () => undefined,
            );
          }}
        />
      )}
      {instructions && (
        <Modal
          title={`Session instructions for ${instructions.name}`}
          actions={
            <CopyLink
              target={instructions.session.prompt}
              label="Copy prompt"
              copiedLabel="Prompt copied"
            />
          }
          close={() => setInstructions(null)}
          onEdit={() => undefined}
        >
          {/* Copy prompt and the session itself always read the latest
              saved revision; edits here replace the shown session. */}
          <SessionInstructions
            session={instructions.session}
            onChange={(session) =>
              setInstructions((open) => (open ? { ...open, session } : open))
            }
            Markdown={Prose}
          />
        </Modal>
      )}
      {dialog && (
        <Modal
          title={
            dialog.kind === "review"
              ? "Review draft"
              : archiveNotice
                ? `Archived ${dialog.kind}`
                : dialog.row && dialog.kind === "note"
                  ? "Note"
                  : `${dialog.row ? "Edit" : "New"} ${dialog.kind}`
          }
          actions={
            dialog.row &&
            (dialog.kind === "task" || dialog.kind === "note") && (
              <>
                <CopyLink
                  key={dialog.row.id}
                  target={itemShareUrl(dialog.kind, dialog.row)}
                />
                {dialog.kind === "note" && !archiveNotice && (
                  <ShareAsArtifact
                    note={dialog.row}
                    done={(id) => {
                      closeDialog();
                      location.hash = `${viewHashes.shared}/${id}`;
                    }}
                  />
                )}
              </>
            )
          }
          onEdit={() => {
            edited.current = true;
          }}
          close={() => {
            if (!busy && discardOk()) closeDialog();
          }}
        >
          <Editor
            key={`${dialog.kind}-${dialog.row?.id || "new"}`}
            {...dialog}
            data={{
              ...data,
              agents: [...data.agents, ...archived.agents],
              buckets: [...data.buckets, ...archived.buckets],
              notes: [...data.notes, ...archived.notes],
              tasks: [...data.tasks, ...archived.tasks],
            }}
            archiveNotice={archiveNotice}
            onEdit={() => {
              edited.current = true;
            }}
            openRelated={(kind, target) => {
              if (target.id === dialog.row?.id || !discardOk()) return;
              openItem(kind, target);
            }}
            wakeMissing={
              dialog.kind === "task" && !!dialog.row && wakeMissing.has(dialog.row.id)
            }
            busy={busy}
            error={error}
            save={save}
            perform={perform}
            close={closeDialog}
            refresh={() => void load({ silent: true })}
            onWithdrawn={(kind, id) => void refreshDialogRow(kind, id)}
            refreshRow={() => {
              if (dialog.row && (dialog.kind === "task" || dialog.kind === "note"))
                void refreshDialogRow(dialog.kind, dialog.row.id);
            }}
          />
        </Modal>
      )}
    </div>
    </HelpModeContext.Provider>
  );
}
type EditorProps = {
  kind: Kind;
  row?: Row;
  /** The task tab the address asked for, and a counter to switch again. */
  tab?: TaskTab;
  tabAsk?: number;
  data: Data;
  archiveNotice?: string;
  onEdit: () => void;
  /** Opens a related task or note, after confirming unsaved changes. */
  openRelated: (kind: ItemKind, row: Row) => void;
  /** An overdue wake for this task was never received. */
  wakeMissing?: boolean;
  busy: boolean;
  error: string;
  save: (
    action: string,
    fields: Record<string, unknown>,
    row?: Row,
    reason?: string,
  ) => Promise<void>;
  perform: (work: () => Promise<unknown>, message?: string) => Promise<boolean>;
  close: () => void;
  /** Background reload after a file change (card thumbnails, task status). */
  refresh?: () => void;
  /** A file change withdrew this item's pending approval. */
  onWithdrawn?: (kind: ItemKind, id: string) => void;
  /** Rereads the open record after a change made outside the form. */
  refreshRow?: () => void;
};
/** The form's field values for a record (or a new one). */
function formValues(kind: Kind, row: Row | undefined, data: Data) {
  return {
    title: val(row, "title") || val(row, "name"),
    body: val(
      row,
      kind === "agent"
        ? "brief"
        : kind === "bucket"
          ? "purpose"
          : kind === "task"
            ? "description"
            : "body",
    ),
    draft: val(row, "draft"),
    links: list(row, "links").join("\n"),
    selection:
      val(
        row,
        kind === "note"
          ? "bucket"
          : kind === "bucket"
            ? "responsible_agent"
            : "assigned_agent",
      ) || (kind === "note" ? data.buckets[0]?.id || "" : ""),
    status: val(row, "status") || "todo",
    // On hold is `waiting` in the API (`on_hold` is only a write alias).
    readiness: val(row, "readiness") === "ready" ? "ready" : "waiting",
    waitingReason: val(row, "waiting_reason"),
    // JSON, so the form compares and restores the exact chips.
    labels: JSON.stringify(list(row, "labels")),
    // How an agent is started; a new one's default follows the webhook setup.
    agentKind: agentKind(row) as string,
  };
}
function Editor({
  kind,
  row,
  tab: askedTab,
  tabAsk = 0,
  data,
  archiveNotice = "",
  onEdit,
  openRelated,
  wakeMissing = false,
  busy,
  error,
  save,
  perform,
  close,
  refresh,
  onWithdrawn,
  refreshRow,
}: EditorProps) {
  const readOnly = !!archiveNotice;
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTabState] = useState<string>(
      kind === "note" && row ? "read" : kind === "task" && row && askedTab ? askedTab : "edit",
    ),
    [history, setHistory] = useState<Row[]>([]),
    [events, setEvents] = useState<Row[]>([]),
    [relatedError, setRelatedError] = useState("");
  const comments = events.filter(
    (x) => val(x, "action") === "task.comment" && val(x, "body"),
  );
  // A task's tab follows into its address (`?tab=comments`), so Copy link and
  // a reload keep it; the address changes only while it names this task.
  const setTab = (next: string) => {
    setTabState(next);
    if (kind !== "task" || !row) return;
    const link = parseItemHash(location.hash);
    if (link?.kind === "task" && link.id === row.id)
      setAddress(itemTabPath(location.hash, next));
  };
  useEffect(() => {
    if (kind === "task" && row && askedTab && tabAsk) setTabState(askedTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabAsk]);
  const [start] = useState(() => formValues(kind, row, data));
  const [title, setTitle] = useState(start.title),
    [body, setBody] = useState(start.body),
    [draft, setDraft] = useState(start.draft),
    [reason, setReason] = useState(""),
    [comment, setComment] = useState(""),
    [links, setLinks] = useState(start.links);
  const [selection, setSelection] = useState(start.selection),
    [status, setStatus] = useState(start.status),
    [readiness, setReadiness] = useState(start.readiness),
    [waitingReason, setWaitingReason] = useState(start.waitingReason),
    [labels, setLabels] = useState(start.labels),
    [agentKindValue, setAgentKind] = useState(start.agentKind),
    agentKindTouched = useRef(false);
  // A new agent is started manually unless the webhook integration is set up;
  // until that is known, or if it can't be read, it is a webhook bot.
  useEffect(() => {
    if (kind !== "agent" || row) return;
    let alive = true;
    void crewApi.read("webhook_configs").then(
      (configs) => {
        if (alive && !agentKindTouched.current && !webhookConfigured(configs))
          setAgentKind("external");
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [kind, row]);
  // Files: an existing task or note's attachments, or files staged for a new one.
  const itemKind = kind === "task" || kind === "note" ? kind : null;
  const parent =
    itemKind && row
      ? { kind: itemKind, id: row.id }
      : kind === "review" && row && val(row, "task")
        ? { kind: "task" as const, id: val(row, "task") }
        : undefined;
  const reloadEvents = () => {
    if (row && itemKind)
      void crewApi
        .read("events", { parent: row.id })
        .then(setEvents, () => undefined);
  };
  const item = useItemAttachments({
    parent,
    onChanged: () => {
      reloadEvents();
      refresh?.();
    },
    onWithdrawn: () => {
      if (row && itemKind) onWithdrawn?.(itemKind, row.id);
    },
  });
  const staged = useStagedFiles();
  const [inlineErrors, setInlineErrors] = useState<Record<string, string>>({});
  // Inline uploads still running: Save waits so no "⏳ Uploading" text is saved.
  const [inlineUploads, setInlineUploads] = useState(0);
  const uploadTokens = useRef(0);
  const commentBox = useRef<HTMLTextAreaElement>(null);
  const commentFiles = useRef<HTMLInputElement>(null);
  const takenNames = () => [
    ...item.attachments.map((a) => a.name),
    ...staged.staged.map((s) => s.file.name),
  ];
  /**
   * Pasted or dropped files in a Markdown field: an existing item uploads each
   * and replaces its "⏳ Uploading…" placeholder (found by a unique token) with
   * its reference; a new item stages them and inserts `attachment:new-K`
   * placeholders. Files over a limit are refused with a message. Returns the
   * inserted text.
   */
  const insertFiles =
    (
      field: "body" | "draft" | "comment",
      setText: (update: (text: string) => string) => void,
    ) =>
    (incoming: File[], [from, to]: [number, number], pasted: boolean) => {
      if (readOnly || !itemKind) return;
      const named = pasted ? namePasted(incoming, takenNames()) : incoming;
      onEdit();
      const splice = (text: string) =>
        setText((value) => value.slice(0, from) + text + value.slice(to));
      const report = (refused: FileRefusal[]) =>
        setInlineErrors(({ [field]: _gone, ...rest }) =>
          refused.length
            ? { ...rest, [field]: refused.map((r) => r.message).join(" ") }
            : rest,
        );
      if (!row) {
        const { entries, refused } = staged.stage(named);
        report(refused);
        const text = entries
          .map((e) => fileReference(e.file.name, `new-${e.key}`, e.image))
          .join("\n");
        splice(text);
        return text;
      }
      const { accepted: files, refused } = checkFiles(named, {
        existing: item.used() + inlineUploads,
      });
      report(refused);
      if (!files.length) return "";
      const tokens = files.map(
        () =>
          `${++uploadTokens.current}-${Math.random().toString(36).slice(2, 6)}`,
      );
      const text = files
        .map((f, i) => uploadPlaceholder(f.name, tokens[i]))
        .join("\n");
      splice(text);
      setInlineUploads((n) => n + files.length);
      files.forEach((file, i) => {
        item
          .upload(file)
          .then(
            (a) =>
              setText((value) =>
                replaceUploadPlaceholder(
                  value,
                  tokens[i],
                  fileReference(a.name, a.id, isImage(a)),
                ),
              ),
            (e) => {
              setText((value) => replaceUploadPlaceholder(value, tokens[i], ""));
              setInlineErrors((all) => ({
                ...all,
                [field]: `Could not attach ${file.name}: ${e instanceof Error ? e.message : "upload failed"}`,
              }));
            },
          )
          .finally(() => setInlineUploads((n) => n - 1));
      });
      return text;
    };
  const inlineStatus = (field: "body" | "draft" | "comment") =>
    inlineErrors[field] ? (
      <p className="crew-alert crew-inline-upload-error" role="alert">
        {inlineErrors[field]}
      </p>
    ) : null;
  /** Staged files leave the text too, so no placeholder points at nothing. */
  const unstage = (key: number) => {
    const ref = new RegExp(`!?\\[(?:[^\\]\\\\]|\\\\.)*\\]\\(attachment:new-${key}\\)\\n?`, "g");
    setBody((text) => text.replace(ref, ""));
    setDraft((text) => text.replace(ref, ""));
    staged.unstage(key);
  };
  // A newer revision of the open record (after a file change withdrew its
  // approval) replaces the fields the owner has not changed.
  const baseRow = useRef(row);
  const initialRef = useRef(start);
  useEffect(() => {
    let alive = true;
    if (row && (kind === "note" || kind === "task"))
      void Promise.all([
        crewApi.read(kind === "note" ? "note_revisions" : "reviews", {
          parent: row.id,
        }),
        crewApi.read("events", { parent: row.id }),
      ])
        .then(([h, e]) => {
          if (alive) {
            setHistory(h);
            setEvents(e);
          }
        })
        .catch((e) => {
          if (alive)
            setRelatedError(
              e instanceof Error ? e.message : "Could not load history.",
            );
        });
    return () => {
      alive = false;
    };
  }, [row?.id, kind]);
  useEffect(() => {
    // A new view starts at its top; focus stays in the dialog when its control goes.
    const dialog = root.current?.closest("dialog");
    dialog?.scrollTo?.(0, 0);
    if (dialog && !dialog.contains(document.activeElement))
      dialog.focus({ preventScroll: true });
  }, [tab]);
  const current = {
    title,
    body,
    draft,
    links,
    selection,
    status,
    readiness,
    waitingReason,
    labels,
    agentKind: agentKindValue,
  };
  const setters: Record<keyof typeof current, (v: string) => void> = {
    title: setTitle,
    body: setBody,
    draft: setDraft,
    links: setLinks,
    selection: setSelection,
    status: setStatus,
    readiness: setReadiness,
    waitingReason: setWaitingReason,
    labels: setLabels,
    agentKind: setAgentKind,
  };
  useEffect(() => {
    const before = baseRow.current;
    baseRow.current = row;
    if (!row || !before || before.revision === row.revision) return;
    const next = formValues(kind, row, data);
    for (const key of Object.keys(current) as (keyof typeof current)[])
      if (current[key] === initialRef.current[key]) setters[key](next[key]);
    initialRef.current = next;
    // Runs only when the record itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);
  const initial = initialRef.current;
  const dirty = (Object.keys(current) as (keyof typeof current)[]).some(
    (key) => current[key] !== initial[key],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (readOnly || inlineUploads > 0) return;
    const fields =
      kind === "note"
        ? {
            title,
            body,
            ...(row ? {} : { bucket: selection }),
            links: links
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          }
        : kind === "task"
          ? {
              title,
              description: body,
              draft,
              assigned_agent: selection,
              readiness,
              waiting_reason: readiness !== "ready" ? waitingReason : "",
              ...(status === "needs_review" ? {} : { status }),
              labels: JSON.parse(labels) as string[],
              links: links
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
            }
          : kind === "bucket"
            ? { name: title, purpose: body, responsible_agent: selection }
            : {
                name: title,
                brief: body,
                ...(!row || agentKindValue !== initial.agentKind
                  ? { kind: agentKindValue }
                  : {}),
              };
    if (!row && itemKind && staged.staged.length) {
      // One atomic request: the item, its files and resolved placeholders.
      const prepared = staged.prepare();
      const textKeys = itemKind === "task" ? ["description", "draft"] : ["body"];
      const withFiles: Record<string, unknown> = { ...fields };
      for (const key of textKeys)
        if (typeof withFiles[key] === "string")
          withFiles[key] = prepared.renumber(withFiles[key] as string);
      void perform(async () => {
        try {
          await attachmentsApi.createWithFiles(itemKind, withFiles, prepared.files, {
            reason,
          });
        } catch (e) {
          prepared.fail(e);
          throw e;
        }
      }).then((ok) => {
        if (ok) close();
      });
      return;
    }
    void save(`${kind}.${row ? "update" : "create"}`, fields, row, reason);
  };
  if (kind === "review" && row)
    return <ReviewDecision row={row} busy={busy} error={error}
      attachments={item.attachments} loaded={item.loaded} Prose={Prose}
      when={when} save={save} />;
  const bar = (action?: ReactNode) =>
    action || error ? (
      <div className="crew-save-bar">
        {error && (
          <p className="crew-alert" role="alert">
            {error}
          </p>
        )}
        {action}
      </div>
    ) : null;
  // One quiet line: these are rarely needed and must not look like next steps.
  const more = row && (
    <p className="crew-meta-row">
      <span>Revision {row.revision}</span>
      {kind === "note" && (
        <button
          type="button"
          className="crew-quiet"
          onClick={() => setTab("history")}
        >
          History
        </button>
      )}
      {!readOnly && (
        <button
          type="button"
          className="crew-quiet"
          disabled={busy}
          onClick={() =>
            void save(`${kind}.update`, { archived: true }, row, reason)
          }
        >
          {kind === "agent" ? "Deactivate agent" : `Archive ${kind}`}
        </button>
      )}
    </p>
  );
  const backToNote = (
    <button
      type="button"
      className="crew-quiet crew-back"
      onClick={() => setTab("read")}
    >
      ← Back to note
    </button>
  );
  const savedDraft = val(row, "draft");
  const reviewPending = data.reviews.some(
    (x) => val(x, "task") === row?.id && val(x, "status") === "pending",
  );
  const reviewState = reviewPending ? (
    <p className="crew-review-state">
      Waiting for your approval. <a href={viewHashes.reviews}>Approvals</a>
    </p>
  ) : draft !== savedDraft ? (
    <p className="crew-review-state">Save your draft first</p>
  ) : !savedDraft.trim() ? (
    <p className="crew-review-state">Add a draft to request approval</p>
  ) : (
    <ReviewRequest busy={busy} submit={(options) => void save("review.request", options.length ? { options } : {}, row)} />
  );
  const buckets = data.buckets.find((x) => x.id === val(row, "bucket"));
  // A coding session's claim; the owner may always release it (In progress goes back to To do).
  const claim = claimOf(row);
  const releaseClaim = async () => {
    if (!row) return;
    if (
      claim.state === "live" &&
      !window.confirm("A session is working on this. Release its claim?")
    )
      return;
    if (
      await perform(
        () => crewApi.write("task.release", {}, row),
        val(row, "status") === "in_progress"
          ? "Claim released. The task is To do."
          : "Claim released.",
      )
    )
      refreshRow?.();
  };
  // Controls inside a disabled fieldset can't open, so read-only forms have no help.
  const help = (topic: HelpTopic) => (readOnly ? undefined : topic);
  // Labels already used on other tasks, offered while typing a new one.
  const labelSuggestions = [
    ...new Set(data.tasks.flatMap((x) => list(x, "labels"))),
  ];
  const filesSection = itemKind && (
    <AttachmentsSection
      parent={parent}
      item={row ? item : undefined}
      staged={row ? undefined : staged}
      readOnly={readOnly}
      onStage={(files) => {
        onEdit();
        staged.stage(files);
      }}
      onUnstage={unstage}
    />
  );
  // Files pasted or dropped anywhere else in the dialog are added to the item.
  const addToItem = (files: File[], pasted: boolean) => {
    if (readOnly || !itemKind || !files.length) return;
    const named = pasted ? namePasted(files, takenNames()) : files;
    if (row) item.addFiles(named);
    else {
      onEdit();
      staged.stage(named);
    }
  };
  return (
    <AttachmentsProvider attachments={item.attachments} staged={staged.staged}>
    <div
      className={`crew-dialog-body${row && (kind === "note" || kind === "task") ? " crew-switching-views" : ""}`}
      ref={root}
      onPaste={(e) => {
        if (e.defaultPrevented) return;
        const files = filesOf(e.clipboardData);
        if (!files.length || !itemKind || readOnly) return;
        e.preventDefault();
        addToItem(files, true);
      }}
      onDragOver={(e) => {
        if (itemKind && !readOnly && Array.from(e.dataTransfer.types).includes("Files"))
          e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.defaultPrevented) return;
        const files = filesOf(e.dataTransfer);
        if (!files.length || !itemKind || readOnly) return;
        e.preventDefault();
        addToItem(files, false);
      }}
    >
      {readOnly && (
        <p className="crew-notice" role="status">
          {archiveNotice}
        </p>
      )}
      {row && kind === "task" && (
        <div className="crew-tabs" role="tablist" aria-label="Record views">
          {taskTabs.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {readOnly && key === "edit"
                ? "Details"
                : key[0].toUpperCase() + key.slice(1)}
              {key === "comments" && (
                <span className="crew-tab-count" aria-label={`, ${comments.length}`}>
                  {comments.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {row && kind === "note" && !readOnly && tab !== "history" && (
        <div
          className="crew-md-tabs crew-note-tabs"
          role="tablist"
          aria-label="Note view"
        >
          {["read", "edit"].map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {key === "read" ? "Read" : "Edit"}
            </button>
          ))}
        </div>
      )}
      {relatedError && <p className="crew-alert">{relatedError}</p>}
      {tab === "read" && row && (
        <div className="crew-read">
          <article>
            {buckets && (
              <span className="crew-note-bucket">{val(buckets, "name")}</span>
            )}
            {/* Same labels and boxes as Edit, so switching views keeps everything in place. */}
            <div className="crew-field">
              <span>Title</span>
              <h3 className="crew-read-title">{title}</h3>
            </div>
            <div className="crew-md-field">
              <div className="crew-md-label">
                <span className="crew-md-name">Note</span>
              </div>
              <div className="crew-md-box">
                <div className="crew-md-preview">
                  {body.trim() ? <Prose>{body}</Prose> : <p>Nothing written yet.</p>}
                </div>
              </div>
            </div>
            {(() => {
              const rel = relatedItems(data, row?.id, list(row, "links"));
              if (!rel.linked.length && !rel.linkedFrom.length) return null;
              return (
                <section className="crew-linked-notes" aria-label="Related">
                  <h3>Related</h3>
                  {rel.linked.length > 0 && (
                    <ul className="crew-related-linked">
                      {rel.linked.map((item) => (
                        <li key={item.id}>
                          <RelatedLink item={item} open={openRelated} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {rel.linkedFrom.length > 0 && (
                    <>
                      <h4 className="crew-related-heading">Linked from</h4>
                      <ul className="crew-related-linked">
                        {rel.linkedFrom.map((item) => (
                          <li key={item.id}>
                            <RelatedLink item={item} open={openRelated} />
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              );
            })()}
          </article>
          {filesSection}
          {more}
          {bar(
            dirty && (
              <button className="crew-primary" onClick={() => setTab("edit")}>
                Continue editing to save
              </button>
            ),
          )}
        </div>
      )}
      {tab === "edit" && (
        <form className="crew-editor-form" onSubmit={submit}>
          {kind === "note" && row && buckets && (
            <span className="crew-note-bucket">{val(buckets, "name")}</span>
          )}
          <fieldset className="crew-form-fields" disabled={readOnly}>
            <Field
              label={kind === "note" || kind === "task" ? "Title" : "Name"}
            >
              <input
                required
                maxLength={200}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            {kind === "agent" && (
              <fieldset className="crew-agent-start">
                <legend>
                  How is it started?
                  {!readOnly && <Help topic="agent-start" />}
                </legend>
                {agentKinds.map((key: AgentKind) => (
                  <div key={key} className="crew-agent-start-option">
                    <label>
                      <input
                        type="radio"
                        name="agent-kind"
                        value={key}
                        checked={agentKindValue === key}
                        // A click on the already chosen option is a choice too.
                        onClick={() => {
                          agentKindTouched.current = true;
                        }}
                        onChange={() => {
                          agentKindTouched.current = true;
                          setAgentKind(key);
                        }}
                      />
                      {agentKindChoices[key]}
                    </label>
                    {key === "external" && agentKindValue === "external" && (
                      <small className="crew-agent-start-hint">
                        Name it after the project, e.g. pocketcontext-crew.
                        Start sessions from its card.
                      </small>
                    )}
                  </div>
                ))}
              </fieldset>
            )}
            {!(kind === "note" && row) &&
              (kind === "note" || kind === "bucket" || kind === "task") && (
              <Field
                label={
                  kind === "note"
                    ? "Bucket"
                    : kind === "bucket"
                      ? "Responsible agent"
                      : "Assigned agent"
                }
                help={help(
                  kind === "note"
                    ? "bucket"
                    : kind === "bucket"
                      ? "responsible-agent"
                      : "assigned-agent",
                )}
              >
                <select
                  value={selection}
                  required={kind === "note"}
                  onChange={(e) => setSelection(e.target.value)}
                >
                  <option value="">
                    {kind === "note" ? "Choose a bucket" : "Unassigned"}
                  </option>
                  {kind === "task" &&
                    selection &&
                    !data.agents.some((x) => x.id === selection) && (
                      <option value={selection} disabled>
                        Unavailable agent
                      </option>
                    )}
                  {data[kind === "note" ? "buckets" : "agents"]
                    .filter(
                      (x) =>
                        !x.archived ||
                        x.id ===
                          val(
                            row,
                            kind === "note"
                              ? "bucket"
                              : kind === "bucket"
                                ? "responsible_agent"
                                : "assigned_agent",
                          ),
                    )
                    .map((x) => (
                      <option key={x.id} value={x.id} disabled={!!x.archived}>
                        {val(x, "name")}
                        {x.archived ? " (inactive)" : ""}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {kind === "note" || kind === "task" ? (
              <MarkdownField
                label={kind === "note" ? "Note" : "Description"}
                required={kind === "note"}
                className={kind === "note" ? "crew-note-text" : ""}
                value={body}
                onChange={setBody}
                tabs={kind === "task"}
                onFiles={insertFiles("body", setBody)}
                status={inlineStatus("body")}
              />
            ) : (
              // Briefs and purposes are Markdown (0.24.0): Read and Edit like a
              // task description, opening in Read when there is text.
              <MarkdownField
                label={kind === "agent" ? "Agent brief" : "Purpose"}
                help={
                  kind === "agent" && help("brief") ? <Help topic="brief" /> : undefined
                }
                className={kind === "agent" ? "crew-long-text" : ""}
                value={body}
                onChange={setBody}
              />
            )}
            {kind === "task" && (
              <>
                {row && claim.state && (
                  <div className="crew-claim-row">
                    <ClaimChip task={row} details />
                    {!readOnly && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void releaseClaim()}
                      >
                        Release claim
                      </button>
                    )}
                  </div>
                )}
                <div className="crew-form-grid">
                  <Field label="Status">
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      {statuses.map(([key, label]) => (
                        <option
                          key={key}
                          value={key}
                          disabled={key === "needs_review"}
                        >
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <LabelsInput
                    value={JSON.parse(labels) as string[]}
                    disabled={readOnly}
                    suggestions={labelSuggestions}
                    onChange={(next) => {
                      setLabels(JSON.stringify(next));
                      onEdit();
                    }}
                  />
                </div>
                {row && approvalLine(row) && (
                  <p className="crew-approval-line" role="note">
                    {approvalLine(row)}
                  </p>
                )}
                <div className="crew-form-grid">
                  <Field label="Hold" help={help("readiness")}>
                    <select
                      value={readiness === "ready" ? "ready" : "waiting"}
                      onChange={(e) => setReadiness(e.target.value)}
                    >
                      <option value="waiting">On hold</option>
                      <option value="ready">Ready</option>
                    </select>
                  </Field>
                  {readiness !== "ready" && (
                    <Field label="Hold reason">
                      <input
                        value={waitingReason}
                        onChange={(e) => setWaitingReason(e.target.value)}
                        placeholder="What needs to happen first?"
                        maxLength={2000}
                      />
                    </Field>
                  )}
                </div>
                <p className="crew-footnote crew-hold-explainer">
                  On hold: nobody is woken; a person decides. Ready: the
                  assigned bot may act.
                </p>
                {wakeMissing && (
                  <p className="crew-wake-missing" role="note">
                    <WakeMissingChip /> {wakeMissingTitle}
                  </p>
                )}
                <MarkdownField
                  label="Draft for review"
                  help={help("draft")}
                  className="crew-long-text"
                  value={draft}
                  onChange={setDraft}
                  onFiles={insertFiles("draft", setDraft)}
                  status={inlineStatus("draft")}
                />
                {row && !readOnly && (
                  <div className="crew-review-row">
                    {reviewState}
                    <Help topic="send-for-approval" />
                  </div>
                )}
              </>
            )}
            {(kind === "note" || kind === "task") && (
              <RelatedItems
                data={data}
                currentId={row?.id}
                links={links}
                readOnly={readOnly}
                open={openRelated}
                setLinks={(next) => {
                  setLinks(next);
                  onEdit();
                }}
              />
            )}
            {row && !readOnly && dirty && (
              <Field label="Reason for change" help="reason">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Optional: what changed and why?"
                />
              </Field>
            )}
            {kind === "agent" && (
              <p className="crew-footnote">
                Include its bucket, handoff rules and when to update notes.
                Agent names are reported attribution, not verified identities.
              </p>
            )}
            {kind === "bucket" && (
              <p className="crew-footnote">
                Responsibility is a convention, not a permission. Archiving this
                bucket hides its notes and stops writes until restored.
              </p>
            )}
          </fieldset>
          {filesSection}
          {kind !== "note" && more}
          {bar(
            !readOnly && (
              // Always visible in Edit, so there is no guessing how to save.
              <button
                className="crew-primary"
                disabled={busy || inlineUploads > 0 || (Boolean(row) && !dirty)}
                title={row && !dirty ? "Change something to save" : undefined}
              >
                {inlineUploads > 0 ? "Waiting for uploads…" : `Save ${kind}`}
              </button>
            ),
          )}
        </form>
      )}
      {tab === "history" && (
        <>
          {backToNote}
          <p>
            Restoring creates a new revision and keeps every previous version.
          </p>
          {!history.length && <p>No earlier revisions available.</p>}
          {events.some(isFileEvent) && (
            <details className="crew-version">
              <summary>File activity</summary>
              <ol className="crew-timeline">
                {events.filter(isFileEvent).map((x) => {
                  const summary = eventSummary(x);
                  return (
                    <li key={x.id}>
                      <strong>{summary.title}</strong>
                      <small>
                        {when(x.created)} · {summary.by}
                      </small>
                    </li>
                  );
                })}
              </ol>
            </details>
          )}
          {[...history]
            .sort((a, b) => b.revision - a.revision)
            .map((x) => {
              const diff = lineDiff(val(x, "body"), val(row, "body"));
              return (
                <details className="crew-version" key={x.id}>
                  <summary>
                    Revision {x.revision} · {when(x.created)}
                  </summary>
                  <p className="crew-footnote">
                    {val(x, "reported_agent") ||
                      val(x, "actor") ||
                      "Owner / connection"}
                    {val(x, "reason") ? ` · ${val(x, "reason")}` : ""}
                  </p>
                  <h3>{val(x, "title")}</h3>
                  <Prose>{val(x, "body")}</Prose>
                  <details>
                    <summary>Changed section compared with current</summary>
                    <p className="crew-footnote">
                      The ordered section replaced between this revision and the
                      current version.
                    </p>
                    <pre className="crew-diff">
                      {diff.removed.map((l, i) => (
                        <span className="removed" key={`r${i}`}>
                          − {l}
                          {"\n"}
                        </span>
                      ))}
                      {diff.added.map((l, i) => (
                        <span className="added" key={`a${i}`}>
                          ＋ {l}
                          {"\n"}
                        </span>
                      ))}
                    </pre>
                  </details>
                  {!readOnly && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void save(
                          "note.restore",
                          { revision_id: x.id },
                          row,
                          `Restore revision ${x.revision}`,
                        )
                      }
                    >
                      Restore as new revision
                    </button>
                  )}
                </details>
              );
            })}
        </>
      )}
      {tab === "comments" && (
        <>
          {!readOnly && (
            <form
              className="crew-comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                // Waits for uploads, so no "Uploading" placeholder is posted.
                if (row && inlineUploads === 0)
                  void perform(() =>
                    crewApi.write("task.comment", { body: comment }, row),
                  ).then(async (ok) => {
                    if (ok) {
                      setComment("");
                      setEvents(
                        await crewApi.read("events", { parent: row.id }),
                      );
                    }
                  });
              }}
            >
              <div className="crew-md-field">
                <div className="crew-md-label">
                  <label htmlFor={`comment-${row?.id}`}>Add a comment</label>
                  <small>Markdown supported</small>
                </div>
                <textarea
                  id={`comment-${row?.id}`}
                  ref={commentBox}
                  required
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Paste or drop screenshots here"
                  {...fileInputHandlers(insertFiles("comment", setComment))}
                />
                {inlineStatus("comment")}
              </div>
              <div className="crew-comment-actions">
                <input
                  ref={commentFiles}
                  type="file"
                  multiple
                  hidden
                  aria-label="Attach files to the comment"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (!files.length) return;
                    const box = commentBox.current;
                    const end = box?.value.length ?? comment.length;
                    insertFiles("comment", setComment)(
                      files,
                      [box?.selectionStart ?? end, box?.selectionEnd ?? end],
                      false,
                    );
                  }}
                />
                <button
                  type="button"
                  onClick={() => commentFiles.current?.click()}
                >
                  Attach files
                </button>
                <button
                  className="crew-primary"
                  disabled={busy || inlineUploads > 0}
                >
                  {inlineUploads > 0 ? "Waiting for uploads…" : "Add comment"}
                </button>
              </div>
            </form>
          )}
          {comments.length ? (
            <ol className="crew-timeline crew-comments" aria-label="Comments">
              {comments.map((x) => (
                <li key={x.id}>
                  <small>
                    <strong>{eventSummary(x).by}</strong> · {when(x.created)}
                  </small>
                  {/* Sanitized Markdown: raw HTML is shown as text, never run. */}
                  <div className="crew-comment-body">
                    <Prose>{val(x, "body")}</Prose>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="crew-empty-note">No comments yet.</p>
          )}
        </>
      )}
      {tab === "activity" && (
        <>
          <ol className="crew-timeline">
            {events.map((x) => {
              const summary = eventSummary(x);
              return (
                <li key={x.id}>
                  <strong>{summary.title}</strong>
                  {val(x, "action") === "review.decide" && (() => {
                    const changes = typeof x.changes === "string" ? (() => { try { return JSON.parse(x.changes); } catch { return {}; } })() : (x.changes || {});
                    const choices = objects(changes.option_decisions);
                    const summary = decisionSummary({ id: x.id, revision: x.revision, options: changes.options, option_decisions: choices });
                    return summary ? <p>{summary}</p> : null;
                  })()}
                  <small>
                    {when(x.created)} · {summary.by}
                  </small>
                  {summary.by.startsWith(
                    "via upload link",
                  ) ? null : val(x, "action") === "task.comment" &&
                    val(x, "body") ? (
                    // Sanitized Markdown: raw HTML is shown as text, never run.
                    <div className="crew-comment-body">
                      <Prose>{val(x, "body")}</Prose>
                    </div>
                  ) : (
                    <p>{val(x, "body") || val(x, "reason")}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      {tab === "reviews" && (
        <>
          {!history.length && (
            <p>No review requests yet. Save a draft and submit it from Edit.</p>
          )}
          {history.map((x) => (
            <article className="crew-version" key={x.id}>
              <span className="crew-pill">
                {val(x, "status").replaceAll("_", " ")}
              </span>
              <small>{when(x.created)}</small>
              <ReviewContent row={x} attachments={item.attachments} loaded={item.loaded} Prose={Prose}>
                <ReviewChoices row={x} Prose={Prose} />
              </ReviewContent>
              {decisionSummary(x) && <p>{decisionSummary(x)}</p>}
              {val(x, "decision_note") && <p>{val(x, "decision_note")}</p>}
              {val(x, "status") === "pending" && !readOnly && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      () => crewApi.write("review.withdraw", {}, x),
                      "Review withdrawn.",
                    ).then((ok) => {
                      if (ok) close();
                    })
                  }
                >
                  Withdraw request
                </button>
              )}
            </article>
          ))}
        </>
      )}
      {tab !== "read" && tab !== "edit" && error && (
        <p className="crew-alert" role="alert">
          {error}
        </p>
      )}
    </div>
    </AttachmentsProvider>
  );
}
