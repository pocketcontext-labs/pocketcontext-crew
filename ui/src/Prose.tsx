import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ProseImage, ProseLink, proseUrlTransform } from "./Attachments";

/**
 * Markdown components, defined once: an inline component in `components`
 * would be a new type on every render, so React would remount each image
 * (blank, then loaded again) whenever the page re-rendered, for example on
 * every keystroke in a field beside the draft.
 */
const proseRemarkPlugins = [remarkGfm];
const proseComponents: ComponentProps<typeof ReactMarkdown>["components"] = {
  // Same-item attachments only; external images never load.
  img: ({ src, alt }) => <ProseImage src={src} alt={alt} />,
  a: ({ children, href }) => <ProseLink href={href}>{children}</ProseLink>,
};
export default function Prose({ children }: { children: string }) {
  return (
    <div className="crew-prose">
      <ReactMarkdown
        remarkPlugins={proseRemarkPlugins}
        urlTransform={proseUrlTransform}
        components={proseComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
