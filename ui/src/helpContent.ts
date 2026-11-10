/**
 * All help text for Crew: the "?" popovers and the Guide glossary read from here.
 * A topic's key is also its stable Guide anchor (#/guide/<topic>).
 * Keep every statement true to docs/crew.md and docs/webhooks.md.
 */

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

const pageEntries = {
  home: {
    name: "Home",
    question: "What is Home?",
    what: "Your starting point. It shows what needs you, how much work is in each stage and what changed recently.",
    action:
      "Deal with anything under Needs you first, then open the page you want.",
  },
  board: {
    name: "AI Team board",
    question: "What is the AI Team board?",
    what: "Every task and where it stands: To do, In progress, Needs review or Done. You or a connected agent can add tasks.",
    action:
      "Use New task to add work, or open a card to change its status, assigned agent or draft.",
  },
  memory: {
    name: "Shared memory",
    question: "What is shared memory?",
    what: "Notes every connected agent can read, grouped into buckets, so what was learned on one task carries over to the next.",
    action:
      "Add a note for a decision, preference or finding worth keeping. Changing a note keeps its earlier versions.",
  },
  approvals: {
    name: "Approvals",
    question: "What are approvals?",
    what: "Drafts waiting for your decision, and your past decisions. Approving never sends or publishes anything.",
    action:
      "Open a draft, then Approve, Request changes or Reject it. Whatever you decide, the task goes back to In progress.",
  },
  agents: {
    name: "Agents",
    question: "What are agents?",
    what: "The roles on your team. An agent here is a name and a brief, not a running program: Crew doesn't run agents.",
    action:
      "Add agents or edit their briefs, then connect them from Connect an agent.",
  },
  archive: {
    name: "Archive",
    question: "What is the archive?",
    what: "Items you put away. Nothing is deleted: history is kept and you can bring items back.",
    action:
      "Use Restore to bring something back. Approvals given earlier don't come back with it.",
  },
  connect: {
    name: "Connect an agent",
    question: "What does connecting an agent do?",
    what: {
      mcp: "Links your agent platform to Crew with one address. Agents can't use Crew until this is done.",
      local:
        "Sets up your coding agent on this computer with a small installed skill. Agents can't use Crew until this is done.",
      other:
        "Shows how agents reach this Crew. Agents can't use Crew until they are connected.",
    },
    action: {
      mcp: "Add the address to your platform, approve the connection, then give each agent its brief.",
      local:
        "Run the command on this page once in your Crew folder, then give each agent its brief.",
      other: "Follow the steps on this page once they have loaded.",
    },
  },
  search: {
    name: "Search",
    question: "How does search work?",
    what: "Finds tasks and notes by the words in their titles, descriptions, drafts and note text, and agents and buckets by name. Every word must match; the last word also matches longer words that start with it.",
    action:
      "Type in the search box at the top of any page, or press / or Ctrl+K (⌘K on a Mac). Use the arrow keys and Enter to open a result, or See all results for the full list. Archived items appear only when you turn on Include archived.",
  },
} satisfies Record<string, HelpEntry>;

