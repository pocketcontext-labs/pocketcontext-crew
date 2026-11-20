import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  AttachmentsProvider,
  FileTile,
  fromAttachment,
  useAttachmentsContext,
} from "./Attachments";
import { attachmentsApi, type Attachment } from "./attachmentsApi";
import { val, type Row } from "./crewApi";
import {
  decisionSummary,
  isImageOption,
  missingReviewEvidence,
  optionDecisions,
  reviewFiles,
  type OptionDecision,
  type ReviewOption,
} from "./reviews";
import {
  IconButton,
  MoreMenu,
  useDialogMenu,
  type MenuItem,
} from "./DialogHeader";
import {
  BlockOptionContext,
  CopyButton,
  ReviewMarkupContext,
  BlockCount,
  blockMetrics,
  blockName,
  channelName,
} from "./ReviewBlocks";
import { blockCopyText, characterCount } from "./reviewMarkup";
import { reviewPresentation, type PresentedReview } from "./reviewPresentation";
import HideHelp, { helpIds, useHelpShown } from "./HideHelp";
import { itemPath, reviewHash } from "./itemLink";
import "./review.css";
import AutoTextarea from "./AutoTextarea";
import PlainRefs from "./PlainRefs";
import { ReadTitle } from "./ReadFields";
import { locale, t } from "./i18n";
import { followTrail } from "./trail";

/** Fills a translated sentence's {name} slots with elements. */
function fillNodes(
  text: string,
  nodes: Record<string, ReactNode>,
): ReactNode[] {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in nodes ? (
      <Fragment key={i}>{nodes[name]}</Fragment>
    ) : (
      part
    );
  });
}

/** A review status as the pill shows it ("changes requested"). */
function reviewStatusText(status: string): string {
  switch (status) {
    case "pending":
      return t("pending");
    case "approved":
      return t("approved");
    case "changes_requested":
      return t("changes requested");
    case "rejected":
      return t("rejected");
    case "withdrawn":
      return t("withdrawn");
    default:
      return status.replaceAll("_", " ");
  }
}

export { CopyButton };

