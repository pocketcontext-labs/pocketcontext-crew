import { useContext, useEffect, useState, type ReactNode } from "react";
import { HelpModeContext } from "./Help";
import {
  glossaryTopics,
  guideAnchor,
  guideTopicFromHash,
  helpContent,
  pageTopics,
  textFor,
  type HelpMode,
  type HelpPageTopic,
  type HelpTopic,
} from "./helpContent";
import { viewHashes, type View } from "./itemLink";

const pageViews: Record<HelpPageTopic, View> = {
  home: "home",
  board: "board",
  memory: "memory",
  approvals: "reviews",
  agents: "agents",
  archive: "archive",
  connect: "connect",
};

const flow: { title: string; detail: string }[] = [
  {
    title: "You create a task",
    detail: "Describe the work on the AI Team board and assign an agent.",
  },
  {
    title: "An agent drafts it",
    detail: "A connected agent does the work and sends a draft for approval.",
  },
  {
    title: "You approve",
    detail: "Read the exact draft, then approve it, ask for changes or reject it.",
  },
  {
    title: "The result is saved to memory",
    detail: "You or the agent keep what's worth remembering as a note.",
  },
];

const connectFirst: Record<HelpMode, string> = {
  mcp: "Agents must be connected first. Add this Crew's address to your agent platform from Connect an agent.",
  local:
    "Agents must be connected first. Install the skill for your coding agent from Connect an agent. This Crew has no domain, so there is no address to add.",
  other:
    "Agents must be connected first. Connect an agent shows the steps for this Crew.",
};

function Entry({
  topic,
  current,
  children,
}: {
  topic: HelpTopic;
  current: HelpTopic | null;
  children?: ReactNode;
}) {
  const mode = useContext(HelpModeContext);
  const entry = helpContent[topic];
  return (
    <div
      id={guideAnchor(topic)}
      className={
        topic === current ? "crew-guide-entry current" : "crew-guide-entry"
      }
    >
      <h3>{entry.name}</h3>
      <p>{textFor(entry.what, mode)}</p>
      <p>{textFor(entry.action, mode)}</p>
      {children}
    </div>
  );
}

export default function Guide() {
  const mode = useContext(HelpModeContext);
  const [topic, setTopic] = useState(() => guideTopicFromHash(location.hash));
  useEffect(() => {
    const receive = () => setTopic(guideTopicFromHash(location.hash));
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  useEffect(() => {
    const target = topic
      ? document.getElementById(guideAnchor(topic))
      : document.querySelector(".crew-app");
    target?.scrollIntoView?.({ block: "start" });
  }, [topic]);
  return (
    <div className="crew-guide">
      <section aria-labelledby="guide-how">
        <h2 id="guide-how">How Crew works</h2>
        <ol className="crew-guide-flow">
          {flow.map((step, index) => (
            <li key={step.title}>
              <b aria-hidden="true">{index + 1}</b>
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="guide-know">
        <h2 id="guide-know">Good to know</h2>
        <ul className="crew-guide-facts">
          <li>
            <strong>Approving never sends or publishes anything.</strong> It
            records your decision. Anything outside Crew, you do yourself.
          </li>
          <li>
            <strong>Crew doesn't run agents.</strong> They run on your own
            platform or computer; Crew holds their tasks and memory.
          </li>
          <li>
            <strong>{connectFirst[mode].split(". ")[0]}.</strong>{" "}
            {connectFirst[mode].split(". ").slice(1).join(". ")}
          </li>
          <li>
            <strong>History is kept.</strong> Items are archived rather than
            deleted, and you can restore them.
          </li>
        </ul>
      </section>
      <section aria-labelledby="guide-pages">
        <h2 id="guide-pages">What each page is for</h2>
        <div className="crew-guide-entries">
          {pageTopics.map((page) => (
            <Entry key={page} topic={page} current={topic}>
              <a href={viewHashes[pageViews[page]]}>
                Open {helpContent[page].name}
              </a>
            </Entry>
          ))}
        </div>
      </section>
      <section aria-labelledby="guide-words">
        <h2 id="guide-words">Words used in Crew</h2>
        <div className="crew-guide-entries">
          {glossaryTopics.map((word) => (
            <Entry key={word} topic={word} current={topic} />
          ))}
        </div>
      </section>
    </div>
  );
}
