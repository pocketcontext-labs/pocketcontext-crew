/**
 * Review markup blocks as the reader shows them (Crew 0.38.0): each
 * `:::variant` and `:::copy` is a bordered sub-card whose header holds its
 * name, its character count, Copy and (in a review option) the feedback
 * button, fixed at the right edge; `:::note` is grey secondary text. The same
 * blocks render in notes, comments and task drafts with Copy and count only.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./DialogHeader";
import { copyText } from "./projectAgents";
import { markdownPlainText } from "./markdownText";
import {
  blockCopyText,
  characterCount,
  copyBlocks,
  parseReviewMarkup,
  type MarkupBlock,
} from "./reviewMarkup";
import { locale, t } from "./i18n";
import "./blocks.css";

/**
 * Copy (0.37.1): copies Markdown as plain text that pastes cleanly into a
 * chat app, inside the tap (phones refuse a clipboard write after an await).
 * The label turns to "Copied" for 2 s, or "Not copied" on failure; every
 * label sits in the same grid cell, so the button never changes width.
 */
export function CopyButton({
  text = "",
  plainText,
  label,
  className = "",
  iconOnly = false,
  short = false,
}: {
  /**
   * Blocks: the button is only as wide as "Copy"/"Copied"; a failure shows
   * a cross with "Copy" (and is announced), so the header keeps its room.
   */
  short?: boolean;
  /** An icon button (option cards): a check when copied, a cross on failure. */
  iconOnly?: boolean;
  /** The Markdown to copy. */
  text?: string;
  /** Plain text to copy as it is, instead of `text`. */
  plainText?: string;
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
        className={`crew-copy-button ${iconOnly ? "crew-icon-button" : ""} ${className}`
          .replace(/\s+/g, " ")
          .trim()}
        data-state={state || undefined}
        aria-label={label}
        title={label}
        onClick={() =>
          void copyText(plainText ?? markdownPlainText(text)).then((ok) =>
            setState(ok ? "copied" : "failed"),
          )
        }
      >
        <Icon
          name={state === "copied" ? "check" : state === "failed" ? "close" : "copy"}
        />
        {!iconOnly && (
          <span className="crew-copy-labels" aria-hidden="true">
            {(short ? (["", "copied"] as const) : (["", "copied", "failed"] as const)).map((key) => (
              <span
                key={key}
                data-shown={key === (short && state === "failed" ? "" : state) || undefined}
              >
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

/** A channel as people name it. */
export function channelName(channel: string): string {
  switch (channel) {
    case "linkedin":
      return "LinkedIn";
    case "x":
      return "X";
    case "email":
      return t("Email");
    case "whatsapp":
      return "WhatsApp";
    case "slack":
      return "Slack";
    default:
      return t("Text");
  }
}

/** A variant's channel name or a copy block's label. */
export const blockName = (block: MarkupBlock) =>
  block.kind === "copy" ? block.label || "" : channelName(block.channel || "");

/**
 * Copy all variants: each variant and copy block preceded by its name on its
 * own line, a blank line between blocks, notes left out. A body without
 * blocks copies as a whole.
 */
export function copyAllText(body: string): string {
  const blocks = copyBlocks(parseReviewMarkup(body));
  if (!blocks.length) return markdownPlainText(body);
  return blocks.map((b) => `${blockName(b)}\n${blockCopyText(b)}`).join("\n\n");
}

/** The blocks Prose found in the body it renders. */
export const MarkupBlocksContext = createContext<MarkupBlock[]>([]);
/** Inside a review (draft or option): notes say who they are for. */
export const ReviewMarkupContext = createContext(false);

/** What a review option gives its blocks: its label and feedback controls. */
export type BlockOption = {
  label: string;
  /** The block's feedback button and its field (or recorded feedback). */
  feedback?: (target: string, name: string) => { button: ReactNode; field: ReactNode };
};
export const BlockOptionContext = createContext<BlockOption | null>(null);

/** "612 / 3,000", in the danger colour with "too long" past the limit. */
function BlockCount({ count, limit }: { count: number; limit: number | null }) {
  const format = new Intl.NumberFormat(locale());
  const over = limit !== null && count > limit;
  return (
    <span className="crew-block-count" data-over={over || undefined}>
      {format.format(count)}
      {limit !== null && ` / ${format.format(limit)}`}
      {over && <span className="crew-block-too-long"> · {t("too long")}</span>}
    </span>
  );
}

/**
 * One block: name and count on the left, Copy and feedback fixed at the
 * right edge, the text below and its feedback field under it. An unnamed
 * block is a whole option body without markup.
 */
export function BlockCard({
  name,
  target,
  copy,
  count,
  limit = null,
  kind,
  children,
}: {
  name: string;
  /** The feedback target: a channel, copy-<n>, or "" for the whole option. */
  target: string;
  copy: string;
  count?: number;
  limit?: number | null;
  kind?: string;
  children: ReactNode;
}) {
  const option = useContext(BlockOptionContext);
  const full = option ? (name ? `${option.label} · ${name}` : option.label) : name;
  const controls = option?.feedback?.(target, name);
  return (
    <div className="crew-block" data-kind={kind || "body"} data-target={target || undefined}>
      <div className="crew-block-head">
        <span className="crew-block-title">
          {name && <span className="crew-block-name">{name}</span>}
          {count !== undefined && <BlockCount count={count} limit={limit} />}
        </span>
        <CopyButton
          className="crew-block-copy"
          short
          plainText={copy}
          label={full ? t("Copy {label}", { label: full }) : t("Copy")}
        />
        {controls?.button}
      </div>
      <div className="crew-block-body">{children}</div>
      {controls?.field}
    </div>
  );
}

/** A `:::` block Prose found, by its index in the body's blocks. */
export function MarkupSection({ index, children }: { index: number; children: ReactNode }) {
  const blocks = useContext(MarkupBlocksContext);
  const review = useContext(ReviewMarkupContext);
  const block = blocks[index];
  if (!block) return <div>{children}</div>;
  if (block.kind === "note")
    return (
      <aside className="crew-block-note">
        {review && <p className="crew-block-note-label">{t("Note for the reviewer")}</p>}
        {children}
      </aside>
    );
  const copy = blockCopyText(block);
  return (
    <BlockCard
      name={blockName(block)}
      target={block.target}
      copy={copy}
      count={characterCount(copy, block.channel)}
      limit={block.limit}
      kind={block.kind}
    >
      {children}
    </BlockCard>
  );
}
