import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { fileInputHandlers } from "./Attachments";
import Prose from "./Prose";
import { t } from "./i18n";

/**
 * Grows with its content, so a long note scrolls with the dialog, not inside it.
 * The agent brief is capped (CSS max-height) and past that scrolls itself.
 */
function GrowingTextarea({ value, ...props }: ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = el.closest("dialog");
    const top = scroller?.scrollTop;
    const own = el.scrollTop;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight + 2}px`;
    // Past the cap the field scrolls itself; keep its place while typing.
    el.scrollTop = own;
    if (scroller && top !== undefined) scroller.scrollTop = top;
  }, []);
  useLayoutEffect(measure, [measure, value, props.hidden]);
  // A textarea in a dialog not yet shown, or hidden, measures zero; children's
  // layout effects run before the dialog's showModal(). Measure again when it
  // gets a width, and when the width changes and the text rewraps.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = 0;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  return (
    <textarea
      ref={ref}
      value={value}
      {...props}
      className={`crew-grow ${props.className || ""}`}
    />
  );
}
export default function MarkdownField({
  label,
  help,
  hint,
  preview,
  required,
  maxLength,
  className,
  value,
  onChange,
  tabs = true,
  onFiles,
  status,
}: {
  label: string;
  help?: ReactNode;
  hint?: string;
  preview?: string;
  tabs?: boolean;
  required?: boolean;
  maxLength?: number;
  className?: string;
  value: string;
  onChange: (value: string) => void;
  /** Pasted or dropped files at the caret; returns the inserted text. */
  onFiles?: (
    files: File[],
    range: [number, number],
    pasted: boolean,
  ) => string | void;
  /** Upload messages shown under the field. */
  status?: ReactNode;
}) {
  const id = useId();
  const [reading, setReading] = useState(tabs && Boolean(value.trim()));
  return (
    <div className="crew-md-field">
      <div className="crew-md-label">
        <label htmlFor={id}>{label}</label>
        <small>{t("Markdown supported")}</small>
        {help}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="crew-md-hint">
          {hint}
        </p>
      )}
      <div className="crew-md-box">
        {tabs && (
          <div
            className="crew-md-tabs"
            role="tablist"
            aria-label={t("{label} view", { label })}
          >
            {[true, false].map((showRead) => (
              <button
                key={String(showRead)}
                type="button"
                role="tab"
                aria-selected={reading === showRead}
                onClick={() => setReading(showRead)}
              >
                {showRead ? t("Read") : t("Edit")}
              </button>
            ))}
          </div>
        )}
        {/* Hidden rather than removed, so undo and the height survive Read. */}
        <GrowingTextarea
          id={id}
          aria-describedby={hint ? `${id}-hint` : undefined}
          hidden={reading}
          required={required}
          maxLength={maxLength}
          className={className}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onInvalid={() => setReading(false)}
          {...fileInputHandlers(onFiles)}
        />
        {reading && (
          <div className="crew-md-preview">
            {(preview ?? value).trim() ? (
              <Prose>{preview ?? value}</Prose>
            ) : (
              <p>{t("Nothing written yet.")}</p>
            )}
          </div>
        )}
      </div>
      {status}
    </div>
  );
}