type ProseComponent = ComponentType<{ children: string }>;
export function ReviewContent({
  row,
  attachments,
  loaded = true,
  presentation,
  Prose,
  children,
}: {
  row: Row;
  attachments: Attachment[];
  loaded?: boolean;
  presentation?: PresentedReview;
  Prose: ProseComponent;
  children?: React.ReactNode;
}) {
  const { draft, options, notes } = useMemo(
    () => presentation ?? reviewPresentation(row),
    [row, presentation],
  );
  const files = reviewFiles(row, attachments);
  const missing = missingReviewEvidence(row, files, loaded);
  return (
    <AttachmentsProvider attachments={files} stepThroughAll>
      <ReviewMarkupContext.Provider value={true}>
        <div className="crew-review-content">
          {missing.length > 0 && (
            <div className="crew-alert" role="alert">
              <p>
                {t(
                  "This draft mentions files that aren't attached to Crew. Request changes and ask the agent to attach them.",
                )}
              </p>
              <ul>
                {missing.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!options.length && draft.body && (
            <div
              className="crew-draft-snapshot"
              data-blocks={draft.paste.length > 0 || undefined}
            >
              {!draft.paste.length && (
                <header>
                  <CopyButton
                    className="crew-draft-copy"
                    plainText={draft.copy}
                    label={t("Copy draft text")}
                  />
                </header>
              )}
              <Prose>{draft.body}</Prose>
            </div>
          )}
          {notes.length > 0 && (
            <aside className="crew-md-field" aria-label={t("Note for you")}>
              <div className="crew-md-label">
                <h3 className="crew-md-name">{t("Note for you")}</h3>
              </div>
              <div className="crew-reviewer-note">
                {notes.map((note, i) => (
                  <Prose key={i}>{note}</Prose>
                ))}
              </div>
            </aside>
          )}
          {children}
          {files.length > 0 && (
            <section aria-label={t("Files submitted for review")}>
              <h3>{t("Files submitted for review")}</h3>
              <ReviewFileTiles files={files} />
            </section>
          )}
        </div>
      </ReviewMarkupContext.Provider>
    </AttachmentsProvider>
  );
}

/** Each submitted file once, as a tile; the viewer steps through them all. */
function ReviewFileTiles({ files }: { files: Attachment[] }) {
  const ctx = useAttachmentsContext();
  const ids = files.map((f) => f.id);
  return (
    <ul className="crew-file-tiles">
      {files.map((file) => (
        <FileTile
          key={file.id}
          file={fromAttachment(file)}
          token={ctx?.token ?? ""}
          onOpen={() => ctx?.open(file.id, ids)}
          onDownload={() => void attachmentsApi.download(file)}
        />
      ))}
    </ul>
  );
}

/**
 * One option's state while deciding: checked, its whole-option feedback and
 * whether that field is open, and (0.38.0) feedback per block, by target.
 */
export type OptionPick = {
  selected: boolean;
  note: string;
  open?: boolean;
  feedback?: Record<string, string>;
  openBlocks?: Record<string, boolean>;
};
export type OptionPicks = Record<string, OptionPick>;

const pickOf = (picks: OptionPicks | undefined, key: string): OptionPick =>
  picks?.[key] ?? { selected: false, note: "" };

/** A decided option, as the read-only dialog shows it. */
const decidedPick = (choices: OptionDecision[], key: string): OptionPick => {
  const choice = choices.find((x) => x.key === key);
  const feedback: Record<string, string> = {};
  for (const entry of choice?.feedback ?? [])
    if (entry && typeof entry.target === "string")
      feedback[entry.target] = String(entry.note ?? "");
  return {
    selected: choice?.decision === "approved",
    note: choice?.note || "",
    feedback,
  };
};

/** The per-block feedback a decision sends: non-empty notes only. */
export const pickFeedback = (pick: OptionPick | undefined) =>
  Object.entries(pick?.feedback ?? {})
    .filter(([, note]) => note.trim())
    .map(([target, note]) => ({ target, note }));

function FeedbackButton({
  label,
  hasNote,
  expanded,
  onPointerDown,
  onClick,
}: {
  label: string;
  hasNote: boolean;
  expanded?: boolean;
  onPointerDown?: () => void;
  onClick?: (keyboard: boolean) => void;
}) {
  return (
    <IconButton
      icon="note"
      className="crew-pick-comment"
      data-note={hasNote || undefined}
      label={t("Feedback on {label}", { label })}
      aria-expanded={onClick ? expanded : undefined}
      disabled={!onClick}
      onPointerDown={onPointerDown}
      onClick={onClick && ((e) => onClick(e.detail === 0))}
    />
  );
}

/** Option selection and feedback always refer to the frozen option keys. */
export function ReviewChoices({
  row,
  Prose,
  picks,
  presentation,
  onChange,
}: {
  row: Row;
  Prose: ProseComponent;
  picks?: OptionPicks;
  presentation?: PresentedReview;
  onChange?: (key: string, pick: OptionPick) => void;
}) {
  const { options } = useMemo(
    () => presentation ?? reviewPresentation(row),
    [row, presentation],
  );
  const pickOne = row.selection === "one";
  const choices = optionDecisions(row);
  const prefix = useId();
  // Whether the field had focus when its feedback icon was pressed (the
  // press itself moves focus away).
  const hadFocus = useRef(false);
  if (!options.length) return null;
  const editable = !!onChange;
  const pickFor = (key: string) =>
    editable ? pickOf(picks, key) : decidedPick(choices, key);
  // target "" is the whole option; anything else a block.
  const noteOf = (pick: OptionPick, target: string) =>
    target ? (pick.feedback?.[target] ?? "") : pick.note;
  const shownFor = (pick: OptionPick, target: string) =>
    target
      ? editable
        ? (pick.openBlocks?.[target] ?? !!noteOf(pick, target))
        : !!noteOf(pick, target)
      : editable
        ? (pick.open ?? ((!pickOne && pick.selected) || !!pick.note))
        : !!pick.note;
  const shown = (pick: OptionPick) => shownFor(pick, "");
  const withNote = (
    pick: OptionPick,
    target: string,
    note: string,
  ): OptionPick =>
    target
      ? { ...pick, feedback: { ...pick.feedback, [target]: note } }
      : { ...pick, note };
  const withOpen = (
    pick: OptionPick,
    target: string,
    open: boolean,
  ): OptionPick =>
    target
      ? { ...pick, openBlocks: { ...pick.openBlocks, [target]: open } }
      : { ...pick, open };
  const fieldId = (option: ReviewOption, target: string) =>
    target ? `${prefix}-${option.key}--${target}` : `${prefix}-${option.key}`;
  const text = options.filter((o) => !isImageOption(o));
  const images = options.filter(isImageOption);
  const field = (
    option: ReviewOption,
    pick: OptionPick,
    target = "",
    label = option.label,
  ) =>
    editable ? (
      <AutoTextarea
        id={fieldId(option, target)}
        className="crew-pick-note"
        aria-label={t("Feedback on {label}", { label })}
        placeholder={t("Feedback on {label}…", { label })}
        maxLength={20000}
        value={noteOf(pick, target)}
        onValue={(note) => onChange(option.key, withNote(pick, target, note))}
      />
    ) : target ? (
      <p className="crew-pick-feedback crew-block-feedback">
        <strong>{t("Feedback on {label}:", { label })}</strong>{" "}
        {noteOf(pick, target)}
      </p>
    ) : (
      <p className="crew-pick-feedback">
        <strong>{t("Feedback:")}</strong> {pick.note}
      </p>
    );
  const fieldOf = (option: ReviewOption, target = "") =>
    document.getElementById(
      fieldId(option, target),
    ) as HTMLTextAreaElement | null;
  const pressFeedback = (option: ReviewOption, target = "") => {
    const field = fieldOf(option, target);
    hadFocus.current = !!field && document.activeElement === field;
  };
  // The icon opens its field and focuses it (0.37.1). The focus happens
  // inside the tap, after a synchronous render, because iOS opens the
  // keyboard only for a focus made by the gesture itself. Pressing it again
  // on the focused empty field (or from the keyboard on an open empty one)
  // closes the field.
  const toggleFeedback = (
    option: ReviewOption,
    pick: OptionPick,
    keyboard: boolean,
    target = "",
  ) => {
    if (!onChange) return;
    const focused = hadFocus.current;
    hadFocus.current = false;
    if (
      shownFor(pick, target) &&
      !noteOf(pick, target) &&
      (focused || keyboard)
    ) {
      onChange(option.key, withOpen(pick, target, false));
      return;
    }
    flushSync(() => onChange(option.key, withOpen(pick, target, true)));
    const field = fieldOf(option, target);
    if (!field) return;
    field.focus({ preventScroll: true });
    // Above the sticky footer and, on a phone, the keyboard.
    field.scrollIntoView?.({ block: "center" });
  };
  const check = (option: ReviewOption, pick: OptionPick) =>
    // Nothing recorded yet (a pending review in history): no checkboxes.
    !editable && !choices.length ? (
      <span className="crew-pick-check">
        <span className="crew-pick-label">{option.label}</span>
      </span>
    ) : (
      <label className="crew-pick-check">
        <input
          type={pickOne ? "radio" : "checkbox"}
          name={pickOne ? prefix : undefined}
          checked={pick.selected}
          disabled={!editable}
          onChange={(e) =>
            onChange?.(option.key, {
              ...pick,
              selected: e.target.checked,
              open: undefined,
            })
          }
        />
        <span className="crew-pick-label">{option.label}</span>
      </label>
    );
  /** What the option's blocks get: its label and their feedback controls. */
  const blockOption = (
    option: PresentedReview["options"][number],
    pick: OptionPick,
  ) => ({
    label: option.label,
    feedback: (target: string, name: string) => {
      const label = name ? `${option.label} · ${name}` : option.label;
      return shownFor(pick, target) ? field(option, pick, target, label) : null;
    },
  });
  const textHeading = images.length
    ? editable
      ? pickOne
        ? t("Text · pick one")
        : t("Text · pick any")
      : t("Text")
    : editable
      ? pickOne
        ? t("Options · pick one")
        : t("Options · pick any")
      : t("Options");
  const imagesHeading = editable
    ? pickOne
      ? t("Images · pick one")
      : t("Images · pick any")
    : t("Images");
  return (
    <div className="crew-review-options">
      {text.length > 0 && (
        <section aria-label={images.length ? t("Text options") : t("Options")}>
          <h3 className="crew-pick-heading">{textHeading}</h3>
          {text.map((option) => {
            const pick = pickFor(option.key);
            const single =
              option.paste.length === 1 ? option.paste[0] : undefined;
            const feedbackItems: MenuItem[] = editable
              ? [
                  {
                    label: t("Feedback on the whole option"),
                    icon: "note",
                    onSelect: () => toggleFeedback(option, pick, false),
                  },
                  ...option.paste.map((block) => ({
                    label: t("Feedback on {label}", {
                      label: blockName(block),
                    }),
                    icon: "note" as const,
                    onSelect: () =>
                      toggleFeedback(option, pick, false, block.target),
                  })),
                ]
              : [];
            return (
              <section
                key={option.key}
                className="crew-review-option crew-pick"
                data-selected={pick.selected || undefined}
                aria-label={option.label}
              >
                <div className="crew-pick-head">
                  {check(option, pick)}
                  {single ? (
                    <span className="crew-option-channel">
                      {blockName(single) && `${blockName(single)} · `}
                      <BlockCount {...blockMetrics(single, option.copy)} />
                    </span>
                  ) : !option.paste.length && (
                    <span className="crew-option-channel">
                      {t("{n} characters", { n: characterCount(option.copy).toLocaleString(locale()) })}
                    </span>
                  )}
                  {option.copy && (
                    <CopyButton
                      plainText={option.copy}
                      label={t("Copy {label}", { label: option.label })}
                    />
                  )}
                  {feedbackItems.length > 0 && (
                    <MoreMenu
                      iconButton
                      items={feedbackItems}
                      label={t("Actions for {label}", { label: option.label })}
                    />
                  )}
                </div>
                <div className="crew-pick-body">
                  <BlockOptionContext.Provider
                    value={blockOption(option, pick)}
                  >
                    <Prose>{single?.content ?? option.body}</Prose>
                    {single &&
                      shownFor(pick, single.target) &&
                      field(
                        option,
                        pick,
                        single.target,
                        `${option.label} · ${blockName(single)}`,
                      )}
                  </BlockOptionContext.Provider>
                </div>
                {shown(pick) && field(option, pick)}
              </section>
            );
          })}
        </section>
      )}
      {images.length > 0 && (
        <section aria-label={t("Image options")}>
          <h3 className="crew-pick-heading">{imagesHeading}</h3>
          <ul className="crew-pick-tiles">
            {images.map((option) => {
              const pick = pickFor(option.key);
              return (
                <li
                  key={option.key}
                  className="crew-pick-tile"
                  data-selected={pick.selected || undefined}
                  aria-label={option.label}
                >
                  <div className="crew-pick-image">
                    <Prose>{option.body}</Prose>
                  </div>
                  {(editable || pick.note) && (
                    <FeedbackButton
                      label={option.label}
                      hasNote={!!pick.note}
                      expanded={shown(pick)}
                      onPointerDown={() => pressFeedback(option)}
                      onClick={
                        editable
                          ? (keyboard) => toggleFeedback(option, pick, keyboard)
                          : undefined
                      }
                    />
                  )}
                  {check(option, pick)}
                </li>
              );
            })}
          </ul>
          {/* Feedback on images sits under the whole row of tiles, so the
              tiles never move when a field opens. */}
          {images.map((option) => {
            const pick = pickFor(option.key);
            return (
              shown(pick) && (
                <div key={option.key} className="crew-pick-tile-note">
                  {field(option, pick)}
                </div>
              )
            );
          })}
        </section>
      )}
    </div>
  );
}

const decisionLabel = (status: string) =>
  status === "approved"
    ? t("Approved")
    : status === "changes_requested"
      ? t("Changes requested")
      : status === "rejected"
        ? t("Rejected")
        : t("Decided");
/**
 * "Approved 5 min ago by you.": decided_by is the actor, the owner's
 * browser or a work client (MCP or CLI).
 */
const decidedLine = (status: string, actor: string, when: ReactNode) => {
  const decision = decisionLabel(status);
  const text = actor.startsWith("owner:")
    ? t("{decision} {when} by you.", { decision })
    : actor.startsWith("mcp:")
      ? t("{decision} {when} by an agent.", { decision })
      : t("{decision} {when} by someone.", { decision });
  return fillNodes(text, { when });
};

/** The review's own address: the server's url on a domain, else this reader's. */
const reviewUrl = (row: Row) =>
  typeof row.url === "string" && row.url
    ? row.url
    : location.origin + location.pathname + reviewHash(row.id);

export function ReviewDecision({
  row,
  task,
  busy,
  error,
  attachments,
  loaded,
  Prose,
  when,
  save,
  archiveTask,
}: {
  row: Row;
  task?: Row;
  busy: boolean;
  error: string;
  attachments: Attachment[];
  loaded: boolean;
  Prose: ProseComponent;
  when: (time: unknown) => ReactNode;
  save: (
    action: string,
    fields: Record<string, unknown>,
    row?: Row,
  ) => Promise<void>;
  /**
   * Archives the review's task, which withdraws this pending review (0.40.0):
   * for work that is no longer needed, where Reject says the draft is not good.
   */
  archiveTask?: (review: Row, task: Row) => void;
}) {
  // Uncontrolled: typing a note re-renders nothing, so the draft and its
  // images stay put.
  const note = useRef<HTMLTextAreaElement>(null);
  const [picks, setPicks] = useState<OptionPicks>({});
  const [copied, setCopied] = useState<"" | "copied" | "failed">("");
  const presentation = useMemo(() => reviewPresentation(row), [row]);
  const { options } = presentation;
  const pending = val(row, "status") === "pending";
  const selected = options.filter((o) => picks[o.key]?.selected).length;
  const pickOne = row.selection === "one";
  const chosen = options.find((o) =>
    pending
      ? picks[o.key]?.selected
      : decidedPick(optionDecisions(row), o.key).selected,
  );
  const { draft } = presentation;
  const draftBlock = draft.paste[0];
  const channel = (chosen ?? options[0] ?? draft).paste[0]?.channel;
  // Page metadata describes a standalone draft. Alternatives carry their own counts.
  const showDraftMeta = !options.length && !!draft.copy;
  const autoHelp = useHelpShown(helpIds.review);
  const helpPanel = useRef<HTMLElement>(null);
  const [showHelp, setShowHelp] = useState<boolean>();
  const setPick = (key: string, pick: OptionPick) =>
    setPicks((all) => {
      if (!pickOne || !pick.selected || all[key]?.selected)
        return { ...all, [key]: pick };
      const next = { ...all };
      for (const [other, prev] of Object.entries(next))
        next[other] = { ...prev, selected: false };
      next[key] = pick;
      return next;
    });
  // Every option is recorded: checked as approved, unchecked as rejected,
  // each with its feedback (empty stays empty). Reject rejects them all.
  const submit = (decision: string) => {
    const decisions = options.map((o) => ({
      key: o.key,
      decision:
        decision !== "rejected" && picks[o.key]?.selected
          ? "approved"
          : "rejected",
      note: picks[o.key]?.note || "",
      // Per-block feedback (0.38.0), sent only when there is some.
      ...(pickFeedback(picks[o.key]).length
        ? { feedback: pickFeedback(picks[o.key]) }
        : {}),
    }));
    void save(
      "review.decide",
      {
        decision,
        note: note.current?.value ?? "",
        ...(options.length ? { option_decisions: decisions } : {}),
      },
      row,
    );
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const archiveRef = useRef(archiveTask);
  archiveRef.current = archiveTask;
  const canArchive = !!archiveTask;
  useEffect(() => {
    if (copied !== "copied") return;
    const timer = window.setTimeout(() => setCopied(""), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  // Secondary actions live in the header's More menu (0.32.0): Add note,
  // Copy link, Open task, Archive task (0.40.0: a plain row, only while the
  // review is pending and its task is active), Share and, last and in red,
  // Reject.
  const setMenu = useDialogMenu();
  useEffect(() => {
    if (!setMenu) return;
    const url = reviewUrl(row);
    const items: MenuItem[] = [];
    if (pending)
      items.push({
        label: t("Add note"),
        icon: "note",
        onSelect: () => note.current?.focus(),
      });
    items.push({
      label: t("Copy link"),
      icon: "link",
      copy: { text: url, onResult: (ok) => setCopied(ok ? "copied" : "failed") },
    });
    if (task)
      items.push({
        label: t("Open task"),
        icon: "link",
        onSelect: () => followTrail(itemPath("task", task)),
      });
    if (pending && task && task.archived !== true && canArchive)
      items.push({
        label: t("Archive task"),
        icon: "archive",
        disabled: busy,
        onSelect: () => archiveRef.current?.(row, task),
      });
    items.push({
      label: t("How it works"),
      icon: "note",
      onSelect: () => {
        flushSync(() => setShowHelp(true));
        helpPanel.current?.focus();
        helpPanel.current?.scrollIntoView?.({ block: "center" });
      },
    });
    if (typeof navigator.share === "function")
      items.push({
        label: t("Share"),
        icon: "share",
        onSelect: () =>
          void navigator
            .share({ title: t("Review draft"), url })
            .catch(() => undefined),
      });
    if (pending)
      items.push({
        label: t("Reject"),
        icon: "reject",
        destructive: true,
        disabled: busy,
        onSelect: () => submitRef.current("rejected"),
      });
    setMenu(items);
    return () => setMenu([]);
  }, [setMenu, row, task, pending, busy, canArchive]);
  return (
    <>
      <div className="crew-dialog-body crew-review-body">
        <span className="crew-note-bucket">{t("Approvals")}</span>
        <div className="crew-review-meta">
          <span className={pending ? "crew-human" : "crew-pill"}>
            {reviewStatusText(val(row, "status"))}
          </span>
          {showDraftMeta && draftBlock?.channel && (
            <span className="crew-pill">{channelName(draftBlock.channel)}</span>
          )}
          {val(row, "recipient") && (
            <span>
              {t("To {recipient}", { recipient: val(row, "recipient") })}
            </span>
          )}
          {showDraftMeta && (
            <span>
              {draftBlock ? (
                <BlockCount {...blockMetrics(draftBlock, blockCopyText(draftBlock))} />
              ) : t("{n} characters", { n: characterCount(draft.copy).toLocaleString(locale()) })}
            </span>
          )}
        </div>
        {val(task, "title") && <ReadTitle title={val(task, "title")} />}
        {(showHelp ?? autoHelp) && (
          <aside className="crew-review-help" ref={helpPanel} tabIndex={-1}>
            <p>
              {t("Approval does not send, post or publish this.")}{" "}
              {channel === "linkedin" &&
                t("You paste the reply on LinkedIn yourself.")}
            </p>
            <HideHelp id={helpIds.review} />
          </aside>
        )}
        {copied && (
          <p
            className={copied === "copied" ? "crew-review-toast" : "crew-alert"}
            role={copied === "copied" ? "status" : "alert"}
          >
            {copied === "copied" ? (
              t("Link copied")
            ) : (
              <>
                {t("Could not copy automatically. Copy it from here:")}{" "}
                <code>{reviewUrl(row)}</code>
              </>
            )}
          </p>
        )}
        <ReviewContent
          row={row}
          attachments={attachments}
          loaded={loaded}
          presentation={presentation}
          Prose={Prose}
        >
          <ReviewChoices
            row={row}
            Prose={Prose}
            presentation={presentation}
            picks={pending ? picks : undefined}
            onChange={pending ? setPick : undefined}
          />
        </ReviewContent>
        {!pending && val(row, "decided_at") && (
          <p className="crew-review-decided">
            {decidedLine(
              val(row, "status"),
              val(row, "decided_by"),
              when(val(row, "decided_at")),
            )}
          </p>
        )}
        {!!decisionSummary(row) && (
          <p className="crew-review-decision-summary">{decisionSummary(row)}</p>
        )}
        {val(row, "decision_note") && (
          <p>
            <strong>{t("Your decision note:")}</strong>{" "}
            <PlainRefs text={val(row, "decision_note")} />
          </p>
        )}
        {!pending && error && <p className="crew-alert" role="alert">{error}</p>}
      </div>
      {pending && (
        <div className="crew-save-bar crew-review-bar">
          {error && (
            <p className="crew-alert" role="alert">
              {error}
            </p>
          )}
          <textarea
            ref={note}
            className="crew-review-note"
            aria-label={t("Decision note")}
            rows={1}
            defaultValue=""
            maxLength={20000}
            placeholder={t("Add a note…")}
          />
          <div className="crew-actions">
            <button
              className="crew-primary"
              disabled={busy || (options.length > 0 && selected === 0)}
              onClick={() => submit("approved")}
            >
              {options.length
                ? pickOne
                  ? chosen
                    ? t("Approve {label}", { label: chosen.label })
                    : t("Approve")
                  : t("Approve {n} selected", { n: selected })
                : t("Approve draft")}
            </button>
            <button
              disabled={busy}
              onClick={() => submit("changes_requested")}
            >
              {t("Request changes")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
