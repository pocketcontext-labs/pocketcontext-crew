/** Review markup shared by reviews, task drafts, notes and comments. */
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import { CopyControl } from "./CopyFeedback";
import { copyText } from "./projectAgents";
import { markdownPlainText } from "./markdownText";
import {
  blockCopyText,
  characterCount,
  defaultLimits,
  type MarkupBlock,
} from "./reviewMarkup";
import { locale, t } from "./i18n";
import "./blocks.css";

/**
 * Copy (0.37.1): copies Markdown as plain text that pastes cleanly into a
 * chat app, inside the tap (phones refuse a clipboard write after an await).
 * The label confirms success or failure; every
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
  return (
    <CopyControl
      copy={() => copyText(plainText ?? markdownPlainText(text))}
      label={t("Copy")}
      successLabel={t("Copied")}
      failureLabel={short ? undefined : t("Not copied")}
      accessibleLabel={label}
      className={`crew-copy-button ${iconOnly ? "crew-icon-button" : ""} ${className}`.trim()}
      iconOnly={iconOnly}
      announce
    />
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

/** The blocks Prose found in the body it renders. */
export const MarkupBlocksContext = createContext<MarkupBlock[]>([]);
/** Inside a review (draft or option): notes say who they are for. */
export const ReviewMarkupContext = createContext(false);

/** What a review option gives its blocks: its label and feedback controls. */
export type BlockOption = {
  label: string;
  /** The block’s editable or recorded feedback, if present. */
  feedback: (target: string, name: string) => ReactNode;
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
  const inReview = useContext(ReviewMarkupContext);
  const full = option ? (name ? `${option.label} · ${name}` : option.label) : name;
  const feedback = option?.feedback(target, name);
  return (
    <div className="crew-block" data-kind={kind || "body"} data-target={target || undefined}>
      <div className="crew-block-head">
        <span className="crew-block-title">
          {name && <span className="crew-block-name">{name}</span>}
          {count !== undefined && <BlockCount count={count} limit={limit} />}
        </span>
        <CopyButton
          className="crew-block-copy"
          iconOnly={inReview}
          short
          plainText={copy}
          label={full ? t("Copy {label}", { label: full }) : t("Copy")}
        />
      </div>
      <div className="crew-block-body">{children}</div>
      {feedback}
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
  // Task descriptions can hold several options as named copy blocks, e.g.
  // "Text A LinkedIn" and "Text B LinkedIn". Use their channel for the
  // displayed count while preserving the author's label and feedback target.
  const channel = block.channel
    ?? /^(?:Text [A-Z] )?(LinkedIn|X)$/i.exec(block.label?.trim() ?? "")?.[1].toLowerCase();
  return (
    <BlockCard
      name={blockName(block)}
      target={block.target}
      copy={copy}
      count={characterCount(copy, channel)}
      limit={block.limit ?? (channel ? defaultLimits[channel] : null)}
      kind={block.kind}
    >
      {children}
    </BlockCard>
  );
}
