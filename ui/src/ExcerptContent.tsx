import { blockName } from "./ReviewBlocks";
import { PlainTitles } from "./PlainRefs";
import type { markdownExcerpt } from "./markdownText";

export function ExcerptContent({ excerpt, resolveTitles }: {
  excerpt: ReturnType<typeof markdownExcerpt>;
  resolveTitles?: boolean;
}) {
  return (
    <>
      {excerpt.blocks.length > 0 && (
        <span className="crew-tags crew-excerpt-labels">
          {excerpt.blocks.map((block) => <span className="crew-chip" key={block.target}>{blockName(block)}</span>)}
        </span>
      )}
      {resolveTitles ? <PlainTitles text={excerpt.text} /> : excerpt.text}
    </>
  );
}
