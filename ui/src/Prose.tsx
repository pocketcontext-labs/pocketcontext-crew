import {
  Children,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ProseImage,
  ProseLink,
  attachmentRefId,
  proseUrlTransform,
} from "./Attachments";
import {
  crewAddress,
  displayUrl,
  parseRefHref,
  referenceLabel,
  refScheme,
  remarkCrewRefs,
  useReference,
} from "./references";
import PagePreview, { isStandaloneDisplay, publicPagePath } from "./PagePreview";
import { followLink } from "./trail";
import { parseReviewMarkup, remarkCrewMarkup } from "./reviewMarkup";
import { MarkupBlocksContext, MarkupSection } from "./ReviewBlocks";
import { t } from "./i18n";

/** A long title shortened for running text; the tooltip names the record. */
const shorten = (text: string, max?: number) =>
  max && text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/**
 * A bare id: its record's title when it resolves, otherwise the plain id. An
 * id written as inline code stays code when it resolves to nothing; an id
 * beside a link to the same record (`beside`) keeps the id as its text, the
 * title in the tooltip, so the sentence does not repeat the title.
 */
export function RecordRef({
  id,
  max,
  code = false,
  beside = false,
}: {
  id: string;
  max?: number;
  code?: boolean;
  beside?: boolean;
}) {
  const ref = useReference(id);
  if (!ref) return code ? <code>{id}</code> : <>{id}</>;
  const shown = beside ? id : shorten(ref.title, max) || id;
  return (
    <a
      href={ref.path}
      className="crew-ref"
      title={
        shown === ref.title
          ? referenceLabel(ref)
          : `${ref.title} · ${referenceLabel(ref)}`
      }
      data-collection={ref.collection}
      onClick={(e) => followLink(e, ref.path)}
    >
      {beside && code ? <code>{id}</code> : shown}
    </a>
  );
}

const textOf = (children: ReactNode) => {
  const parts = Children.toArray(children);
  return parts.every((x) => typeof x === "string") ? parts.join("") : null;
};

/**
 * A link to this Crew install opens in the app. A pasted address (its text is
 * the address itself) reads as the record's title; written link text stays.
 */
export function CrewLink({
  href,
  hash,
  id,
  max,
  children,
}: {
  href: string;
  hash: string;
  id: string;
  max?: number;
  children?: ReactNode;
}) {
  const ref = useReference(id);
  const pasted = textOf(children) === href;
  return (
    <a
      href={hash}
      className="crew-ref"
      title={ref ? referenceLabel(ref) : href}
      onClick={(e) => followLink(e, hash)}
    >
      {pasted ? shorten(ref?.title || "", max) || displayUrl(href) : children}
    </a>
  );
}

/** External links open in a new tab; long pasted URLs are shortened. */
function ProseAnchor({
  href = "",
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  const ref = parseRefHref(href);
  if (ref) return <RecordRef {...ref} />;
  if (attachmentRefId(href)) return <ProseLink href={href}>{children}</ProseLink>;
  const crew = crewAddress(href);
  if (crew) return <CrewLink href={href} {...crew}>{children}</CrewLink>;
  const pasted = textOf(children) === href || textOf(children) === href.replace(/^mailto:/, "");
  if (/^mailto:/i.test(href)) return <a href={href}>{children}</a>;
  if (!/^https?:\/\//i.test(href)) return <>{children}</>;
  const shown = pasted ? displayUrl(href) : null;
  if (publicPagePath(href))
    return <PublicPageAnchor href={href}>{shown ?? children}</PublicPageAnchor>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={shown !== null && shown !== href ? href : undefined}
    >
      {shown ?? children}
    </a>
  );
}

/**
 * A link to one of this Crew's published pages (`/a/<token>`): a new tab in a
 * browser; in the home-screen app, which keeps in-scope links in its own
 * window and has no Back, the in-app preview.
 */
function PublicPageAnchor({
  href,
  children,
}: {
  href: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          if (!isStandaloneDisplay()) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open && (
        <PagePreview
          url={href}
          title={textOf(children) || t("Shared page")}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Lets the `crew-ref:` links of bare ids through, as well as attachments. */
function urlTransform(url: string, key: string) {
  if (key === "href" && url.startsWith(refScheme)) return url;
  return proseUrlTransform(url, key);
}

/**
 * Markdown components, defined once: an inline component in `components`
 * would be a new type on every render, so React would remount each image
 * (blank, then loaded again) whenever the page re-rendered, for example on
 * every keystroke in a field beside the draft.
 */
const proseRemarkPlugins = [remarkGfm, remarkCrewRefs];
const proseComponents: ComponentProps<typeof ReactMarkdown>["components"] = {
  // Same-item attachments only; external images never load.
  img: ({ src, alt }) => <ProseImage src={src} alt={alt} />,
  a: ({ children, href }) => <ProseAnchor href={href}>{children}</ProseAnchor>,
  // Review markup blocks (0.38.0) arrive as sections marked by the plugin;
  // any other section (GFM footnotes) stays one. No attribute of the markup
  // reaches the DOM.
  section: ({ node: _node, children, ...props }) => {
    const index = (props as Record<string, unknown>)["data-crew-block"];
    return typeof index === "string" ? (
      <MarkupSection index={Number(index)}>{children}</MarkupSection>
    ) : (
      <section {...props}>{children}</section>
    );
  },
};
export default function Prose({ children }: { children: string }) {
  // Review markup (0.38.0): a body without valid blocks renders exactly as
  // before, without the directive syntax at all.
  const blocks = useMemo(() => parseReviewMarkup(children).blocks, [children]);
  const plugins = useMemo(
    () =>
      blocks.length
        ? [remarkGfm, [remarkCrewMarkup, { blocks }] as const, remarkCrewRefs]
        : proseRemarkPlugins,
    [blocks],
  );
  return (
    <div className="crew-prose">
      <MarkupBlocksContext.Provider value={blocks}>
        <ReactMarkdown
          remarkPlugins={plugins as typeof proseRemarkPlugins}
          urlTransform={urlTransform}
          components={proseComponents}
        >
          {children}
        </ReactMarkdown>
      </MarkupBlocksContext.Provider>
    </div>
  );
}
