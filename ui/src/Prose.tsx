import {
  Children,
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
  referenceLabel,
  refScheme,
  remarkCrewRefs,
  useReference,
} from "./references";
import { followLink } from "./trail";

/** A bare id: its record's title when it resolves, otherwise the plain id. */
function RecordRef({ id }: { id: string }) {
  const ref = useReference(id);
  if (!ref) return <>{id}</>;
  return (
    <a
      href={ref.path}
      className="crew-ref"
      title={referenceLabel(ref)}
      data-collection={ref.collection}
      onClick={(e) => followLink(e, ref.path)}
    >
      {ref.title || id}
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
function CrewLink({
  href,
  hash,
  id,
  children,
}: {
  href: string;
  hash: string;
  id: string;
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
      {pasted ? ref?.title || displayUrl(href) : children}
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
  if (href.startsWith(refScheme)) return <RecordRef id={href.slice(refScheme.length)} />;
  if (attachmentRefId(href)) return <ProseLink href={href}>{children}</ProseLink>;
  const crew = crewAddress(href);
  if (crew) return <CrewLink href={href} {...crew}>{children}</CrewLink>;
  const pasted = textOf(children) === href || textOf(children) === href.replace(/^mailto:/, "");
  if (/^mailto:/i.test(href)) return <a href={href}>{children}</a>;
  if (!/^https?:\/\//i.test(href)) return <>{children}</>;
  const shown = pasted ? displayUrl(href) : null;
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
};
export default function Prose({ children }: { children: string }) {
  return (
    <div className="crew-prose">
      <ReactMarkdown
        remarkPlugins={proseRemarkPlugins}
        urlTransform={urlTransform}
        components={proseComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
