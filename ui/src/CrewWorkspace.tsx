import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";
import { NamedCopyAction, CopyControl, CopyGlyph, useCopyFeedback } from "./CopyFeedback";
import { Icon } from "./Icon";
import Brand from "./Brand";
import { api } from "./api";
import {
  crewApi,
  val,
  list,
  statuses,
  boardStatuses,
  lineDiff,
  type AgentSession,
  type ConnectionState,
  type Row,
} from "./crewApi";
import Connect from "./Connect";
import Guide from "./Guide";
import Help, {
  HelpField,
  HelpModeContext,
  helpIsOpenIn,
  helpMode,
} from "./Help";
import type { HelpTopic } from "./helpContent";
import Home from "./Home";
import Settings from "./Settings";
import { loadReaderSettings } from "./sessionGuide";
import LabelsInput from "./LabelsInput";
import { markdownExcerpt, markdownText } from "./markdownText";
import { taskBrief } from "./reviewMarkup";
import { ExcerptContent } from "./ExcerptContent";
import { ReviewChoices, ReviewContent, ReviewDecision } from "./Review";
import MarkdownField from "./MarkdownField";
import { ReadTitle, ReadField } from "./ReadFields";
import TaskDraft, { draftFields, makeEditorOptions, savedOptions, updateOption, removeOption, type WorkingDraft } from "./TaskDraft";
import { decisionSummary, objects, reviewOptions } from "./reviews";
import { strandedWakes } from "./wakes";
import {
  approvalLine,
  doneColumn,
  isClosed,
} from "./closedTasks";
import StartSession, {
  SessionToast,
  useSessionStart,
  agentInitials,
  type SessionStart,
} from "./StartSession";
import AgentAssignments from "./AgentAssignments";
import AgentStartupSettings from "./AgentStartupSettings";
import SessionInstructions from "./SessionInstructions";
import UndoToast, { messageToastMs, undoToastMs } from "./UndoToast";
import {
  clearedBoard,
  commitBoardSearch,
  filterChips,
  heldDuration,
  heldSince,
  isLongHeld,
  knownLabels,
  labelMatches,
  longHolds,
  parseBoardSearch,
  statusMatches,
  tokensMatch,
} from "./boardFilters";
import {
  agentKind,
  canStartChat,
  agentKindSuffix,
  claimAgent,
  claimOf,
  claimLabel,
  claimTitle,
  copyText,
} from "./projectAgents";
import { GlobalSearch, SearchPage, type SearchEntry } from "./Search";
import { searchHash, searchTextFromHash, type SearchHit } from "./searchApi";
import "./crew.css";
import "./fields.css";
import type { ServerVersion } from "./crewApi";
import {
  AttachmentsProvider,
  AttachmentsSection,
  CardThumbnail,
  eventSummary,
  fileInputHandlers,
  fileReference,
  isFileEvent,
  namePasted,
  filesOf,
  useItemAttachments,
  useStagedFiles,
  withdrawnNoticeText,
} from "./Attachments";
import {
  attachmentsApi,
  checkFiles,
  isImage,
  replaceUploadPlaceholder,
  uploadPlaceholder,
  useFileToken,
  type CardThumb,
  type FileRefusal,
} from "./attachmentsApi";
import {
  boardColumnFromHash,
  connectSectionFromHash,
  bucketSorts,
  holdFilters,
  isItemHash,
  itemPath,
  itemShareUrl,
  itemTabPath,
  taskTabs,
  type TaskTab,
  legacyRedirect,
  noteSorts,
  parseItemHash,
  type BucketSort,
  type HoldFilter,
  type ItemKind,
  type NoteSort,
  type View,
  type ViewState,
  viewFromHash,
  viewHashes,
  viewStateFromHash,
  viewStateHash,
  reviewFocusFromHash,
  reviewHash,
  sharedFocusFromHash,
} from "./itemLink";
import Shared from "./Shared";
import Prose from "./Prose";
import DialogHeader, {
  DialogMenuContext,
  ListNavCluster,
  NavCluster,
  menuIsOpenIn,
  useDialogMenu,
  type MenuItem,
} from "./DialogHeader";
import {
  followLink,
  followTrail,
  listDepth,
  pushFromList,
  resetTrail,
  stepTrail,
  useTrail,
} from "./trail";
import {
  listKeyStep,
  swipeFeedback,
  type Step,
  type StepResult,
} from "./swipe";
import Archive, { type RestoreItem } from "./Archive";
import AutoTextarea, { AutoTextField } from "./AutoTextarea";
import ClaimBanner from "./ClaimBanner";
import HoldReasonField from "./HoldReasonField";
import PlainRefs from "./PlainRefs";
import { RelativeTime, useNow, type Instant } from "./relativeTime";
import { usePhone } from "./usePhone";
import {
  icons,
  MobileTabBar,
  MobileTopBar,
  PopoverMenu,
  Sheet,
  type MenuItem as PopoverItem,
  type PageAction,
} from "./MobileChrome";
import NewSharedPage from "./NewSharedPage";
import {
  currentListSource,
  homeList,
  listSourceNoun,
  type ListSource,
} from "./listSource";
import ColumnSwitcher from "./ColumnSwitcher";
import { NoteRows, NotesFilterSheet } from "./NotesMobile";
import { t, tn } from "./i18n";
// Page names, eyebrows and sort and filter labels below stay English in their
// tables and are translated where they render: t(label).
const nav: [View, string, ReactNode][] = [
  ["home", "Home", icons.home],
  ["board", "Tasks", icons.tasks],
  ["memory", "Notes", icons.notes],
  ["reviews", "Approvals", icons.approvals],
  ["shared", "Shared", icons.shared],
  ["agents", "Agents", icons.agent],
  ["archive", "Archive", <Icon name="archive" />],
];
const pages: [View, string, ReactNode][] = [
  ...nav,
  ["connect", "Connect an agent", "⇄"],
  ["guide", "Guide", "?"],
  ["search", "Search", "⌕"],
  ["settings", "Settings", "⚙"],
];
const eyebrows: Record<View, string> = {
  home: "START HERE",
  board: "BOARD",
  memory: "BUCKETS AND NOTES",
  reviews: "YOUR FINAL SAY",
  agents: "YOUR TEAM",
  archive: "NOTHING IS DELETED",
  connect: "ONE CONNECTION FOR ALL YOUR AGENTS",
  guide: "HOW IT WORKS",
  search: "FIND ANYTHING",
  shared: "PAGES YOU SHARE BY LINK",
  settings: "YOUR PREFERENCES",
};
const viewHelp: Partial<Record<View, HelpTopic>> = {
  home: "home",
  board: "board",
  memory: "memory",
  reviews: "approvals",
  shared: "shared",
  agents: "agents",
  archive: "archive",
  connect: "connect",
  search: "search",
};
const statusHelp: Record<(typeof boardStatuses)[number][0], HelpTopic> = {
  todo: "todo",
  in_progress: "in-progress",
  needs_review: "needs-review",
  done: "done",
};
type Kind = "task" | "note" | "bucket" | "agent" | "review";
type Data = Record<string, Row[]>;
type LoadOutcome = "ok" | "failed" | "stale";
type RefreshStatus = { ok: boolean; text: string };
/**
 * Never fires hashchange, so writing the address cannot open a dialog. The
 * entry keeps its state: its place in a link trail (trail.ts).
 */
const setAddress = (hash: string) =>
  history.replaceState(
    history.state,
    "",
    location.pathname + location.search + hash,
  );
/** Replaces an old page address with its current form, adding no history entry. */
const redirectLegacyAddress = () => {
  const next = legacyRedirect(location.hash);
  if (next) setAddress(next);
};
/** A plain history entry; it starts a new link trail (see trail.ts). */
const pushAddress = (hash: string) => {
  if (location.hash !== hash) {
    history.pushState(null, "", location.pathname + location.search + hash);
    resetTrail();
  }
};
/**
 * Where the owner lands after Archive task on an Approval detail (0.40.0).
 *
 * The approved mockup: the next approval in the list the detail was opened
 * from (the Approvals page or Home's approvals waiting), in that list's
 * order. `list` and `index` are the dialog's list and the archived approval's
 * place in it before the archive; `pending` is the reviews still pending after
 * it. With none left after it, the detail closes and the list shows.
 *
 * To return to the list every time instead, as Approve does, return undefined.
 */
function approvalAfterArchive(
  list: readonly { kind: Kind; row: Row }[] | null,
  index: number,
  pending: readonly Row[],
): Row | undefined {
  if (!list || index < 0) return undefined;
  for (const { kind, row } of list.slice(index + 1)) {
    const next =
      kind === "review" ? pending.find((x) => x.id === row.id) : undefined;
    if (next) return next;
  }
  return undefined;
}
/**
 * What a failed write says about itself: the HTTP status (0 when nothing came
 * back from the server) and the server's reason code, if it gave one.
 */
function writeFailure(failure: unknown): { status: number; code: string } {
  const f = failure as {
    status?: unknown;
    response?: { data?: { reason?: { code?: unknown } } };
    data?: { reason?: { code?: unknown } };
  } | null;
  const code = f?.response?.data?.reason?.code ?? f?.data?.reason?.code;
  return {
    status: Number(f?.status) || 0,
    code: typeof code === "string" ? code : "",
  };
}
const noteSortLabels: Record<NoteSort, string> = {
  updated: "Sort: Last updated",
  created: "Sort: Newest first",
  title: "Sort: Title A–Z",
  bucket: "Sort: Bucket",
};
const bucketSortLabels: Record<BucketSort, string> = {
  name: "Sort: Name",
  notes: "Sort: Most notes",
  activity: "Sort: Last activity",
};
const byName = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
/** Newest first; timestamps share one format, and missing ones sort last. */
const byNewest = (a: unknown, b: unknown) =>
  String(b || "").localeCompare(String(a || ""));
/** All, unassigned, invalid, or an active agent's id. */
const validAssignment = (value: string, agents: Row[]) =>
  value === "all" ||
  value === "unassigned" ||
  value === "invalid" ||
  agents.some((x) => x.id === value);
/** Whether a task shows under the board's assignment filter. */
function assignmentMatches(
  filter: string,
  task: Row,
  invalid: (task: Row) => boolean,
) {
  if (filter === "all") return true;
  // Unassigned and invalid are queues of open work.
  if (filter === "unassigned")
    return !isClosed(task) && !val(task, "assigned_agent");
  if (filter === "invalid")
    return !isClosed(task) && invalid(task);
  return val(task, "assigned_agent") === filter;
}
const holdFilterLabels: Record<HoldFilter, string> = {
  all: "On hold and Ready",
  on_hold: "On hold",
  ready: "Ready",
};
/** Whether a task shows under the board's hold filter; Done and Won't do have no hold. */
function holdMatches(filter: HoldFilter, task: Row) {
  if (filter === "all") return true;
  if (isClosed(task)) return false;
  return (val(task, "readiness") === "ready") === (filter === "ready");
}
/** Readiness as the reader names it: the API keeps `waiting` for On hold. */
const onHold = (task: Row) => val(task, "readiness") !== "ready";
/** A record date as relative text with the exact time on hover (RelativeTime). */
const when = (raw: unknown) => (
  <RelativeTime value={raw as Instant} fallback={t("just now")} />
);
/**
 * On hold (with its reason on hover) or Ready; not shown for Done tasks.
 * With `onFilter` (board cards) the chip is a button that filters the board
 * by that readiness, like a label chip.
 */
function HoldChip({
  task,
  onFilter,
}: {
  task: Row;
  onFilter?: (hold: "ready" | "on_hold") => void;
}) {
  if (!onHold(task)) {
    if (val(task, "status") !== "todo") return null;
    return onFilter ? (
      <FilterChipButton
        className="crew-ready-chip"
        label={t("Filter by readiness Ready")}
        onFilter={() => onFilter("ready")}
      >
        {t("Ready")}
      </FilterChipButton>
    ) : (
      <span className="crew-ready-chip">{t("Ready")}</span>
    );
  }
  const reason = val(task, "waiting_reason").trim();
  const content = (
    <>
      {heldDuration(task) ? t("On hold {duration}", { duration: heldDuration(task) }) : t("On hold")}
      {reason && <span className="sr-only">: {reason}</span>}
    </>
  );
  return onFilter ? (
    <FilterChipButton
      className="crew-hold-chip"
      label={t("Filter by readiness On hold")}
      title={reason || undefined}
      onFilter={() => onFilter("on_hold")}
    >
      {content}
    </FilterChipButton>
  ) : (
    <span className="crew-hold-chip" title={reason || undefined}>
      {content}
    </span>
  );
}
/**
 * A card chip that filters the board: it never opens the card under it
 * (click, Enter and Space stop at the chip) and shares one hover and focus
 * style with every other filter chip.
 */
function FilterChipButton({
  className,
  label,
  title,
  onFilter,
  children,
}: {
  className: string;
  label: string;
  title?: string;
  onFilter: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`crew-chip-filter ${className}`}
      aria-label={label}
      title={title ?? label}
      onClick={(e) => {
        e.stopPropagation();
        onFilter();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}
/** A coding session's claim: time left (exact times on hover), or expired. */
function ClaimChip({ task }: { task: Row }) {
  const now = useNow().getTime();
  const claim = claimOf(task, now);
  if (!claim.state) return null;
  const title = claimTitle(claim);
  const warning = claim.state === "expired" || Date.parse(claim.until) - now < 15 * 60000;
  return (
    <span className={warning ? "crew-claim-expired" : "crew-claim-chip"} title={title}>
      {claimLabel(claim, now)}
    </span>
  );
}
const wakeMissingTitle = () =>
  t("Crew woke the assigned bot but it never confirmed receiving the wake. Check the bot's conversation, then set the task On hold and Ready again if it should run.");
function WakeMissingChip() {
  return (
    <span className="crew-human" title={wakeMissingTitle()}>
      {t("Wake not received")}
    </span>
  );
}
function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: HelpTopic;
  children: ReactNode;
}) {
  if (help)
    return (
      <HelpField label={label} topic={help}>
        {children as ReactElement<{ id?: string }>}
      </HelpField>
    );
  return (
    <label className="crew-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Empty({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="crew-empty">
      <span aria-hidden="true">↗</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action && <div className="crew-empty-action">{action}</div>}
    </div>
  );
}
function CopyLink({
  target,
  label = t("Copy link"),
  copiedLabel = t("Link copied"),
}: {
  target: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="crew-copy-link">
      <CopyControl
        copy={() => copyText(target)}
        label={label}
        successLabel={copiedLabel}
        onResult={(ok) => setFailed(!ok)}
      />
      {failed && (
        <span role="alert" className="crew-copy-error">
          {t("Could not copy automatically. Copy it from here:")} <code>{target}</code>
        </span>
      )}
    </span>
  );
}
/** The session header provides a manual fallback if the clipboard refuses the prompt. */
function HeadCopy({
  target,
  label = t("Copy link"),
  copiedLabel = t("Link copied"),
}: {
  target: string;
  label?: string;
  copiedLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="crew-head-copy">
      <CopyControl
        copy={() => copyText(target)}
        label={label}
        successLabel={copiedLabel}
        onResult={(ok) => setFailed(!ok)}
      />
      {failed && (
        <span role="alert" className="crew-head-alert">
          {t("Could not copy automatically. Copy it from here:")} <code>{target}</code>
        </span>
      )}
    </span>
  );
}
/** Creates a draft artifact prefilled from a note; publishing is on Shared. */
async function shareAsArtifact(note: Row) {
  const created = await crewApi.write(
    "artifact.create",
    {
      title: val(note, "title"),
      body: val(note, "body"),
      sources: [note.id],
    },
    undefined,
    "Share as artifact",
  );
  return created.id as string;
}
type Related = { id: string; kind: ItemKind; row?: Row };
/**
 * Links (0.24.0) name tasks or notes. `linked` are this record's own links in
 * order; `linkedFrom` are other records that link here and aren't linked back,
 * so a relationship shows on both sides without writing it twice.
 */
function relatedItems(
  data: Data,
  currentId: string | undefined,
  links: string[],
): { linked: Related[]; linkedFrom: Related[] } {
  const find = (id: string): Related => {
    const task = (data.tasks || []).find((x) => x.id === id);
    if (task) return { id, kind: "task", row: task };
    const note = (data.notes || []).find((x) => x.id === id);
    return { id, kind: "note", row: note };
  };
  const linked = links.map(find);
  const linkedFrom: Related[] = [];
  if (currentId)
    for (const kind of ["task", "note"] as const)
      for (const row of data[`${kind}s`] || [])
        if (
          row.id !== currentId &&
          !links.includes(row.id) &&
          list(row, "links").includes(currentId)
        )
          linkedFrom.push({ id: row.id, kind, row });
  return { linked, linkedFrom };
}
/** A past review's status as the reader names it; unknown values show as stored. */
const reviewStatusLabel = (status: string) =>
  ({
    pending: t("pending"),
    approved: t("approved"),
    changes_requested: t("changes requested"),
    rejected: t("rejected"),
    withdrawn: t("withdrawn"),
  })[status] ?? status.replaceAll("_", " ");
const kindName = (kind: ItemKind) => (kind === "task" ? t("Task") : t("Note"));
/**
 * A related task or note by title, linking to its permanent address. A click
 * is the next step of the link trail, like a reference in text, so Back
 * returns here; unsaved changes are confirmed by the hashchange handler.
 */
function RelatedLink({ item }: { item: Related }) {
  const { row, kind } = item;
  if (!row) return <span className="crew-related-missing">{t("Unavailable item")}</span>;
  const title = val(row, "title") || t("Untitled");
  return (
    <span className="crew-related-item">
      <span className="crew-related-kind">{kindName(kind)}</span>
      <a
        href={itemPath(kind, row)}
        onClick={(e) => followLink(e, itemPath(kind, row))}
      >
        {title}
      </a>
      {row.archived ? <span className="crew-related-archived">{t("archived")}</span> : null}
    </span>
  );
}
/**
 * Related, the same on tasks and notes (Read and Edit): links with Remove,
 * Linked from, and the search that adds a link. Read-only hides the controls.
 */
