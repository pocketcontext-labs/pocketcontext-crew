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

/** Keep the clipboard writer in the tap and convert Markdown into paste-ready text. */
export function CopyButton({ text = "", plainText, label, className }: {
  text?: string;
  plainText?: string;
  label: string;
  className?: string;
}) {
  return (
    <CopyControl
      copy={() => copyText(plainText ?? markdownPlainText(text))}
      label={label}
      className={className}
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
export function BlockCount({ count, limit }: { count: number; limit: number | null }) {
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
          plainText={copy}
          label={full ? t("Copy {label}", { label: full }) : t("Copy")}
        />
      </div>
      <div className="crew-block-body">{children}</div>
      {feedback}
    </div>
  );
}

/** Legacy named copy blocks also carry channels in labels such as "Text A LinkedIn". */
export function blockMetrics(block: MarkupBlock, copy: string) {
  const channel = block.channel
    ?? /^(?:Text [A-Z] )?(LinkedIn|X)$/i.exec(block.label?.trim() ?? "")?.[1].toLowerCase();
  return {
    count: characterCount(copy, channel),
    limit: block.limit ?? (channel ? defaultLimits[channel] : undefined) ?? null,
  };
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
  const { count, limit } = blockMetrics(block, copy);
  return (
    <BlockCard
      name={blockName(block)}
      target={block.target}
      copy={copy}
      count={count}
      limit={limit}
      kind={block.kind}
    >
      {children}
    </BlockCard>
  );
}
