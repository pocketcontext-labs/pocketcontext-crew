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
import { t } from "./i18n";
import { viewHashes, type View } from "./itemLink";

const pageViews: Record<HelpPageTopic, View> = {
  home: "home",
  board: "board",
  memory: "memory",
  approvals: "reviews",
  agents: "agents",
  archive: "archive",
  connect: "connect",
  search: "search",
};

// Built at render time so a language switch applies at once.
const flow = (): { title: string; detail: string }[] => [
  {
    title: t("You create a task"),
    detail: t("Describe the work on the Tasks board and assign an agent."),
  },
  {
    title: t("An agent drafts it"),
    detail: t(
      "A connected agent does the work and sends a draft for approval.",
    ),
  },
  {
    title: t("You approve"),
    detail: t(
      "Read the exact draft, then approve it, ask for changes or reject it.",
    ),
  },
  {
    title: t("The result is saved as a note"),
    detail: t("You or the agent keep what's worth remembering as a note."),
  },
];

/** What follows "Agents must be connected first." for each kind of install. */
const connectFirst = (mode: HelpMode): string =>
  ({
    mcp: t(
      "Add this Crew's address to your agent platform from Connect an agent.",
    ),
    local: t(
      "Install the skill for your coding agent from Connect an agent. This Crew has no domain, so there is no address to add.",
    ),
    other: t("Connect an agent shows the steps for this Crew."),
  })[mode];

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
        <h2 id="guide-how">{t("How Crew works")}</h2>
        <ol className="crew-guide-flow">
          {flow().map((step, index) => (
            <li key={step.title}>
              <b aria-hidden="true">{index + 1}</b>
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="guide-know">
        <h2 id="guide-know">{t("Good to know")}</h2>
        <ul className="crew-guide-facts">
          <li>
            <strong>{t("Approving never sends or publishes anything.")}</strong>{" "}
            {t(
              "It records your decision. Anything outside Crew, you do yourself.",
            )}
          </li>
          <li>
            <strong>{t("Crew doesn't run agents.")}</strong>{" "}
            {t(
              "They run on your own platform or computer; Crew holds their tasks and notes.",
            )}
          </li>
          <li>
            <strong>{t("Agents must be connected first.")}</strong>{" "}
            {connectFirst(mode)}
          </li>
          <li>
            <strong>{t("History is kept.")}</strong>{" "}
            {t(
              "Items are archived rather than deleted, and you can restore them.",
            )}
          </li>
        </ul>
      </section>
      <section aria-labelledby="guide-sessions">
        <h2 id="guide-sessions">{t("Project agents and coding sessions")}</h2>
        <ul className="crew-guide-facts">
          <li>
            <strong>{t("One agent per project.")}</strong>{" "}
            {t("Create an agent and name it after the project. You can start it in a connected chat.")}
          </li>
          <li>
            <strong>{t("Its queue is its Ready tasks.")}</strong>{" "}
            {t(
              "Assign tasks to it and set them Ready; those are what its sessions work on.",
            )}
          </li>
          <li>
            <strong>{t("Start a session from its card.")}</strong>{" "}
            {t(
              "Copy the instructions from the agent card and paste them into a chat connected to Crew. Open the card menu to see the steps again.",
            )}
          </li>
          <li>
            <strong>{t("Its instructions are saved in Crew.")}</strong>{" "}
            {t(
              "Open Show full instructions to edit them by hand, see their history or restore the default. To change more than a line, use Rewrite with an agent: it copies a prompt for an agent conversation that saves only after you approve.",
            )}
          </li>
          <li>
            <strong>{t("A session claims one task for 2 hours.")}</strong>{" "}
            {t(
              "It renews the claim while it works, and a second session can't take the same task.",
            )}
          </li>
          <li>
            <strong>{t("An expired claim can be released.")}</strong>{" "}
            {t(
              "If a session stops, its task shows Claim expired. Open it and use Release claim to put it back in To do.",
            )}
          </li>
        </ul>
      </section>
      <section aria-labelledby="guide-pages">
        <h2 id="guide-pages">{t("What each page is for")}</h2>
        <div className="crew-guide-entries">
          {pageTopics.map((page) => (
            <Entry key={page} topic={page} current={topic}>
              <a href={viewHashes[pageViews[page]]}>
                {t("Open {page}", { page: helpContent[page].name })}
              </a>
            </Entry>
          ))}
        </div>
      </section>
      <section aria-labelledby="guide-words">
        <h2 id="guide-words">{t("Words used in Crew")}</h2>
        <div className="crew-guide-entries">
          {glossaryTopics.map((word) => (
            <Entry key={word} topic={word} current={topic} />
          ))}
        </div>
      </section>
    </div>
  );
}
