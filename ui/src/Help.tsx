import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { ConnectionState } from "./crewApi";
import {
  guideHash,
  helpContent,
  textFor,
  type HelpMode,
  type HelpTopic,
} from "./helpContent";

export const HelpModeContext = createContext<HelpMode>("other");
export const helpMode = (connection: ConnectionState): HelpMode =>
  connection.kind === "mcp" || connection.kind === "local"
    ? connection.kind
    : "other";

/** Lets a dialog tell a click that only dismisses help from a real backdrop click. */
export const helpIsOpenIn = (element: Element | null) =>
  !!element?.querySelector(".crew-help-popover");

const edge = 8;
const gap = 6;

/** A "?" that opens a short explanation on click or tap. */
export default function Help({ topic }: { topic: HelpTopic }) {
  const mode = useContext(HelpModeContext);
  const entry = helpContent[topic];
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    // Fixed so a scrolling dialog cannot clip it; kept on screen at any width.
    const place = () => {
      const anchor = button.current?.getBoundingClientRect();
      const box = popover.current?.getBoundingClientRect();
      if (!anchor || !box || !popover.current) return;
      const left = Math.max(
        edge,
        Math.min(
          anchor.left + anchor.width / 2 - box.width / 2,
          window.innerWidth - box.width - edge,
        ),
      );
      const below = anchor.bottom + gap;
      const top =
        below + box.height > window.innerHeight - edge
          ? Math.max(edge, anchor.top - box.height - gap)
          : below;
      popover.current.style.left = `${left}px`;
      popover.current.style.top = `${top}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    // Captured and cancelled so Escape closes only this, not a surrounding dialog.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  // Leaving the page would close a dialog and lose its edits.
  const inDialog = open && !!root.current?.closest("dialog");
  return (
    <div className="crew-help" ref={root}>
      <button
        ref={button}
        type="button"
        className="crew-help-button"
        aria-label={entry.question}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <div
          id={id}
          ref={popover}
          className="crew-help-popover"
          role="group"
          aria-label={entry.name}
        >
          <div>{textFor(entry.what, mode)}</div>
          <div>{textFor(entry.action, mode)}</div>
          <a
            href={guideHash(topic)}
            onClick={() => setOpen(false)}
            {...(inDialog
              ? {
                  target: "_blank",
                  rel: "noopener",
                  "aria-label": "Learn more (opens in a new tab)",
                }
              : {})}
          >
            Learn more
          </a>
        </div>
      )}
    </div>
  );
}

/**
 * A form field with help beside its label. The button sits outside the label so
 * it never becomes part of the control's accessible name.
 */
export function HelpField({
  label,
  topic,
  children,
}: {
  label: string;
  topic: HelpTopic;
  children: ReactElement<{ id?: string }>;
}) {
  const id = useId();
  return (
    <div className="crew-field">
      <div className="crew-field-head">
        <label htmlFor={id}>{label}</label>
        <Help topic={topic} />
      </div>
      {cloneElement(children, { id })}
    </div>
  );
}
