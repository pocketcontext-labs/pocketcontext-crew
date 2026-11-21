import { useEffect, useState } from "react";
import { crewApi, statuses, val, type Row } from "./crewApi";
import { canStartChat, claimOf, copyText } from "./projectAgents";
import { CopyControl } from "./CopyFeedback";
import { itemPath, itemTabPath } from "./itemLink";
import { followLink } from "./trail";
import { t } from "./i18n";

import { isClosed } from "./closedTasks";

const fields = [
  "title",
  "status",
  "readiness",
  "claim_state",
  "claimed_by",
  "claim_until",
  "webhook_holder",
  "last_saved_step",
];

export default function AgentAssignments({ agent }: { agent: Row }) {
  const [tasks, setTasks] = useState<Row[]>([]);
  const [selected, select] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    setLoaded(false);
    setFailed(false);
    setTasks([]);
    select("");
    crewApi.read("tasks", { assigned_agent: agent.id, fields }).then(
      (rows) => {
        if (current) {
          setTasks([...rows].sort((a, b) => Number(isClosed(a)) - Number(isClosed(b))));
          setLoaded(true);
        }
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [agent.id, retry]);
  // The chat itself must acquire the lease under its own session name.
  // Only a deliberate selection copies this separate, task-specific message.
  const choice =
    selected &&
    t(
      "I choose task {id}. Read its current state and claim it before starting.",
      { id: selected },
    );
  if (loaded && !tasks.length) return <p className="crew-agent-no-tasks">{t("No assigned tasks")}</p>;
  return (
    <section className="crew-agent-assignments">
      <h3>{t("Assigned tasks")}</h3>
      {failed ? (
        <button type="button" onClick={() => setRetry(retry + 1)}>
          {t("Retry")}
        </button>
      ) : !loaded ? (
        <p>{t("Loading assigned tasks…")}</p>
      ) : null}
      {tasks.map((task) => {
        const claim = claimOf(task);
        const holder =
          val(task, "webhook_holder") ||
          (claim.state === "live" ? claim.by : "");
        const ready = task.readiness === "ready";
        const available = canStartChat(agent) && ready && (task.status === "todo" || task.status === "in_progress") && !holder;
        const path = itemTabPath(itemPath("task", task), "comments");
        return (
          <article key={task.id}>
            <a href={path} onClick={(e) => followLink(e, path)}>
              {val(task, "title")}
            </a>
            <small>
              <span className="crew-assignment-status">{t(statuses.find(([key]) => key === task.status)?.[1] ?? "Task")}</span>
              {!isClosed(task) && (ready ? t("Ready") : t("On hold"))}
              {holder && " · " + t("Claimed by {by}", { by: holder })}
            </small>
            {task.last_saved_step ? (
              <p className="crew-assignment-preview">{val(task, "last_saved_step")}</p>
            ) : null}
            {available && (
              <label>
                <input
                  type="radio"
                  name="chat-task"
                  checked={selected === task.id}
                  onChange={() => select(task.id)}
                />
                {t("Choose {title}", { title: val(task, "title") })}
              </label>
            )}
          </article>
        );
      })}
      {choice && (
        <div>
          <p>{t("Paste this choice into your Crew-connected chat.")}</p>
          <output>{choice}</output>
          <CopyControl
            label={t("Copy task choice")}
            copy={() => copyText(choice)}
          />
        </div>
      )}
    </section>
  );
}
