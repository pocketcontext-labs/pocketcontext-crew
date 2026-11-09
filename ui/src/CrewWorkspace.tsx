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
  lineDiff,
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
import { GlobalSearch, SearchPage } from "./Search";
import { searchHash, searchTextFromHash, type SearchHit } from "./search";
import "./crew.css";
import type { ServerVersion } from "./crewApi";
import {
  isItemHash,
  itemPath,
  itemShareUrl,
  parseItemHash,
  type ItemKind,
  type View,
  viewFromHash,
  viewHashes,
} from "./itemLink";
const nav: [View, string, string][] = [
  ["home", "Home", "⌂"],
  ["board", "AI Team", "▦"],
  ["memory", "Shared memory", "▤"],
  ["reviews", "Approvals", "✓"],
  ["agents", "Agents", "◎"],
  ["archive", "Archive", "↶"],
];
const pages: [View, string, string][] = [
  ...nav,
  ["connect", "Connect an agent", "⇄"],
  ["guide", "Guide", "?"],
  ["search", "Search", "⌕"],
];
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
const statusHelp: Record<(typeof statuses)[number][0], HelpTopic> = {
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
const pushAddress = (hash: string) => {
  if (location.hash !== hash)
    history.pushState(null, "", location.pathname + location.search + hash);
};
const when = (raw: unknown) =>
  raw ? new Date(String(raw)).toLocaleString() : "Just now";
/** Readable card text: Markdown markers would otherwise show, and could be cut in half. */
const plainPreview = (markdown: string) =>
  markdown
    .replace(/^```.*$/gm, "")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+)/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\*(\S[^*\n]*)\*/g, "$1")
    .replace(/\n{2,}/g, "\n")
    .trim();
function Prose({ children }: { children: string }) {
  return (
    <div className="crew-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span>[Image: {alt || "attachment"}]</span>,
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(target);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
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
/** Grows with its content, so a long note scrolls with the dialog, not inside it. */
function GrowingTextarea({ value, ...props }: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = el.closest("dialog");
    const top = scroller?.scrollTop;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px`;
    if (scroller && top !== undefined) scroller.scrollTop = top;
    // A hidden textarea measures zero, so measure again when it appears.
  }, [value, props.hidden]);
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
}: {
  label: string;
  help?: ReactNode;
  tabs?: boolean;
  required?: boolean;
  className?: string;
  value: string;
  onChange: (value: string) => void;
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
    </div>
  );
}
function RelatedNotes({
  notes,
  currentId,
  links,
  setLinks,
  readOnly,
}: {
  notes: Row[];
  currentId?: string;
  links: string;
  setLinks: (next: string) => void;
  readOnly: boolean;
}) {
  const [query, setQuery] = useState("");
  const linked = links.split("\n").filter(Boolean);
  const others = notes.filter((note) => note.id !== currentId);
  const needle = query.trim().toLowerCase();
  const results = needle
    ? others
        .filter(
          (note) =>
            !linked.includes(note.id) &&
            val(note, "title").toLowerCase().includes(needle),
        )
        .slice(0, 8)
    : [];
  const label = (note: Row) =>
    `${val(note, "title")}${note.archived ? " (archived)" : ""}`;
  return (
    <fieldset className="crew-related" aria-label="Related memory">
      <legend>
        <span>Related memory</span>
        {!readOnly && <Help topic="related-memory" />}
      </legend>
      {linked.length > 0 && (
        <ul className="crew-related-linked">
          {linked.map((id) => {
            const note = notes.find((x) => x.id === id);
            const text = note ? label(note) : "Unavailable note";
            return (
              <li key={id}>
                <span>{text}</span>
                {!readOnly && (
                  <button
                    type="button"
                    className="crew-quiet"
                    aria-label={`Remove ${text}`}
                    onClick={() =>
                      setLinks(linked.filter((x) => x !== id).join("\n"))
                    }
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && others.length > 0 && (
        <label className="crew-field crew-related-search">
          <span>Add related note</span>
          <input
            type="search"
            placeholder="Search your notes"
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
          {results.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                onClick={() => {
                  setLinks([...linked, note.id].join("\n"));
                  setQuery("");
                }}
              >
                {label(note)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle && !results.length && <p>No matching notes.</p>}
      {!others.length && !linked.length && <p>No other notes yet.</p>}
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
  useEffect(() => {
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
  const [view, setView] = useState<View>(() => viewFromHash(location.hash)),
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
    [bucket, setBucket] = useState(""),
    [assignmentFilter, setAssignmentFilter] = useState("all"),
    // The Search page's query, from its address; null for an invalid address.
    [searchText, setSearchText] = useState(() =>
      searchTextFromHash(location.hash),
    ),
    // Bumped after each save, so search results show the change.
    [saves, setSaves] = useState(0);
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
  const [dialog, setDialog] = useState<{ kind: Kind; row?: Row } | null>(null),
    // Set per hash navigation and consumed once, so data refreshes never open a dialog.
    [pendingLink, setPendingLink] = useState(() =>
      parseItemHash(location.hash),
    ),
    [ready, setReady] = useState(false),
    generation = useRef(0),
    edited = useRef(false),
    busyRef = useRef(false),
    loadsInFlight = useRef(0),
    loadFailed = useRef(false);
  const discardOk = () =>
    !edited.current || window.confirm("Discard your unsaved changes?");
  useEffect(() => {
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
      setPendingLink(parseItemHash(location.hash));
      if (isItemHash(location.hash)) return;
      if (!discardOk()) {
        history.forward();
        return;
      }
      setView(viewFromHash(location.hash));
      setSearchText(searchTextFromHash(location.hash));
      setQuery("");
      setDialog(null);
    };
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  const openTitle =
    dialog?.row && (dialog.kind === "task" || dialog.kind === "note")
      ? val(dialog.row, "title")
      : "";
  const pageTitle = openTitle || pages.find(([key]) => key === view)?.[1];
  useEffect(() => {
    document.title = `${pageTitle} · PocketContext Crew`;
    return () => {
      document.title = "PocketContext Crew";
    };
  }, [pageTitle]);
  useEffect(() => {
    if (!pendingLink || !ready) return;
    setPendingLink(null);
    const { kind, id } = pendingLink;
    const collection = kind === "task" ? "tasks" : "notes";
    const row = [...data[collection], ...archived[collection]].find(
      (x) => x.id === id,
    );
    if (!row) return;
    setAddress(itemPath(kind, row));
    // Navigating to the open item must not disturb its in-progress edits.
    setDialog((open) =>
      open?.kind === kind && open.row?.id === id ? open : { kind, row },
    );
  }, [pendingLink, ready, data, archived]);
  const openItem = (kind: ItemKind, row: Row) => {
    pushAddress(itemPath(kind, row));
    setDialog({ kind, row });
  };
  const closeDialog = () => {
    if (isItemHash(location.hash))
      pushAddress(
        view === "search" && searchText ? searchHash(searchText) : viewHashes[view],
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
    if (await perform(() => crewApi.write(action, fields, row, reason)))
      closeDialog();
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
  const openTasks = data.tasks.filter((task) => val(task, "status") !== "done");
  const unassignedCount = openTasks.filter(
    (task) => !val(task, "assigned_agent"),
  ).length;
  const invalidCount = openTasks.filter(invalidAssignment).length;
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
      .includes(query.toLowerCase());
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
            brief: `Read relevant memory before work. Maintain ${n.toUpperCase()}; request changes elsewhere through tasks. Record progress in tasks and save durable decisions and findings only. Submit drafts for human review. The owner performs external actions.`,
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
    }, "Your five starter agents and memory buckets are ready.");
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
    home: "Where you and your AI agents share tasks and memory. Agents do the work; you decide what's approved.",
    board: "Follow each task from request to finished work. Agents draft; you decide what's approved.",
    memory:
      "Keep decisions, preferences and useful findings where every agent can find them.",
    reviews:
      "Review the exact draft. Approval never sends or publishes anything.",
    agents:
      "Give each agent a name and a brief that says what it works on and what to remember.",
    archive: "Restore notes, tasks and buckets without losing their history.",
    connect: "Crew needs one connection to your agent platform before agents can work here.",
    guide: "What Crew does, what each page is for, and the words it uses.",
    search: "Every task, note, agent and bucket that matches your words.",
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
              <p className="crew-eyebrow">
                {view === "guide"
                  ? "HOW IT WORKS"
                  : view === "search"
                  ? "FIND ANYTHING"
                  : view === "connect"
                  ? "ONE CONNECTION FOR ALL YOUR AGENTS"
                  : view === "home"
                  ? "START HERE"
                  : view === "reviews"
                  ? "YOUR FINAL SAY"
                  : view === "memory"
                    ? "CONTEXT THAT CARRIES FORWARD"
                    : "FROM SHARED CONTEXT TO FINISHED WORK"}
              </p>
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
                    memory bucket each. Edit their briefs to fit your work.
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
          {(view === "board" || view === "memory") && (
            <div className="crew-toolbar">
              <label className="crew-search">
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  aria-label={
                    view === "board" ? "Search tasks" : "Search memory"
                  }
                  placeholder={
                    view === "board"
                      ? "Search tasks, descriptions or labels…"
                      : "Search note titles and content…"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {view === "board" && (
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
                </select>
              )}
              {view === "memory" && (
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
              )}
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
            />
          )}
          {view === "guide" && <Guide />}
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
              connection={connection}
              copyEndpoint={copyEndpoint}
            />
          )}
          {view === "board" && (
            <div className="crew-board">
              {statuses.map(([status, label]) => {
                const tasks = data.tasks.filter(
                  (x) =>
                    val(x, "status") === status &&
                    matches(x) &&
                    (assignmentFilter === "all" ||
                      (status !== "done" &&
                        (assignmentFilter === "unassigned"
                          ? !val(x, "assigned_agent")
                          : invalidAssignment(x)))),
                );
                return (
                  <section className="crew-column" key={status}>
                    <div className="crew-column-head">
                      <h2>
                        <i className={status} />
                        {label}
                        <span>{tasks.length}</span>
                      </h2>
                      <Help topic={statusHelp[status]} />
                    </div>
                    {tasks.map((x) => (
                      <button
                        className="crew-task-card"
                        key={x.id}
                        onClick={() => openItem("task", x)}
                      >
                        <div className="crew-tags">
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
                          {list(x, "labels").map((l) => (
                            <span key={l}>{l}</span>
                          ))}
                        </div>
                        <h3>{val(x, "title")}</h3>
                        <p>{plainPreview(val(x, "description")).slice(0, 150)}</p>
                        <p className="crew-readiness">
                          {val(x, "readiness") === "ready"
                            ? "Ready"
                            : "Waiting"}
                          {val(x, "readiness") !== "ready" &&
                          val(x, "waiting_reason")
                            ? ` · ${val(x, "waiting_reason")}`
                            : ""}
                        </p>
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
                      </button>
                    ))}
                    {!tasks.length && (
                      <div className="crew-column-empty">
                        {query || assignmentFilter !== "all" ? (
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
              </div>
              <div className="crew-buckets">
                {data.buckets
                  .filter((x) => !bucket || x.id === bucket)
                  .map((x) => (
                    <button
                      className="crew-bucket-card"
                      key={x.id}
                      onClick={() => setDialog({ kind: "bucket", row: x })}
                    >
                      <span>▤</span>
                      <h2>{val(x, "name")}</h2>
                      <p>{val(x, "purpose")}</p>
                      <small>
                        {name(val(x, "responsible_agent"))} · responsible agent
                      </small>
                    </button>
                  ))}
              </div>
              <div className="crew-section-title">
                <h2>Notes</h2>
                <Help topic="note" />
                <span>Useful context, with a history</span>
              </div>
              <div className="crew-notes">
                {data.notes
                  .filter(
                    (x) =>
                      (!bucket || val(x, "bucket") === bucket) && matches(x),
                  )
                  .map((x) => (
                    <button
                      className="crew-note-card"
                      key={x.id}
                      onClick={() => openItem("note", x)}
                    >
                      <span className="crew-eyebrow">
                        {name(val(x, "bucket"), "buckets")}
                      </span>
                      <h3>{val(x, "title")}</h3>
                      <p>{plainPreview(val(x, "body")).slice(0, 180)}</p>
                      <small>
                        Revision {x.revision} · {when(x.updated)}
                      </small>
                    </button>
                  ))}
              </div>
              {!data.notes.filter(
                (x) => (!bucket || val(x, "bucket") === bucket) && matches(x),
              ).length && (
                <Empty
                  title={query ? "No matching notes" : "No notes yet"}
                  action={
                    query ? undefined : data.buckets.length ? (
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
                  {query
                    ? "Try different words, or clear the search."
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
                {pending.map((x) => (
                  <article className="crew-review-card" key={x.id}>
                    <div>
                      <span className="crew-human">Human</span>
                      <small>{when(x.created)}</small>
                    </div>
                    <h2>
                      {val(
                        data.tasks.find((t) => t.id === val(x, "task")),
                        "title",
                      ) || "Task draft"}
                    </h2>
                    <Prose>{val(x, "draft").slice(0, 700)}</Prose>
                    <button
                      className="crew-primary"
                      onClick={() => setDialog({ kind: "review", row: x })}
                    >
                      Review exact draft →
                    </button>
                  </article>
                ))}
              </div>
              {!pending.length && (
                <Empty
                  title="Nothing waiting for your review"
                  action={<a href={viewHashes.board}>Go to the AI Team board</a>}
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
                All connected agents can read and write all shared memory. A
                bucket's responsible agent is a convention, not a permission;
                each agent's brief says where it should contribute.
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
                  <button
                    className="crew-agent-card"
                    key={x.id}
                    onClick={() => setDialog({ kind: "agent", row: x })}
                  >
                    <span className="crew-avatar">
                      {val(x, "name").slice(0, 1)}
                    </span>
                    <h2>{val(x, "name")}</h2>
                    <p>{val(x, "brief")}</p>
                    <small>Edit brief and responsibilities →</small>
                  </button>
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
              <CopyLink
                key={dialog.row.id}
                target={itemShareUrl(dialog.kind, dialog.row)}
              />
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
            }}
            archiveNotice={archiveNotice}
            onEdit={() => {
              edited.current = true;
            }}
            openNote={(note) => openItem("note", note)}
            busy={busy}
            error={error}
            save={save}
            perform={perform}
            close={closeDialog}
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
  data: Data;
  archiveNotice?: string;
  onEdit: () => void;
  openNote: (note: Row) => void;
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
};
function Editor({
  kind,
  row,
  data,
  archiveNotice = "",
  onEdit,
  openNote,
  busy,
  error,
  save,
  perform,
  close,
}: EditorProps) {
  const readOnly = !!archiveNotice;
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState(kind === "note" && row ? "read" : "edit"),
    [history, setHistory] = useState<Row[]>([]),
    [events, setEvents] = useState<Row[]>([]),
    [relatedError, setRelatedError] = useState("");
  const [title, setTitle] = useState(val(row, "title") || val(row, "name")),
    [body, setBody] = useState(
      val(
        row,
        kind === "agent"
          ? "brief"
          : kind === "bucket"
            ? "purpose"
            : kind === "task"
              ? "description"
              : "body",
      ),
    ),
    [draft, setDraft] = useState(val(row, "draft")),
    [reason, setReason] = useState(""),
    [comment, setComment] = useState(""),
    [links, setLinks] = useState(list(row, "links").join("\n"));
  const [selection, setSelection] = useState(
      val(
        row,
        kind === "note"
          ? "bucket"
          : kind === "bucket"
            ? "responsible_agent"
            : "assigned_agent",
      ) || (kind === "note" ? data.buckets[0]?.id || "" : ""),
    ),
    [status, setStatus] = useState(val(row, "status") || "todo"),
    [readiness, setReadiness] = useState(val(row, "readiness") || "waiting"),
    [waitingReason, setWaitingReason] = useState(val(row, "waiting_reason")),
    [labels, setLabels] = useState(list(row, "labels").join(", "));
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
  };
  const initial = useRef(current).current;
  const dirty = (Object.keys(current) as (keyof typeof current)[]).some(
    (key) => current[key] !== initial[key],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
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
              waiting_reason: readiness === "waiting" ? waitingReason : "",
              ...(status === "needs_review" ? {} : { status }),
              labels: labels
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
              links: links
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
            }
          : kind === "bucket"
            ? { name: title, purpose: body, responsible_agent: selection }
            : { name: title, brief: body };
    void save(`${kind}.${row ? "update" : "create"}`, fields, row, reason);
  };
  if (kind === "review" && row)
    return (
      <div className="crew-dialog-body">
        <div className="crew-review-meta">
          <span
            className={
              val(row, "status") === "pending" ? "crew-human" : "crew-pill"
            }
          >
            {val(row, "status").replaceAll("_", " ")}
          </span>
          <span>
            Snapshot {row.id} · {when(row.created)}
          </span>
        </div>
        <p>
          This is the exact submitted draft. Approval does not send, post or
          publish it.
        </p>
        <div className="crew-draft-snapshot">
          <Prose>{val(row, "draft")}</Prose>
        </div>
        {val(row, "decision_note") && (
          <p>
            <strong>Your decision note:</strong> {val(row, "decision_note")}
          </p>
        )}
        {val(row, "status") === "pending" && (
          <>
            <Field label="Decision note">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Feedback for the next revision"
              />
            </Field>
            <div className="crew-actions">
              <button
                className="crew-primary"
                disabled={busy}
                onClick={() =>
                  void save(
                    "review.decide",
                    { decision: "approved", note: reason },
                    row,
                  )
                }
              >
                Approve draft
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void save(
                    "review.decide",
                    { decision: "changes_requested", note: reason },
                    row,
                  )
                }
              >
                Request changes
              </button>
              <button
                className="crew-danger"
                disabled={busy}
                onClick={() =>
                  void save(
                    "review.decide",
                    { decision: "rejected", note: reason },
                    row,
                  )
                }
              >
                Reject
              </button>
            </div>
            <p className="crew-footnote">
              After approval, perform the external action yourself and mark the
              task Done.
            </p>
          </>
        )}
        {error && (
          <p className="crew-alert" role="alert">
            {error}
          </p>
        )}
      </div>
    );
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
    <button
      type="button"
      className="crew-review-submit"
      disabled={busy}
      onClick={() => void save("review.request", {}, row)}
    >
      Send draft for approval
    </button>
  );
  const buckets = data.buckets.find((x) => x.id === val(row, "bucket"));
  // Controls inside a disabled fieldset can't open, so read-only forms have no help.
  const help = (topic: HelpTopic) => (readOnly ? undefined : topic);
  return (
    <div
      className={`crew-dialog-body${row && (kind === "note" || kind === "task") ? " crew-switching-views" : ""}`}
      ref={root}
    >
      {readOnly && (
        <p className="crew-notice" role="status">
          {archiveNotice}
        </p>
      )}
      {row && kind === "task" && (
        <div className="crew-tabs" role="tablist" aria-label="Record views">
          {["edit", "activity", "reviews"].map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {readOnly && key === "edit"
                ? "Details"
                : key[0].toUpperCase() + key.slice(1)}
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
            {list(row, "links").length > 0 && (
              <section className="crew-linked-notes">
                <h3>Related memory</h3>
                {list(row, "links").map((id) => {
                  const target = data.notes.find((note) => note.id === id);
                  return (
                    <div key={id}>
                      {target && !target.archived ? (
                        <button onClick={() => openNote(target)}>
                          {val(target, "title")} →
                        </button>
                      ) : (
                        <span>
                          {target ? val(target, "title") : "Unavailable note"}{" "}
                          (archived or unavailable)
                        </span>
                      )}
                    </div>
                  );
                })}
              </section>
            )}
          </article>
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
              />
            ) : (
              <Field
                label={kind === "agent" ? "Agent brief" : "Purpose"}
                help={kind === "agent" ? help("brief") : undefined}
              >
                <GrowingTextarea
                  className={kind === "agent" ? "crew-long-text" : ""}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </Field>
            )}
            {kind === "task" && (
              <>
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
                  <Field label="Labels (comma separated)">
                    <input
                      value={labels}
                      onChange={(e) => setLabels(e.target.value)}
                      placeholder="Network, Launch"
                    />
                  </Field>
                </div>
                <div className="crew-form-grid">
                  <Field label="Readiness" help={help("readiness")}>
                    <select
                      value={readiness}
                      onChange={(e) => setReadiness(e.target.value)}
                    >
                      <option value="waiting">Waiting</option>
                      <option value="ready">Ready</option>
                    </select>
                  </Field>
                  {readiness === "waiting" && (
                    <Field label="Waiting reason">
                      <input
                        value={waitingReason}
                        onChange={(e) => setWaitingReason(e.target.value)}
                        placeholder="What needs to happen first?"
                        maxLength={2000}
                      />
                    </Field>
                  )}
                </div>
                <p className="crew-footnote">
                  Ready tasks can wake their assigned agent. Assignment alone
                  does not make a waiting task ready. Pending human review still
                  blocks work.
                </p>
                <MarkdownField
                  label="Draft for review"
                  help={help("draft")}
                  className="crew-long-text"
                  value={draft}
                  onChange={setDraft}
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
              <RelatedNotes
                notes={data.notes}
                currentId={row?.id}
                links={links}
                readOnly={readOnly}
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
                Include its bucket, handoff rules and when to update memory.
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
          {kind !== "note" && more}
          {bar(
            !readOnly && (
              // Always visible in Edit, so there is no guessing how to save.
              <button
                className="crew-primary"
                disabled={busy || (Boolean(row) && !dirty)}
                title={row && !dirty ? "Change something to save" : undefined}
              >
                Save {kind}
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
      {tab === "activity" && (
        <>
          {!readOnly && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (row)
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
              <Field label="Add a comment">
                <textarea
                  required
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </Field>
              <button className="crew-primary" disabled={busy}>
                Add comment
              </button>
            </form>
          )}
          <ol className="crew-timeline">
            {events.map((x) => (
              <li key={x.id}>
                <strong>{val(x, "action")}</strong>
                <small>
                  {when(x.created)} ·{" "}
                  {val(x, "reported_agent") ||
                    val(x, "actor") ||
                    "Owner / connection"}
                </small>
                <p>{val(x, "body") || val(x, "reason")}</p>
              </li>
            ))}
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
              <Prose>{val(x, "draft")}</Prose>
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
  );
}
