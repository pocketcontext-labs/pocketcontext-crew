import {
  forwardRef,
  useCallback,
  useId,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type ComponentProps,
  type KeyboardEvent,
} from "react";

/** Line breaks (and the spaces around them) become one space. */
export const singleLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ");

type Props = Omit<ComponentProps<"textarea">, "onChange" | "value" | "rows"> & {
  value: string;
  /** The new value, always on one line. */
  onValue: (value: string) => void;
  /** Lines shown before the field scrolls inside (default 4). */
  maxRows?: number;
};

/**
 * A single-line text field that wraps (0.33.0): a textarea one line tall that
 * grows with its text up to `maxRows` lines, then scrolls inside, so a long
 * title or hold reason is never cut off or scrolled sideways on a phone. The
 * value never holds a line break: Enter submits the form like an input does
 * (only when its submit button is enabled), and pasted line breaks become
 * spaces. AutoFill is off, so iOS doesn't offer contacts.
 */
const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function AutoTextarea(
    { value, onValue, maxRows = 4, className, onKeyDown, onPaste, ...rest },
    forwarded,
  ) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(forwarded, () => ref.current as HTMLTextAreaElement);
    const measure = useCallback(() => {
      const el = ref.current;
      if (!el) return;
      const style = getComputedStyle(el);
      const px = (v: string) => parseFloat(v) || 0;
      const lineHeight = px(style.lineHeight) || px(style.fontSize) * 1.4 || 20;
      const chrome =
        px(style.paddingTop) +
        px(style.paddingBottom) +
        px(style.borderTopWidth) +
        px(style.borderBottomWidth);
      const max = Math.ceil(lineHeight * maxRows + chrome);
      el.style.height = "auto";
      // Hidden or not yet laid out: leave the one-row height.
      if (!el.scrollHeight) return;
      const needed =
        el.scrollHeight +
        px(style.borderTopWidth) +
        px(style.borderBottomWidth);
      el.style.height = `${Math.min(needed, max)}px`;
      el.style.overflowY = needed > max + 1 ? "auto" : "hidden";
    }, [maxRows]);
    useLayoutEffect(measure, [measure, value, rest.hidden]);
    // Fields in a dialog not yet shown measure zero, and a new width rewraps.
    useEffect(() => {
      const el = ref.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      let width = -1;
      const observer = new ResizeObserver(() => {
        if (el.clientWidth === width) return;
        width = el.clientWidth;
        measure();
      });
      observer.observe(el);
      return () => observer.disconnect();
    }, [measure]);
    const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented || e.key !== "Enter" || e.nativeEvent.isComposing)
        return;
      e.preventDefault();
      // Like Enter in an input: submit through the form's default button,
      // and not at all when that button is disabled.
      const form = e.currentTarget.form;
      if (!form) return;
      const button = form.querySelector<HTMLButtonElement | HTMLInputElement>(
        'button:not([type]), button[type="submit"], input[type="submit"]',
      );
      if (!button || button.disabled) return;
      if (typeof form.requestSubmit === "function") form.requestSubmit(button);
      else button.click();
    };
    const paste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
      onPaste?.(e);
      if (e.defaultPrevented) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!/[\r\n]/.test(text) || e.clipboardData.files?.length) return;
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const clean = singleLine(text);
      const next = el.value.slice(0, start) + clean + el.value.slice(end);
      onValue(next.slice(0, rest.maxLength ?? next.length));
      const caret = start + clean.length;
      requestAnimationFrame(() => {
        if (document.activeElement === el) el.setSelectionRange(caret, caret);
      });
    };
    return (
      <textarea
        autoComplete="off"
        autoCorrect="on"
        autoCapitalize="sentences"
        enterKeyHint="done"
        {...rest}
        ref={ref}
        rows={1}
        value={value}
        className={`crew-auto-field${className ? ` ${className}` : ""}`}
        onChange={(e) => onValue(singleLine(e.target.value))}
        onKeyDown={keyDown}
        onPaste={paste}
      />
    );
  },
);
export default AutoTextarea;

/**
 * A labelled AutoTextarea. The label names the field by `for`, not by
 * wrapping it: a wrapping label would add the field's own text to its
 * accessible name in some browsers ("Title Launch plan").
 */
export function AutoTextField({
  label,
  className = "crew-field",
  ...props
}: Props & { label: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={props.id ?? id}>{label}</label>
      <AutoTextarea id={id} {...props} />
    </div>
  );
}
