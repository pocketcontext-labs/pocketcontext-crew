import { Fragment, type ReactNode } from "react";
import { CrewLink, RecordRef } from "./Prose";
import { crewAddress, displayUrl, findIds, useReference } from "./references";

// A web address in running text, without the punctuation that ends a sentence.
const urlPattern = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const trimUrl = (url: string) => {
  let out = url.replace(/[.,;:!?]+$/, "");
  // A closing bracket belongs to the address only when it opened one.
  while (/[)\]]$/.test(out)) {
    const close = out.endsWith(")") ? ")" : "]";
    const open = close === ")" ? "(" : "[";
    if (out.split(open).length >= out.split(close).length) break;
    out = out.slice(0, -1).replace(/[.,;:!?]+$/, "");
  }
  return out;
};

export type PlainPart =
  | { kind: "text"; text: string }
  | { kind: "id"; id: string }
  | { kind: "url"; url: string };

/** Splits plain text into text, bare record ids and web addresses. */
export function plainParts(text: string): PlainPart[] {
  const parts: PlainPart[] = [];
  const pushText = (chunk: string) => {
    let at = 0;
    for (const { id, index } of findIds(chunk)) {
      if (index > at)
        parts.push({ kind: "text", text: chunk.slice(at, index) });
      parts.push({ kind: "id", id });
      at = index + id.length;
    }
    if (at < chunk.length) parts.push({ kind: "text", text: chunk.slice(at) });
  };
  let at = 0;
  for (const match of text.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    const url = trimUrl(match[0]);
    if (!url) continue;
    if (index > at) pushText(text.slice(at, index));
    parts.push({ kind: "url", url });
    at = index + url.length;
  }
  if (at < text.length) pushText(text.slice(at));
  return parts;
}

/**
 * Plain (non-Markdown) text with its references linked (0.33.0), like ids in
 * rendered Markdown: a bare record id reads as the record's title and a Crew
 * address as the title it names, both opening as the next step of the link
 * trail; other http(s) addresses open in a new tab. Ids that resolve to
 * nothing stay plain. The stored text never changes. `max` shortens long
 * titles in running text.
 */
export default function PlainRefs({
  text,
  max,
}: {
  text: string;
  max?: number;
}): ReactNode {
  return plainParts(text).map((part, i) => {
    if (part.kind === "text") return <Fragment key={i}>{part.text}</Fragment>;
    if (part.kind === "id") return <RecordRef key={i} id={part.id} max={max} />;
    const crew = crewAddress(part.url);
    if (crew)
      return (
        <CrewLink key={i} href={part.url} max={max} {...crew}>
          {part.url}
        </CrewLink>
      );
    const shown = displayUrl(part.url);
    return (
      <a
        key={i}
        href={part.url}
        target="_blank"
        rel="noopener noreferrer"
        title={shown !== part.url ? part.url : undefined}
      >
        {shown}
      </a>
    );
  });
}

function RefTitle({ id }: { id: string }) {
  const ref = useReference(id);
  return <>{ref?.title || id}</>;
}

/**
 * Plain text for places that are one tap target (a list row is a button, so
 * it cannot hold links): bare record ids read as the record's title, as text.
 */
export function PlainTitles({ text }: { text: string }): ReactNode {
  return plainParts(text).map((part, i) =>
    part.kind === "id" ? (
      <RefTitle key={i} id={part.id} />
    ) : (
      <Fragment key={i}>{part.kind === "text" ? part.text : part.url}</Fragment>
    ),
  );
}
