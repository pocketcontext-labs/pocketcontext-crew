import {
  Fragment,
  useEffect,
  useId,
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
  ProseImage,
  ProseLink,
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
  reviewOptions,
  type OptionDecision,
  type ReviewOption,
} from "./reviews";
import { Icon, useDialogMenu, type MenuItem } from "./DialogHeader";
import { reviewHash } from "./itemLink";
import { copyText } from "./projectAgents";
import { markdownPlainText } from "./markdownText";
import "./review.css";
import AutoTextarea, { AutoTextField } from "./AutoTextarea";
import PlainRefs from "./PlainRefs";
import { t } from "./i18n";

/** Fills a translated sentence's {name} slots with elements. */
function fillNodes(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/).map((part, i) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in nodes ? <Fragment key={i}>{nodes[name]}</Fragment> : part;
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

/**
 * Copy (0.37.1): copies Markdown as plain text that pastes cleanly into a
 * chat app, inside the tap (phones refuse a clipboard write after an await).
 * The label turns to "Copied" for 2 s, or "Not copied" on failure; every
 * label sits in the same grid cell, so the button never changes width.
 */
export function CopyButton({
  text,
  label,
  className = "",
  iconOnly = false,
}: {
  /** An icon button (option cards): a check when copied, a cross on failure. */
  iconOnly?: boolean;
  /** The Markdown to copy. */
  text: string;
  /** The accessible name, such as "Copy Draft A". */
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  useEffect(() => {
    if (!state) return;
    const timer = window.setTimeout(() => setState(""), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);
  const labels = { "": t("Copy"), copied: t("Copied"), failed: t("Not copied") };
  return (
    <>
      <button
        type="button"
        className={`crew-copy-button ${className}`.trim()}
        data-state={state || undefined}
        aria-label={label}
        title={label}
        onClick={() =>
          void copyText(markdownPlainText(text)).then((ok) =>
            setState(ok ? "copied" : "failed"),
          )
        }
      >
        <Icon
          name={state === "copied" ? "check" : state === "failed" ? "close" : "copy"}
        />
        {!iconOnly && (
          <span className="crew-copy-labels" aria-hidden="true">
            {(["", "copied", "failed"] as const).map((key) => (
              <span key={key} data-shown={key === state || undefined}>
                {labels[key]}
              </span>
            ))}
          </span>
        )}
      </button>
      <span className="crew-visually-hidden" aria-live="polite">
        {state ? labels[state] : ""}
      </span>
    </>
  );
}

type ProseComponent = ComponentType<{ children: string }>;
export function ReviewContent({
  row,
  attachments,
  loaded = true,
  Prose,
  children,
}: {
  row: Row;
  attachments: Attachment[];
  loaded?: boolean;
  Prose: ProseComponent;
  children?: React.ReactNode;
}) {
  const files = reviewFiles(row, attachments);
  const missing = missingReviewEvidence(row, files, loaded);
  return (
    <AttachmentsProvider attachments={files} stepThroughAll>
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
        <div className="crew-draft-snapshot">
          {/* Floats at the top right, so the text wraps around it. */}
          <CopyButton
            className="crew-draft-copy"
            text={val(row, "draft")}
            label={t("Copy draft text")}
          />
          <Prose>{val(row, "draft")}</Prose>
        </div>
        {children}
        {files.length > 0 && (
          <section aria-label={t("Files submitted for review")}>
            <h3>{t("Files submitted for review")}</h3>
            <ReviewFileTiles files={files} />
          </section>
        )}
      </div>
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

/** One option's state while deciding: checked, its feedback, field open. */
export type OptionPick = { selected: boolean; note: string; open?: boolean };
export type OptionPicks = Record<string, OptionPick>;

const pickOf = (picks: OptionPicks | undefined, key: string): OptionPick =>
  picks?.[key] ?? { selected: false, note: "" };

/** A decided option, as the read-only dialog shows it. */
const decidedPick = (choices: OptionDecision[], key: string): OptionPick => {
  const choice = choices.find((x) => x.key === key);
  return { selected: choice?.decision === "approved", note: choice?.note || "" };
};

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
    <button
      type="button"
      className="crew-pick-comment"
      data-note={hasNote || undefined}
      aria-label={t("Feedback on {label}", { label })}
      aria-expanded={onClick ? expanded : undefined}
      title={t("Feedback on {label}", { label })}
      disabled={!onClick}
      onPointerDown={onPointerDown}
      onClick={onClick && ((e) => onClick(e.detail === 0))}
    >
      <Icon name="note" />
    </button>
  );
}

/**
 * The options of a review (0.32.0, as in the approved mockup): pick any
 * number with checkboxes, and give each option its own feedback in a
 * one-line field under it. Selecting an option or tapping its feedback icon
 * (also on an unselected option) opens the field. Options whose body is one
 * image are tiles, with a badge when they have feedback. Read-only (decided
 * reviews and history) shows the recorded selection and feedback.
 */
export function ReviewChoices({
  row,
  Prose,
  picks,
  onChange,
}: {
  row: Row;
  Prose: ProseComponent;
  picks?: OptionPicks;
  onChange?: (key: string, pick: OptionPick) => void;
}) {
  const options = reviewOptions(row);
  const choices = optionDecisions(row);
  const prefix = useId();
  // Whether the option's field had focus when its feedback icon was pressed
  // (the press itself moves focus away).
  const hadFocus = useRef(false);
  if (!options.length) return null;
  const editable = !!onChange;
  const pickFor = (key: string) =>
    editable ? pickOf(picks, key) : decidedPick(choices, key);
  const shown = (pick: OptionPick) =>
    editable ? (pick.open ?? (pick.selected || !!pick.note)) : !!pick.note;
  const text = options.filter((o) => !isImageOption(o));
  const images = options.filter(isImageOption);
  const field = (option: ReviewOption, pick: OptionPick) =>
    editable ? (
      <AutoTextarea
        id={`${prefix}-${option.key}`}
        className="crew-pick-note"
        aria-label={t("Feedback on {label}", { label: option.label })}
        placeholder={t("Feedback on {label}…", { label: option.label })}
        maxLength={20000}
        value={pick.note}
        onValue={(note) => onChange(option.key, { ...pick, note })}
      />
    ) : (
      <p className="crew-pick-feedback">
        <strong>{t("Feedback:")}</strong> {pick.note}
      </p>
    );
  const fieldOf = (option: ReviewOption) =>
    document.getElementById(`${prefix}-${option.key}`) as HTMLTextAreaElement | null;
  const pressFeedback = (option: ReviewOption) => {
    const field = fieldOf(option);
    hadFocus.current = !!field && document.activeElement === field;
  };
  // The icon opens the option's field and focuses it (0.37.1). The focus
  // happens inside the tap, after a synchronous render, because iOS opens
  // the keyboard only for a focus made by the gesture itself. Pressing it
  // again on the focused empty field (or from the keyboard on an open empty
  // one) closes the field.
  const toggleFeedback = (
    option: ReviewOption,
    pick: OptionPick,
    keyboard: boolean,
  ) => {
    if (!onChange) return;
    const focused = hadFocus.current;
    hadFocus.current = false;
    if (shown(pick) && !pick.note && (focused || keyboard)) {
      onChange(option.key, { ...pick, open: false });
      return;
    }
    flushSync(() => onChange(option.key, { ...pick, open: true }));
    const field = fieldOf(option);
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
        type="checkbox"
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
  const textHeading = images.length
    ? editable
      ? t("Text · pick any")
      : t("Text")
    : editable
      ? t("Options · pick any")
      : t("Options");
  const imagesHeading = editable ? t("Images · pick any") : t("Images");
  return (
    <div className="crew-review-options">
      {text.length > 0 && (
        <section aria-label={images.length ? t("Text options") : t("Options")}>
          <h3 className="crew-pick-heading">{textHeading}</h3>
          {text.map((option) => {
            const pick = pickFor(option.key);
            return (
              <section
                key={option.key}
                className="crew-review-option crew-pick"
                data-selected={pick.selected || undefined}
                aria-label={option.label}
              >
                <div className="crew-pick-head">
                  {check(option, pick)}
                  <CopyButton
                    className="crew-pick-copy"
                    iconOnly
                    text={option.body}
                    label={t("Copy {label}", { label: option.label })}
                  />
                  {editable && (
                    <FeedbackButton
                      label={option.label}
                      hasNote={!!pick.note}
                      expanded={shown(pick)}
                      onPointerDown={() => pressFeedback(option)}
                      onClick={(keyboard) =>
                        toggleFeedback(option, pick, keyboard)
                      }
                    />
                  )}
                </div>
                <div className="crew-pick-body">
                  <Prose>{option.body}</Prose>
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
  busy,
  error,
  attachments,
  loaded,
  Prose,
  when,
  save,
}: {
  row: Row;
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
}) {
  // Uncontrolled: typing a note re-renders nothing, so the draft and its
  // images stay put.
  const note = useRef<HTMLTextAreaElement>(null);
  const [picks, setPicks] = useState<OptionPicks>({});
  // What the More menu copied last: the link or the draft text.
  const [copied, setCopied] = useState<
    "" | "copied" | "failed" | "text" | "text-failed"
  >("");
  const options = reviewOptions(row),
    pending = val(row, "status") === "pending";
  const selected = options.filter((o) => picks[o.key]?.selected).length;
  const setPick = (key: string, pick: OptionPick) =>
    setPicks((all) => ({ ...all, [key]: pick }));
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
  useEffect(() => {
    if (copied !== "copied" && copied !== "text") return;
    const timer = window.setTimeout(() => setCopied(""), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  // Secondary actions live in the header's More menu (0.32.0): Add note,
  // Copy link, Share and, last and in red, Reject.
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
      onSelect: () =>
        void copyText(url).then((ok) => setCopied(ok ? "copied" : "failed")),
    });
    items.push({
      label: t("Copy text"),
      icon: "copy",
      onSelect: () =>
        void copyText(markdownPlainText(val(row, "draft"))).then((ok) =>
          setCopied(ok ? "text" : "text-failed"),
        ),
    });
    if (typeof navigator.share === "function")
      items.push({
        label: t("Share"),
        icon: "share",
        onSelect: () =>
          void navigator.share({ title: t("Review draft"), url }).catch(() => undefined),
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
  }, [setMenu, row, pending, busy]);
  return (
    <div className="crew-dialog-body crew-review-body">
      <div className="crew-review-meta">
        <span className={pending ? "crew-human" : "crew-pill"}>
          {reviewStatusText(val(row, "status"))}
        </span>
        <span>
          {t("Snapshot {id}", { id: row.id })} · {when(row.created)}
        </span>
      </div>
      <p>
        {t(
          "This is the exact submitted draft. Approval does not send, post or publish it.",
        )}
      </p>
      {copied && (
        <p
          className={
            copied === "copied" || copied === "text"
              ? "crew-review-toast"
              : "crew-alert"
          }
          role={copied === "copied" || copied === "text" ? "status" : "alert"}
        >
          {copied === "copied" ? (
            t("Link copied")
          ) : copied === "text" ? (
            t("Text copied")
          ) : copied === "text-failed" ? (
            t("Couldn't copy the text.")
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
        Prose={Prose}
      >
        <ReviewChoices
          row={row}
          Prose={Prose}
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
      {pending && (
        <>
          <p className="crew-footnote">
            {options.length > 0 &&
              t("Check every option you approve and add feedback on any option.") +
                " "}
            {t(
              "After approval, perform the external action yourself and mark the task Done. Reject is in the More menu.",
            )}
          </p>
          {/* Pinned to the bottom (0.31.0) and compact (0.32.0): a one-line
              note that grows upward on focus, then the two primary actions,
              which never move. */}
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
                  ? t("Approve {n} selected", { n: selected })
                  : t("Approve draft")}
              </button>
              <button disabled={busy} onClick={() => submit("changes_requested")}>
                {t("Request changes")}
              </button>
            </div>
          </div>
        </>
      )}
      {!pending && error && (
        <p className="crew-alert" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReviewRequest({
  busy,
  submit,
  help,
}: {
  busy: boolean;
  submit: (options: ReviewOption[]) => void;
  /** The standard "?" shown right after the button. */
  help?: ReactNode;
}) {
  const [options, setOptions] = useState<ReviewOption[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const valid = options.every((o) => o.label.trim() && o.body.trim());
  return (
    <div className="crew-review-request">
      <div className="crew-review-actions">
        <button
          type="button"
          className="crew-review-submit"
          disabled={busy || !valid}
          onClick={() => submit(options)}
        >
          {t("Request approval")}
        </button>
        {help}
      </div>
      <details>
        <summary>{t("Review alternatives (optional)")}</summary>
        <p>
          {t(
            "Give each draft or platform its own option so the reviewer can choose exactly what to approve. Options are saved when you send the review.",
          )}
        </p>
        {options.map((option, index) => (
          <fieldset key={option.key} className="crew-review-option">
            <legend>{t("Option {n}", { n: index + 1 })}</legend>
            <AutoTextField
              className="crew-option-note"
              label={t("Option {n} label", { n: index + 1 })}
              maxLength={200}
              value={option.label}
              onValue={(label) =>
                setOptions(
                  options.map((o) =>
                    o.key === option.key ? { ...o, label } : o,
                  ),
                )
              }
            />
            <label className="crew-option-note">
              {t("Option {n} draft", { n: index + 1 })}
              <textarea
                maxLength={100000}
                value={option.body}
                onChange={(e) =>
                  setOptions(
                    options.map((o) =>
                      o.key === option.key ? { ...o, body: e.target.value } : o,
                    ),
                  )
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                setOptions(options.filter((o) => o.key !== option.key))
              }
            >
              {t("Remove option {n}", { n: index + 1 })}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={options.length >= 20}
          onClick={() => {
            setOptions([
              ...options,
              { key: `option-${nextKey}`, label: "", body: "" },
            ]);
            setNextKey(nextKey + 1);
          }}
        >
          {t("Add review option")}
        </button>
      </details>
    </div>
  );
}

/** Request approval while it can't be sent yet: disabled, with why. */
export function ReviewRequestBlocked({
  hint,
  help,
}: {
  hint: string;
  help?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="crew-review-request">
      <div className="crew-review-actions">
        <button type="button" className="crew-review-submit" disabled aria-describedby={id}>
          {t("Request approval")}
        </button>
        {help}
        <span id={id} className="crew-review-hint">
          {hint}
        </span>
      </div>
    </div>
  );
}