function RelatedItems({
  data,
  currentId,
  links,
  setLinks,
  readOnly,
}: {
  data: Data;
  currentId?: string;
  links: string;
  setLinks: (next: string) => void;
  readOnly: boolean;
}) {
  const [query, setQuery] = useState("");
  const ids = links.split("\n").filter(Boolean);
  const { linked, linkedFrom } = relatedItems(data, currentId, ids);
  const candidates: Related[] = [
    ...(data.tasks || []).map((row) => ({ id: row.id, kind: "task" as const, row })),
    ...(data.notes || []).map((row) => ({ id: row.id, kind: "note" as const, row })),
  ].filter((x) => x.id !== currentId && !x.row.archived);
  const needle = query.trim().toLowerCase();
  const results = needle
    ? candidates
        .filter(
          (x) =>
            !ids.includes(x.id) &&
            val(x.row, "title").toLowerCase().includes(needle),
        )
        .slice(0, 8)
    : [];
  return (
    <fieldset className="crew-related" aria-label={t("Related")}>
      <legend>
        <span>{t("Related")}</span>
        {!readOnly && <Help topic="related-memory" />}
      </legend>
      {!linked.length && !linkedFrom.length && (
        <p className="crew-related-empty">{t("No related items")}</p>
      )}
      {linked.length > 0 && (
        <ul className="crew-related-linked" aria-label={t("Links")}>
          {linked.map((item) => (
            <li key={item.id}>
              <RelatedLink item={item} />
              {!readOnly && (
                <button
                  type="button"
                  className="crew-related-remove"
                  aria-label={t("Remove {title}", {
                    title: item.row ? val(item.row, "title") : t("unavailable item"),
                  })}
                  title={t("Remove link")}
                  onClick={() =>
                    setLinks(ids.filter((x) => x !== item.id).join("\n"))
                  }
                >
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {linkedFrom.length > 0 && (
        <>
          <h4 className="crew-related-heading">{t("Linked from")}</h4>
          <ul className="crew-related-linked" aria-label={t("Linked from")}>
            {linkedFrom.map((item) => (
              <li key={item.id}>
                <RelatedLink item={item} />
              </li>
            ))}
          </ul>
        </>
      )}
      {!readOnly && candidates.length > 0 && (
        <label className="crew-field crew-related-search">
          <span>{t("Link a task or note")}</span>
          <input
            type="search"
            placeholder={t("Search tasks and notes")}
            value={query}
            // Searching is not an edit to the record.
            onChange={(e) => {
              e.stopPropagation();
              setQuery(e.target.value);
            }}
          />
        </label>
      )}
      {results.length > 0 && (
        <ul className="crew-related-results">
          {results.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => {
                  setLinks([...ids, x.id].join("\n"));
                  setQuery("");
                }}
              >
                <span className="crew-related-kind">{kindName(x.kind)}</span>{" "}
                {val(x.row, "title")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {needle && !results.length && <p>{t("No matching tasks or notes.")}</p>}
    </fieldset>
  );
}
/**
 * Back and forward through records opened from links in text (0.29.0). The
 * two buttons stay in place, disabled when there is nowhere to go, and use
 * the browser's own history, so browser Back and Forward agree with them.
 */
function TrailNav() {
  const trail = useTrail();
  return (
    <NavCluster
      back={trail.back ? () => history.back() : undefined}
      forward={trail.forward ? () => history.forward() : undefined}
    />
  );
}
/**
 * The list a record dialog was opened from (0.31.0; buttons and "x of y"
 * since 0.32.0): the header's previous/next and J/K step through it.
 * Inactive when the list does not hold the item (its slot stays, hidden);
 * previous/next are false at the ends. index is zero-based.
 */
type ListNav = {
  noun: string;
  active: boolean;
  previous: boolean;
  next: boolean;
  index: number;
  count: number;
  go: (step: Step) => StepResult;
};
function Modal({
  title,
  nav,
  listNav,
  actions,
  menu = [],
  hideEmptyMenu = false,
  record = false,
  toast,
  children,
  close,
  onEdit,
}: {
  /** A record dialog keeps one size, whatever it shows. */
  record?: boolean;
  /**
   * The workspace toast while this dialog is open: everything outside an open
   * modal dialog is inert, so the toast is shown inside it.
   */
  toast?: ReactNode;
  title: string;
  /** Shown before the title, so it never moves when the title changes. */
  nav?: ReactNode;
  /** Stepping through the source list, with its header cluster. */
  listNav?: ListNav;
  /** Icon buttons in the header pill. */
  actions?: ReactNode;
  /** The More menu's own items; the body can add more through context. */
  menu?: MenuItem[];
  hideEmptyMenu?: boolean;
  children: ReactNode;
  close: () => void;
  onEdit: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [bodyMenu, setBodyMenu] = useState<MenuItem[]>([]);
  // One handler for the header buttons and J/K.
  const step = (direction: Step) => {
    if (!listNav?.active) return;
    const result = listNav.go(direction);
    swipeFeedback(ref.current, result, direction);
    // The next item replaces the body, and a button at the end turns
    // disabled: keep focus in the dialog so J/K keep working.
    if (result === "moved")
      requestAnimationFrame(() => {
        const dialog = ref.current;
        if (dialog && !dialog.contains(document.activeElement))
          dialog.focus({ preventScroll: true });
      });
  };
  const pressedBackdrop = useRef(false);
  const helpWasOpen = useRef(false);
  // A native file picker opened from inside the dialog: while it is open, and
  // briefly after it closes, a stray Escape, cancel or backdrop click comes from
  // dismissing the picker, not from the owner closing this dialog.
  const pickerOpen = useRef(false);
  const pickerClosedAt = useRef(0);
  const pickerBusy = () =>
    pickerOpen.current || Date.now() - pickerClosedAt.current < 600;
  const openedPicker = (target: EventTarget) => {
    if (!(target instanceof HTMLInputElement) || target.type !== "file") return;
    pickerOpen.current = true;
    const done = () => {
      if (!pickerOpen.current) return;
      pickerOpen.current = false;
      pickerClosedAt.current = Date.now();
      window.removeEventListener("focus", done);
      target.removeEventListener("cancel", done);
      target.removeEventListener("change", done);
    };
    window.addEventListener("focus", done);
    target.addEventListener("cancel", done);
    target.addEventListener("change", done);
  };
  // Backdrop clicks target the dialog itself, as do its scrollbars, so use position.
  const onBackdrop = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== ref.current) return false;
    const box = ref.current.getBoundingClientRect();
    return (
      e.clientX < box.left ||
      e.clientX > box.right ||
      e.clientY < box.top ||
      e.clientY > box.bottom
    );
  };
  // A layout effect: the dialog is focused in the commit that shows it.
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal?.();
    // showModal focuses the first control; the dialog itself takes focus so
    // nothing is highlighted on open and Tab still starts at the first control.
    ref.current?.focus({ preventScroll: true });
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
      className={`crew-dialog${record ? " crew-record-dialog" : ""}`}
      tabIndex={-1}
      onChange={onEdit}
      onKeyDown={(e) => {
        const direction = listNav?.active ? listKeyStep(e, ref.current) : 0;
        if (!direction) return;
        e.preventDefault();
        step(direction);
      }}
      // Runs before Help's own listener, so it still sees the popover. The first
      // click outside an open popover only dismisses the popover.
      onPointerDown={() => {
        helpWasOpen.current =
          helpIsOpenIn(ref.current) || menuIsOpenIn(ref.current);
      }}
      onScroll={(e) =>
        e.currentTarget.classList.toggle(
          "crew-scrolled",
          e.currentTarget.scrollTop > 0,
        )
      }
      onMouseDown={(e) => {
        pressedBackdrop.current =
          onBackdrop(e) && !helpWasOpen.current && !pickerBusy();
      }}
      onClickCapture={(e) => openedPicker(e.target)}
      onClick={(e) => {
        // A drag that starts inside, such as selecting text, must not close it.
        if (pressedBackdrop.current && onBackdrop(e) && !pickerBusy()) close();
        pressedBackdrop.current = false;
      }}
      onCancel={(e) => {
        // A file input fires a bubbling cancel when its picker is dismissed;
        // only a cancel aimed at the dialog itself (Escape) closes it.
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        if (pickerBusy()) return;
        close();
      }}
      aria-label={title}
    >
      <DialogHeader
        title={title}
        nav={nav}
        listNav={
          listNav && (
            <ListNavCluster
              noun={listNav.noun}
              index={listNav.index}
              count={listNav.count}
              previous={listNav.previous ? () => step(-1) : undefined}
              next={listNav.next ? () => step(1) : undefined}
              hidden={!listNav.active}
            />
          )
        }
        actions={actions}
        menu={[...menu, ...bodyMenu]}
        hideEmptyMenu={hideEmptyMenu}
        close={close}
      />
      <DialogMenuContext.Provider value={setBodyMenu}>
        {children}
      </DialogMenuContext.Provider>
      {toast && <div className="crew-dialog-toast">{toast}</div>}
    </dialog>
  );
}
export default function CrewWorkspace() {
  const [sharedHeader, setSharedHeader] = useState<HTMLDivElement | null>(null);
  // Phones get the slim top bar, bottom tabs and one board column at a time.
  const phone = usePhone();
  const [view, setView] = useState<View>(() => {
      redirectLegacyAddress();
      return viewFromHash(location.hash);
    }),
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
    // Tasks and Notes filters and sorts, kept in the address
    // (#/tasks?agent=…, #/notes?bucket=…&sort=…).
    [viewState, setViewState] = useState<ViewState>(() =>
      viewStateFromHash(location.hash),
    ),
    // The Search page's query, from its address; null for an invalid address.
    [searchText, setSearchText] = useState(() =>
      searchTextFromHash(location.hash),
    ),
    // Bumped after each save, so search results show the change.
    [saves, setSaves] = useState(0),
    // The first image of each task and note, for card thumbnails.
    [thumbs, setThumbs] = useState<Record<string, CardThumb>>({}),
    // Wake bridges, for "Wake not received" on tasks whose wake is overdue.
    [bridges, setBridges] = useState<Row[]>([]),
    // The records the Search page shows, for stepping through them.
    [searchEntries, setSearchEntries] = useState<SearchEntry[]>([]);
  const thumbToken = useFileToken(Object.keys(thumbs).length > 0);
  // "Saved." confirms an action; it should not linger on other pages.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [serverVersion, setServerVersion] = useState<ServerVersion | null>();
  // The owner's reader settings (0.36.0: the language) apply on load.
  useEffect(() => void loadReaderSettings(), []);
  const [connection, setConnection] = useState<ConnectionState>({
    kind: "checking",
  });
  useEffect(() => {
    let alive = true;
    void crewApi
      .connection()
      .catch((): ConnectionState => ({ kind: "unknown" }))
      .then((next) => {
        if (alive) setConnection(next);
      });
    return () => {
      alive = false;
    };
  }, []);
  const copyEndpoint =
    connection.kind === "mcp" ? (
      <CopyLink
        target={connection.url}
        label={t("Copy address")}
        copiedLabel={t("Address copied")}
      />
    ) : null;
  const [dialog, setDialog] = useState<{
      kind: Kind;
      firstTask?: boolean;
      row?: Row;
      /** A task tab asked for by the address, with a counter to repeat it. */
      tab?: TaskTab;
      tabAsk?: number;
      /** A file (`?file=`) or comment (`?comment=`) the address points at. */
      file?: string;
      comment?: string;
      /** The Home section it was opened from, whose list previous/next walk. */
      source?: ListSource;
    } | null>(null),
    [instructions, setInstructions] = useState<InstructionsView | null>(null),
    // The toast after Start a session (0.24.0).
    [promptPreview, setPromptPreview] = useState<SessionStart | null>(null),
    [sessionStart, setSessionStart] = useState<SessionStart | null>(null),
    // The toast after an action that asks no confirmation (0.40.0: Archive
    // task from the Approval ⋯ menu). One at a time: a new one replaces it.
    // `undo` names what its Undo restores. `left` is the time left on its
    // countdown, kept with the toast because it is shown over the page or
    // inside the open dialog and moves between them.
    [toast, setToast] = useState<{
      id: number;
      tone: "status" | "alert";
      text: string;
      ms: number;
      left: { current: number };
      undo?: { review: string; task: string };
    } | null>(null),
    // Set per hash navigation and consumed once, so data refreshes never open a dialog.
    [pendingLink, setPendingLink] = useState(() =>
      parseItemHash(location.hash),
    ),
    // A review an Approvals link (#/approvals/<id>) opens; consumed once, like
    // pendingLink, after the data has loaded.
    [pendingReview, setPendingReview] = useState(() =>
      reviewFocusFromHash(location.hash),
    ),
    // A status column a Home tile asked the board to show; consumed once, like
    // pendingLink, after the data has loaded.
    [pendingColumn, setPendingColumn] = useState(() =>
      boardColumnFromHash(location.hash),
    ),
    // A Connect page section (#/connect?section=files) to show once.
    [pendingSection, setPendingSection] = useState(() =>
      connectSectionFromHash(location.hash),
    ),
    [highlightColumn, setHighlightColumn] = useState(""),
    // The one board column a phone shows; a Home tile's column picks it.
    [phoneColumn, setPhoneColumn] = useState(
      () => boardColumnFromHash(location.hash) ?? "todo",
    ),
    // The phone's on-demand Tasks and Notes filter sheets, and the Notes
    // sheet's search and responsible agent (not kept in the address).
    [boardSheet, setBoardSheet] = useState(false),
    [notesSheet, setNotesSheet] = useState(false),
    // Home's create menu (anchored to the + that opened it) and its Shared page form.
    [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null),
    [newShared, setNewShared] = useState(false),
    [noteSearch, setNoteSearch] = useState(""),
    [noteAgent, setNoteAgent] = useState(""),
    columnRefs = useRef<Record<string, HTMLElement | null>>({}),
    [ready, setReady] = useState(false),
    generation = useRef(0),
    edited = useRef(0),
    busyRef = useRef(false),
    loadsInFlight = useRef(0),
    loadFailed = useRef(false),
    // The records of the last successful load, for code that continues right
    // after awaiting it (the state is still a render behind).
    loaded = useRef<Data | null>(null),
    // The toast's id counter, and an Undo that is running.
    toastSeq = useRef(0),
    undoing = useRef(false);
  const discardOk = () =>
    !edited.current || window.confirm(t("Discard your unsaved changes?"));
  // The open dialog, for the hashchange listener registered once below.
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  // The page and the toast as they are now, for work that continues after a write.
  const viewRef = useRef(view);
  viewRef.current = view;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const showToast = (next: Omit<NonNullable<typeof toast>, "id" | "left">) =>
    setToast({ ...next, id: ++toastSeq.current, left: { current: next.ms } });
  const dismissToast = useCallback(() => setToast(null), []);
  // A layout effect, so the reset precedes any edit to the newly shown dialog;
  // a deferred effect could run after the first change and erase it.
  useLayoutEffect(() => {
    edited.current = 0;
  }, [dialog?.kind, dialog?.row?.id]);
  // A silent load is the background refresh: it changes data only when the data
  // changed, and a failure leaves the page as it is until the next attempt.
  // It resolves to the outcome, or "stale" when a newer load superseded it.
  const load = useCallback(async ({ silent = false } = {}): Promise<LoadOutcome> => {
    const ticket = ++generation.current;
    loadsInFlight.current++;
    void crewApi
      .serverVersion()
      .then((version) => {
        if (ticket === generation.current) setServerVersion(version);
      })
      .catch(() => {
        if (!silent && ticket === generation.current) setServerVersion(null);
      });
    // One query for every card thumbnail; a failure only hides thumbnails.
    void attachmentsApi
      .cardThumbnails()
      .then((next) => {
        if (ticket !== generation.current) return;
        setThumbs((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      })
      .catch(() => undefined);
    // Wake evidence is optional: a failure only hides "Wake not received".
    void crewApi
      .read("webhook_bridges", { overdue: true })
      .then((next) => {
        if (ticket !== generation.current) return;
        setBridges((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      })
      .catch(() => undefined);
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
      if (ticket !== generation.current) return "stale";
      const keep = (next: Data) => (current: Data) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next;
      const fresh: Data = Object.fromEntries(result);
      loaded.current = fresh;
      setData(keep(fresh));
      setArchived(keep(Object.fromEntries(old)));
      setReady(true);
      // A background success only clears a failed load, never a save error.
      if (!silent || loadFailed.current) {
        setError("");
        loadFailed.current = false;
      }
      return "ok";
    } catch (e) {
      if (ticket !== generation.current) return "stale";
      if (!silent) {
        loadFailed.current = true;
        setError(e instanceof Error ? e.message : t("Could not load workspace."));
      }
      return "failed";
    } finally {
      loadsInFlight.current--;
      if (ticket === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  // The header Refresh: one request at a time, a spinning icon while it runs
  // and a short status when it ends, so a tap on a phone visibly registers.
  const [refreshing, setRefreshing] = useState(false),
    [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(null),
    refreshingRef = useRef(false);
  const refreshNow = async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshStatus(null);
    try {
      const outcome = await load();
      if (outcome === "ok") setRefreshStatus({ ok: true, text: t("Updated.") });
      else if (outcome === "failed")
        setRefreshStatus({
          ok: false,
          text: t("Couldn't refresh. Check your connection and try again."),
        });
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };
  useEffect(() => {
    if (!refreshStatus) return;
    const timer = setTimeout(
      () => setRefreshStatus(null),
      refreshStatus.ok ? 2500 : 6000,
    );
    return () => clearTimeout(timer);
  }, [refreshStatus]);
  useEffect(() => {
    const refresh = () => {
      if (document.hidden || busyRef.current || loadsInFlight.current) return;
      void load({ silent: true });
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);
  useEffect(() => {
    const receive = () => {
      redirectLegacyAddress();
      // Following a link to another record from a dialog with unsaved changes
      // asks first; declining steps back to where the dialog was.
      const link = parseItemHash(location.hash);
      const open = dialogRef.current;
      if (
        link &&
        open &&
        !(open.kind === link.kind && open.row?.id === link.id) &&
        !discardOk()
      ) {
        history.back();
        return;
      }
      setPendingLink(link);
      setPendingReview(reviewFocusFromHash(location.hash));
      setPendingColumn(boardColumnFromHash(location.hash));
      setPendingSection(connectSectionFromHash(location.hash));
      if (isItemHash(location.hash)) return;
      // A review opened from a link in an open dialog replaces that dialog and
      // keeps the page underneath, like any other record on the trail.
      if (reviewFocusFromHash(location.hash) && dialogRef.current) {
        if (
          !(dialogRef.current.kind === "review" &&
            dialogRef.current.row?.id === reviewFocusFromHash(location.hash)) &&
          !discardOk()
        ) {
          setPendingReview("");
          history.back();
        }
        return;
      }
      if (!discardOk()) {
        history.forward();
        return;
      }
      setView(viewFromHash(location.hash));
      setViewState(viewStateFromHash(location.hash));
      setSearchText(searchTextFromHash(location.hash));
      setQuery("");
      setDialog(null);
    };
    window.addEventListener("hashchange", receive);
    return () => window.removeEventListener("hashchange", receive);
  }, []);
  // The address follows the page state; replacing it adds no history entry and
  // fires no hashchange. An open item keeps its own address.
  useEffect(() => {
    if ((view !== "board" && view !== "memory") || isItemHash(location.hash))
      return;
    setAddress(viewStateHash(view, viewState));
  }, [view, viewState]);
  // An address naming a bucket or agent that isn't active falls back to all.
  useEffect(() => {
    if (
      ready &&
      viewState.bucket &&
      !data.buckets.some((x) => x.id === viewState.bucket)
    )
      setViewState((state) => ({ ...state, bucket: "" }));
  }, [ready, data.buckets, viewState.bucket]);
  useEffect(() => {
    if (ready && !validAssignment(viewState.assignment, data.agents))
      setViewState((state) => ({ ...state, assignment: "all" }));
  }, [ready, data.agents, viewState.assignment]);
  const assignmentFilter = validAssignment(viewState.assignment, data.agents)
    ? viewState.assignment
    : "all";
  const updateBoard = (changes: Partial<ViewState>) => {
    const next = { ...viewState, ...changes };
    pushAddress(viewStateHash("board", next));
    setViewState(next);
  };
  const setAssignmentFilter = (value: string) => updateBoard({ assignment: value });
  const holdFilter = viewState.hold;
  const setHoldFilter = (value: HoldFilter) => updateBoard({ hold: value, heldOver: "" });
  // Panel filters show as chips under the toolbar; the Filters button counts them.
  const chips = filterChips(viewState);
  const boardFiltered = assignmentFilter !== "all" || chips.length > 0;
  // `label:`, `agent:` and `status:` in the search act as filters.
  const boardSearch = parseBoardSearch(query);
  const agentNames = data.agents.map((agent) => ({ id: agent.id, name: val(agent, "name") }));
  const clearBoard = () => {
    setQuery("");
    updateBoard(clearedBoard);
  };
  // The Filters panel: closes on Escape (back to its button) or a click outside.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const filtersButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    const outside = (e: Event) => {
      if (!filtersRef.current?.contains(e.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [filtersOpen]);
  useEffect(() => {
    if (view !== "board") setFiltersOpen(false);
  }, [view]);
  // Older closed tasks stay folded until asked for; not part of the address.
  const [showOlderDone, setShowOlderDone] = useState(false);
  const bucket = data.buckets.some((x) => x.id === viewState.bucket)
    ? viewState.bucket
    : "";
  const selectedBucket = data.buckets.find((x) => x.id === bucket);
  const setBucket = (id: string) =>
    setViewState((state) => ({ ...state, bucket: id }));
  const openTitle =
    dialog?.row && (dialog.kind === "task" || dialog.kind === "note")
      ? val(dialog.row, "title")
      : "";
  const pageTitle = openTitle || t(pages.find(([key]) => key === view)?.[1] ?? "");
  useLayoutEffect(() => {
    document.title = `${pageTitle} · PocketContext Crew`;
    return () => {
      document.title = "PocketContext Crew";
    };
  }, [pageTitle]);
  useEffect(() => {
    if (!pendingLink || !ready) return;
    setPendingLink(null);
    const { kind, id, tab, file, comment } = pendingLink;
    const collection = `${kind}s`;
    const show = (row: Row) => {
      // Tasks and notes keep their server path (with its slug) in the
      // address; buckets and agents, and file or comment links, keep the
      // address they were opened with.
      if (!file && !comment && (kind === "task" || kind === "note"))
        setAddress(itemTabPath(itemPath(kind, row), tab));
      // Navigating to the open item must not disturb its in-progress edits; a
      // tab in the address still switches to it.
      setDialog((open) =>
        open?.kind === kind && open.row?.id === id
          ? tab
            ? { ...open, tab, tabAsk: (open.tabAsk || 0) + 1, comment }
            : open
          : { kind, row, tab, file, comment, source: currentListSource() },
      );
    };
    const row = [...(data[collection] ?? []), ...(archived[collection] ?? [])].find(
      (x) => x.id === id,
    );
    if (row) return show(row);
    // A record newer than the last load is read by id; one that doesn't
    // exist leaves a short notice.
    const hash = location.hash;
    void Promise.all([
      crewApi.read(collection, { id }),
      crewApi.read(collection, { id, archived: true }),
    ])
      .then(([a, b]) => [...a, ...b])
      .catch(() => [] as Row[])
      .then(([fresh]) => {
        if (location.hash !== hash) return;
        if (fresh?.id === id) return show(fresh);
        setNotice(
          {
            task: t("That task wasn't found."),
            note: t("That note wasn't found."),
            bucket: t("That bucket wasn't found."),
            agent: t("That agent wasn't found."),
          }[kind],
        );
      });
  }, [pendingLink, ready, data, archived]);
  // An Approvals link opens that review's dialog over the Approvals page; a
  // review newer than the last load is read by id. An unknown id stays on
  // the page with a notice.
  useEffect(() => {
    if (!pendingReview || !ready) return;
    setPendingReview("");
    const id = pendingReview;
    const open = (row: Row) =>
      setDialog((current) =>
        current?.kind === "review" && current.row?.id === id
          ? current
          : { kind: "review", row, source: currentListSource() },
      );
    const row = data.reviews.find((x) => x.id === id);
    if (row) return open(row);
    void crewApi
      .read("reviews", { id })
      .catch(() => [] as Row[])
      .then(([fresh]) => {
        if (reviewFocusFromHash(location.hash) !== id) return;
        if (fresh?.id === id) return open(fresh);
        setAddress(viewHashes.reviews);
        setNotice(t("Review not found."));
      });
  }, [pendingReview, ready, data.reviews]);
  // The section query is consumed once: drop it from the address so a refresh
  // or Back does not scroll again.
  useEffect(() => {
    if (pendingSection && view === "connect") setAddress(viewHashes.connect);
  }, [pendingSection, view]);
  const sectionShown = useCallback(() => setPendingSection(null), []);
  // Bring the asked-for column into view, focus it and highlight it briefly.
  // The address effect above has already dropped `column` from the address, so
  // a refresh or Back does not repeat this.
  useEffect(() => {
    if (!pendingColumn || !ready) return;
    // A phone shows one column: show the asked-for one first, then focus it.
    setPhoneColumn(pendingColumn);
    if (phone && phoneColumn !== pendingColumn) return;
    setPendingColumn(null);
    const column = columnRefs.current[pendingColumn];
    if (view !== "board" || !column) return;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    column.scrollIntoView?.({
      behavior: reduce ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
    column.focus({ preventScroll: true });
    setHighlightColumn(pendingColumn);
  }, [pendingColumn, ready, view, phone, phoneColumn]);
  useEffect(() => {
    if (!highlightColumn) return;
    const timer = setTimeout(() => setHighlightColumn(""), 1200);
    return () => clearTimeout(timer);
  }, [highlightColumn]);
  const dismissSessionStart = useCallback(() => setSessionStart(null), []);
  // A source names the list when the page alone does not (a Home section).
  const openItem = (kind: ItemKind, row: Row, source?: ListSource) => {
    pushFromList(itemPath(kind, row), source);
    setDialog({ kind, row, source });
  };
  // Clicking an Approvals card puts its shareable link in the address.
  const openReviewCard = (row: Row, source?: ListSource) => {
    pushFromList(reviewHash(row.id), source);
    setDialog({ kind: "review", row, source });
  };
  // Share as artifact from a note's header or menu opens the new draft.
  const sharedArtifact = (id: string) => {
    setDialog(null);
    location.hash = `${viewHashes.shared}/${id}`;
  };
  const closeDialog = () => {
    // Opened from a list: go back to the list's own entry (0.32.0), so the
    // address is the list, its scroll and filters stay, and Back does not
    // reopen the item. The hashchange that follows shows the page.
    const depth = listDepth();
    if (depth > 0) {
      // Saved or confirmed already: the hashchange may arrive before the
      // closed dialog's render resets this, and must not ask again.
      edited.current = 0;
      setDialog(null);
      history.go(-depth);
      return;
    }
    // Replace, so Back never reopens the review. A review reached from a link
    // over another page returns to that page, like an item.
    if (reviewFocusFromHash(location.hash)) {
      if (view === "reviews") setAddress(viewHashes.reviews);
      else
        pushAddress(
          view === "search" && searchText
            ? searchHash(searchText)
            : viewStateHash(view, viewState),
        );
    }
    if (isItemHash(location.hash))
      pushAddress(
        view === "search" && searchText
          ? searchHash(searchText)
          : viewStateHash(view, viewState),
      );
    setDialog(null);
  };
  // A hit is compact, so open the loaded record; one newer than the last load
  // is read by id first.
  const openHit = async (hit: SearchHit, inArchive = false) => {
    const kind: ItemKind = hit.collection === "tasks" ? "task" : "note";
    const row = [...data[hit.collection], ...archived[hit.collection]].find(
      (x) => x.id === hit.id,
    );
    if (row) return openItem(kind, row);
    try {
      const [fresh] = await crewApi.read(hit.collection, {
        id: hit.id,
        archived: inArchive,
      });
      if (!fresh) throw new Error("missing");
      openItem(kind, fresh);
      void load({ silent: true });
    } catch {
      setNotice(
        kind === "task"
          ? t("That task couldn't be opened. It may have just changed; try again.")
          : t("That note couldn't be opened. It may have just changed; try again."),
      );
    }
  };
  const perform = async (
    work: () => Promise<unknown>,
    message: string | (() => string) = t("Saved."),
  ) => {
    setBusy(true);
    busyRef.current = true;
    loadFailed.current = false;
    setError("");
    setNotice("");
    try {
      await work();
      await load();
      setSaves((n) => n + 1);
      setNotice(typeof message === "function" ? message() : message);
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("Could not save. Refresh and try again."),
      );
      return false;
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };
  // Archive restores (one row, a bucket or a selection) run one at a time;
  // failures are reported by title and the rest still restore.
  const restoreArchived = (items: RestoreItem[]) => {
    const failed: string[] = [];
    let reason = "";
    return perform(
      async () => {
        for (const { collection, row } of items) {
          try {
            await crewApi.write(
              `${collection === "buckets" ? "bucket" : collection === "agents" ? "agent" : collection === "tasks" ? "task" : "note"}.update`,
              { archived: false },
              row,
            );
          } catch (e) {
            failed.push(val(row, "title") || val(row, "name"));
            reason ||= e instanceof Error ? e.message : "";
          }
        }
        if (failed.length === items.length)
          throw new Error(
            t("Could not restore {names}.", { names: failed.join(", ") }) +
              (reason ? ` ${reason}` : ""),
          );
      },
      () =>
        failed.length
          ? t("Restored {done} of {total}. Could not restore {names}.", {
              done: items.length - failed.length,
              total: items.length,
              names: failed.join(", "),
            }) + (reason ? ` ${reason}` : "")
          : items.length === 1
            ? t("Restored. Prior approvals were not reactivated.")
            : t("Restored {n} items. Prior approvals were not reactivated.", {
                n: items.length,
              }),
    );
  };
  const save = async (
    action: string,
    fields: Record<string, unknown>,
    row?: Row,
    reason = "",
    keepOpen = false,
  ) => {
    const editsAtSave = edited.current;
    // A changed draft withdraws a pending approval; say so, as file changes do.
    const withdraws =
      action === "task.update" &&
      !!row &&
      ((typeof fields.draft === "string" && fields.draft !== val(row, "draft")) ||
        ["draft_options", "draft_selection", "draft_recipient"].some(key => key in fields)) &&
      data.reviews.some(
        (x) => val(x, "task") === row.id && val(x, "status") === "pending",
      );
    const saved = await perform(
      async () => {
        const updated = await crewApi.write(action, fields, row, reason);
        if (keepOpen) {
          // A keystroke after Save still needs the dialog's discard prompt.
          if (edited.current === editsAtSave) edited.current = 0;
          setDialog((open) =>
            open?.row?.id === updated.id ? { ...open, row: updated } : open,
          );
        }
      },
      withdraws ? `${t("Saved.")} ${withdrawnNoticeText()}` : t("Saved."),
    );
    if (saved && !keepOpen) closeDialog();
  };
  // After a file change withdrew an approval the task has a new revision; the
  // open form takes it so its next save does not conflict.
  const refreshDialogRow = async (kind: ItemKind, id: string) => {
    try {
      const [fresh] = await crewApi.read(kind === "task" ? "tasks" : "notes", {
        id,
      });
      if (fresh)
        setDialog((open) =>
          open && open.kind === kind && open.row?.id === id
            ? { ...open, row: fresh }
            : open,
        );
    } catch {
      /* The next save reports a conflict instead. */
    }
  };
  const name = (id: string, c = "agents") =>
    val(
      [...data[c], ...(archived[c] || [])].find((x) => x.id === id),
      "name",
    ) || (id ? t("Unavailable agent") : t("Unassigned"));
  const invalidAssignment = (task: Row) => {
    const id = val(task, "assigned_agent");
    return !!id && !data.agents.some((agent) => agent.id === id);
  };
  const openTasks = data.tasks.filter((task) => !isClosed(task));
  const unassignedCount = openTasks.filter(
    (task) => !val(task, "assigned_agent"),
  ).length;
  const invalidCount = openTasks.filter(invalidAssignment).length;
  const onHoldCount = openTasks.filter(onHold).length;
  const wakeMissing = new Set(
    strandedWakes(bridges, data.tasks, data.agents).map((x) => x.task.id),
  );
  // One filter option per active agent; its count is the cards it shows.
  const agentOptions = [...data.agents]
    .sort((a, b) => byName(val(a, "name"), val(b, "name")))
    .map((agent) => ({
      agent,
      count: data.tasks.filter((x) => val(x, "assigned_agent") === agent.id)
        .length,
    }));
  const labelsAvailable = knownLabels(data.tasks);
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
      .includes(boardSearch.text.toLowerCase()) &&
    tokensMatch(boardSearch.tokens, x, agentNames);
  // Every filter but the column; the columns split these by status.
  const boardTasks = data.tasks.filter(
    (x) =>
      matches(x) &&
      assignmentMatches(assignmentFilter, x, invalidAssignment) &&
      holdMatches(holdFilter, x) &&
      labelMatches(viewState.label, x) &&
      statusMatches(viewState.status, x) &&
      (!viewState.heldOver || isLongHeld(x)),
  );
  const boardSearched = boardSearch.text !== "" || boardSearch.tokens.length > 0;
  const emptyBoard = view === "board" && ready && !data.tasks.length &&
    !boardFiltered && !boardSearched;
  const showBoard = view === "board" && ready && !emptyBoard;
  // A label chosen (filter or search) shows its older closed tasks too, so a
  // release-0.21.0 label finds that release's work.
  const labelChosen =
    viewState.label !== "" || boardSearch.tokens.some((t) => t.key === "label");
  // Note count and latest note update per bucket, for the cards and their sorts.
  const bucketStats = new Map<string, { count: number; latest: string }>();
  for (const note of data.notes) {
    const id = val(note, "bucket");
    const stats = bucketStats.get(id) ?? { count: 0, latest: "" };
    stats.count++;
    if (String(note.updated || "") > stats.latest)
      stats.latest = String(note.updated || "");
    bucketStats.set(id, stats);
  }
  const bucketCounts = new Map(
    [...bucketStats].map(([id, stats]) => [id, stats.count]),
  );
  const sortedBuckets = [...data.buckets].sort((a, b) => {
    const [sa, sb] = [bucketStats.get(a.id), bucketStats.get(b.id)];
    const order =
      viewState.bucketSort === "notes"
        ? (sb?.count ?? 0) - (sa?.count ?? 0)
        : viewState.bucketSort === "activity"
          ? byNewest(sa?.latest, sb?.latest)
          : 0;
    return order || byName(val(a, "name"), val(b, "name"));
  });
  // The phone sheet's search and responsible agent narrow the list too.
  const noteText = phone ? noteSearch.trim().toLowerCase() : "";
  const noteAgentShown = phone && data.agents.some((x) => x.id === noteAgent) ? noteAgent : "";
  const shownNotes = data.notes
    .filter((x) => !bucket || val(x, "bucket") === bucket)
    .filter(
      (x) =>
        !noteAgentShown ||
        val(data.buckets.find((b) => b.id === val(x, "bucket")), "responsible_agent") === noteAgentShown,
    )
    .filter(
      (x) =>
        !noteText ||
        `${val(x, "title")} ${val(x, "body")}`.toLowerCase().includes(noteText),
    )
    .sort((a, b) => {
      const sort = viewState.noteSort;
      const order =
        sort === "title"
          ? byName(val(a, "title"), val(b, "title"))
          : sort === "created"
            ? byNewest(a.created, b.created)
            : sort === "bucket"
              ? byName(
                  name(val(a, "bucket"), "buckets"),
                  name(val(b, "bucket"), "buckets"),
                )
              : 0;
      return (
        order ||
        byNewest(a.updated, b.updated) ||
        byName(val(a, "title"), val(b, "title"))
      );
    });
  // The board's columns as shown, so a task dialog steps in card order.
  const boardColumns = boardStatuses.map(([status, label]) => {
    // The Done column holds every closed task: Done and Won't do.
    const tasks = boardTasks.filter((x) =>
      status === "done" ? isClosed(x) : val(x, "status") === status,
    );
    tasks.sort((a, b) => viewState.taskSort === "held"
      ? (onHold(a) && !isClosed(a) ? heldSince(a) || Infinity : Infinity) - (onHold(b) && !isClosed(b) ? heldSince(b) || Infinity : Infinity)
      : val(b, "updated").localeCompare(val(a, "updated")));
    // Older closed tasks fold away unless a label is chosen or the owner
    // asks for them.
    const done =
      status === "done"
        ? doneColumn(tasks, showOlderDone || labelChosen || viewState.status === "done" || viewState.status === "wont_do")
        : null;
    return { status, label, tasks, done, shown: done ? done.tasks : tasks };
  });
  const shownColumn = boardColumns.some((c) => c.status === phoneColumn)
    ? phoneColumn
    : "todo";
  // The list under the open record dialog, as the page shows it (0.31.0):
  // the board's cards, the Notes page's notes or bucket cards, the agents,
  // pending reviews or past decisions, or the Search page's results. Since
  // 0.35.0 every record dialog has a list: the Home section it was opened
  // from (its source), else the page's list for its kind, else the kind's
  // natural list (a link to another kind, a review over Search). An item its
  // list is hiding does not step; the capsule keeps its slot, hidden.
  const as = (kind: Kind) => (row: Row) => ({ kind, row });
  // A phone shows one board column: the shown one, or the task's own.
  const taskColumns = (id: string) => {
    if (!phone) return boardColumns;
    const shown = boardColumns.find((c) => c.status === shownColumn);
    if (shown?.shown.some((x) => x.id === id)) return [shown];
    return boardColumns.filter((c) => c.shown.some((x) => x.id === id));
  };
  // Pending reviews, or past decisions, as the Approvals page lists them.
  const reviewList = (row: Row) => {
    const status = val(data.reviews.find((x) => x.id === row.id) ?? row, "status");
    return data.reviews
      .filter((x) => (val(x, "status") === "pending") === (status === "pending"))
      .map(as("review"));
  };
  const pageList = (kind: Kind, row: Row): { kind: Kind; row: Row }[] | null => {
    switch (`${view}:${kind}`) {
      case "board:task":
        return taskColumns(row.id).flatMap((c) => c.shown).map(as("task"));
      case "memory:note":
        return shownNotes.map(as("note"));
      case "memory:bucket":
        return sortedBuckets.map(as("bucket"));
      case "agents:agent":
        return data.agents.map(as("agent"));
      case "reviews:review":
        return reviewList(row);
    }
    if (view !== "search" || kind === "review") return null;
    // Records not loaded here are skipped, as an inaccessible item is.
    const rows: Record<SearchEntry["kind"], Row[]> = {
      task: [...data.tasks, ...archived.tasks],
      note: [...data.notes, ...archived.notes],
      agent: data.agents,
      bucket: data.buckets,
    };
    return searchEntries.flatMap(({ kind, id }) => {
      const row = rows[kind].find((x) => x.id === id);
      return row ? [{ kind, row }] : [];
    });
  };
  // A record with no list on this page: its collection's own list.
  const naturalList = (kind: Kind, row: Row): { kind: Kind; row: Row }[] => {
    switch (kind) {
      case "task":
        return taskColumns(row.id).flatMap((c) => c.shown).map(as("task"));
      case "note":
        return [...data.notes]
          .sort((a, b) => byNewest(a.updated, b.updated))
          .map(as("note"));
      case "bucket":
        return sortedBuckets.map(as("bucket"));
      case "agent":
        return data.agents.map(as("agent"));
      case "review":
        return reviewList(row);
    }
  };
  const dialogList = ((): { kind: Kind; row: Row }[] | null => {
    if (!dialog?.row) return null;
    if (dialog.source)
      return homeList(dialog.source, {
        tasks: data.tasks,
        notes: data.notes,
        agents: data.agents,
        pending,
        invalidAssignment,
      });
    return pageList(dialog.kind, dialog.row) ?? naturalList(dialog.kind, dialog.row);
  })();
  const dialogIndex =
    dialogList?.findIndex(
      (x) => x.kind === dialog?.kind && x.row.id === dialog?.row?.id,
    ) ?? -1;
  // Moves the open dialog to the item `step` away in its list, without
  // wrapping. Unsaved changes ask first (staying adds no history); a move
  // pushes one history entry with the new item's link (0.32.0), so Back and
  // Forward retrace the items moved through. The list's source stays.
  const stepDialog = (step: Step): StepResult => {
    const target = dialogIndex >= 0 ? dialogList?.[dialogIndex + step] : undefined;
    if (!target) return "end";
    if (busy || !discardOk()) return "stayed";
    const { kind, row } = target;
    stepTrail(kind === "review" ? reviewHash(row.id) : itemPath(kind, row));
    setDialog({ kind, row, source: dialog?.source });
    return "moved";
  };
  // Archive task from the Approval detail's ⋯ menu (0.40.0): the work is no
  // longer needed, where Reject says the draft is not good. One write: the
  // server archives the task and withdraws its pending review together. No
  // confirmation, no "Saved." and no inline error: a toast offers Undo, or
  // says that nothing was archived.
  const archiveFromApproval = async (review: Row, task: Row) => {
    if (busyRef.current) return;
    // The list and the place in it, before the archive shortens the list.
    const list = dialogList,
      index = dialogIndex,
      source = dialog?.source;
    setBusy(true);
    busyRef.current = true;
    loadFailed.current = false;
    setError("");
    setNotice("");
    try {
      let reloaded = false;
      try {
        await crewApi.write("task.update", { archived: true }, task);
      } catch {
        // The reload gives a retry the task's current revision. It also tells
        // a write that did not happen from one whose answer was lost: only a
        // fresh load in which the task is archived and the review no longer
        // pending counts as archived.
        const fresh =
          (await load({ silent: true })) === "ok" ? loaded.current : null;
        if (
          !fresh ||
          fresh.tasks.some((x) => x.id === task.id) ||
          !fresh.reviews.some(
            (x) => x.id === review.id && val(x, "status") !== "pending",
          )
        ) {
          // Nothing was archived: the approval stays as it is, with what the
          // owner typed.
          showToast({
            tone: "alert",
            text: t("Couldn't archive the task. Try again."),
            ms: messageToastMs,
          });
          return;
        }
        reloaded = true;
      }
      if (!reloaded) await load();
      setSaves((n) => n + 1);
      const open = dialogRef.current;
      if (open?.kind === "review" && open.row?.id === review.id) {
        const pendingNow = (loaded.current?.reviews ?? data.reviews).filter(
          (x) => val(x, "status") === "pending" && val(x, "task") !== task.id,
        );
        const next = approvalAfterArchive(list, index, pendingNow);
        if (next) {
          // Replaces the archived approval's entry and keeps its state: Back
          // never returns to it, and closing still goes to the list's own entry.
          setAddress(reviewHash(next.id));
          setDialog({ kind: "review", row: next, source });
        } else closeDialog();
      }
      showToast({
        tone: "status",
        text: t("Task archived"),
        ms: undoToastMs,
        undo: { review: review.id, task: task.id },
      });
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };
  // Undo of that archive. review.restore un-archives the task and makes the
  // same review pending again in one write, so no bot is woken in between;
  // the restored approval then opens at its own address, in its old place.
  // If the server refuses (the approval can no longer be restored safely),
  // the task alone is restored and the owner is told. If nothing reached the
  // server, the task stays in Archive, where it can be restored.
  const undoArchive = async (
    id: number,
    archived: { review: string; task: string },
  ) => {
    // One Undo at a time, and none once its toast is gone or replaced.
    if (undoing.current || busyRef.current || toastRef.current?.id !== id)
      return;
    undoing.current = true;
    setBusy(true);
    busyRef.current = true;
    loadFailed.current = false;
    setError("");
    setNotice("");
    const failed = () =>
      showToast({
        tone: "alert",
        text: t("Couldn't undo. The task is in Archive; restore it from there."),
        ms: messageToastMs,
      });
    // The archive changed the review's revision: restore its current row.
    const restore = async () => {
      const [current] = await crewApi.read("reviews", { id: archived.review });
      return current
        ? await crewApi.write("review.restore", {}, current)
        : undefined;
    };
    try {
      let restored: Row | undefined;
      try {
        try {
          restored = await restore();
        } catch (e) {
          // A plain revision conflict (409 with no reason code) only means the
          // review changed since it was read: read it again, once.
          const { status, code } = writeFailure(e);
          if (status !== 409 || code) throw e;
          restored = await restore();
        }
      } catch (e) {
        // Only an answer from the server (HTTP 4xx) is a refusal.
        const { status } = writeFailure(e);
        if (status < 400 || status > 499) return failed();
      }
      if (!restored) {
        try {
          const [task] = await crewApi.read("tasks", {
            id: archived.task,
            archived: true,
          });
          if (task) await crewApi.write("task.update", { archived: false }, task);
        } catch {
          return failed();
        }
        await load();
        setSaves((n) => n + 1);
        showToast({
          tone: "status",
          text: t(
            "Task restored. Its approval is no longer pending; request it again.",
          ),
          ms: messageToastMs,
        });
        return;
      }
      // The reloaded row when there is one, else the server's answer.
      const row =
        ((await load()) === "ok" &&
          loaded.current?.reviews.find((x) => x.id === restored.id)) ||
        restored;
      setSaves((n) => n + 1);
      setToast(null);
      const open = dialogRef.current;
      if (!open)
        // From the list: as a click on its card opens it.
        openReviewCard(
          row,
          viewRef.current === "home" ? "home:approvals" : undefined,
        );
      else if (open.kind === "review" && open.row?.id === row.id)
        setDialog({ ...open, row });
      else if (discardOk()) {
        // The detail that took its place gives the address back.
        setAddress(reviewHash(row.id));
        setDialog({ kind: "review", row, source: open.source });
      }
    } finally {
      undoing.current = false;
      setBusy(false);
      busyRef.current = false;
    }
  };
  const listNoun = dialog?.source
    ? listSourceNoun(dialog.source)
    : view === "search" && dialog?.kind !== "review"
      ? "result"
      : dialog?.kind ?? "item";
  const seed = () =>
    perform(async () => {
      const readBoth = async (collection: string, fields: string[]) => {
        const [active, archived] = await Promise.all([
          crewApi.read(collection, { fields }),
          crewApi.read(collection, { archived: true, fields }),
        ]);
        return [...active, ...archived];
      };
      const [agents, buckets, notes] = await Promise.all([
        readBoth("agents", ["name", "archived"]),
        readBoth("buckets", ["name", "purpose", "responsible_agent", "archived"]),
        readBoth("notes", ["bucket", "title"]),
      ]);
      for (const [name, purpose] of [
        ["Build", "Product plans, priorities and technical decisions."],
        ["Deploy", "Release preparation and deployment decisions."],
        ["Design", "Brand, voice and visual direction."],
        ["Learn", "Research, trusted sources and useful findings."],
        ["Network", "Audience, messaging, outreach and posting voice."],
      ]) {
        const bucketName = name.toUpperCase();
        let agent = agents.find((row) => val(row, "name") === name);
        if (agent?.archived) {
          agent = await crewApi.write("agent.update", { archived: false }, agent);
        } else if (!agent) {
          agent = await crewApi.write("agent.create", {
            name,
            brief: `Read relevant notes before work. Maintain ${bucketName}; request changes elsewhere through tasks. Record progress in tasks and save durable decisions and findings only. Submit drafts for human review. The owner performs external actions.`,
          });
        }
        let bucket = buckets.find((row) => val(row, "name") === bucketName);
        if (bucket?.archived) {
          bucket = await crewApi.write("bucket.update", { archived: false }, bucket);
        } else if (!bucket) {
          bucket = await crewApi.write("bucket.create", {
            name: bucketName, purpose, responsible_agent: agent.id,
          });
        }
        // Archived notes include those hidden by an archived parent. Leave
        // individually archived introductions alone, and keep edited ones.
        const bucketId = bucket.id;
        if (!notes.some((row) => val(row, "bucket") === bucketId && val(row, "title") === "About this bucket")) {
          const ownerId = val(bucket, "responsible_agent");
          const ownerName = ownerId === agent.id ? name : val(agents.find((row) => row.id === ownerId), "name");
          const responsibility = ownerName ? `Responsible agent: ${ownerName}. ` : "";
          await crewApi.write("note.create", {
            bucket: bucketId,
            title: "About this bucket",
            body: `${val(bucket, "purpose") || purpose}\n\n${responsibility}All agents can read this bucket. Save durable decisions and useful findings.`,
            links: [],
          });
        }
      }
    }, t("Your five starter agents and their buckets are ready."));
  const starterCrewBanner = !loading && !data.agents.length && (
    <div className="crew-welcome">
      <div>
        <span className="crew-eyebrow">{t("START WITH A SMALL CREW")}</span>
        <h2>{t("A shared brief for every agent.")}</h2>
        <p>
          {t("Create Build, Deploy, Design, Learn and Network with a bucket each. Edit their briefs to fit your work.")}
        </p>
      </div>
      <button
        className="crew-primary"
        disabled={busy}
        onClick={() => void seed()}
      >
        {t("Set up starter crew")}
      </button>
    </div>
  );
  const archivedRow =
    dialog?.row && (dialog.kind === "task" || dialog.kind === "note")
      ? archived[`${dialog.kind}s`].find((x) => x.id === dialog.row?.id)
      : undefined;
  const archiveNotice = !archivedRow
    ? ""
    : dialog?.kind === "note" && !archivedRow.archived
      ? t("This note is read-only because its bucket is archived. Restore the bucket from the Archive view to make changes.")
      : dialog?.kind === "note"
        ? t("This note is archived and read-only. Restore it from the Archive view to make changes.")
        : t("This task is archived and read-only. Restore it from the Archive view to make changes.");
  const descriptions = {
    home: t("Where you and your AI agents share tasks and notes. Agents do the work; you decide what's approved."),
    board: t("Follow each task from request to finished work. Agents draft; you decide what's approved."),
    memory: t("Decisions, preferences and findings every agent can find."),
    reviews:
      t("Review the exact draft. Approval never sends or publishes anything."),
    agents:
      t("Give each agent a name and a brief that says what it works on and what to remember."),
    archive: t("Restore notes, tasks and buckets without losing their history."),
    connect: t("Crew needs one connection to your agent platform before agents can work here."),
    guide: t("What Crew does, what each page is for, and the words it uses."),
    search: t("Every task, note, agent and bucket that matches your words."),
    shared:
      t("Frozen copies of notes, shared by a secret link with no sign-in. Agents draft them; only you publish, update, expire, revoke or archive them. Editing a source note never changes a published page."),
    settings: t("Language, what tapping an agent does, help, your account and the server version."),
  };
  // The board's controls: one toolbar row on a desktop, the filter sheet on a phone.
  const boardSearchField = (
    <label className="crew-search">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        aria-label={t("Search tasks")}
        placeholder={t("Search tasks, or label:bug…")}
        title={t("Search titles, descriptions and labels. label:, agent: and status: filter; Enter turns them into filter chips.")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const { text, changes } = commitBoardSearch(query, agentNames);
          if (!Object.keys(changes).length) return;
          e.preventDefault();
          setQuery(text);
          updateBoard(changes);
        }}
      />
    </label>
  );
  const assignmentSelect = (
    <select
      aria-label={t("Filter by assignment")}
      value={assignmentFilter}
      onChange={(e) => setAssignmentFilter(e.target.value)}
    >
      <option value="all">{t("All tasks")}</option>
      <option value="unassigned">
        {t("Unassigned")} ({unassignedCount})
      </option>
      <option value="invalid">
        {t("Invalid assignments")} ({invalidCount})
      </option>
      {agentOptions.length > 0 && (
        <optgroup label={t("By agent")}>
          {agentOptions.map(({ agent, count }) => (
            <option key={agent.id} value={agent.id}>
              {val(agent, "name")}
              {t(agentKindSuffix[agentKind(agent)])} ({count})
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
  const sortControl = (
    <label className="crew-sort" title={t("Sort tasks")}>
      <span>{t("Sort")}</span>
      <select
        aria-label={t("Sort tasks")}
        value={viewState.taskSort}
        onChange={(e) =>
          updateBoard({ taskSort: e.target.value as ViewState["taskSort"] })
        }
      >
        <option value="updated">{t("Last updated")}</option>
        <option value="held">{t("Oldest hold first")}</option>
      </select>
    </label>
  );
  const filterFields = (
    <>
      <label className="crew-field">
        <span>{t("Readiness")}</span>
        <select
          aria-label={t("Filter by hold")}
          value={holdFilter}
          onChange={(e) => setHoldFilter(e.target.value as HoldFilter)}
        >
          {holdFilters.map((key) => (
            <option key={key} value={key}>
              {t(holdFilterLabels[key])}
              {key === "on_hold"
                ? ` (${onHoldCount})`
                : key === "ready"
                  ? ` (${openTasks.length - onHoldCount})`
                  : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="crew-filters-check">
        <input
          type="checkbox"
          checked={!!viewState.heldOver}
          onChange={(e) =>
            updateBoard(
              e.target.checked
                ? { hold: "on_hold", heldOver: "3d" }
                : { heldOver: "" },
            )
          }
        />
        {t("On hold over 3 days")} ({longHolds(data.tasks).length})
      </label>
      <label className="crew-field">
        <span>{t("Label")}</span>
        <select
          aria-label={t("Filter by label")}
          value={viewState.label.toLowerCase()}
          onChange={(e) => updateBoard({ label: e.target.value })}
        >
          <option value="">{t("All labels")}</option>
          {viewState.label &&
            !labelsAvailable.some(
              (x) => x.label.toLowerCase() === viewState.label.toLowerCase(),
            ) && (
              <option value={viewState.label.toLowerCase()}>
                {viewState.label} (0)
              </option>
            )}
          {labelsAvailable.map(({ label, count }) => (
            <option key={label.toLowerCase()} value={label.toLowerCase()}>
              {label} ({count})
            </option>
          ))}
        </select>
      </label>
      <label className="crew-field">
        <span>{t("Status")}</span>
        <select
          aria-label={t("Filter by status")}
          value={viewState.status}
          onChange={(e) => updateBoard({ status: e.target.value })}
        >
          <option value="">{t("All statuses")}</option>
          {statuses.map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
  const agentRow = (
    // One click per agent, like the Notes bucket cards; the same
    // assignment filter as the select and the card footers.
    <div className="crew-agent-row" role="group" aria-label={t("Filter by agent")}>
      <button
        type="button"
        className="crew-agent-chip"
        aria-pressed={assignmentFilter === "all"}
        aria-label={t("All agents, {n} open", { n: openTasks.length })}
        onClick={() => setAssignmentFilter("all")}
      >
        {t("All")}
        <span className="crew-agent-chip-count" aria-hidden="true">
          {openTasks.length}
        </span>
      </button>
      {agentOptions.map(({ agent }) => {
        const agentName = val(agent, "name");
        const count = openTasks.filter((x) => val(x, "assigned_agent") === agent.id).length;
        const selected = assignmentFilter === agent.id;
        return (
          <button
            type="button"
            key={agent.id}
            className="crew-agent-chip"
            aria-pressed={selected}
            aria-label={t("{name}, {n} open", { name: agentName, n: count })}
            title={selected ? t("Show all agents") : t("Filter by agent {name}", { name: agentName })}
            onClick={() => setAssignmentFilter(selected ? "all" : agent.id)}
          >
            <span className="crew-avatar" aria-hidden="true">
              {agentInitials(agentName, data.agents)}
            </span>
            {agentName}
            <span className="crew-agent-chip-count" aria-hidden="true">
              {count}
            </span>
          </button>
        );
      })}
      {unassignedCount > 0 && (
        <button
          type="button"
          className="crew-agent-chip"
          aria-pressed={assignmentFilter === "unassigned"}
          aria-label={t("Unassigned, {n} open", { n: unassignedCount })}
          onClick={() =>
            setAssignmentFilter(assignmentFilter === "unassigned" ? "all" : "unassigned")
          }
        >
          {t("Unassigned")}
          <span className="crew-agent-chip-count" aria-hidden="true">
            {unassignedCount}
          </span>
        </button>
      )}
    </div>
  );
  const titleHelp = viewHelp[view];
  // Phones: the page's filter icon counts every active filter, search included.
  const assignmentLabel =
    assignmentFilter === "unassigned"
      ? t("Unassigned")
      : assignmentFilter === "invalid"
        ? t("Invalid assignments")
        : t("Agent: {name}", { name: name(assignmentFilter) });
  const boardFilterCount =
    chips.length + (assignmentFilter !== "all" ? 1 : 0) + (boardSearched ? 1 : 0);
  const noteFilterCount =
    (bucket ? 1 : 0) + (noteText ? 1 : 0) + (noteAgentShown ? 1 : 0);
  // Home's + (0.34.0) opens a menu of everything the owner can create.
  const createItems: PopoverItem[] = [
    { label: t("Task"), icon: icons.tasks, onSelect: () => setDialog({ kind: "task" }) },
    {
      label: t("Note"),
      icon: icons.notes,
      disabled: !data.buckets.length,
      onSelect: () => setDialog({ kind: "note" }),
    },
    { label: t("Bucket"), icon: icons.bucket, onSelect: () => setDialog({ kind: "bucket" }) },
    { label: t("Agent"), icon: icons.agent, onSelect: () => setDialog({ kind: "agent" }) },
    { label: t("Shared page"), icon: icons.shared, onSelect: () => setNewShared(true) },
  ];
  const emptyMemory = view === "memory" && ready && !data.notes.length &&
    !data.buckets.length && !noteText && !noteAgentShown;
  const showMemory = view === "memory" && ready && !emptyMemory;
  const phoneAdd: PageAction | undefined =
    view === "home"
      ? {
          label: t("Create"),
          menu: { open: !!createAnchor },
          onClick: (anchor) => setCreateAnchor(anchor ?? null),
        }
      : showBoard
      ? { label: t("New task"), onClick: () => setDialog({ kind: "task" }) }
      : showMemory
        ? {
            label: t("New note"),
            disabled: !data.buckets.length,
            onClick: () => setDialog({ kind: "note" }),
          }
        : view === "agents"
          ? { label: t("New agent"), onClick: () => setDialog({ kind: "agent" }) }
          : undefined;
  const phoneActions: PageAction[] =
    showMemory
      ? [
          { label: t("New bucket"), onClick: () => setDialog({ kind: "bucket" }) },
          ...(selectedBucket
            ? [
                {
                  label: t("Edit bucket {name}", { name: val(selectedBucket, "name") }),
                  onClick: () => openItem("bucket", selectedBucket),
                },
              ]
            : []),
        ]
      : view === "board" && (boardFiltered || boardSearched)
        ? [{ label: t("Clear all filters"), onClick: clearBoard }]
        : [];
  const sourceForHit = (hit: SearchHit) =>
    data[hit.collection].find((row) => row.id === hit.id) ??
    archived[hit.collection].find((row) => row.id === hit.id);
  // Shown over the page, or inside the open record dialog (see Modal).
  const actionToast = toast && (
    <UndoToast
      key={toast.id}
      text={toast.text}
      tone={toast.tone}
      ms={toast.ms}
      left={toast.left}
      busy={busy}
      action={
        toast.undo && {
          label: t("Undo"),
          run: () => void undoArchive(toast.id, toast.undo!),
        }
      }
      dismiss={dismissToast}
    />
  );
  const globalSearch = (
    <GlobalSearch
      sourceForHit={sourceForHit}
      agents={data.agents}
      buckets={data.buckets}
      pageText={view === "search" ? searchText : null}
      disabled={dialog !== null}
      onOpenHit={(hit) => void openHit(hit)}
      onOpenAgent={(row) => openItem("agent", row)}
      onOpenBucket={(row) => openItem("bucket", row)}
    />
  );
  return (
    <HelpModeContext.Provider value={helpMode(connection)}>
    <div className={phone ? "crew-app crew-phone" : "crew-app"}>
      {phone ? (
        <MobileTabBar view={view} pending={pending.length} />
      ) : (
      <aside className="crew-sidebar">
        <a
          className="crew-logo"
          href={viewHashes.home}
          aria-label={t("Crew, go to Home")}
        >
          <Brand />
          <strong>Crew</strong>
        </a>
        <nav aria-label={t("Workspace")}>
          {nav.map(([key, label, icon]) => (
            <a
              key={key}
              href={viewHashes[key]}
              aria-current={view === key ? "page" : undefined}
            >
              <span aria-hidden="true">{icon}</span>
              {t(label)}
              {key === "reviews" && pending.length > 0 && (
                <b>{pending.length}</b>
              )}
            </a>
          ))}
        </nav>
        <div className="crew-sidebar-bottom">
          <a
            className="crew-sidebar-link"
            href={viewHashes.connect}
            aria-current={view === "connect" ? "page" : undefined}
          >
            {t("Connect an agent")}
          </a>
          <a
            className="crew-sidebar-link"
            href={viewHashes.guide}
            aria-current={view === "guide" ? "page" : undefined}
          >
            {t("Guide")}
          </a>
          <a
            className="crew-sidebar-link"
            href={viewHashes.settings}
            aria-current={view === "settings" ? "page" : undefined}
          >
            {t("Settings")}
          </a>
          <div className="crew-sidebar-account">
            <button type="button" onClick={() => api.logout()}>
              <Icon name="signOut" />
              {t("Sign out")}
            </button>
          </div>
        </div>
      </aside>
      )}
      <main className="crew-main">
        {phone ? (
          <MobileTopBar
            title={t(pages.find((x) => x[0] === view)?.[1] ?? "")}
            view={view}
            search={globalSearch}
            filter={
              showBoard
                ? {
                    label: t("Filters"),
                    count: boardFilterCount,
                    open: boardSheet,
                    onOpen: () => setBoardSheet(true),
                  }
                : showMemory
                  ? {
                      label: t("Filter and sort"),
                      count: noteFilterCount,
                      open: notesSheet,
                      onOpen: () => setNotesSheet(true),
                    }
                  : undefined
            }
            add={phoneAdd}
            description={descriptions[view]}
            help={titleHelp}
            actions={phoneActions}
            refresh={{
              busy: refreshing,
              disabled: busy || loading || refreshing,
              run: () => void refreshNow(),
            }}
          />
        ) : (
        <header className="crew-topbar">
          <span>POCKETCONTEXT / CREW</span>
          <div>
            {globalSearch}
            <button
              className={`crew-refresh${refreshing ? " is-refreshing" : ""}`}
              aria-label={t("Refresh")}
              title={refreshing ? t("Refreshing…") : t("Refresh")}
              aria-busy={refreshing || undefined}
              disabled={busy || loading || refreshing}
              onClick={() => void refreshNow()}
            >
              <span className="crew-refresh-icon" aria-hidden="true">
                ↻
              </span>
            </button>
          </div>
        </header>
        )}
        {refreshStatus && (
          <p
            className={`crew-refresh-status${refreshStatus.ok ? "" : " is-error"}`}
            role={refreshStatus.ok ? "status" : "alert"}
          >
            {refreshStatus.text}
          </p>
        )}
        <section className="crew-content">
          {!phone && (
          <div className="crew-heading" ref={view === "shared" ? setSharedHeader : undefined}>
            <div>
              <p className="crew-eyebrow">{t(eyebrows[view])}</p>
              <div className="crew-title-row">
                <h1>{t(pages.find((x) => x[0] === view)?.[1] ?? "")}</h1>
                {titleHelp && <Help topic={titleHelp} />}
              </div>
              <p>{descriptions[view]}</p>
            </div>
            {view === "home" && (
              <button
                className="crew-primary"
                aria-haspopup="dialog"
                aria-expanded={!!createAnchor}
                onClick={(e) => setCreateAnchor(e.currentTarget)}
              >
                {t("＋ New")}
              </button>
            )}
            {showBoard && (
              <button
                className="crew-primary"
                onClick={() => setDialog({ kind: "task" })}
              >
                {t("＋ New task")}
              </button>
            )}
            {showMemory && (
              <div className="crew-actions">
                <button onClick={() => setDialog({ kind: "bucket" })}>
                  {t("New bucket")}
                </button>
                <button
                  className="crew-primary"
                  disabled={!data.buckets.length}
                  onClick={() => setDialog({ kind: "note" })}
                >
                  {t("＋ New note")}
                </button>
              </div>
            )}
            {view === "agents" && (
              <button
                className="crew-primary"
                onClick={() => setDialog({ kind: "agent" })}
              >
                {t("＋ New agent")}
              </button>
            )}
          </div>
          )}
          {error && (
            <div className="crew-alert" role="alert">
              {error}{" "}
              <button onClick={() => void load()}>{t("Reload workspace")}</button>
            </div>
          )}
          {notice && (
            <p className="crew-notice" role="status">
              {notice}
            </p>
          )}
          {loading && view !== "guide" && (
            <p className="crew-workspace-loading" role="status">{t("Loading your workspace…")}</p>
          )}
          {view !== "home" && starterCrewBanner}
          {showBoard && !phone && (
            <div className="crew-toolbar">
              {boardSearchField}
              {assignmentSelect}
              {sortControl}
              <div
                className="crew-filters"
                ref={filtersRef}
                onKeyDown={(e) => {
                  if (e.key !== "Escape" || !filtersOpen) return;
                  e.stopPropagation();
                  setFiltersOpen(false);
                  filtersButton.current?.focus();
                }}
              >
                <button
                  type="button"
                  ref={filtersButton}
                  className={chips.length ? "crew-filters-button active" : "crew-filters-button"}
                  aria-expanded={filtersOpen}
                  aria-controls="crew-filters-panel"
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  {t("Filters")}{chips.length ? ` · ${chips.length}` : ""}
                </button>
                {filtersOpen && (
                  <div
                    id="crew-filters-panel"
                    className="crew-filters-panel"
                    role="group"
                    aria-label={t("Task filters")}
                  >
                    {filterFields}
                    <button
                      type="button"
                      className="crew-filters-done"
                      onClick={() => {
                        setFiltersOpen(false);
                        filtersButton.current?.focus();
                      }}
                    >
                      {t("Done")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {showBoard && !phone && data.agents.length > 0 && agentRow}
          {showBoard && phone && boardSheet && (
            <Sheet title={t("Filters")} className="crew-filter-sheet" onClose={() => setBoardSheet(false)}>
              {boardSearchField}
              <div className="crew-sheet-section crew-sheet-field">
                <h3>{t("Scope")}</h3>
                {assignmentSelect}
              </div>
              <div className="crew-sheet-section crew-sheet-field">
                <h3>{t("Sort")}</h3>
                {sortControl}
              </div>
              {data.agents.length > 0 && (
                <div className="crew-sheet-section">
                  <h3>{t("Agents")}</h3>
                  {agentRow}
                </div>
              )}
              <div className="crew-sheet-section crew-sheet-filters">
                <h3>{t("More filters")}</h3>
                {filterFields}
              </div>
            </Sheet>
          )}
          {view === "board" && (boardFiltered || boardSearched) && (
            <div className="crew-filter-chips" role="group" aria-label={t("Active filters")}>
              {phone && boardSearched && (
                <span className="crew-chip crew-filter-chip">
                  “{query}”
                  <button
                    type="button"
                    aria-label={t("Remove filter search")}
                    onClick={() => setQuery("")}
                  >
                    ×
                  </button>
                </span>
              )}
              {phone && assignmentFilter !== "all" && (
                <span className="crew-chip crew-filter-chip">
                  {assignmentLabel}
                  <button
                    type="button"
                    aria-label={t("Remove filter {name}", { name: assignmentLabel })}
                    onClick={() => setAssignmentFilter("all")}
                  >
                    ×
                  </button>
                </span>
              )}
              {chips.map((chip) => (
                <span className="crew-chip crew-filter-chip" key={chip.key}>
                  {chip.label}
                  <button
                    type="button"
                    aria-label={t("Remove filter {name}", { name: chip.label })}
                    onClick={() => updateBoard(chip.clear)}
                  >
                    ×
                  </button>
                </span>
              ))}
              <span className="crew-filter-count" role="status">
                {tn(boardTasks.length, "{n} task", "{n} tasks")}
              </span>
              <button type="button" className="crew-clear-filters" onClick={clearBoard}>
                {t("Clear all")}
              </button>
            </div>
          )}
          {showBoard && phone && (
            <ColumnSwitcher
              columns={boardColumns.map(({ status, label, tasks }) => ({
                status,
                label: t(label),
                count: tasks.length,
              }))}
              current={shownColumn}
              onSelect={(status) => {
                setPhoneColumn(status);
                if (window.scrollY > 0) window.scrollTo(0, 0);
              }}
            />
          )}
          {view === "home" && (
            <Home
              starterCrewBanner={starterCrewBanner}
              data={data}
              archived={archived}
              pending={pending}
              ready={ready}
              busy={busy}
              seed={() => void seed()}
              newTask={() => setDialog({ kind: "task", firstTask: true })}
              openItem={openItem}
              openReview={(row) => openReviewCard(row, "home:approvals")}
              invalidAssignment={invalidAssignment}
              connection={connection}
              copyEndpoint={copyEndpoint}
              onStartSession={setSessionStart}
            />
          )}
          {createAnchor && (
            <PopoverMenu
              label={t("Create")}
              anchor={createAnchor}
              items={createItems}
              onClose={() => setCreateAnchor(null)}
            />
          )}
          {newShared && (
            <NewSharedPage
              onClose={() => setNewShared(false)}
              onCreated={(id) => {
                setNewShared(false);
                sharedArtifact(id);
              }}
            />
          )}
          {view === "guide" && <Guide />}
          {view === "settings" && (
            <Settings
              agents={data.agents}
              serverVersion={serverVersion}
              onSignOut={() => api.logout()}
            />
          )}
          {view === "shared" && (
            <Shared
              header={sharedHeader}
              notes={[...data.notes, ...archived.notes]}
              tasks={[...data.tasks, ...archived.tasks]}
              focus={sharedFocusFromHash(location.hash)}
              Prose={Prose}
            />
          )}
          {view === "search" && (
            <SearchPage
              sourceForHit={sourceForHit}
              text={searchText}
              agents={data.agents}
              buckets={data.buckets}
              refreshKey={saves}
              onOpenHit={(hit, inArchive) => void openHit(hit, inArchive)}
              onOpenAgent={(row) => openItem("agent", row)}
              onOpenBucket={(row) => openItem("bucket", row)}
              onResults={setSearchEntries}
            />
          )}
          {view === "connect" && (
            <Connect
              onAgentsChanged={() => void load({ silent: true })}
              agents={[...data.agents, ...archived.agents]}
              tasks={[...data.tasks, ...archived.tasks]}
              notes={[...data.notes, ...archived.notes]}
              connection={connection}
              copyEndpoint={copyEndpoint}
              section={pendingSection}
              onSectionShown={sectionShown}
            />
          )}
          {emptyBoard && (
            <section className="crew-board-empty" aria-labelledby="crew-first-task">
              <span className="crew-board-empty-icon" aria-hidden="true">{icons.tasks}</span>
              <h2 id="crew-first-task">{archived.tasks.length ? t("No active tasks") : t("No tasks yet")}</h2>
              <p>{t("Start with a title. You can assign the task to an agent later.")}</p>
              <button className="crew-primary" onClick={() => setDialog({ kind: "task" })}>
                {archived.tasks.length ? t("New task") : t("Create your first task")}
              </button>
            </section>
          )}
          {showBoard && (
            <div className={phone ? "crew-board crew-board-phone" : "crew-board"}>
              {boardColumns
                .filter((c) => !phone || c.status === shownColumn)
                .map(({ status, label, tasks, done, shown }) => {
                const card = (x: Row) => (
                  <div
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openItem("task", x); }
                    }}
                    className="crew-task-card"
                    key={x.id}
                    onClick={() => openItem("task", x)}
                  >
                    <div className="crew-tags">
                      {val(x, "status") === "wont_do" && (
                        <FilterChipButton
                          className="crew-wont-do"
                          label={t("Filter by status Won't do")}
                          onFilter={() => updateBoard({ status: "wont_do" })}
                        >
                          {t("Won't do")}
                        </FilterChipButton>
                      )}
                      {!isClosed(x) && (
                        <HoldChip
                          task={x}
                          onFilter={(hold) => updateBoard({ hold, heldOver: "" })}
                        />
                      )}
                      <ClaimChip task={x} />
                      {wakeMissing.has(x.id) && <WakeMissingChip />}
                      {pending.some((r) => val(r, "task") === x.id) && (
                        <span className="crew-human">{t("Human")}</span>
                      )}
                      {x.handoff_limited === true && (
                        <span
                          className="crew-human"
                          title={t("Stopped after too many consecutive agent reassignments. Review it, then set Ready.")}
                        >
                          {t("Handoff limit")}
                        </span>
                      )}
                      {Number(x.comment_wake_generation) > 0 &&
                        Number(x.comment_wake_generation) ===
                          Number(x.wake_generation) && (
                          <span title={t("Your comment wakes the assignee when the current execution finishes.")}>
                            {t("Comment wake pending")}
                          </span>
                        )}
                      {list(x, "labels").filter((l) => !val(x, "assigned_agent") || l.toLowerCase() !== name(val(x, "assigned_agent")).toLowerCase()).map((l) => (
                        <FilterChipButton
                          className="crew-chip crew-label-filter"
                          key={l}
                          label={t("Filter by label {label}", { label: l })}
                          onFilter={() => updateBoard({ label: l })}
                        >
                          {l}
                        </FilterChipButton>
                      ))}
                    </div>
                    {thumbs[x.id] && (
                      <CardThumbnail
                        thumb={thumbs[x.id]}
                        token={thumbToken}
                      />
                    )}
                    <h3>{val(x, "title")}</h3>
                    <p><ExcerptContent excerpt={markdownExcerpt(taskBrief(val(x, "description")), 150)} /></p>
                    {invalidAssignment(x) && (
                      <p className="crew-assignment-warning">
                        {t("Assigned agent is inactive or unavailable. Reassign this task.")}
                      </p>
                    )}
                    <footer>
                      {val(x, "assigned_agent") && !invalidAssignment(x) ? (
                        <FilterChipButton
                          className="crew-card-agent"
                          label={t("Filter by agent {name}", { name: name(val(x, "assigned_agent")) })}
                          onFilter={() => setAssignmentFilter(val(x, "assigned_agent"))}
                        >
                          <span className="crew-avatar" aria-hidden="true">
                            {name(val(x, "assigned_agent")).slice(0, 1)}
                          </span>
                          {name(val(x, "assigned_agent"))}
                        </FilterChipButton>
                      ) : (
                        <>
                          <span className="crew-avatar">
                            {name(val(x, "assigned_agent")).slice(0, 1)}
                          </span>
                          {name(val(x, "assigned_agent"))}
                        </>
                      )}
                    </footer>
                  </div>
                );
                return (
                  <section
                    className={
                      highlightColumn === status
                        ? "crew-column crew-column-highlight"
                        : "crew-column"
                    }
                    key={status}
                    ref={(el) => {
                      columnRefs.current[status] = el;
                    }}
                    tabIndex={-1}
                    aria-labelledby={`crew-column-${status}`}
                  >
                    <div className="crew-column-head">
                      <h2 id={`crew-column-${status}`}>
                        <i className={status} />
                        {t(label)}
                        <span>{tasks.length}</span>
                      </h2>
                      <Help topic={statusHelp[status]} />
                    </div>
                    {shown.map(card)}
                    {done && done.older > 0 && (
                      <button
                        type="button"
                        className="crew-show-older"
                        onClick={() => setShowOlderDone(true)}
                        title={t("Closed tasks not changed in the last 7 days")}
                      >
                        {t("Show older ({n})", { n: done.older })}
                      </button>
                    )}
                    {!tasks.length && (
                      <div className="crew-column-empty">
                        {boardSearched || boardFiltered ? (
                          t("No matching tasks")
                        ) : status === "todo" ? (
                          <>
                            <p>{t("New tasks start here.")}</p>
                            <button onClick={() => setDialog({ kind: "task" })}>
                              {t("＋ Add a task")}
                            </button>
                          </>
                        ) : status === "in_progress" ? (
                          t("Tasks being worked on appear here.")
                        ) : status === "needs_review" ? (
                          t("Drafts sent for your approval appear here.")
                        ) : (
                          t("Finished tasks appear here.")
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {emptyMemory && (
            <section className="crew-board-empty" aria-labelledby="crew-first-bucket">
              <span className="crew-board-empty-icon" aria-hidden="true">{icons.notes}</span>
              <h2 id="crew-first-bucket">{t("No notes yet")}</h2>
              <p>{t("Notes live in buckets. Create a bucket first, then add notes to it.")}</p>
              <button className="crew-primary" onClick={() => setDialog({ kind: "bucket" })}>
                {t("New bucket")}
              </button>
            </section>
          )}
          {showMemory && phone && (
            <>
              <ColumnSwitcher
                className="crew-bucket-switcher"
                item="bucket"
                pickerLabel={t("Buckets")}
                noun={["note", "notes"]}
                columns={[
                  { status: "", label: t("All"), count: data.notes.length },
                  ...[...data.buckets]
                    .sort((a, b) => byName(val(a, "name"), val(b, "name")))
                    .map((row) => ({
                      status: row.id,
                      label: val(row, "name"),
                      count: bucketCounts.get(row.id) ?? 0,
                    })),
                ]}
                current={bucket}
                onSelect={(id) => {
                  setBucket(id);
                  if (window.scrollY > 0) window.scrollTo(0, 0);
                }}
              />
              <NoteRows
                notes={shownNotes}
                bucketName={(id) => name(id, "buckets")}
                onOpen={(note) => openItem("note", note)}
              />
              {!shownNotes.length && (
                <Empty
                  title={
                    bucket || noteText || noteAgentShown
                      ? t("No matching notes")
                      : t("No notes yet")
                  }
                  action={
                    bucket || noteText || noteAgentShown ? (
                      <button
                        onClick={() => {
                          setBucket("");
                          setNoteSearch("");
                          setNoteAgent("");
                        }}
                      >
                        {t("Show all notes")}
                      </button>
                    ) : data.buckets.length ? (
                      <button
                        className="crew-primary"
                        onClick={() => setDialog({ kind: "note" })}
                      >
                        {t("Add your first note")}
                      </button>
                    ) : (
                      <button onClick={() => setDialog({ kind: "bucket" })}>
                        {t("New bucket")}
                      </button>
                    )
                  }
                >
                  {data.buckets.length
                    ? t("Notes hold decisions, preferences and findings your agents should remember.")
                    : t("Notes live in buckets. Create a bucket first, then add notes to it.")}
                </Empty>
              )}
              {notesSheet && (
                <NotesFilterSheet
                  onClose={() => setNotesSheet(false)}
                  search={noteSearch}
                  onSearch={setNoteSearch}
                  sort={viewState.noteSort}
                  onSort={(noteSort) =>
                    setViewState((state) => ({ ...state, noteSort }))
                  }
                  agents={data.agents}
                  agent={noteAgentShown}
                  onAgent={setNoteAgent}
                  buckets={sortedBuckets}
                  counts={bucketCounts}
                  total={data.notes.length}
                  selected={bucket}
                  onSelect={setBucket}
                  onEdit={(row) => {
                    setNotesSheet(false);
                    openItem("bucket", row);
                  }}
                />
              )}
            </>
          )}
          {showMemory && !phone && (
            <>
              <div className="crew-section-title crew-section-title-first">
                <h2>{t("Buckets")}</h2>
                <Help topic="bucket" />
                <span>{t("Groups of notes")}</span>
                <div className="crew-section-tools">
                  <select
                    aria-label={t("Sort buckets")}
                    value={viewState.bucketSort}
                    onChange={(e) =>
                      setViewState((state) => ({
                        ...state,
                        bucketSort: e.target.value as BucketSort,
                      }))
                    }
                  >
                    {bucketSorts.map((key) => (
                      <option key={key} value={key}>
                        {t(bucketSortLabels[key])}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="crew-buckets">
                {sortedBuckets.map((x) => {
                  const selected = x.id === bucket;
                  const count = bucketStats.get(x.id)?.count ?? 0;
                  return (
                    // Two sibling buttons: the card filters, Edit opens the bucket.
                    <div
                      className={`crew-bucket-card${selected ? " selected" : ""}`}
                      key={x.id}
                    >
                      <button
                        type="button"
                        className="crew-bucket-filter"
                        aria-pressed={selected}
                        title={markdownExcerpt(val(x, "purpose"), undefined, String).text || undefined}
                        onClick={() => setBucket(selected ? "" : x.id)}
                      >
                        <span aria-hidden="true">▤</span>
                        <h2>{val(x, "name")}</h2>
                        <small>
                          {t("{name} · responsible agent", { name: name(val(x, "responsible_agent")) })}
                        </small>
                        <small className="crew-bucket-count">
                          {tn(count, "{n} note", "{n} notes")}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="crew-bucket-edit"
                        aria-label={t("Edit bucket {name}", { name: val(x, "name") })}
                        onClick={() => openItem("bucket", x)}
                      >
                        {t("Edit")}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="crew-section-title">
                <h2>{t("Notes")}</h2>
                <Help topic="note" />
                <span>{t("Useful context, with a history")}</span>
                <div className="crew-section-tools">
                  <select
                    aria-label={t("Filter by bucket")}
                    value={bucket}
                    onChange={(e) => setBucket(e.target.value)}
                  >
                    <option value="">{t("All buckets")}</option>
                    {data.buckets.map((x) => (
                      <option key={x.id} value={x.id}>
                        {val(x, "name")}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={t("Sort notes")}
                    value={viewState.noteSort}
                    onChange={(e) =>
                      setViewState((state) => ({
                        ...state,
                        noteSort: e.target.value as NoteSort,
                      }))
                    }
                  >
                    {noteSorts.map((key) => (
                      <option key={key} value={key}>
                        {t(noteSortLabels[key])}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="crew-notes">
                {shownNotes.map((x) => (
                  <button
                    className="crew-note-card"
                    key={x.id}
                    onClick={() => openItem("note", x)}
                  >
                    <span className="crew-eyebrow">
                      {name(val(x, "bucket"), "buckets")}
                    </span>
                    {thumbs[x.id] && (
                      <CardThumbnail thumb={thumbs[x.id]} token={thumbToken} />
                    )}
                    <h3>{val(x, "title")}</h3>
                    <p><ExcerptContent excerpt={markdownExcerpt(val(x, "body"), 180)} /></p>
                    <small>
                      {t("Revision {n}", { n: String(x.revision) })} · {when(x.updated)}
                    </small>
                  </button>
                ))}
              </div>
              {!shownNotes.length && (
                <Empty
                  title={bucket ? t("No notes in this bucket") : t("No notes yet")}
                  action={
                    bucket ? (
                      <button onClick={() => setBucket("")}>
                        {t("Show all buckets")}
                      </button>
                    ) : data.buckets.length ? (
                      <button
                        className="crew-primary"
                        onClick={() => setDialog({ kind: "note" })}
                      >
                        {t("Add your first note")}
                      </button>
                    ) : (
                      <button onClick={() => setDialog({ kind: "bucket" })}>
                        {t("New bucket")}
                      </button>
                    )
                  }
                >
                  {bucket
                    ? t("Add one with New note, or show the notes in every bucket.")
                    : data.buckets.length
                      ? t("Notes hold decisions, preferences and findings your agents should remember.")
                      : t("Notes live in buckets. Create a bucket first, then add notes to it.")}
                </Empty>
              )}
            </>
          )}
          {view === "reviews" && (
            <>
              {pending.length > 0 && <div className="crew-review-list">
                {pending.map((x) => {
                  const title =
                    val(
                      data.tasks.find((t) => t.id === val(x, "task")),
                      "title",
                    ) || t("Task draft");
                  return (
                    // The whole card opens the review; nothing inside is interactive.
                    <button
                      type="button"
                      className="crew-review-card"
                      key={x.id}
                      aria-label={t("Review draft: {title}", { title })}
                      aria-describedby={`review-preview-${x.id}`}
                      onClick={() => openReviewCard(x)}
                    >
                      <small className="crew-review-date">
                        {when(x.created)}
                      </small>
                      <h2>{title}</h2>
                      <p
                        className="crew-review-preview"
                        id={`review-preview-${x.id}`}
                      >
                        <ExcerptContent excerpt={markdownExcerpt(reviewOptions(x)[0]?.body ?? val(x, "draft"), 600)} />
                      </p>
                    </button>
                  );
                })}
              </div>}
              {ready && !pending.length && (
                <section className="crew-board-empty" aria-labelledby="crew-no-approvals">
                  <span className="crew-board-empty-icon" aria-hidden="true">{icons.approvals}</span>
                  <h2 id="crew-no-approvals">{t("Nothing waiting for your review")}</h2>
                  <p>{t("Drafts sent for approval will appear here.")}</p>
                  <a className="crew-button-link crew-primary" href={viewHashes.board}>{t("Go to Tasks")}</a>
                </section>
              )}
              {data.reviews.length > pending.length && <details className="crew-history-list">
                <summary>
                  {t("Past decisions ({n})", { n: data.reviews.length - pending.length })}
                </summary>
                {data.reviews
                  .filter((x) => val(x, "status") !== "pending")
                  .map((x) => (
                    <button key={x.id} onClick={() => openReviewCard(x)}>
                      <span>
                        {val(
                          data.tasks.find((t) => t.id === val(x, "task")),
                          "title",
                        ) || t("Task draft")}
                      </span>
                      <span>{reviewStatusLabel(val(x, "status"))}</span>
                    </button>
                  ))}
              </details>}
            </>
          )}
          {view === "agents" && (
            <>
              <div className="crew-callout">
                {t("Every connected agent can read and write all notes. Each agent's brief says where it should add things.")}
              </div>
              {!data.agents.length && !!data.buckets.length && (
                <Empty
                  title={t("No agents yet")}
                  action={
                    <button
                      className="crew-primary"
                      onClick={() => setDialog({ kind: "agent" })}
                    >
                      {t("Add your first agent")}
                    </button>
                  }
                >
                  {t("An agent is a role with a brief that tells it what to work on.")}
                </Empty>
              )}
              <div className="crew-agents">
                {data.agents.map((x) => (
                  <div className="crew-agent-tile" key={x.id}>
                    <button
                      className="crew-agent-card"
                      onClick={() => openItem("agent", x)}
                    >
                      <span className="crew-avatar">
                        {agentInitials(val(x, "name"), data.agents)}
                      </span>
                      <h2>{val(x, "name")}</h2>
                      <small className="crew-agent-kind">
                        {agentKind(x) === "human" ? t("Person") : x.chat_start === "webhook"
                          ? t("Started automatically · webhook") : t("Started manually · no webhook")}
                      </small>
                      {/* A preview: the brief as plain text, one line per
                          block, clamped to whole lines. */}
                      <p title={markdownExcerpt(val(x, "brief"), undefined, markdownText).text || undefined}>
                        <ExcerptContent excerpt={markdownExcerpt(val(x, "brief"), undefined, markdownText)} />
                      </p>
                    </button>
                    {canStartChat(x) && (
                      <StartSession
                        openAgent={() => openItem("agent", x)}
                        agent={x}
                        onStart={setSessionStart}
                      />
                    )}
                  </div>
                ))}
              </div>
              <a className="crew-agents-connect crew-button-link crew-primary" href={viewHashes.connect}>
                {t("Connect these agents to your platform →")}
              </a>
            </>
          )}
          {view === "archive" && (
            <>
              <Archive
                archived={archived}
                buckets={data.buckets}
                busy={busy}
                restore={(items) => void restoreArchived(items)}
              />
              <p className="crew-footnote">
                {t("Archived records remain in history and backups. Permanent deletion is not available.")}
              </p>
            </>
          )}
        </section>
      </main>
      {sessionStart && (
        <SessionToast
          key={`${sessionStart.name}-${sessionStart.state}-${sessionStart.prompt}`}
          start={sessionStart}
          dismiss={dismissSessionStart}
          view={() => {
            setPromptPreview(sessionStart);
            setSessionStart(null);
          }}
        />
      )}
      {/* After the session toast, so its Undo stays on top for its few seconds. */}
      {!dialog && actionToast}
      {promptPreview && (
        <Modal hideEmptyMenu title={t("Startup prompt for {name}", { name: promptPreview.name })}
          close={() => setPromptPreview(null)} onEdit={() => undefined}>
          <div className="crew-dialog-body crew-startup-preview">
            <pre>{promptPreview.prompt}</pre>
            <div className="crew-actions">
              <NamedCopyAction label={t("Copy again")} successLabel={t("Copied")}
                copy={() => copyText(promptPreview.prompt)} />
              <button type="button" onClick={() => {
                const { name, session } = promptPreview;
                void session?.then(next => {
                  setPromptPreview(null);
                  setInstructions({ name, session: next });
                }, () => setError(t("Could not load session instructions.")));
              }}>{t("Read session instructions")}</button>
            </div>
          </div>
        </Modal>
      )}
      {instructions && (
        <Modal
          hideEmptyMenu
          title={t("Session instructions for {name}", { name: instructions.name })}
          nav={<NavCluster />}
          actions={
            <HeadCopy
              target={instructions.session.prompt}
              label={t("Copy prompt")}
              copiedLabel={t("Prompt copied")}
            />
          }
          close={() => setInstructions(null)}
          onEdit={() => undefined}
        >
          {/* Copy prompt and the session itself always read the latest
              saved revision; edits here replace the shown session. */}
          <SessionInstructions
            session={instructions.session}
            initialMode={instructions.initialMode}
            onChange={(session) =>
              setInstructions((open) => (open ? { ...open, session } : open))
            }
            Markdown={Prose}
          />
        </Modal>
      )}
      {dialog && (
        <Modal
          record={!!dialog.row}
          toast={actionToast}
          nav={dialog.row ? <TrailNav /> : <NavCluster />}
          listNav={
            dialog.row
              ? {
                  noun: listNoun,
                  active: dialogIndex >= 0,
                  previous: dialogIndex > 0,
                  next: !!dialogList && dialogIndex >= 0 && dialogIndex < dialogList.length - 1,
                  index: dialogIndex,
                  count: dialogList?.length ?? 0,
                  go: stepDialog,
                }
              : undefined
          }
          title={
            dialog.kind === "review"
              ? t("Approval")
              : archiveNotice
                ? dialog.kind === "note"
                  ? t("Archived note")
                  : t("Archived task")
                : dialog.row && dialog.kind === "note"
                  ? t("Note")
                  : dialog.row
                    ? {
                        task: t("Edit task"),
                        note: t("Edit note"),
                        bucket: t("Edit bucket"),
                        agent: t("Edit agent"),
                      }[dialog.kind]
                    : {
                        task: t("New task"),
                        note: t("New note"),
                        bucket: t("New bucket"),
                        agent: t("New agent"),
                      }[dialog.kind]
          }
          menu={
            // Copy link and Share live in the More menu (0.32.0); a review's
            // own menu comes from its body.
            dialog.row && dialog.kind !== "review"
              ? [
                  {
                    label: t("Copy link"),
                    icon: "link",
                    copy: {
                      text: itemShareUrl(dialog.kind as ItemKind, dialog.row),
                      onResult: (ok, url) => {
                        if (ok) setNotice(t("Link copied."));
                        else setError(t("Could not copy automatically. Copy it from here: {url}", { url }));
                      },
                    },
                  },
                  ...(dialog.kind === "note" && !archiveNotice
                    ? [
                        {
                          label: t("Share as artifact"),
                          icon: "share" as const,
                          onSelect: () =>
                            void shareAsArtifact(dialog.row!).then(
                              sharedArtifact,
                              () => setError(t("Could not create the artifact.")),
                            ),
                        },
                      ]
                    : []),
                ]
              : []
          }
          onEdit={() => {
            edited.current++;
          }}
          close={() => {
            if (!busy && discardOk()) closeDialog();
          }}
        >
          <Editor
            key={`${dialog.kind}-${dialog.row?.id || "new"}`}
            {...dialog}
            data={{
              ...data,
              agents: [...data.agents, ...archived.agents],
              buckets: [...data.buckets, ...archived.buckets],
              notes: [...data.notes, ...archived.notes],
              tasks: [...data.tasks, ...archived.tasks],
            }}
            archiveNotice={archiveNotice}
            onEdit={() => {
              edited.current++;
            }}
            wakeMissing={
              dialog.kind === "task" && !!dialog.row && wakeMissing.has(dialog.row.id)
            }
            busy={busy}
            error={error}
            save={save}
            perform={perform}
            archiveReviewTask={(review, task) =>
              void archiveFromApproval(review, task)
            }
            close={closeDialog}
            openInstructions={setInstructions}
            onAgentConfigured={(updated) => {
              setDialog((open) => open?.kind === "agent" && open.row?.id === updated.id
                ? { ...open, row: updated } : open);
              void load({ silent: true });
            }}
            refresh={() => void load({ silent: true })}
            onWithdrawn={(kind, id) => void refreshDialogRow(kind, id)}
            refreshRow={() => {
              if (dialog.row && (dialog.kind === "task" || dialog.kind === "note"))
                void refreshDialogRow(dialog.kind, dialog.row.id);
            }}
          />
        </Modal>
      )}
    </div>
    </HelpModeContext.Provider>
  );
}
/** The archive action's name; an agent is deactivated instead. */
const archiveLabel = (kind: Kind) =>
  kind === "agent"
    ? t("Deactivate agent")
    : kind === "task"
      ? t("Archive task")
      : kind === "note"
        ? t("Archive note")
        : t("Archive bucket");
type InstructionsView = {
  name: string;
  session: AgentSession;
  initialMode?: "read" | "history";
};
type EditorProps = {
  firstTask?: boolean;
  kind: Kind;
  row?: Row;
  /** The task tab the address asked for, and a counter to switch again. */
  tab?: TaskTab;
  tabAsk?: number;
  /** A file to open in the viewer, or a comment to show, from the address. */
  file?: string;
  comment?: string;
  data: Data;
  archiveNotice?: string;
  onEdit: () => void;
  /** An overdue wake for this task was never received. */
  wakeMissing?: boolean;
  busy: boolean;
  error: string;
  save: (
    action: string,
    fields: Record<string, unknown>,
    row?: Row,
    reason?: string,
    keepOpen?: boolean,
  ) => Promise<void>;
  perform: (work: () => Promise<unknown>, message?: string) => Promise<boolean>;
  /** Archive task from a pending review's More menu (0.40.0). */
  archiveReviewTask?: (review: Row, task: Row) => void;
  close: () => void;
  openInstructions: (view: InstructionsView) => void;
  onAgentConfigured: (agent: Row) => void;
  /** Background reload after a file change (card thumbnails, task status). */
  refresh?: () => void;
  /** A file change withdrew this item's pending approval. */
  onWithdrawn?: (kind: ItemKind, id: string) => void;
  /** Rereads the open record after a change made outside the form. */
  refreshRow?: () => void;
};
/** The form's field values for a record (or a new one). */
function formValues(kind: Kind, row: Row | undefined, data: Data) {
  return {
    title: val(row, "title") || val(row, "name"),
    body: val(
      row,
      kind === "agent"
        ? "brief"
        : kind === "bucket"
          ? "purpose"
          : kind === "task"
            ? "description"
            : "body",
    ),
    ...draftFields(row),
    links: list(row, "links").join("\n"),
    selection:
      val(
        row,
        kind === "note"
          ? "bucket"
          : kind === "bucket"
            ? "responsible_agent"
            : "assigned_agent",
      ) || (kind === "note" ? data.buckets[0]?.id || "" : ""),
    status: val(row, "status") || "todo",
    // On hold is `waiting` in the API (`on_hold` is only a write alias).
    readiness: val(row, "readiness") === "ready" ? "ready" : "waiting",
    waitingReason: val(row, "waiting_reason"),
    // JSON, so the form compares and restores the exact chips.
    labels: JSON.stringify(list(row, "labels")),
    agentKind: row ? agentKind(row) : "external",
  };
}
function ChatInstructions({ agent, open }: { agent: Row; open: (view: InstructionsView) => void }) {
  const [request, setRequest] = useState<"read" | "history" | null>(null);
  const [readError, setReadError] = useState(false);
  const name = val(agent, "name");
  useEffect(() => {
    if (!request) return;
    let active = true;
    setReadError(false);
    void crewApi.session(agent.id).then(
      (session) => {
        if (!active) return;
        setRequest(null);
        open({ name, session, initialMode: request });
      },
      () => {
        if (!active) return;
        setRequest(null);
        setReadError(true);
      },
    );
    return () => { active = false; };
  }, [agent.id, name, open, request]);

  const [result, setResult] = useState<SessionStart>();
  const session = useSessionStart(agent, setResult);
  const { state, run } = useCopyFeedback();
  return (
    <section className="crew-chat-instructions">
      <button type="button" className="crew-manual-copy-row"
        aria-label={t("Copy instructions for {name}", { name })}
        title={t("Copy instructions for {name}", { name })}
        onClick={() => void run(session.start)} disabled={session.loading}>
        <span>
          <strong>{t("Manual start")}</strong>
          <span className="crew-manual-copy-hint">{t("Paste the instructions into a chat connected to Crew.")}</span>
        </span>
        <span className="crew-manual-copy-icon" aria-hidden="true"><CopyGlyph state={state} /></span>
      </button>
      {state === "copied" && <small role="status">{t("Instructions copied")}</small>}
      {result?.state === "manual" && <textarea aria-label={t("Session prompt for {name}", { name })}
        readOnly value={result.prompt} onFocus={(e) => e.currentTarget.select()} />}
      {result?.state === "failed" && <p role="alert">{t("Could not prepare the session prompt for {name}. Check your connection and try again.", { name })}</p>}
      <div className="crew-instruction-actions">
        <button type="button" aria-haspopup="dialog" disabled={!!request} onClick={() => setRequest("read")}>
          {t("Read instructions")}
        </button>
        <button type="button" aria-haspopup="dialog" disabled={!!request} onClick={() => setRequest("history")}>
          {t("Revision history")}
        </button>
      </div>
      {readError && <p role="alert">{t("Could not prepare the session prompt for {name}. Check your connection and try again.", { name })}</p>}
      {session.guide}
    </section>
  );
}

function Editor({
  firstTask = false,
  kind,
  row,
  tab: askedTab,
  tabAsk = 0,
  file: askedFile = "",
  comment: askedComment = "",
  data,
  archiveNotice = "",
  onEdit,
  wakeMissing = false,
  busy,
  error,
  save,
  perform,
  archiveReviewTask,
  close,
  refresh,
  onWithdrawn,
  refreshRow,
  onAgentConfigured,
  openInstructions,
}: EditorProps) {
  const readOnly = !!archiveNotice;
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTabState] = useState<string>(
      kind === "note" && row ? "read" : kind === "task" && row && askedTab ? askedTab : "edit",
    ),
    [history, setHistory] = useState<Row[]>([]),
    [events, setEvents] = useState<Row[]>([]),
    [relatedError, setRelatedError] = useState("");
  const comments = events.filter(
    (x) => val(x, "action") === "task.comment" && val(x, "body"),
  );
  // A task's tab follows into its address (`?tab=comments`), so Copy link and
  // a reload keep it; the address changes only while it names this task.
  const setTab = (next: string) => {
    setTabState(next);
    if (kind !== "task" || !row) return;
    const link = parseItemHash(location.hash);
    if (link?.kind === "task" && link.id === row.id)
      setAddress(itemTabPath(location.hash, next));
  };
  useEffect(() => {
    if (kind === "task" && row && askedTab && tabAsk) setTabState(askedTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabAsk]);
  // A comment link (`?comment=<id>`) scrolls to that comment once it loads.
  const shownComment = useRef("");
  const commentLoaded = comments.some((x) => x.id === askedComment);
  useEffect(() => {
    if (!askedComment || !commentLoaded || shownComment.current === askedComment)
      return;
    shownComment.current = askedComment;
    document
      .getElementById(`crew-comment-${askedComment}`)
      ?.scrollIntoView?.({ block: "center" });
  }, [askedComment, commentLoaded, tab]);
  const reviewPending = kind === "task" && row
    ? data.reviews.find((review) => val(review, "task") === row.id && val(review, "status") === "pending")
    : undefined;
  const pendingReviewId = reviewPending?.id;
  // The header's More menu: a note's History and Archive (Deactivate for an
  // agent). They call through a ref, so the menu always runs the latest save.
  const setMenu = useDialogMenu();
  const menuActions = useRef({ history: () => {}, archive: () => {} });
  useEffect(() => {
    // A review's body (ReviewDecision) sets its own menu.
    if (!setMenu || kind === "review") return;
    const items: MenuItem[] = [];
    if (row && kind === "note")
      items.push({
        label: t("History"),
        icon: "history",
        onSelect: () => menuActions.current.history(),
      });
    if (pendingReviewId && !readOnly)
      items.push({
        label: t("Review the draft"),
        icon: "check",
        onSelect: () => followTrail(reviewHash(pendingReviewId)),
      });
    if (row && !readOnly)
      items.push({
        label: archiveLabel(kind),
        icon: kind === "agent" ? "person" : "archive",
        destructive: true,
        disabled: busy,
        onSelect: () => menuActions.current.archive(),
      });
    setMenu(items);
    return () => setMenu([]);
  }, [setMenu, row, kind, readOnly, busy, pendingReviewId]);
  const [start] = useState(() => {
    const values = formValues(kind, row, data);
    if (!firstTask || row || kind !== "task") return values;
    const agents = data.agents.filter(canStartChat);
    return {
      ...values,
      title: t("Draft a welcome message for the crew"),
      body: t("Write a two-sentence welcome message for a new teammate explaining how to give the crew its first task. Save the message in Draft for review and use review.request to submit it for my approval. Leave the task in Needs review and wait for my decision."),
      readiness: "ready",
      selection: agents.length === 1 ? agents[0].id : "",
    };
  });
  const [title, setTitle] = useState(start.title),
    [body, setBody] = useState(start.body),
    [reason, setReason] = useState(""),
    [comment, setComment] = useState(""),
    [links, setLinks] = useState(start.links);
  const [workingDraft, setWorkingDraft] = useState<WorkingDraft>(() => ({
    draft: start.draft,
    options: makeEditorOptions(JSON.parse(start.draftOptions)),
  }));
  const { draft, options } = workingDraft;
  const [draftSelection, setDraftSelection] = useState(start.draftSelection);
  const [draftRecipient, setDraftRecipient] = useState(start.draftRecipient);
  const setDraft = (update: SetStateAction<string>) => setWorkingDraft(current => ({
    ...current, mirrorId: undefined, draft: typeof update === "function" ? update(current.draft) : update,
  }));
  const editOption = (id: string, edit: Parameters<typeof updateOption>[2]) =>
    setWorkingDraft(current => updateOption(current, id, edit));
  const [selection, setSelection] = useState(start.selection),
    [status, setStatus] = useState(start.status),
    [readiness, setReadiness] = useState(start.readiness),
    [waitingReason, setWaitingReason] = useState(start.waitingReason),
    [labels, setLabels] = useState(start.labels),
    [agentKindValue, setAgentKind] = useState<string>(start.agentKind);
  // Files: an existing task or note's attachments, or files staged for a new one.
  const itemKind = kind === "task" || kind === "note" ? kind : null;
  const parent =
    itemKind && row
      ? { kind: itemKind, id: row.id }
      : kind === "review" && row && val(row, "task")
        ? { kind: "task" as const, id: val(row, "task") }
        : undefined;
  const reloadEvents = () => {
    if (row && itemKind)
      void crewApi
        .read("events", { parent: row.id })
        .then(setEvents, () => undefined);
  };
  const item = useItemAttachments({
    parent,
    onChanged: () => {
      reloadEvents();
      refresh?.();
    },
    onWithdrawn: () => {
      if (row && itemKind) onWithdrawn?.(itemKind, row.id);
    },
  });
  const staged = useStagedFiles();
  const [inlineErrors, setInlineErrors] = useState<Record<string, string>>({});
  // Inline uploads still running: Save waits so no "⏳ Uploading" text is saved.
  const [inlineUploads, setInlineUploads] = useState(0);
  const uploadTokens = useRef(0);
  const commentBox = useRef<HTMLTextAreaElement>(null);
  const commentFiles = useRef<HTMLInputElement>(null);
  const takenNames = () => [
    ...item.attachments.map((a) => a.name),
    ...staged.staged.map((s) => s.file.name),
  ];
  /**
   * Pasted or dropped files in a Markdown field: an existing item uploads each
   * and replaces its "⏳ Uploading…" placeholder (found by a unique token) with
   * its reference; a new item stages them and inserts `attachment:new-K`
   * placeholders. Files over a limit are refused with a message. Returns the
   * inserted text.
   */
  const insertFiles =
    (
      field: string,
      setText: (update: (text: string) => string) => void,
    ) =>
    (incoming: File[], [from, to]: [number, number], pasted: boolean) => {
      if (readOnly || !itemKind) return;
      const named = pasted ? namePasted(incoming, takenNames()) : incoming;
      onEdit();
      const splice = (text: string) =>
        setText((value) => value.slice(0, from) + text + value.slice(to));
      const report = (refused: FileRefusal[]) =>
        setInlineErrors(({ [field]: _gone, ...rest }) =>
          refused.length
            ? { ...rest, [field]: refused.map((r) => r.message).join(" ") }
            : rest,
        );
      if (!row) {
        const { entries, refused } = staged.stage(named);
        report(refused);
        const text = entries
          .map((e) => fileReference(e.file.name, `new-${e.key}`, e.image))
          .join("\n");
        splice(text);
        return text;
      }
      const { accepted: files, refused } = checkFiles(named, {
        existing: item.used() + inlineUploads,
      });
      report(refused);
      if (!files.length) return "";
      const tokens = files.map(
        () =>
          `${++uploadTokens.current}-${Math.random().toString(36).slice(2, 6)}`,
      );
      const text = files
        .map((f, i) => uploadPlaceholder(f.name, tokens[i]))
        .join("\n");
      splice(text);
      setInlineUploads((n) => n + files.length);
      files.forEach((file, i) => {
        item
          .upload(file)
          .then(
            (a) =>
              setText((value) =>
                replaceUploadPlaceholder(
                  value,
                  tokens[i],
                  fileReference(a.name, a.id, isImage(a)),
                ),
              ),
            (e) => {
              setText((value) => replaceUploadPlaceholder(value, tokens[i], ""));
              setInlineErrors((all) => ({
                ...all,
                [field]: t("Could not attach {name}: {reason}", {
                  name: file.name,
                  reason: e instanceof Error ? e.message : t("upload failed"),
                }),
              }));
            },
          )
          .finally(() => setInlineUploads((n) => n - 1));
      });
      return text;
    };
  const inlineStatus = (field: string) =>
    inlineErrors[field] ? (
      <p className="crew-alert crew-inline-upload-error" role="alert">
        {inlineErrors[field]}
      </p>
    ) : null;
  /** Staged files leave the text too, so no placeholder points at nothing. */
  const unstage = (key: number) => {
    const ref = new RegExp(`!?\\[(?:[^\\]\\\\]|\\\\.)*\\]\\(attachment:new-${key}\\)\\n?`, "g");
    setBody((text) => text.replace(ref, ""));
    setWorkingDraft(current => ({
      ...current,
      draft: current.draft.replace(ref, ""),
      options: current.options.map(option => ({ ...option, body: option.body.replace(ref, "") })),
    }));
    staged.unstage(key);
  };
  // A newer revision of the open record (after a file change withdrew its
  // approval) replaces the fields the owner has not changed.
  const baseRow = useRef(row);
  const initialRef = useRef(start);
  const hintId = useId();
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
              e instanceof Error ? e.message : t("Could not load history."),
            );
        });
    return () => {
      alive = false;
    };
  }, [row?.id, kind]);
  useEffect(() => {
    // A new view starts at its top; focus stays in the dialog when its control goes.
    const dialog = root.current?.closest("dialog");
    dialog?.scrollTo?.(0, 0);
    if (dialog && !dialog.contains(document.activeElement))
      dialog.focus({ preventScroll: true });
  }, [tab]);
  const current = {
    title,
    body,
    draft,
    draftOptions: JSON.stringify(savedOptions(options)),
    draftSelection,
    draftRecipient: draftRecipient.trim(),
    links,
    selection,
    status,
    readiness,
    waitingReason,
    labels,
    agentKind: agentKindValue,
  };
  const setters: Record<keyof typeof current, (v: string) => void> = {
    title: setTitle,
    body: setBody,
    draft: setDraft,
    draftOptions: raw => setWorkingDraft(current => ({
      ...current, mirrorId: undefined, options: makeEditorOptions(JSON.parse(raw), current.options),
    })),
    draftSelection: setDraftSelection,
    draftRecipient: setDraftRecipient,
    links: setLinks,
    selection: setSelection,
    status: setStatus,
    readiness: setReadiness,
    waitingReason: setWaitingReason,
    labels: setLabels,
    agentKind: setAgentKind,
  };
  useEffect(() => {
    const before = baseRow.current;
    baseRow.current = row;
    if (!row || !before || before.revision === row.revision) return;
    const next = formValues(kind, row, data);
    for (const key of Object.keys(current) as (keyof typeof current)[])
      if (current[key] === initialRef.current[key]) setters[key](next[key]);
    initialRef.current = next;
    // Runs only when the record itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);
  const initial = initialRef.current;
  const changed = (Object.keys(current) as (keyof typeof current)[]).filter(
    (key) => current[key] !== initial[key],
  );
  const dirty = changed.length > 0;
  const reviewSettingsChanged = current.draftOptions !== initial.draftOptions ||
    draftSelection !== initial.draftSelection || current.draftRecipient !== initial.draftRecipient;
  const reviewChanged = draft !== initial.draft || reviewSettingsChanged;
  const onlyLinksChanged = changed.length === 1 && changed[0] === "links";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (readOnly || inlineUploads > 0) return;
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
              ...(!row || body !== initial.body ? { description: body } : {}),
              ...(!row || draft !== initial.draft ? { draft } : {}),
              ...(current.draftOptions !== initial.draftOptions ? { draft_options: savedOptions(options) } : {}),
              ...(draftSelection !== initial.draftSelection ? { draft_selection: draftSelection } : {}),
              ...(current.draftRecipient !== initial.draftRecipient ? { draft_recipient: current.draftRecipient } : {}),
              assigned_agent: selection,
              readiness,
              waiting_reason: readiness !== "ready" ? waitingReason : "",
              ...(status === "needs_review" ? {} : { status }),
              labels: JSON.parse(labels) as string[],
              links: links
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
            }
          : kind === "bucket"
            ? { name: title, purpose: body, responsible_agent: selection }
            : {
                name: title,
                brief: body,
                ...(!row ? { kind: agentKindValue } : {}),
              };
    if (!row && itemKind && staged.staged.length) {
      // One atomic request: the item, its files and resolved placeholders.
      const prepared = staged.prepare();
      const textKeys = itemKind === "task" ? ["description", "draft"] : ["body"];
      const withFiles: Record<string, unknown> = { ...fields };
      for (const key of textKeys)
        if (typeof withFiles[key] === "string")
          withFiles[key] = prepared.renumber(withFiles[key] as string);
      if (kind === "task" && options.length)
        withFiles.draft_options = savedOptions(options).map(option => ({ ...option, body: prepared.renumber(option.body) }));
      void perform(async () => {
        try {
          await attachmentsApi.createWithFiles(itemKind, withFiles, prepared.files, {
            reason,
          });
        } catch (e) {
          prepared.fail(e);
          throw e;
        }
      }).then((ok) => {
        if (ok) close();
      });
      return;
    }
    const keepOpen = kind === "task" && !!row && (options.length > 0 || !!draftRecipient.trim() || reviewSettingsChanged);
    void save(`${kind}.${row ? "update" : "create"}`, fields, row, reason, keepOpen);
  };
  if (kind === "review" && row)
    return <ReviewDecision row={row} task={data.tasks.find(task => task.id === val(row, "task"))} busy={busy} error={error}
      attachments={item.attachments} loaded={item.loaded} Prose={Prose}
      when={when} save={save} archiveTask={archiveReviewTask} />;
  const bar = (action?: ReactNode) =>
    action || error ? (
      <div className="crew-save-bar">
        {error && (
          <p className="crew-alert" role="alert">
            {error}
          </p>
        )}
        {action}
      </div>
    ) : null;
  menuActions.current = {
    history: () => setTab("history"),
    archive: () => {
      if (row) void save(`${kind}.update`, { archived: true }, row, reason);
    },
  };
  // One quiet line: these are rarely needed and must not look like next steps.
  const more = row && (
    <p className="crew-meta-row">
      <span>{t("Revision {n}", { n: String(row.revision) })}</span>
      {kind === "note" && (
        <button
          type="button"
          className="crew-quiet"
          onClick={() => setTab("history")}
        >
          {t("History")}
        </button>
      )}
      {!readOnly && (
        <button
          type="button"
          className="crew-quiet"
          disabled={busy}
          onClick={() =>
            void save(`${kind}.update`, { archived: true }, row, reason)
          }
        >
          {archiveLabel(kind)}
        </button>
      )}
    </p>
  );
  const backToNote = (
    <button
      type="button"
      className="crew-quiet crew-back"
      onClick={() => setTab("read")}
    >
      {t("← Back to note")}
    </button>
  );
  const brief = kind === "task" ? taskBrief(body) : undefined;
  const whyBlocked = draft !== initial.draft ? t("Save your draft first.")
    : dirty ? t("Save your task changes first.")
    : !draft.trim() && !options.length ? t("Save a draft or add an option first.") : "";
  const requestApproval = row && !readOnly && !reviewPending && (
    <div className="crew-review-actions">
      <button type="button" className="crew-review-submit"
        disabled={busy || inlineUploads > 0 || !!whyBlocked}
        aria-describedby={whyBlocked ? `${hintId}-request` : undefined}
        onClick={() => void save("review.request", {}, row)}>
        {t("Request approval")}
      </button>
      <Help topic="send-for-approval" />
      {whyBlocked && <span id={`${hintId}-request`} className="crew-review-hint">{whyBlocked}</span>}
    </div>
  );
  const buckets = data.buckets.find((x) => x.id === val(row, "bucket"));
  // A coding session's claim; the owner may always release it (In progress goes back to To do).
  const claim = claimOf(row);
  const releaseClaim = async () => {
    if (!row) return;
    if (
      claim.state === "live" &&
      !window.confirm(t("A session is working on this. Release its claim?"))
    )
      return;
    if (
      await perform(
        () => crewApi.write("task.release", {}, row),
        val(row, "status") === "in_progress"
          ? t("Claim released. The task is To do.")
          : t("Claim released."),
      )
    )
      refreshRow?.();
  };
  // Controls inside a disabled fieldset can't open, so read-only forms have no help.
  const help = (topic: HelpTopic) => (readOnly ? undefined : topic);
  // Labels already used on other tasks, offered while typing a new one.
  const labelSuggestions = [
    ...new Set(data.tasks.flatMap((x) => list(x, "labels"))),
  ];
  const filesSection = itemKind && (
    <AttachmentsSection
      parent={parent}
      item={row ? item : undefined}
      staged={row ? undefined : staged}
      readOnly={readOnly}
      onStage={(files) => {
        onEdit();
        staged.stage(files);
      }}
      onUnstage={unstage}
    />
  );
  // Files pasted or dropped anywhere else in the dialog are added to the item.
  const addToItem = (files: File[], pasted: boolean) => {
    if (readOnly || !itemKind || !files.length) return;
    const named = pasted ? namePasted(files, takenNames()) : files;
    if (row) item.addFiles(named);
    else {
      onEdit();
      staged.stage(named);
    }
  };
  if (kind === "agent") {
    const formId = `${hintId}-agent-profile`;
    const briefLabel = agentKindValue === "human" ? t("Role description") : t("Agent brief");
    return (
      <div className="crew-dialog-body crew-agent-editor" ref={root}>
        {readOnly && <p className="crew-notice" role="status">{archiveNotice}</p>}
        <form id={formId} onSubmit={submit}>
          {!row && <fieldset className="crew-assignee-kind">
            <legend>{t("Who will receive assignments?")}</legend>
            {(["external", "human"] as const).map((type) => (
              <label key={type}>
                <input type="radio" name="assignee-type" checked={agentKindValue === type}
                  onChange={() => setAgentKind(type)} />
                {type === "human" ? t("Person") : t("Agent")}
              </label>
            ))}
          </fieldset>}
          <div className="crew-agent-profile">
            <fieldset className="crew-form-fields" disabled={readOnly}>
              <AutoTextField label={t("Name")} required maxLength={200} value={title} onValue={setTitle} />
            </fieldset>
            <fieldset className="crew-form-fields" disabled={readOnly}>
              <MarkdownField label={briefLabel} className="crew-long-text" value={body}
                help={!readOnly && agentKindValue !== "human" ? <Help topic="brief" /> : undefined} onChange={setBody} />
            </fieldset>
            {row && !readOnly && dirty && <Field label={t("Reason for change")} help="reason">
              <AutoTextarea value={reason} onValue={setReason} placeholder={t("Optional: what changed and why?")} />
            </Field>}
          </div>
        </form>
        {row && !readOnly && canStartChat(row) && (
          <div className="crew-agent-startup" onChange={(event) => event.stopPropagation()}>
            <ChatInstructions agent={row} open={openInstructions} />
            <AgentStartupSettings agent={row} onConfigured={onAgentConfigured} />
          </div>
        )}
        {row && !readOnly && <div onChange={(event) => event.stopPropagation()}>
          <AgentAssignments agent={row} />
        </div>}
        {more}
        {bar(!readOnly && <button className="crew-primary" type="submit" form={formId}
          disabled={busy || !title.trim() || (!!row && !dirty)}>{agentKindValue === "human" ? t("Save person") : t("Save agent")}</button>)}
      </div>
    );
  }
  const approval = approvalLine(row);
  return (
    <AttachmentsProvider
      attachments={item.attachments}
      staged={staged.staged}
      initialOpen={askedFile}
    >
    <div
      className={`crew-dialog-body${row && (kind === "note" || kind === "task") ? " crew-switching-views" : ""}`}
      ref={root}
      onPaste={(e) => {
        if (e.defaultPrevented) return;
        const files = filesOf(e.clipboardData);
        if (!files.length || !itemKind || readOnly) return;
        e.preventDefault();
        addToItem(files, true);
      }}
      onDragOver={(e) => {
        if (itemKind && !readOnly && Array.from(e.dataTransfer.types).includes("Files"))
          e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.defaultPrevented) return;
        const files = filesOf(e.dataTransfer);
        if (!files.length || !itemKind || readOnly) return;
        e.preventDefault();
        addToItem(files, false);
      }}
    >
      {readOnly && (
        <p className="crew-notice" role="status">
          {archiveNotice}
        </p>
      )}
      {row && kind === "task" && (
        <div className="crew-tabs" role="tablist" aria-label={t("Record views")}>
          {taskTabs.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {readOnly && key === "edit"
                ? t("Details")
                : {
                    edit: t("Edit"),
                    comments: t("Comments"),
                    activity: t("Activity"),
                    reviews: t("Reviews"),
                  }[key]}
              {key === "comments" && (
                <span className="crew-tab-count" aria-label={`, ${comments.length}`}>
                  {comments.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {row && kind === "note" && !readOnly && tab !== "history" && (
        <div
          className="crew-md-tabs crew-note-tabs"
          role="tablist"
          aria-label={t("Note view")}
        >
          {["read", "edit"].map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {key === "read" ? t("Read") : t("Edit")}
            </button>
          ))}
        </div>
      )}
      {relatedError && <p className="crew-alert">{relatedError}</p>}
      {tab === "read" && row && (
        <div className="crew-read">
          <article>
            {buckets && (
              <span className="crew-note-bucket">{val(buckets, "name")}</span>
            )}
            {/* Same labels and boxes as Edit, so switching views keeps everything in place. */}
            <ReadTitle title={title} />
            <ReadField label={t("Note")}>
              {body.trim() ? <Prose>{body}</Prose> : <p>{t("Nothing written yet.")}</p>}
            </ReadField>
            <RelatedItems
              data={data}
              currentId={row.id}
              links={links}
              readOnly={readOnly}
              setLinks={(next) => {
                setLinks(next);
                onEdit();
              }}
            />
          </article>
          {filesSection}
          {more}
          {bar(
            dirty &&
              (onlyLinksChanged ? (
                // Linking from Read saves here, like Remove and add on a task.
                <button
                  className="crew-primary"
                  disabled={busy || readOnly}
                  onClick={(e) => submit(e)}
                >
                  {t("Save note")}
                </button>
              ) : (
                <button className="crew-primary" onClick={() => setTab("edit")}>
                  {t("Continue editing to save")}
                </button>
              )),
          )}
        </div>
      )}
      {tab === "edit" && (
        <form className="crew-editor-form" onSubmit={submit}>
          {kind === "note" && row && buckets && (
            <span className="crew-note-bucket">{val(buckets, "name")}</span>
          )}
          <fieldset className="crew-form-fields" disabled={readOnly}>
            <AutoTextField
              label={kind === "note" || kind === "task" ? t("Title") : t("Name")}
              required
              maxLength={200}
              value={title}
              onValue={setTitle}
            />
            {!(kind === "note" && row) &&
              (kind === "note" || kind === "bucket" || kind === "task") && (
              <Field
                label={
                  kind === "note"
                    ? t("Bucket")
                    : kind === "bucket"
                      ? t("Responsible agent")
                      : t("Assigned agent")
                }
                help={help(
                  kind === "note"
                    ? "bucket"
                    : kind === "bucket"
                      ? "responsible-agent"
                      : "assigned-agent",
                )}
              >
                <select
                  value={selection}
                  required={kind === "note" || firstTask}
                  ref={(el) => { el?.setCustomValidity(firstTask && !data.agents.some(agent => agent.id === selection && canStartChat(agent)) ? t("Assign the first task to an active agent.") : ""); }}
                  onChange={(e) => setSelection(e.target.value)}
                >
                  <option value="">
                    {kind === "note" ? t("Choose a bucket") : t("Unassigned")}
                  </option>
                  {kind === "task" &&
                    selection &&
                    !data.agents.some((x) => x.id === selection) && (
                      <option value={selection} disabled>
                        {t("Unavailable agent")}
                      </option>
                    )}
                  {data[kind === "note" ? "buckets" : "agents"]
                    .filter(
                      (x) =>
                        !x.archived ||
                        x.id ===
                          val(
                            row,
                            kind === "note"
                              ? "bucket"
                              : kind === "bucket"
                                ? "responsible_agent"
                                : "assigned_agent",
                          ),
                    )
                    .map((x) => (
                      <option key={x.id} value={x.id} disabled={!!x.archived || (firstTask && !canStartChat(x))}>
                        {val(x, "name")}
                        {x.archived ? ` ${t("(inactive)")}` : ""}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {kind === "note" || kind === "task" ? (
              <MarkdownField
                label={kind === "note" ? t("Note") : t("Description")}
                required={kind === "note"}
                className={kind === "note" ? "crew-note-text" : ""}
                value={body}
                onChange={setBody}
                preview={brief}
                hint={kind === "task" ? (brief === body
                  ? t("The owner’s request, sources and constraints.")
                  : t("Edit to see the full description, including saved draft blocks.")) : undefined}
                tabs={kind === "task"}
                onFiles={insertFiles("body", setBody)}
                status={inlineStatus("body")}
              />
            ) : (
              <MarkdownField label={t("Purpose")} value={body} onChange={setBody} />
            )}
            {kind === "task" && (
              <>
                {row && claim.state && (
                  <ClaimBanner
                    claim={claim}
                    agent={claimAgent(
                      claim,
                      val(
                        data.agents.find(
                          (x) => x.id === val(row, "assigned_agent"),
                        ),
                        "name",
                      ),
                    )}
                    readOnly={readOnly}
                    busy={busy}
                    onRelease={() => void releaseClaim()}
                  />
                )}
                <div className="crew-form-grid">
                  <div className="crew-status-field">
                    <Field label={t("Status")} help={help("status")}>
                      <select
                        value={status}
                        aria-describedby={`${hintId}-status`}
                        onChange={(e) => setStatus(e.target.value)}
                      >
                        {statuses.map(([key, label]) => (
                          <option
                            key={key}
                            value={key}
                            disabled={key === "needs_review"}
                          >
                            {t(label)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {/* Native options can't explain themselves: the hint shows on
                        focus, and always while a review is pending. */}
                    <p
                      id={`${hintId}-status`}
                      className={reviewPending ? "crew-status-hint is-pending" : "crew-status-hint"}
                    >
                      {reviewPending
                        ? t("Needs review: a draft is waiting for your decision in Approvals.")
                        : t("Needs review is set by requesting approval for a saved draft, not by hand.")}
                    </p>
                  </div>
                  <LabelsInput
                    value={JSON.parse(labels) as string[]}
                    disabled={readOnly}
                    suggestions={labelSuggestions}
                    onChange={(next) => {
                      setLabels(JSON.stringify(next));
                      onEdit();
                    }}
                  />
                </div>
                {approval && (
                  <p className="crew-approval-line" role="note">
                    {approval.text}
                    {approval.at && <>, <RelativeTime value={approval.at} /></>}
                  </p>
                )}
                <div className="crew-form-grid">
                  <Field label={t("Hold")} help={help("readiness")}>
                    <select
                      value={readiness === "ready" ? "ready" : "waiting"}
                      ref={(el) => { el?.setCustomValidity(firstTask && readiness !== "ready" ? t("Set the first task to Ready.") : ""); }}
                      onChange={(e) => setReadiness(e.target.value)}
                    >
                      <option value="waiting">{t("On hold")}</option>
                      <option value="ready">{t("Ready")}</option>
                    </select>
                  </Field>
                  {readiness !== "ready" && (
                    <HoldReasonField
                      value={waitingReason}
                      onValue={setWaitingReason}
                      readOnly={readOnly}
                    />
                  )}
                </div>
                <p className="crew-footnote crew-hold-explainer">
                  {t("On hold: nobody is woken; a person decides. Ready: the assigned bot may act.")}
                </p>
                {wakeMissing && (
                  <p className="crew-wake-missing" role="note">
                    <WakeMissingChip /> {wakeMissingTitle()}
                  </p>
                )}
                <TaskDraft
                  {...workingDraft}
                  recipient={draftRecipient}
                  selection={draftSelection}
                  setRecipient={setDraftRecipient}
                  setSelection={setDraftSelection}
                  readOnly={readOnly}
                  pending={!!reviewPending}
                  dirtyReview={reviewChanged}
                  help={!readOnly && <Help topic="draft" />}
                  request={requestApproval}
                  onDraft={setDraft}
                  onOption={editOption}
                  onAdd={() => {
                    onEdit();
                    setWorkingDraft(current => {
                      const keys = new Set(current.options.map(option => option.key));
                      let n = 1;
                      while (keys.has(`option-${n}`)) n++;
                      const [added] = makeEditorOptions([{ key: `option-${n}`, label: "", body: "" }]);
                      return { ...current, options: [...current.options, added] };
                    });
                  }}
                  onRemove={id => {
                    onEdit();
                    if (options.length === 1) setDraftSelection("any");
                    setWorkingDraft(current => removeOption(current, id));
                  }}
                  files={id => {
                    const field = id ? `option-${id}` : "draft";
                    return {
                      status: inlineStatus(field),
                      onFiles: insertFiles(field, id ? body => editOption(id, { body }) : setDraft),
                    };
                  }}
                />
              </>
            )}
            {(kind === "note" || kind === "task") && (
              <RelatedItems
                data={data}
                currentId={row?.id}
                links={links}
                readOnly={readOnly}
                setLinks={(next) => {
                  setLinks(next);
                  onEdit();
                }}
              />
            )}
            {row && !readOnly && dirty && (
              <Field label={t("Reason for change")} help="reason">
                <AutoTextarea
                  value={reason}
                  onValue={setReason}
                  placeholder={t("Optional: what changed and why?")}
                />
              </Field>
            )}
            {kind === "bucket" && (
              <p className="crew-footnote">
                {t("Responsibility is a convention, not a permission. Archiving this bucket hides its notes and stops writes until restored.")}
              </p>
            )}
          </fieldset>
          {filesSection}
          {kind !== "note" && more}
          {bar(
            !readOnly && (
              // Always visible in Edit, so there is no guessing how to save.
              <button
                className="crew-primary"
                disabled={busy || inlineUploads > 0 || (Boolean(row) && !dirty)}
                title={row && !dirty ? t("Change something to save") : undefined}
              >
                {inlineUploads > 0
                  ? t("Waiting for uploads…")
                  : {
                      task: t("Save task"),
                      note: t("Save note"),
                      bucket: t("Save bucket"),
                      review: t("Save review"),
                    }[kind]}
              </button>
            ),
          )}
        </form>
      )}
      {tab === "history" && (
        <>
          {backToNote}
          <p>
            {t("Restoring creates a new revision and keeps every previous version.")}
          </p>
          {!history.length && <p>{t("No earlier revisions available.")}</p>}
          {events.some(isFileEvent) && (
            <details className="crew-version">
              <summary>{t("File activity")}</summary>
              <ol className="crew-timeline">
                {events.filter(isFileEvent).map((x) => {
                  const summary = eventSummary(x);
                  return (
                    <li key={x.id}>
                      <strong>{summary.title}</strong>
                      <small>
                        {when(x.created)} · {summary.by}
                      </small>
                    </li>
                  );
                })}
              </ol>
            </details>
          )}
          {[...history]
            .sort((a, b) => b.revision - a.revision)
            .map((x) => {
              const diff = lineDiff(val(x, "body"), val(row, "body"));
              return (
                <details className="crew-version" key={x.id}>
                  <summary>
                    {t("Revision {n}", { n: String(x.revision) })} · {when(x.created)}
                  </summary>
                  <p className="crew-footnote">
                    {val(x, "reported_agent") ||
                      val(x, "actor") ||
                      t("Owner / connection")}
                    {val(x, "reason") ? (
                      <>
                        {" · "}
                        <PlainRefs text={val(x, "reason")} />
                      </>
                    ) : null}
                  </p>
                  <h3>{val(x, "title")}</h3>
                  <Prose>{val(x, "body")}</Prose>
                  <details>
                    <summary>{t("Changed section compared with current")}</summary>
                    <p className="crew-footnote">
                      {t("The ordered section replaced between this revision and the current version.")}
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
                  {!readOnly && (
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
                      {t("Restore as new revision")}
                    </button>
                  )}
                </details>
              );
            })}
        </>
      )}
      {tab === "comments" && (
        <>
          {!readOnly && (
            <form
              className="crew-comment-form"
              onSubmit={(e) => {
                e.preventDefault();
                // Waits for uploads, so no "Uploading" placeholder is posted.
                if (row && inlineUploads === 0)
                  void perform(() =>
                    crewApi.write("task.comment", { body: comment }, row),
                  ).then(async (ok) => {
                    if (ok) {
                      setComment("");
                      setEvents(
                        await crewApi.read("events", { parent: row.id }),
                      );
                    }
                  });
              }}
            >
              <div className="crew-md-field">
                <div className="crew-md-label">
                  <label htmlFor={`comment-${row?.id}`}>{t("Add a comment")}</label>
                  <small>{t("Markdown supported")}</small>
                </div>
                <textarea
                  id={`comment-${row?.id}`}
                  ref={commentBox}
                  required
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t("Paste or drop screenshots here")}
                  {...fileInputHandlers(insertFiles("comment", setComment))}
                />
                {inlineStatus("comment")}
              </div>
              <div className="crew-comment-actions">
                <input
                  ref={commentFiles}
                  type="file"
                  multiple
                  hidden
                  aria-label={t("Attach files to the comment")}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    if (!files.length) return;
                    const box = commentBox.current;
                    const end = box?.value.length ?? comment.length;
                    insertFiles("comment", setComment)(
                      files,
                      [box?.selectionStart ?? end, box?.selectionEnd ?? end],
                      false,
                    );
                  }}
                />
                <button
                  type="button"
                  onClick={() => commentFiles.current?.click()}
                >
                  {t("Attach files")}
                </button>
                <button
                  className="crew-primary"
                  disabled={busy || inlineUploads > 0}
                >
                  {inlineUploads > 0 ? t("Waiting for uploads…") : t("Add comment")}
                </button>
              </div>
            </form>
          )}
          {comments.length ? (
            <ol className="crew-timeline crew-comments" aria-label={t("Comments")}>
              {comments.map((x) => (
                <li
                  key={x.id}
                  id={`crew-comment-${x.id}`}
                  className={x.id === askedComment ? "crew-comment-target" : undefined}
                >
                  <small>
                    <strong>{eventSummary(x).by}</strong> · {when(x.created)}
                  </small>
                  {/* Sanitized Markdown: raw HTML is shown as text, never run. */}
                  <div className="crew-comment-body">
                    <Prose>{val(x, "body")}</Prose>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="crew-empty-note">{t("No comments yet.")}</p>
          )}
        </>
      )}
      {tab === "activity" && (
        <>
          <ol className="crew-timeline">
            {events.map((x) => {
              const summary = eventSummary(x);
              return (
                <li key={x.id}>
                  <strong>{summary.title}</strong>
                  <small className="crew-timeline-meta">
                    {" · "}{when(x.created)} · {summary.by}
                  </small>
                  {val(x, "action") === "review.decide" && (() => {
                    const changes = typeof x.changes === "string" ? (() => { try { return JSON.parse(x.changes); } catch { return {}; } })() : (x.changes || {});
                    const choices = objects(changes.option_decisions);
                    const summary = decisionSummary({ id: x.id, revision: x.revision, options: changes.options, option_decisions: choices }, String(changes.decision || changes.status || ""));
                    return summary ? <p>{summary}</p> : null;
                  })()}
                  {summary.by.startsWith(
                    t("via upload link"),
                  ) ? null : val(x, "action") === "task.comment" &&
                    val(x, "body") ? (
                    // Sanitized Markdown: raw HTML is shown as text, never run.
                    <div className="crew-comment-body">
                      <Prose>{val(x, "body")}</Prose>
                    </div>
                  ) : (
                    <p>
                      <PlainRefs text={val(x, "body") || val(x, "reason")} />
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}
      {tab === "reviews" && (
        <>
          {!history.length && (
            <p>{t("No review requests yet. Save a draft and submit it from Edit.")}</p>
          )}
          {history.map((x) => (
            <article className="crew-version" key={x.id}>
              <span className="crew-pill">
                {reviewStatusLabel(val(x, "status"))}
              </span>
              <small>{when(x.created)}</small>
              <ReviewContent row={x} attachments={item.attachments} loaded={item.loaded} Prose={Prose}>
                <ReviewChoices row={x} Prose={Prose} />
              </ReviewContent>
              {decisionSummary(x) && <p>{decisionSummary(x)}</p>}
              {val(x, "decision_note") && (
                <p>
                  <PlainRefs text={val(x, "decision_note")} />
                </p>
              )}
              {val(x, "status") === "pending" && !readOnly && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(
                      () => crewApi.write("review.withdraw", {}, x),
                      t("Review withdrawn."),
                    ).then((ok) => {
                      if (ok) close();
                    })
                  }
                >
                  {t("Withdraw request")}
                </button>
              )}
            </article>
          ))}
        </>
      )}
      {tab !== "read" && tab !== "edit" && error && (
        <p className="crew-alert" role="alert">
          {error}
        </p>
      )}
    </div>
    </AttachmentsProvider>
  );
}
