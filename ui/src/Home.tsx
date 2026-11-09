import { useState, type ReactNode } from "react";
import { statuses, val, type Row } from "./crewApi";
import { viewHashes, type ItemKind } from "./itemLink";

type Data = Record<string, Row[]>;
const connectedKey = "pocketcontext.crew.agent_connected";
const hiddenKey = "pocketcontext.crew.get_started_hidden";

// Per-browser conveniences: progress itself comes from the workspace data.
function stored(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function remember(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* Optional storage: the choice lasts until reload. */
  }
}

export default function Home({
  data,
  archived,
  pending,
  ready,
  busy,
  seed,
  newTask,
  openItem,
  openReview,
  invalidAssignment,
  copyEndpoint,
}: {
  data: Data;
  archived: Data;
  pending: Row[];
  ready: boolean;
  busy: boolean;
  seed: () => void;
  newTask: () => void;
  openItem: (kind: ItemKind, row: Row) => void;
  openReview: (review: Row) => void;
  invalidAssignment: (task: Row) => boolean;
  copyEndpoint: ReactNode;
}) {
  const [connected, setConnected] = useState(() => stored(connectedKey));
  const [hidden, setHidden] = useState(() => stored(hiddenKey));
  if (!ready) return <p role="status">Loading your workspace…</p>;

  const allTasks = [...data.tasks, ...archived.tasks];
  const agentSeen =
    allTasks.some((x) => val(x, "created_by_agent")) || data.reviews.length > 0;
  const steps: { title: string; done: boolean; body: ReactNode }[] = [
    {
      title: "Create your crew",
      done: data.agents.length + archived.agents.length > 0,
      body: (
        <>
          <p>
            Agents are the AI workers on your team. Each one gets a brief and a
            place to keep what it learns. Start with five ready-made roles and
            edit them later.
          </p>
          <button className="crew-primary" disabled={busy} onClick={seed}>
            Set up starter crew
          </button>
        </>
      ),
    },
    {
      title: "Connect your first agent",
      done: connected || agentSeen,
      body: (
        <>
          <p>
            Crew doesn't run agents itself. Add this address to your agent
            platform and approve the connection with your account.
          </p>
          <div className="crew-home-endpoint">
            <code>{location.origin}/mcp</code>
            {copyEndpoint}
          </div>
          <button
            className="crew-primary"
            onClick={() => {
              remember(connectedKey);
              setConnected(true);
            }}
          >
            I've connected it
          </button>
          <a href={viewHashes.connect}>See full setup</a>
        </>
      ),
    },
    {
      title: "Give your crew a first task",
      done: allTasks.length > 0,
      body: (
        <>
          <p>
            Describe a piece of work and assign it to an agent. It appears on
            the AI Team board.
          </p>
          <button className="crew-primary" onClick={newTask}>
            ＋ New task
          </button>
        </>
      ),
    },
    {
      title: "Review the first draft",
      done: data.reviews.some((x) => val(x, "status") !== "pending"),
      body: (
        <>
          <p>
            When an agent finishes a draft it asks for your approval. Approving
            never sends or publishes anything.
          </p>
          <a className="crew-home-action" href={viewHashes.reviews}>
            Open Approvals
          </a>
        </>
      ),
    },
  ];
  const current = steps.findIndex((step) => !step.done);
  const taskTitle = (review: Row) =>
    val(
      allTasks.find((x) => x.id === val(review, "task")),
      "title",
    ) || "Untitled draft";
  const stuck = data.tasks.filter(
    (x) =>
      val(x, "status") !== "done" &&
      (x.handoff_limited === true || invalidAssignment(x)),
  );
  const recent = [
    ...data.tasks.map((row) => ({ kind: "task" as const, row })),
    ...data.notes.map((row) => ({ kind: "note" as const, row })),
  ]
    .sort((a, b) => val(b.row, "updated").localeCompare(val(a.row, "updated")))
    .slice(0, 5);
  const nothingNeeded = !pending.length && !stuck.length;

  return (
    <div className="crew-home">
      {current >= 0 && !hidden && (
        <section className="crew-home-start" aria-label="Get started">
          <header>
            <h2>Get started</h2>
            <span>
              {steps.filter((step) => step.done).length} of {steps.length} done
            </span>
            <button
              onClick={() => {
                remember(hiddenKey);
                setHidden(true);
              }}
            >
              Hide
            </button>
          </header>
          <ol>
            {steps.map((step, index) => (
              <li
                key={step.title}
                aria-current={index === current ? "step" : undefined}
                className={step.done ? "done" : undefined}
              >
                <i aria-hidden="true">{step.done ? "✓" : index + 1}</i>
                <div>
                  <h3>
                    {step.title}
                    {step.done && <span className="sr-only"> (done)</span>}
                  </h3>
                  {index === current && step.body}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section aria-label="Needs you">
        <h2>Needs you</h2>
        {nothingNeeded && <p>Nothing needs you right now.</p>}
        <div className="crew-home-list">
          {pending.map((review) => (
            <button key={review.id} onClick={() => openReview(review)}>
              <strong>{taskTitle(review)}</strong>
              <small>Draft waiting for your approval</small>
            </button>
          ))}
          {stuck.map((task) => (
            <button key={task.id} onClick={() => openItem("task", task)}>
              <strong>{val(task, "title")}</strong>
              <small>
                {task.handoff_limited === true
                  ? "Stopped after too many agent handoffs"
                  : "Assigned agent is unavailable"}
              </small>
            </button>
          ))}
        </div>
      </section>
      <section aria-label="Your crew right now">
        <h2>Your crew right now</h2>
        <div className="crew-home-counts">
          {statuses.map(([status, label]) => (
            <a key={status} href={viewHashes.board}>
              <b>{data.tasks.filter((x) => val(x, "status") === status).length}</b>
              {label}
            </a>
          ))}
        </div>
      </section>
      {recent.length > 0 && (
        <section aria-label="Recently updated">
          <h2>Recently updated</h2>
          <div className="crew-home-list">
            {recent.map(({ kind, row }) => (
              <button key={row.id} onClick={() => openItem(kind, row)}>
                <strong>{val(row, "title")}</strong>
                <small>
                  {kind === "task" ? "Task" : "Note"}
                  {val(row, "updated") &&
                    ` · ${new Date(val(row, "updated")).toLocaleString()}`}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
