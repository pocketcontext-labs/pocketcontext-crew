import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

const sameLabel = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/**
 * Task labels as removable chips. Enter, comma or Tab adds the typed label;
 * Backspace in the empty input selects the last chip and a second Backspace
 * removes it; a focused chip is removed with Delete or Backspace. Suggestions
 * come from labels already used (matched ignoring case, keeping their casing).
 * Duplicates are never added: the existing chip is highlighted instead.
 */
export default function LabelsInput({
  label = "Labels",
  value,
  onChange,
  suggestions = [],
  disabled = false,
}: {
  label?: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** Labels used elsewhere, offered while typing. */
  suggestions?: string[];
  disabled?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  // The chip a first Backspace selected, for a second Backspace to remove.
  const [selected, setSelected] = useState<number | null>(null);
  // A chip briefly highlighted because the owner tried to add it again.
  const [flash, setFlash] = useState("");
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(""), 1200);
    return () => clearTimeout(timer);
  }, [flash]);
  const needle = text.trim().toLowerCase();
  const matches = needle
    ? [...new Map(suggestions.map((s) => [s.toLowerCase(), s])).values()]
        .filter(
          (s) =>
            s.toLowerCase().includes(needle) &&
            !value.some((v) => sameLabel(v, s)),
        )
        .sort(
          (a, b) =>
            Number(!a.toLowerCase().startsWith(needle)) -
              Number(!b.toLowerCase().startsWith(needle)) ||
            a.localeCompare(b),
        )
        .slice(0, 8)
    : [];
  /** Adds each label once, trimmed, in an existing label's casing. */
  const add = (raw: string[]) => {
    const next = [...value];
    let repeated = "";
    for (const part of raw) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const existing = next.find((v) => sameLabel(v, trimmed));
      if (existing) {
        repeated = existing;
        continue;
      }
      next.push(suggestions.find((s) => sameLabel(s, trimmed)) ?? trimmed);
    }
    if (next.length !== value.length) onChange(next);
    if (repeated) setFlash(repeated);
    setText("");
    setActive(-1);
    setSelected(null);
  };
  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    setSelected(null);
    input.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && matches.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
      return;
    }
    if (e.key === "ArrowUp" && matches.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
      return;
    }
    if (e.key === "Escape" && active >= 0) {
      // Closes the suggestion, not the dialog.
      e.preventDefault();
      e.stopPropagation();
      setActive(-1);
      return;
    }
    if (e.key === "Enter" || e.key === "," || (e.key === "Tab" && needle)) {
      // Enter must not submit the form; Tab with text stays to add more.
      e.preventDefault();
      add([active >= 0 && matches[active] ? matches[active] : text]);
      return;
    }
    if (e.key === "Backspace" && !text && value.length) {
      e.preventDefault();
      if (selected === null) setSelected(value.length - 1);
      else remove(selected);
      return;
    }
    if (selected !== null) setSelected(null);
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!/[,\n]/.test(pasted)) return;
    e.preventDefault();
    add((text + pasted).split(/[,\n]/));
  };
  const chipKey = (index: number) => (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(index);
    }
  };
  const listId = `${id}-suggestions`;
  return (
    <div className="crew-field crew-labels-field">
      <label htmlFor={id}>{label}</label>
      <div
        className={`crew-chip-input${disabled ? " disabled" : ""}`}
        onMouseDown={(e) => {
          // A click on the box's empty space types into it.
          if (e.target === e.currentTarget) {
            e.preventDefault();
            input.current?.focus();
          }
        }}
      >
        {value.map((labelText, index) => (
          <span
            key={labelText}
            className={`crew-chip${selected === index ? " selected" : ""}${flash === labelText ? " flash" : ""}`}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={disabled ? undefined : chipKey(index)}
          >
            {labelText}
            {!disabled && (
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Remove label ${labelText}`}
                onClick={() => remove(index)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 && matches[active] ? `${listId}-${active}` : undefined
          }
          disabled={disabled}
          value={text}
          placeholder={value.length ? "" : "Add a label"}
          autoComplete="off"
          // Typing is not an edit until it becomes a chip.
          onChange={(e) => {
            e.stopPropagation();
            const next = e.target.value;
            // A comma that arrives without a key press (autocorrect, mobile
            // keyboards, scripted input) still finishes the labels before it.
            if (/[,\n]/.test(next)) {
              const parts = next.split(/[,\n]/);
              const rest = parts.pop() ?? "";
              add(parts);
              setText(rest);
              return;
            }
            setText(next);
            setActive(-1);
            setSelected(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            setSelected(null);
            if (text.trim()) add([text]);
          }}
        />
      </div>
      {matches.length > 0 && (
        <ul className="crew-label-suggestions" role="listbox" id={listId}>
          {matches.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Keeps focus in the input, so blur does not add the typed text.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                add([s]);
                input.current?.focus();
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
