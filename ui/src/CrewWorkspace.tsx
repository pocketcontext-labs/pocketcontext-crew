import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Brand from "./Brand";
import { api } from "./api";
import { crewApi, val, list, statuses, lineDiff, type Row } from "./crewApi";
import "./crew.css";
import WebhookStatus from "./WebhookStatus";
import type { ServerVersion } from "./crewApi";
type View = "board" | "memory" | "reviews" | "agents" | "archive";
type Kind = "task" | "note" | "bucket" | "agent" | "review";
type Data = Record<string, Row[]>;
const when = (raw: unknown) =>
  raw ? new Date(String(raw)).toLocaleString() : "Just now";
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
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="crew-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="crew-empty">
      <span aria-hidden="true">↗</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal?.();
    ref.current?.querySelector<HTMLElement>("button,input")?.focus();
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
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button onClick={close} aria-label="Close dialog">
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export default function CrewWorkspace() {
  const [view, setView] = useState<View>("board"),
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
    [assignmentFilter, setAssignmentFilter] = useState("all");
  const [serverVersion, setServerVersion] = useState<ServerVersion | null>();
  const [dialog, setDialog] = useState<{ kind: Kind; row?: Row } | null>(null),
    generation = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setServerVersion(undefined);
    void crewApi
      .serverVersion()
      .then((version) => {
        if (ticket === generation.current) setServerVersion(version);
      })
      .catch(() => {
        if (ticket === generation.current) setServerVersion(null);
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
      setData(Object.fromEntries(result));
      setArchived(Object.fromEntries(old));
      setError("");
    } catch (e) {
      if (ticket === generation.current)
        setError(e instanceof Error ? e.message : "Could not load workspace.");
    } finally {
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
    const openLinkedTask = () => {
      const match = /^#\/tasks\/([a-zA-Z0-9]+)$/.exec(location.hash);
      if (!match) return;
      const task = data.tasks.find((row) => row.id === match[1]);
      if (task) setDialog({ kind: "task", row: task });
    };
    openLinkedTask();
    window.addEventListener("hashchange", openLinkedTask);
    return () => window.removeEventListener("hashchange", openLinkedTask);
  }, [data.tasks]);
  const closeDialog = () => {
    if (location.hash.startsWith("#/tasks/"))
      history.replaceState(
        null,
        "",
        location.pathname + location.search + "#/",
      );
    setDialog(null);
  };
  const perform = async (work: () => Promise<unknown>, message = "Saved.") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      await load();
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
  const nav: [View, string, string][] = [
    ["board", "AI Team", "▦"],
    ["memory", "Shared memory", "▤"],
    ["reviews", "Human approvals", "✓"],
    ["agents", "Agents", "◎"],
    ["archive", "Archive", "↶"],
  ];
  const descriptions = {
    board: "Your agents do the groundwork. You decide what goes out.",
    memory:
      "Keep decisions, preferences and useful findings where every agent can find them.",
    reviews:
      "Review the exact draft. Approval never sends or publishes anything.",
    agents:
      "Define responsibilities and decide what belongs in lasting memory.",
    archive: "Restore notes, tasks and buckets without losing their history.",
  };
  return (
    <div className="crew-app">
      <aside className="crew-sidebar">
        <div className="crew-logo">
          <Brand />
          <strong>Crew</strong>
        </div>
        <p className="crew-workspace-label">YOUR GTM WORKSPACE</p>
        <nav aria-label="Workspace">
          {nav.map(([key, label, icon]) => (
            <button
              key={key}
              aria-current={view === key ? "page" : undefined}
              onClick={() => {
                setView(key);
                setQuery("");
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
              {key === "reviews" && pending.length > 0 && (
                <b>{pending.length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="crew-sidebar-bottom">
          <span />
          One owner. One shared context.
          <button onClick={() => api.logout()}>Sign out</button>
        </div>
      </aside>
      <main className="crew-main">
        <header className="crew-topbar">
          <span>POCKETCONTEXT / CREW</span>
          <div>
            <button disabled={busy || loading} onClick={() => void load()}>
              Refresh
            </button>
            <button
              className="crew-mobile-signout"
              onClick={() => api.logout()}
            >
              Sign out
            </button>
          </div>
        </header>
        <section className="crew-content">
          <div className="crew-heading">
            <div>
              <p className="crew-eyebrow">
                {view === "reviews"
                  ? "YOUR FINAL SAY"
                  : view === "memory"
                    ? "CONTEXT THAT CARRIES FORWARD"
                    : "FROM SHARED CONTEXT TO FINISHED WORK"}
              </p>
              <h1>{nav.find((x) => x[0] === view)?.[1]}</h1>
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
          {loading && <p role="status">Loading your workspace…</p>}
          {!loading &&
            !data.agents.length &&
            !data.buckets.length &&
            view !== "archive" && (
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
                    <h2>
                      <i className={status} />
                      {label}
                      <span>{tasks.length}</span>
                    </h2>
                    {tasks.map((x) => (
                      <button
                        className="crew-task-card"
                        key={x.id}
                        onClick={() => setDialog({ kind: "task", row: x })}
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
                        <p>{val(x, "description").slice(0, 150)}</p>
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
                      <p className="crew-column-empty">
                        {query ? "No matching tasks" : "No tasks here yet"}
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {view === "memory" && (
            <>
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
                      onClick={() => setDialog({ kind: "note", row: x })}
                    >
                      <span className="crew-eyebrow">
                        {name(val(x, "bucket"), "buckets")}
                      </span>
                      <h3>{val(x, "title")}</h3>
                      <p>{val(x, "body").slice(0, 180)}</p>
                      <small>
                        Revision {x.revision} · {when(x.updated)}
                      </small>
                    </button>
                  ))}
              </div>
              {!data.notes.filter(
                (x) => (!bucket || val(x, "bucket") === bucket) && matches(x),
              ).length && (
                <Empty title="Make your context useful">
                  Add a decision, preference or example your agents should
                  remember.
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
                <Empty title="Nothing waiting for your review">
                  Submitted drafts will appear here. Your approval does not
                  perform the external action.
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
                Bucket responsibility is a working agreement. All connected
                agents can read and write memory; their briefs tell them where
                to contribute.
              </div>
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
              <WebhookStatus agents={[...data.agents, ...archived.agents]} />
              <section className="crew-connect">
                <h2>One connection for your agents</h2>
                <p>
                  Add this MCP endpoint in your agent platform, then authorize
                  it with your owner account.
                </p>
                <code>{location.origin}/mcp</code>
                <p>
                  Give each agent its brief above. Scheduling and execution stay
                  in your agent platform.
                </p>
                <a href="/oauth/connections">Manage connected apps →</a>
              </section>
            </>
          )}
          {view === "archive" && (
            <>
              {(["notes", "tasks", "buckets", "agents"] as const).map((c) => (
                <section className="crew-archive-section" key={c}>
                  <h2>
                    {c === "agents" ? "Inactive agents" : `Archived ${c}`}
                  </h2>
                  {!archived[c].length && <p>No archived {c}.</p>}
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
        </footer>
      </main>
      {dialog && (
        <Modal
          title={
            dialog.kind === "review"
              ? "Review draft"
              : `${dialog.row ? "Edit" : "New"} ${dialog.kind}`
          }
          close={() => {
            if (!busy) closeDialog();
          }}
        >
          <Editor
            key={`${dialog.kind}-${dialog.row?.id || "new"}`}
            {...dialog}
            data={{
              ...data,
              agents: [...data.agents, ...archived.agents],
              notes: [...data.notes, ...archived.notes],
            }}
            openNote={(note) => setDialog({ kind: "note", row: note })}
            busy={busy}
            error={error}
            save={save}
            perform={perform}
            close={closeDialog}
          />
        </Modal>
      )}
    </div>
  );
}
type EditorProps = {
  kind: Kind;
  row?: Row;
  data: Data;
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
  openNote,
  busy,
  error,
  save,
  perform,
  close,
}: EditorProps) {
  const [tab, setTab] = useState("edit"),
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
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
  return (
    <div className="crew-dialog-body">
      {row && (
        <div className="crew-tabs" role="tablist" aria-label="Record views">
          {[
            "edit",
            ...(kind === "note" ? ["preview", "history"] : []),
            ...(kind === "task" ? ["activity", "reviews"] : []),
          ].map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {key[0].toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
      )}
      {relatedError && <p className="crew-alert">{relatedError}</p>}
      {tab === "edit" && (
        <form onSubmit={submit}>
          <Field label={kind === "note" || kind === "task" ? "Title" : "Name"}>
            <input
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          {(kind === "note" || kind === "bucket" || kind === "task") && (
            <Field
              label={
                kind === "note"
                  ? "Memory bucket"
                  : kind === "bucket"
                    ? "Responsible agent"
                    : "Assigned agent"
              }
            >
              <select
                value={selection}
                disabled={kind === "note" && !!row}
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
                          kind === "bucket"
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
          <Field
            label={
              kind === "note"
                ? "Note (Markdown)"
                : kind === "task"
                  ? "Description"
                  : kind === "agent"
                    ? "Agent brief"
                    : "Purpose"
            }
          >
            <textarea
              required={kind === "note"}
              className={
                kind === "note" || kind === "agent" ? "crew-long-text" : ""
              }
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
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
                <Field label="Readiness">
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
                Ready tasks can wake their assigned agent. Assignment alone does
                not make a waiting task ready. Pending human review still blocks
                work.
              </p>
              <Field label="Draft for review (Markdown)">
                <textarea
                  className="crew-long-text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </Field>
              <p className="crew-footnote">
                Save the draft before submitting it. Changed drafts need fresh
                review. Human is added automatically when review is pending.
              </p>
            </>
          )}
          {(kind === "note" || kind === "task") && (
            <fieldset className="crew-related">
              <legend>Related memory</legend>
              {data.notes
                .filter((note) => note.id !== row?.id)
                .map((note) => (
                  <label key={note.id}>
                    <input
                      type="checkbox"
                      checked={links.split("\n").includes(note.id)}
                      onChange={(e) =>
                        setLinks(
                          (e.target.checked
                            ? [...links.split("\n").filter(Boolean), note.id]
                            : links.split("\n").filter((id) => id !== note.id)
                          ).join("\n"),
                        )
                      }
                    />
                    <span>
                      {val(note, "title")}
                      {note.archived ? " (archived)" : ""}
                    </span>
                  </label>
                ))}
              {!data.notes.filter((note) => note.id !== row?.id).length && (
                <p>No other notes yet.</p>
              )}
            </fieldset>
          )}
          {row && (
            <Field label="Reason for change">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What changed and why?"
              />
            </Field>
          )}
          {kind === "agent" && (
            <p className="crew-footnote">
              Include its bucket, handoff rules and when to update memory. Agent
              names are reported attribution, not verified identities.
            </p>
          )}
          {kind === "bucket" && (
            <p className="crew-footnote">
              Responsibility is a working agreement. Archiving this bucket hides
              its notes and stops writes until restored.
            </p>
          )}
          <div className="crew-form-footer">
            <button className="crew-primary" disabled={busy}>
              Save {kind}
            </button>
            {row && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void save(`${kind}.update`, { archived: true }, row, reason)
                }
              >
                {kind === "agent" ? "Deactivate agent" : `Archive ${kind}`}
              </button>
            )}
          </div>
          {row && kind === "task" && (
            <button
              type="button"
              className="crew-review-submit"
              disabled={
                busy ||
                !val(row, "draft").trim() ||
                draft !== val(row, "draft") ||
                history.some((x) => val(x, "status") === "pending")
              }
              onClick={() => void save("review.request", {}, row)}
            >
              Submit saved draft for human review →
            </button>
          )}
        </form>
      )}
      {tab === "preview" && (
        <>
          <Prose>{body}</Prose>
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
        </>
      )}
      {tab === "history" && (
        <>
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
                </details>
              );
            })}
        </>
      )}
      {tab === "activity" && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (row)
                void perform(() =>
                  crewApi.write("task.comment", { body: comment }, row),
                ).then(async (ok) => {
                  if (ok) {
                    setComment("");
                    setEvents(await crewApi.read("events", { parent: row.id }));
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
              {val(x, "status") === "pending" && (
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
      {row && (
        <p className="crew-record-id">
          {kind} {row.id} · revision {row.revision}
        </p>
      )}
      {error && (
        <p className="crew-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
