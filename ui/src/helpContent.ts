/**
 * All help text for Crew: the "?" popovers and the Guide glossary read from here.
 * A topic's key is also its stable Guide anchor (#/guide/<topic>).
 * Keep every statement true to docs/crew.md and docs/webhooks.md.
 * The English text is the translation key (see i18n/index.ts).
 */
import { getLanguage, t, type Language } from "./i18n";

/** How agents reach this install. "other" means it is still unknown. */
export type HelpMode = "mcp" | "local" | "other";
type ByMode = Record<HelpMode, string>;
export type HelpText = string | ByMode;

export type HelpEntry = {
  /** Display name in the Guide. */
  name: string;
  /** Accessible name of the "?" button. */
  question: string;
  /** What this is. */
  what: HelpText;
  /** What to do here. */
  action: HelpText;
};

export const textFor = (text: HelpText, mode: HelpMode) =>
  typeof text === "string" ? text : text[mode];

function pageEntries() {
  return {
    home: {
      name: t("Home"),
      question: t("What is Home?"),
      what: t(
        "Your starting point. It shows what needs you, how much work is in each stage and what changed recently.",
      ),
      action: t(
        "Deal with anything under Needs you first, then open the page you want.",
      ),
    },
    board: {
      name: t("Tasks"),
      question: t("What is the Tasks page?"),
      what: t(
        "Every task and where it stands: To do, In progress, Needs review or Done. You or a connected agent can add tasks.",
      ),
      action: t(
        "Use New task to add work, or open a card to change its status, assigned agent or draft. Click an agent in the row under the search, or the agent on a card, to see only its tasks; click it again for all. The assignment filter also shows unassigned work or tasks that need a new agent. Sort sits beside Filters; Filters holds readiness, label and status, and clicking a label, Ready, On hold or Won't do chip on a card filters by it. Search also understands label:, agent: and status:. To mark what shipped together, use a label such as release-0.23.0.",
      ),
    },
    memory: {
      name: t("Notes"),
      question: t("What is the Notes page?"),
      what: t(
        "Notes every connected agent can read, grouped into buckets, so what was learned on one task carries over to the next.",
      ),
      action: t(
        "Add a note for a decision, preference or finding worth keeping. Changing a note keeps its earlier versions. Select a bucket to show only its notes, use its Edit button to change it, and find notes with the search box at the top.",
      ),
    },
    approvals: {
      name: t("Approvals"),
      question: t("What are approvals?"),
      what: t(
        "Drafts waiting for your decision, and your past decisions. Approving never sends or publishes anything.",
      ),
      action: t(
        "Open a draft, then Approve, Request changes or Reject it. Whatever you decide, the task goes back to In progress. Request changes also makes it Ready, so its bot picks the work up again.",
      ),
    },
    shared: {
      name: t("Shared"),
      question: t("What is the Shared page?"),
      what: t("Shared holds drafts and published pages. Anyone with the link can read a published page."),
      action: t("Create a draft or open an existing one. Review it before publishing, then copy its link."),
    },
    agents: {
      name: t("Agents"),
      question: t("What are agents?"),
      what: t(
        "The roles on your team. An agent here is a name and a brief, not a running program: Crew doesn't run agents.",
      ),
      action: t(
        "Add agents or edit their briefs, then connect them from Connect an agent.",
      ),
    },
    archive: {
      name: t("Archive"),
      question: t("What is the archive?"),
      what: t(
        "Items you put away. Nothing is deleted: history is kept and you can bring items back.",
      ),
      action: t(
        "Use Restore to bring something back. Approvals given earlier don't come back with it.",
      ),
    },
    connect: {
      name: t("Connect an agent"),
      question: t("What does connecting an agent do?"),
      what: {
        mcp: t(
          "Links your agent platform to Crew with one address. Agents can't use Crew until this is done.",
        ),
        local: t(
          "Sets up your coding agent on this computer with a small installed skill. Agents can't use Crew until this is done.",
        ),
        other: t(
          "Shows how agents reach this Crew. Agents can't use Crew until they are connected.",
        ),
      },
      action: {
        mcp: t(
          "Add the address to your platform, approve the connection, then give each agent its brief.",
        ),
        local: t(
          "Run the command on this page once in your Crew folder, then give each agent its brief.",
        ),
        other: t("Follow the steps on this page once they have loaded."),
      },
    },
    search: {
      name: t("Search"),
      question: t("How does search work?"),
      what: t(
        "Finds tasks and notes by the words in their titles, descriptions, drafts and note text, and agents and buckets by name. Every word must match; the last word also matches longer words that start with it.",
      ),
      action: t(
        "Type in the search box at the top of any page, or press / or Ctrl+K (⌘K on a Mac). Use the arrow keys and Enter to open a result, or See all results for the full list. Archived items appear only when you turn on Include archived.",
      ),
    },
  } satisfies Record<string, HelpEntry>;
}

