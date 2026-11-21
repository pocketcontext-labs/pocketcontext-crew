import { useState, type ReactNode } from "react";
import { CopyGlyph, useCopyFeedback } from "./CopyFeedback";
import { icons, PopoverMenu, type MenuItem } from "./MobileChrome";
import { ConnectionPending, skillCommand } from "./Connect";
import Help from "./Help";
import { RelativeTime } from "./relativeTime";
import { t, tn } from "./i18n";
import { useReaderSettings } from "./sessionGuide";
import HideHelp, { helpIds, useHelpShown } from "./HideHelp";
import {
  resolveAgentTap,
  type AgentTap,
} from "./agentTap";
import { val, type ConnectionState, type Row } from "./crewApi";
import { canStartChat } from "./projectAgents";
import { isClosed } from "./closedTasks";
import {
  homeAgents,
  homeRecent,
  homeStuckTasks,
  type ListSource,
} from "./listSource";
import {
  agentInitials,
  agentMenuItems,
  chatMenuItems,
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
  starterCrewBanner,
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
  starterCrewBanner: ReactNode;
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
  const [confirmedAgents, setConfirmedAgents] = useState<string[]>([]);
  const [pastedFor, setPastedFor] = useState("");
  const getStarted = useHelpShown(helpIds.homeGetStarted);
  const { agentTap } = useReaderSettings();
  if (!ready) return null;

  const allTasks = [...data.tasks, ...archived.tasks];
  const activeAgents = data.agents.filter(canStartChat);
  const connected = activeAgents.some(({ id }) =>
    confirmedAgents.includes(id) || stored(connectedKey + "." + id),
  );
  const agentSeen =
    allTasks.some((x) => val(x, "created_by_agent")) || data.reviews.length > 0;
  const readyTasks = data.tasks.filter((task) => task.readiness === "ready" &&
    activeAgents.some((agent) => agent.id === task.assigned_agent));
  const firstTask = readyTasks.find((task) => task.status === "todo") ?? readyTasks[0];
  const assignee = activeAgents.find((agent) => agent.id === firstTask?.assigned_agent);
  const pasteKey = "pocketcontext.crew.prompt_pasted." + assignee?.id;
  const steps: { title: string; done: boolean; body: ReactNode }[] = [
    {
      title: t("Create your crew"),
      done: data.agents.length > 0,
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
      done: activeAgents.length > 0 && (connected || agentSeen),
      body: (
        <>
          <ConnectionPending connection={connection} />
          {connection.kind === "mcp" && (
            <>
              <p>
                {t(
                  "Copy this MCP server address into your agent platform, then approve the connection in Crew.",
                )}
              </p>
              <div className="crew-connect-address">
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
          <div className="crew-onboarding-actions">
            {(connection.kind === "mcp" || connection.kind === "local") && (
              <button
                className="crew-primary"
                onClick={() => {
                  const ids = activeAgents.map(({ id }) => id);
                  ids.forEach((id) => remember(connectedKey + "." + id));
                  setConfirmedAgents(ids);
                }}
              >
                {t("I've connected it")}
              </button>
            )}
            <a href={viewHashes.connect}>{t("See full setup")}</a>
          </div>
        </>
      ),
    },
    {
      title: t("Give your crew a first task"),
      done: Boolean(firstTask),
      body: (
        <>
          <p>
            {t(
              "Create a task or open an existing one. Assign it to an agent, set readiness to Ready, and save.",
            )}
          </p>
          {data.tasks.length > 0 && <a href={viewHashes.board}>{t("Open Tasks")}</a>}
          <button className="crew-primary" onClick={newTask}>
            {t("＋ New task")}
          </button>
        </>
      ),
    },
    {
      title: t("Start the agent in a chat"),
      done: Boolean(assignee && (pastedFor === assignee.id || stored(pasteKey))),
      body: assignee && firstTask && (
        <PromptHandoff key={assignee.id} agent={assignee} task={firstTask} notify={onStartSession}
          confirm={() => { remember(pasteKey); setPastedFor(assignee.id); }} />
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
      {!getStarted && starterCrewBanner}
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
          <div className="crew-title-row">
            <h2>{t("Agents")}</h2>
            <Help topic="tapping-an-agent" />
          </div>
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

function PromptHandoff({ agent, task, notify, confirm }: {
  agent: Row;
  task: Row;
  notify: (start: SessionStart) => void;
  confirm: () => void;
}) {
  const session = useSessionStart(agent, notify);
  return <>
    <p>{t("Copy the prompt for {name}, paste it into a chat connected to Crew, and send it. Then ask the agent to work on “{task}”.", { name: val(agent, "name"), task: val(task, "title") })}</p>
    <div className="crew-onboarding-actions crew-prompt-actions">
      <button className="crew-primary" disabled={session.loading} onClick={() => void session.start()}>{t("Copy startup prompt")}</button>
      <button onClick={confirm}>{t("I've pasted and sent the prompt")}</button>
    </div>
    {session.guide}
  </>;
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
 * Nonhuman agents share session instructions across manual and automatic startup.
 */
function SessionAgentRow(props: AgentRowProps) {
  const session = useSessionStart(props.agent, props.onStartSession);
  const rowCopy = useCopyFeedback();
  const menuCopy = useCopyFeedback();
  return (
    <AgentRowView
      {...props}
      preparing={session.loading}
      copyPrompt={() => void rowCopy.run(session.start)}
      copyIcon={<CopyGlyph state={rowCopy.state} />}
      moreIcon={<CopyGlyph state={menuCopy.state} idle="more" />}
      extra={chatMenuItems(props.agent, session.loading, <CopyGlyph state={menuCopy.state} />,
        () => void menuCopy.run(session.start), session.openGuide)}
    >
      {session.guide}
    </AgentRowView>
  );
}

function AgentRow(props: AgentRowProps) {
  return canStartChat(props.agent) ? (
    <SessionAgentRow {...props} />
  ) : (
    <AgentRowView {...props} extra={[]} />
  );
}

/**
 * An agent on Home (0.34.0): initials, name and status. Since 0.36.0 a tap
 * anywhere on the row but ⋯ runs the action chosen in Settings > Tapping an
 * agent (Open agent by default). A separate button copies a nonhuman agent's instructions.
 */
function AgentRowView({
  agent,
  agents,
  status,
  tap,
  openItem,
  preparing = false,
  copyPrompt,
  copyIcon,
  moreIcon,
  extra,
  children,
}: AgentRowProps & {
  preparing?: boolean;
  copyPrompt?: () => void;
  copyIcon?: ReactNode;
  moreIcon?: ReactNode;
  extra: MenuItem[];
  children?: ReactNode;
}) {
  const name = val(agent, "name");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const open = () => openItem("agent", agent, "home:agents");
  const showTasks = () => {
    location.hash = boardAgentHash(agent.id);
  };
  const startup = copyPrompt ? (agent.chat_start === "webhook" ? "webhook" : "manual") : "person";
  const action = resolveAgentTap(tap, agent);
  const run = () => {
    if (action === "copy_prompt" && copyPrompt) copyPrompt();
    else if (action === "show_tasks") showTasks();
    else open();
  };
  return (
    <li>
      <button
        type="button"
        className="crew-home-agent"
        onClick={run}
      >
        <span className="crew-avatar" aria-hidden="true">
          {agentInitials(name, agents)}
        </span>
        <span className="crew-home-agent-text">
          <strong>{name}</strong>
          <span className="crew-home-agent-meta">
            <span className="crew-home-startup-badge" data-start={startup}>
              {startup === "person" ? t("Person") : startup === "webhook" ? t("Automatic startup") : t("Manual start")}
            </span>
            <small>{status}</small>
          </span>
        </span>
      </button>
      {copyPrompt && (
        <button
          type="button"
          className="crew-copy-control crew-copy-icon"
          aria-label={t("Copy instructions for {name}", { name })}
          title={t("Copy instructions for {name}", { name })}
          disabled={preparing}
          onClick={copyPrompt}
        >
          {copyIcon}
        </button>
      )}
      <button
        type="button"
        className="crew-home-agent-more crew-micon"
        aria-label={t("More for {name}", { name })}
        title={t("More")}
        aria-haspopup="dialog"
        aria-expanded={!!menu}
        onClick={(e) => setMenu(e.currentTarget)}
      >
        {moreIcon ?? icons.more}
      </button>
      {menu && (
        <PopoverMenu
          label={name}
          anchor={menu}
          onClose={() => setMenu(null)}
          items={agentMenuItems(open, showTasks, extra)}
        />
      )}
      {children}
    </li>
  );
}