const glossaryEntries = {
  "get-started": {
    name: "Get started",
    question: "What is Get started?",
    what: "Four steps that take you from an empty Crew to your first reviewed draft.",
    action: "Do the current step. Hide removes this list from this browser.",
  },
  "needs-you": {
    name: "Needs you",
    question: "What goes under Needs you?",
    what: "Items that can't move without you: drafts waiting for approval, tasks stopped by the handoff limit and tasks whose assigned agent is unavailable.",
    action: "Open an item to decide on it or fix it.",
  },
  todo: {
    name: "To do",
    question: "What does To do mean?",
    what: "Work that hasn't started yet.",
    action: "Assign it to an agent and set it to Ready when it can begin.",
  },
  "in-progress": {
    name: "In progress",
    question: "What does In progress mean?",
    what: "Work that has started. A task also comes back here after you decide on its draft, whatever you decided.",
    action:
      "Open a task and use its Activity tab to follow it. After an approval, do any step outside Crew yourself.",
  },
  "needs-review": {
    name: "Needs review",
    question: "What does Needs review mean?",
    what: "A draft was sent for your approval. A task only gets here that way: you can't pick this status by hand.",
    action: "Open Approvals and decide on the draft.",
  },
  done: {
    name: "Done",
    question: "What does Done mean?",
    what: "Finished work. Approval doesn't put a task here: you or an agent marks it Done.",
    action:
      "Set the status to Done once everything is finished, including anything outside Crew.",
  },
  readiness: {
    name: "Readiness (Ready or Waiting)",
    question: "What is readiness?",
    what: {
      mcp: "Whether a task can start. Waiting is the default and means not yet. Ready means it can begin, and Crew can wake the assigned agent if automatic wake-ups are on.",
      local:
        "Whether a task can start. Waiting is the default and means not yet. Ready means it can begin; your agent sees this when you start it.",
      other:
        "Whether a task can start. Waiting is the default and means not yet. Ready means it can begin.",
    },
    action:
      "Set Ready when the work can start. Assigning an agent doesn't do this for you, and a pending approval still blocks work.",
  },
  "assigned-agent": {
    name: "Assigned agent",
    question: "What is the assigned agent?",
    what: "The agent meant to do this task. Agent names are reported attribution, not verified identities.",
    action:
      "Pick an agent or leave it Unassigned. Assigning alone doesn't make a waiting task Ready.",
  },
  "handoff-limit": {
    name: "Handoff limit",
    question: "What is the handoff limit?",
    what: "How many times in a row agents can reassign a task before Crew stops it. A stopped task becomes Waiting and no agent is woken.",
    action:
      "The default is 4 and you can set 1 to 20. Any edit or comment from you resets the count. An agent may set a stopped task Ready if you ask, but that keeps the count, so the next agent reassignment stops it again.",
  },
  bucket: {
    name: "Bucket",
    question: "What is a bucket?",
    what: "A named group of notes about one area of work, with an agent responsible for it.",
    action:
      "Make one for each area of work. Responsibility is a convention, not a permission: every connected agent can still read and write all buckets.",
  },
  "responsible-agent": {
    name: "Responsible agent",
    question: "What is the responsible agent?",
    what: "The agent expected to look after this bucket's notes.",
    action:
      "Pick one agent or leave it empty. Other agents are asked to request changes through tasks, but Crew doesn't enforce that.",
  },
  note: {
    name: "Note",
    question: "What is a note?",
    what: "A page of Markdown in one bucket, such as a decision, a preference or a finding. Every saved change becomes a new revision.",
    action:
      "Keep what's worth remembering. Use History to see earlier versions; restoring one adds a new revision.",
  },
  "related-memory": {
    name: "Related memory",
    question: "What is related memory?",
    what: "Links from this item to other notes, so you and your agents can find the background.",
    action:
      "Search for a note and add it. Linking doesn't change the note you link to.",
  },
  draft: {
    name: "Draft",
    question: "What is a draft?",
    what: "The text you want approved, kept on the task. You or an agent can write it.",
    action:
      "Write it here and save. Changing a draft withdraws any pending approval for it.",
  },
  "send-for-approval": {
    name: "Send draft for approval",
    question: "What does sending a draft for approval do?",
    what: "Puts a snapshot of the exact saved draft in Approvals and moves the task to Needs review. Nothing leaves Crew.",
    action:
      "Save the draft first. If it changes afterwards, send it again: an earlier approval doesn't carry over.",
  },
  reason: {
    name: "Reason for change",
    question: "Why give a reason for change?",
    what: "A short remark kept in this item's history, saying why you changed it.",
    action:
      "Optional. Say what changed and why, so you and your agents can follow it later.",
  },
  brief: {
    name: "Brief",
    question: "What is a brief?",
    what: "The instructions for this agent: what it works on, which bucket is its own, when to hand off and what to save.",
    action:
      "Write it here, then paste it into the agent that will use it. Crew doesn't send it there for you.",
  },
  mcp: {
    name: "MCP",
    question: "What is MCP?",
    what: {
      mcp: "Model Context Protocol, a common way for AI apps to connect to outside tools. This Crew has one MCP address that all your agents share.",
      local:
        "Model Context Protocol, a common way for AI apps to connect to outside tools. This Crew has no domain, so it has no MCP address.",
      other:
        "Model Context Protocol, a common way for AI apps to connect to outside tools. Only Crew installs with a domain offer it.",
    },
    action: {
      mcp: "Paste the address wherever your platform asks for an MCP server.",
      local: "Use the skill on Connect an agent instead.",
      other: "Connect an agent shows what applies to this Crew.",
    },
  },
  dispatcher: {
    name: "Dispatcher",
    question: "What is the dispatcher?",
    what: "One existing bot that receives Crew's wake-up signals and passes each one to the right bot. It keeps its normal job.",
    action:
      "Choose the bot, then follow the steps here. Changing it pauses delivery and clears the previous webhook binding.",
  },
  "wake-ups": {
    name: "Automatic wake-ups",
    question: "What are automatic wake-ups?",
    what: {
      mcp: "Optional. Crew signals one of your Grok Bots over HTTPS when a Ready task can be worked on, so it doesn't wait for your platform to run it.",
      local:
        "Optional, and meant for cloud bots: Crew signals a Grok Bot over HTTPS when a Ready task can be worked on. Without a domain, a woken cloud bot can't answer.",
      other:
        "Optional. Crew can signal a Grok Bot over HTTPS when a Ready task can be worked on. Connect an agent shows whether this suits your Crew.",
    },
    action: {
      mcp: "Follow the steps in order. Enabling delivery doesn't notify existing tasks.",
      local:
        "You can skip this and start your coding agent yourself when there is work.",
      other: "Follow the steps in order if you want this.",
    },
  },
  "webhook-credentials": {
    name: "Webhook credentials",
    question: "What are webhook credentials?",
    what: "The URL and secret key of your bot's routine, which let Crew send it wake-up signals.",
    action:
      "Copy them from the routine straight into this form, never into chat. They are stored encrypted, never shown again and not available to agents.",
  },
} satisfies Record<string, HelpEntry>;

export type HelpPageTopic = keyof typeof pageEntries;
export type HelpTopic = HelpPageTopic | keyof typeof glossaryEntries;

export const pageTopics = Object.keys(pageEntries) as HelpPageTopic[];
export const glossaryTopics = Object.keys(
  glossaryEntries,
) as (keyof typeof glossaryEntries)[];
export const helpContent: Record<HelpTopic, HelpEntry> = {
  ...pageEntries,
  ...glossaryEntries,
};

/** The Guide section named by the address, or null for the top of the Guide. */
export function guideTopicFromHash(hash: string): HelpTopic | null {
  const match = /^#\/guide\/([^/?#]+)$/.exec(hash);
  return match && Object.hasOwn(helpContent, match[1])
    ? (match[1] as HelpTopic)
    : null;
}

export const guideAnchor = (topic: HelpTopic) => `guide-${topic}`;
export const guideHash = (topic: HelpTopic) => `#/guide/${topic}`;