function glossaryEntries() {
  return {
    "get-started": {
      name: t("Get started"),
      question: t("What is Get started?"),
      what: t(
        "Four steps that take you from an empty Crew to your first reviewed draft.",
      ),
      action: t(
        "Do the current step. Don't show this again hides this list.",
      ),
    },
    "tapping-an-agent": {
      name: t("Tapping an agent"),
      question: t("How do I change what tapping an agent does?"),
      what: t("Tapping an agent can open its profile or show its tasks."),
      action: t("In Settings → Tapping an agent, choose All agents to set the default, or choose an agent by name to give it a different action."),
    },
    "needs-you": {
      name: t("Needs you"),
      question: t("What goes under Needs you?"),
      what: t(
        "How many drafts wait for your approval and how many open tasks are on hold, then the items that can't move without you: drafts waiting for approval, tasks stopped by the handoff limit and tasks whose assigned agent is unavailable.",
      ),
      action: t(
        "Tap a count to open those items, or open an item to decide on it or fix it.",
      ),
    },
    todo: {
      name: t("To do"),
      question: t("What does To do mean?"),
      what: t("Work that hasn't started yet."),
      action: t("Assign it to an agent and set it to Ready when it can begin."),
    },
    "in-progress": {
      name: t("In progress"),
      question: t("What does In progress mean?"),
      what: t(
        "Work that has started. A task also comes back here after you decide on its draft, whatever you decided.",
      ),
      action: t(
        "Open a task and use its Comments tab for the conversation and Activity for the full history. After an approval, do any step outside Crew yourself.",
      ),
    },
    "needs-review": {
      name: t("Needs review"),
      question: t("What does Needs review mean?"),
      what: t(
        "A draft was sent for your approval. A task only gets here that way: you can't pick this status by hand.",
      ),
      action: t("Open Approvals and decide on the draft."),
    },
    done: {
      name: t("Done"),
      question: t("What does Done mean?"),
      what: t(
        "Finished work, plus tasks set to Won't do, most recently changed first; the last 7 days show unless you pick a label or Show older. Approval doesn't put a task here: you or an agent marks it Done. A coding session that you approve in the terminal adds a release label (for example release-0.23.0) and records \"Approved in session\".",
      ),
      action: t(
        "Mark a task Done when its work in Crew is finished. A pending draft stays in Approvals until you decide.",
      ),
    },
    status: {
      name: t("Status"),
      question: t("What do the statuses mean?"),
      what: t(
        "To do: not started. In progress: being worked on. Needs review: a saved draft is waiting for your decision in Approvals. Done: finished. Won't do: decided against.",
      ),
      action: t(
        "Crew sets Needs review when you or an agent requests approval for a saved draft. You can mark the task Done while the draft awaits your decision. Requesting changes reopens the task.",
      ),
    },
    readiness: {
      name: t("Hold (On hold or Ready)"),
      question: t("What do On hold and Ready mean?"),
      what: {
        mcp: t(
          "Whether a task can start. On hold is the default: nobody is woken and a person decides. Ready means the assigned bot may act, and Crew can wake it if automatic wake-ups are on. Crew puts a task on hold by itself when its draft is edited, its review is withdrawn or the handoff limit is reached, and says why.",
        ),
        local: t(
          "Whether a task can start. On hold is the default: nobody is woken and a person decides. Ready means the assigned agent may act; your agent sees this when you start it.",
        ),
        other: t(
          "Whether a task can start. On hold is the default: nobody is woken and a person decides. Ready means the assigned agent may act.",
        ),
      },
      action: t(
        "Set Ready when the work can start. Assigning an agent doesn't do this for you, and a pending approval still blocks work. Putting a task on hold always works and stops any run in progress.",
      ),
    },
    "assigned-agent": {
      name: t("Assigned agent"),
      question: t("What is the assigned agent?"),
      what: t(
        "The agent meant to do this task. Agent names are reported attribution, not verified identities.",
      ),
      action: t(
        "Pick an agent or leave it Unassigned. Assigning alone doesn't take a task off hold.",
      ),
    },
    "handoff-limit": {
      name: t("Handoff limit"),
      question: t("What is the handoff limit?"),
      what: t(
        "How many times in a row agents can reassign a task before Crew stops it. A stopped task goes on hold and no agent is woken.",
      ),
      action: t(
        "The default is 4 and you can set 1 to 20. Any edit or comment from you resets the count. An agent may set a stopped task Ready if you ask, but that keeps the count, so the next agent reassignment stops it again.",
      ),
    },
    bucket: {
      name: t("Bucket"),
      question: t("What is a bucket?"),
      what: t(
        "A named group of notes about one area of work, with an agent responsible for it.",
      ),
      action: t(
        "Make one for each area of work. Responsibility is a convention, not a permission: every connected agent can still read and write all buckets.",
      ),
    },
    "responsible-agent": {
      name: t("Responsible agent"),
      question: t("What is the responsible agent?"),
      what: t("The agent expected to look after this bucket's notes."),
      action: t(
        "Pick one agent or leave it empty. Other agents are asked to request changes through tasks, but Crew doesn't enforce that.",
      ),
    },
    note: {
      name: t("Note"),
      question: t("What is a note?"),
      what: t(
        "A page of Markdown in one bucket, such as a decision, a preference or a finding. Every saved change becomes a new revision.",
      ),
      action: t(
        "Keep what's worth remembering. Use History to see earlier versions; restoring one adds a new revision.",
      ),
    },
    "related-memory": {
      name: t("Related"),
      question: t("What are related tasks and notes?"),
      what: t(
        "Links from this item to other tasks and notes, so you and your agents can find the background. Items that link here show under Linked from.",
      ),
      action: t(
        "Search for a task or note and add it. Linking doesn't change the item you link to, but it shows this item under Linked from.",
      ),
    },
    draft: {
      name: t("Draft"),
      question: t("What is a draft?"),
      what: t(
        "The text and options you want approved. You or an agent can edit them on the task.",
      ),
      action: t(
        "Save the draft and its options here. Saving a change to them withdraws the pending review.",
      ),
    },
    "send-for-approval": {
      name: t("Request approval"),
      question: t("What does Request approval do?"),
      what: t(
        "Saves the submitted text and options in Approvals and moves the task to Needs review.",
      ),
      action: t(
        "Save a draft or add options for the reviewer. If you change the draft later, request approval again.",
      ),
    },
    reason: {
      name: t("Reason for change"),
      question: t("Why give a reason for change?"),
      what: t(
        "A short remark kept in this item's history, saying why you changed it.",
      ),
      action: t(
        "Optional. Say what changed and why, so you and your agents can follow it later.",
      ),
    },
    brief: {
      name: t("Brief"),
      question: t("What is a brief?"),
      what: t("Describe the agent’s role, the work it owns, and who it serves."),
      action: t("For example, Sell handles outreach to founders. Put repeatable steps in Session instructions."),
    },
    "session-instructions": {
      name: t("Session instructions"),
      question: t("What belongs in session instructions?"),
      what: t("Describe the steps the agent follows each time it works."),
      action: t("For example, read the assigned task, draft two options, and request approval. Define the agent’s role in Agent brief."),
    },
    "agent-start": {
      name: t("How an agent is started"),
      question: t("How is an agent started?"),
      what: t(
        "Start an agent in a connected chat by copying its instructions. To wake it automatically for ready tasks, connect an integration and enable automatic startup for that agent.",
      ),
      action: t(
        "Open the agent to see its instructions and startup settings.",
      ),
    },
    claim: {
      name: t("Claim"),
      question: t("What is a claim?"),
      what: t(
        "A coding session marks the one task it is working on as claimed for 2 hours, renewed while it works, so a second session can't take the same task. The claim names the session for your information; it isn't an identity.",
      ),
      action: t(
        "Nothing to do while it is live. Claim expired means the session stopped renewing it: release the claim to put the task back in To do.",
      ),
    },
    mcp: {
      name: t("MCP"),
      question: t("What is MCP?"),
      what: {
        mcp: t(
          "Model Context Protocol, a common way for AI apps to connect to outside tools. This Crew has one MCP address that all your agents share.",
        ),
        local: t(
          "Model Context Protocol, a common way for AI apps to connect to outside tools. This Crew has no domain, so it has no MCP address.",
        ),
        other: t(
          "Model Context Protocol, a common way for AI apps to connect to outside tools. Only Crew installs with a domain offer it.",
        ),
      },
      action: {
        mcp: t(
          "Paste the address wherever your platform asks for an MCP server.",
        ),
        local: t("Use the skill on Connect an agent instead."),
        other: t("Connect an agent shows what applies to this Crew."),
      },
    },
    dispatcher: {
      name: t("Dispatcher"),
      question: t("What is the dispatcher?"),
      what: t(
        "One existing bot that receives Crew's wake-up signals and passes each one to the right bot. It keeps its normal job.",
      ),
      action: t(
        "Choose the bot, then follow the steps here. Changing it pauses delivery and clears the previous webhook binding.",
      ),
    },
    "wake-ups": {
      name: t("Automatic wake-ups"),
      question: t("What are automatic wake-ups?"),
      what: {
        mcp: t(
          "Optional. Crew signals one of your Grok Bots over HTTPS when a Ready task can be worked on, so it doesn't wait for your platform to run it.",
        ),
        local: t(
          "Optional, and meant for cloud bots: Crew signals a Grok Bot over HTTPS when a Ready task can be worked on. Without a domain, a woken cloud bot can't answer.",
        ),
        other: t(
          "Optional. Crew can signal a Grok Bot over HTTPS when a Ready task can be worked on. Connect an agent shows whether this suits your Crew.",
        ),
      },
      action: {
        mcp: t(
          "Follow the steps in order. Enabling delivery doesn't notify existing tasks.",
        ),
        local: t(
          "You can skip this and start your coding agent yourself when there is work.",
        ),
        other: t("Follow the steps in order if you want this."),
      },
    },
    "webhook-credentials": {
      name: t("Webhook credentials"),
      question: t("What are webhook credentials?"),
      what: t(
        "The URL and secret key of your bot's routine, which let Crew send it wake-up signals.",
      ),
      action: t(
        "Copy them from the routine straight into this form, never into chat. They are stored encrypted, never shown again and not available to agents.",
      ),
    },
  } satisfies Record<string, HelpEntry>;
}

