import { useState, type ReactNode } from "react";
import { icons, PopoverMenu, type MenuItem } from "./MobileChrome";
import { ConnectionPending, skillCommand } from "./Connect";
import Help from "./Help";
import { RelativeTime } from "./relativeTime";
import { t, tn } from "./i18n";
import { useReaderSettings } from "./sessionGuide";
import HideHelp, { helpIds, useHelpShown } from "./HideHelp";
import {
  isCodingAgent,
  resolveAgentTap,
  type AgentTap,
  type TapAction,
} from "./agentTap";
import { val, type ConnectionState, type Row } from "./crewApi";
import { isClosed } from "./closedTasks";
import {
  homeAgents,
  homeRecent,
  homeStuckTasks,
  type ListSource,
} from "./listSource";
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
// A per-browser convenience: progress itself comes from the workspace data.
// Since 0.37.0 the How it works row and Get started hide with "Don't show this
// again" (HideHelp), kept on the server.
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
  const guideRow = useHelpShown(helpIds.homeGuideRow);
  const [connected, setConnected] = useState(() => stored(connectedKey));
  const getStarted = useHelpShown(helpIds.homeGetStarted);
  const { agentTap } = useReaderSettings();
  if (!ready) return <p role="status">{t("Loading your workspace…")}</p>;

  const allTasks = [...data.tasks, ...archived.tasks];
  const agentSeen =
    allTasks.some((x) => val(x, "created_by_agent")) || data.reviews.length > 0;
  const steps: { title: string; done: boolean; body: ReactNode }[] = [
    {
      title: t("Create your crew"),
      done: data.agents.length + archived.agents.length > 0,
      body: (
        <>
          <p>
            {t(
              "Agents are the AI workers on your team. Each one gets a brief and a place to keep what it learns. Start with five ready-made roles and edit them later.",
            )}
          </p>
          <button className="crew-primary" disabled={busy} onClick={seed}>
            {t("Set up starter crew")}
          </button>
        </>
      ),
    },
    {
      title: t("Connect your first agent"),
      done: connected || agentSeen,
      body: (
        <>
          <ConnectionPending connection={connection} />
          {connection.kind === "mcp" && (
            <>
              <p>
                {t(
                  "Crew doesn't run agents itself. Add this address to your agent platform and approve the connection with your account.",
                )}
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
                {t(
                  "Crew doesn't run agents itself. Your coding agent uses Crew through a skill. Run this once in your Crew folder.",
                )}
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
              {t("I've connected it")}
            </button>
          )}
          <a href={viewHashes.connect}>{t("See full setup")}</a>
        </>
      ),
    },
    {
      title: t("Give your crew a first task"),
      done: allTasks.length > 0,
      body: (
        <>
          <p>
            {t(
              "Describe a piece of work and assign it to an agent. It appears on the Tasks board.",
            )}
          </p>
          <button className="crew-primary" onClick={newTask}>
            {t("＋ New task")}
          </button>
        </>
      ),
    },
    {
      title: t("Review the first draft"),
      done: data.reviews.some((x) => val(x, "status") !== "pending"),
      body: (
        <>
          <p>
            {t(
              "When an agent finishes a draft it asks for your approval. Approving never sends or publishes anything.",
            )}
          </p>
          <a className="crew-home-action" href={viewHashes.reviews}>
            {t("Open Approvals")}
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
    ) || t("Untitled draft");
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
              <span className="crew-home-guide-lead">{t("New to Crew?")}</span>{" "}
              {t("Read how it works")}
            </span>
          </a>
          <HideHelp id={helpIds.homeGuideRow} />
        </div>
      )}
      {current >= 0 && getStarted && (
        <section className="crew-home-start" aria-label={t("Get started")}>
          <header>
            <h2>{t("Get started")}</h2>
            <Help topic="get-started" />
            <span>
              {t("{done} of {total} done", {
                done: steps.filter((step) => step.done).length,
                total: steps.length,
              })}
            </span>
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
                    {step.done && (
                      <span className="sr-only"> {t("(done)")}</span>
                    )}
                  </h3>
                  {index === current && step.body}
                </div>
              </li>
            ))}
          </ol>
          <HideHelp id={helpIds.homeGetStarted} />
        </section>
      )}
      <section className="crew-home-section" aria-label={t("Needs you")}>
        <div className="crew-title-row">
          <h2>{t("Needs you")}</h2>
          <Help topic="needs-you" />
        </div>
        <div className="crew-home-tiles">
          <a
            href={viewHashes.reviews}
            aria-label={tn(
              pending.length,
              "{n} approval waiting, open Approvals",
              "{n} approvals waiting, open Approvals",
            )}
          >
            <b>{pending.length}</b>
            {t("Approvals waiting")}
          </a>
          <a
            href={boardHeldHash}
            aria-label={tn(
              held,
              "{n} task on hold, show on the Tasks board",
              "{n} tasks on hold, show on the Tasks board",
            )}
          >
            <b>{held}</b>
            {t("Tasks on hold")}
          </a>
        </div>
        {(pending.length > 0 || stuck.length > 0) && (
          <div className="crew-home-list">
            {pending.map((review) => (
              <button key={review.id} onClick={() => openReview(review)}>
                <strong>{taskTitle(review)}</strong>
                <small>{t("Draft waiting for your approval")}</small>
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
                    ? t("Stopped after too many agent handoffs")
                    : t("Assigned agent is unavailable")}
                </small>
              </button>
            ))}
          </div>
        )}
      </section>
      {agents.length > 0 && (
        <section className="crew-home-section" aria-label={t("Agents")}>
          <h2>{t("Agents")}</h2>
          <ul className="crew-home-agents">
            {agents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                agents={data.agents}
                status={agentStatus(agent, open)}
                tap={agentTap}
                openItem={openItem}
                onStartSession={onStartSession}
              />
            ))}
          </ul>
        </section>
      )}
      {recent.length > 0 && (
        <section className="crew-home-section" aria-label={t("Recent")}>
          <h2>{t("Recent")}</h2>
          <div className="crew-home-list">
            {recent.map(({ kind, row }) => (
              <button
                key={row.id}
                onClick={() => openItem(kind, row, "home:recent")}
              >
                <strong>{val(row, "title")}</strong>
                <small>
                  {kind === "task" ? t("Task") : t("Note")}
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
      [
        count((x) => val(x, "status") === "needs_review"),
        (n: number) => t("{n} in review", { n }),
      ],
      [
        count((x) => val(x, "status") === "in_progress"),
        (n: number) => t("{n} in progress", { n }),
      ],
      [
        count(
          (x) => val(x, "status") === "todo" && val(x, "readiness") !== "ready",
        ),
        (n: number) => t("{n} on hold", { n }),
      ],
      [
        count(
          (x) => val(x, "status") === "todo" && val(x, "readiness") === "ready",
        ),
        (n: number) => t("{n} to do", { n }),
      ],
    ] as [number, (n: number) => string][]
  )
    .filter(([n]) => n > 0)
    .slice(0, 2)
    .map(([n, label]) => label(n));
  return parts.length ? parts.join(" · ") : t("No open tasks");
}

type AgentRowProps = {
  agent: Row;
  agents: Row[];
  status: string;
  /** Settings > Tapping an agent. */
  tap: AgentTap;
  openItem: (kind: ItemKind, row: Row, source?: ListSource) => void;
  onStartSession: (start: SessionStart) => void;
};

/**
 * A coding agent (started manually; Crew builds its session prompt): a
 * Coding agent tag, and its ⋯ also copies the prompt, which a tap can run.
 */
function CodingAgentRow(props: AgentRowProps) {
  const session = useSessionStart(props.agent, props.onStartSession);
  return (
    <AgentRowView
      {...props}
      coding
      copyPrompt={session.start}
      extra={[
        {
          label: session.loading
            ? t("Preparing the prompt…")
            : t("Copy prompt for coding agent"),
          disabled: session.loading,
          onSelect: session.start,
        },
        { label: t("How coding sessions work"), onSelect: session.openGuide },
      ]}
    >
      {session.guide}
    </AgentRowView>
  );
}

function AgentRow(props: AgentRowProps) {
  return isCodingAgent(props.agent) ? (
    <CodingAgentRow {...props} />
  ) : (
    <AgentRowView {...props} extra={[]} />
  );
}

/**
 * An agent on Home (0.34.0): initials, name and status. Since 0.36.0 a tap
 * anywhere on the row but ⋯ runs the action chosen in Settings > Tapping an
 * agent (Open agent by default); its ⋯ opens the agent, shows its tasks and,
 * for coding agents, copies the prompt.
 */
function AgentRowView({
  agent,
  agents,
  status,
  tap,
  openItem,
  coding = false,
  copyPrompt,
  extra,
  children,
}: AgentRowProps & {
  coding?: boolean;
  copyPrompt?: () => void;
  extra: MenuItem[];
  children?: ReactNode;
}) {
  const name = val(agent, "name");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const open = () => openItem("agent", agent, "home:agents");
  const showTasks = () => {
    location.hash = boardAgentHash(agent.id);
  };
  const run = (action: TapAction) => {
    if (action === "copy_prompt" && copyPrompt) copyPrompt();
    else if (action === "show_tasks") showTasks();
    else open();
  };
  return (
    <li>
      <button
        type="button"
        className="crew-home-agent"
        onClick={() => run(resolveAgentTap(tap, agent))}
      >
        <span className="crew-avatar" aria-hidden="true">
          {agentInitials(name, agents)}
        </span>
        <span className="crew-home-agent-text">
          <span className="crew-home-agent-line">
            <strong>{name}</strong>
            {coding && (
              <span className="crew-coding-pill">{t("Coding agent")}</span>
            )}
          </span>
          <small>{status}</small>
        </span>
      </button>
      <button
        type="button"
        className="crew-home-agent-more"
        aria-label={t("More for {name}", { name })}
        title={t("More")}
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
            { label: t("Open agent"), onSelect: open },
            { label: t("Show tasks"), onSelect: showTasks },
            ...extra,
          ]}
        />
      )}
      {children}
    </li>
  );
}
