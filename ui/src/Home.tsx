import { useState, type ReactNode } from "react";
import { icons, PopoverMenu, type MenuItem } from "./MobileChrome";
import { ConnectionPending, skillCommand } from "./Connect";
import Help from "./Help";
import { RelativeTime } from "./relativeTime";
import { val, type ConnectionState, type Row } from "./crewApi";
import { isClosed } from "./closedTasks";
import {
  homeAgents,
  homeRecent,
  homeStuckTasks,
  type ListSource,
} from "./listSource";
import { agentKind } from "./projectAgents";
import {
  agentInitials,
  useSessionStart,
  type SessionStart,
} from "./StartSession";
export { longHolds } from "./boardFilters";
import {
  boardAgentHash,
  boardHeldHash,
  viewHashes,
  type ItemKind,
} from "./itemLink";

type Data = Record<string, Row[]>;
const connectedKey = "pocketcontext.crew.agent_connected";
const hiddenKey = "pocketcontext.crew.get_started_hidden";
const guideRowKey = "pocketcontext.crew.how_it_works_hidden";
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
  connection,
  copyEndpoint,
  onStartSession,
}: {
  data: Data;
  archived: Data;
  pending: Row[];
  ready: boolean;
  busy: boolean;
  seed: () => void;
  newTask: () => void;
  /** Opens an item; the source is the Home section it was opened from. */
  openItem: (kind: ItemKind, row: Row, source?: ListSource) => void;
  /** Opens a pending review from Needs you (its list: approvals waiting). */
  openReview: (review: Row) => void;
  invalidAssignment: (task: Row) => boolean;
  connection: ConnectionState;
  copyEndpoint: ReactNode;
  /** One click on a Start a session button: the workspace shows the toast. */
  onStartSession: (start: SessionStart) => void;
}) {
  const [guideRow, setGuideRow] = useState(() => !stored(guideRowKey));
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
          <ConnectionPending connection={connection} />
          {connection.kind === "mcp" && (
            <>
              <p>
                Crew doesn't run agents itself. Add this address to your agent
                platform and approve the connection with your account.
              </p>
              <div className="crew-home-endpoint">
                <code>{connection.url}</code>
                {copyEndpoint}
              </div>
            </>
          )}
          {connection.kind === "local" && (
            <>
              <p>
                Crew doesn't run agents itself. Your coding agent uses Crew
                through a skill. Run this once in your Crew folder.
              </p>
              <div className="crew-home-endpoint">
                <code>{skillCommand}</code>
              </div>
            </>
          )}
          {(connection.kind === "mcp" || connection.kind === "local") && (
            <button
              className="crew-primary"
              onClick={() => {
                remember(connectedKey);
                setConnected(true);
              }}
            >
              I've connected it
            </button>
          )}
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
            the Tasks board.
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
  // Each section's list is also what its items' previous/next walk
  // (listSource.ts), so both use the same helpers.
  const stuck = homeStuckTasks(data.tasks, invalidAssignment);
  const open = data.tasks.filter((x) => !isClosed(x) && !x.archived);
  const held = open.filter((x) => val(x, "readiness") !== "ready").length;
  // Every active agent A–Z (data.agents holds only active ones); none featured.
  const agents = homeAgents(data.agents);
  const recent = homeRecent(data.tasks, data.notes);

  return (
    <div className="crew-home">
      {guideRow && (
        <div className="crew-home-guide">
          <a href={viewHashes.guide}>
            <span>
              <span className="crew-home-guide-lead">New to Crew?</span> Read
              how it works
            </span>
          </a>
          <button
            type="button"
            aria-label="Dismiss How it works"
            title="Dismiss"
            onClick={() => {
              remember(guideRowKey);
              setGuideRow(false);
            }}
          >
            {icons.close}
          </button>
        </div>
      )}
      {current >= 0 && !hidden && (
        <section className="crew-home-start" aria-label="Get started">
          <header>
            <h2>Get started</h2>
            <Help topic="get-started" />
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
      <section className="crew-home-section" aria-label="Needs you">
        <div className="crew-title-row">
          <h2>Needs you</h2>
          <Help topic="needs-you" />
        </div>
        <div className="crew-home-tiles">
          <a
            href={viewHashes.reviews}
            aria-label={`${pending.length} ${pending.length === 1 ? "approval" : "approvals"} waiting, open Approvals`}
          >
            <b>{pending.length}</b>
            Approvals waiting
          </a>
          <a
            href={boardHeldHash}
            aria-label={`${held} ${held === 1 ? "task" : "tasks"} on hold, show on the Tasks board`}
          >
            <b>{held}</b>
            Tasks on hold
          </a>
        </div>
        {(pending.length > 0 || stuck.length > 0) && (
          <div className="crew-home-list">
            {pending.map((review) => (
              <button key={review.id} onClick={() => openReview(review)}>
                <strong>{taskTitle(review)}</strong>
                <small>Draft waiting for your approval</small>
              </button>
            ))}
            {stuck.map((task) => (
              <button
                key={task.id}
                onClick={() => openItem("task", task, "home:tasks")}
              >
                <strong>{val(task, "title")}</strong>
                <small>
                  {task.handoff_limited === true
                    ? "Stopped after too many agent handoffs"
                    : "Assigned agent is unavailable"}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
      {agents.length > 0 && (
        <section className="crew-home-section" aria-label="Agents">
          <h2>Agents</h2>
          <ul className="crew-home-agents">
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                agents={data.agents}
                status={agentStatus(agent, open)}
                openItem={openItem}
                onStartSession={onStartSession}
              />
            ))}
          </ul>
        </section>
      )}
      {recent.length > 0 && (
        <section className="crew-home-section" aria-label="Recent">
          <h2>Recent</h2>
          <div className="crew-home-list">
            {recent.map(({ kind, row }) => (
              <button
                key={row.id}
                onClick={() => openItem(kind, row, "home:recent")}
              >
                <strong>{val(row, "title")}</strong>
                <small>
                  {kind === "task" ? "Task" : "Note"}
                  {val(row, "updated") && (
                    <>
                      {" · "}
                      <RelativeTime value={val(row, "updated")} />
                    </>
                  )}
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * One agent's open work in a few words: up to two of in review, in progress,
 * on hold and to do (in that order), or "No open tasks".
 */
export function agentStatus(agent: Row, open: Row[]) {
  const mine = open.filter((x) => val(x, "assigned_agent") === agent.id);
  const count = (match: (task: Row) => boolean) => mine.filter(match).length;
  const parts = (
    [
      [count((x) => val(x, "status") === "needs_review"), "in review"],
      [count((x) => val(x, "status") === "in_progress"), "in progress"],
      [
        count(
          (x) => val(x, "status") === "todo" && val(x, "readiness") !== "ready",
        ),
        "on hold",
      ],
      [
        count(
          (x) => val(x, "status") === "todo" && val(x, "readiness") === "ready",
        ),
        "to do",
      ],
    ] as [number, string][]
  )
    .filter(([n]) => n > 0)
    .slice(0, 2)
    .map(([n, label]) => `${n} ${label}`);
  return parts.length ? parts.join(" · ") : "No open tasks";
}

type AgentRowProps = {
  agent: Row;
  agents: Row[];
  status: string;
  openItem: (kind: ItemKind, row: Row, source?: ListSource) => void;
  onStartSession: (start: SessionStart) => void;
};

/** A manually started (coding) agent: its ⋯ also copies the session prompt. */
function CodingAgentRow(props: AgentRowProps) {
  const session = useSessionStart(props.agent, props.onStartSession);
  return (
    <AgentRowView
      {...props}
      extra={[
        {
          label: session.loading
            ? "Preparing the prompt…"
            : "Copy prompt for a coding agent",
          disabled: session.loading,
          onSelect: session.start,
        },
        { label: "How coding sessions work", onSelect: session.openGuide },
      ]}
    >
      {session.guide}
    </AgentRowView>
  );
}

function AgentRow(props: AgentRowProps) {
  return agentKind(props.agent) === "external" ? (
    <CodingAgentRow {...props} />
  ) : (
    <AgentRowView {...props} extra={[]} />
  );
}

/**
 * An agent on Home (0.34.0): initials, name and status open the agent; its ⋯
 * opens the agent, shows its tasks and, for coding agents, copies the prompt.
 */
function AgentRowView({
  agent,
  agents,
  status,
  openItem,
  extra,
  children,
}: AgentRowProps & { extra: MenuItem[]; children?: ReactNode }) {
  const name = val(agent, "name");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  return (
    <li>
      <button
        type="button"
        className="crew-home-agent"
        onClick={() => openItem("agent", agent, "home:agents")}
      >
        <span className="crew-avatar" aria-hidden="true">
          {agentInitials(name, agents)}
        </span>
        <span className="crew-home-agent-text">
          <strong>{name}</strong>
          <small>{status}</small>
        </span>
      </button>
      <button
        type="button"
        className="crew-home-agent-more"
        aria-label={`More for ${name}`}
        title="More"
        aria-haspopup="dialog"
        aria-expanded={!!menu}
        onClick={(e) => setMenu(e.currentTarget)}
      >
        {icons.more}
      </button>
      {menu && (
        <PopoverMenu
          label={name}
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Open agent",
              onSelect: () => openItem("agent", agent, "home:agents"),
            },
            {
              label: "Show tasks",
              onSelect: () => {
                location.hash = boardAgentHash(agent.id);
              },
            },
            ...extra,
          ]}
        />
      )}
      {children}
    </li>
  );
}