export type HelpPageTopic = keyof ReturnType<typeof pageEntries>;
type GlossaryTopic = keyof ReturnType<typeof glossaryEntries>;
export type HelpTopic = HelpPageTopic | GlossaryTopic;

export const pageTopics = Object.keys(pageEntries()) as HelpPageTopic[];
export const glossaryTopics = Object.keys(glossaryEntries()) as GlossaryTopic[];

// Built in the current language and rebuilt when it changes, so every read
// (Help, Guide, the phone help sheet) follows a language switch at once.
let built: { lang: Language; table: Record<HelpTopic, HelpEntry> } | undefined;
const table = () => {
  const lang = getLanguage();
  if (built?.lang !== lang)
    built = { lang, table: { ...pageEntries(), ...glossaryEntries() } };
  return built.table;
};

/** Every topic's help in the current language (read at render time). */
export const helpContent = Object.defineProperties(
  {},
  Object.fromEntries(
    [...pageTopics, ...glossaryTopics].map((topic) => [
      topic,
      { enumerable: true, get: () => table()[topic] },
    ]),
  ),
) as Readonly<Record<HelpTopic, HelpEntry>>;

/** The Guide section named by the address, or null for the top of the Guide. */
export function guideTopicFromHash(hash: string): HelpTopic | null {
  const match = /^#\/guide\/([^/?#]+)$/.exec(hash);
  return match && Object.hasOwn(helpContent, match[1])
    ? (match[1] as HelpTopic)
    : null;
}

export const guideAnchor = (topic: HelpTopic) => `guide-${topic}`;
export const guideHash = (topic: HelpTopic) => `#/guide/${topic}`;
