import { useId, useLayoutEffect, useRef, useState } from "react";
import AutoTextarea from "./AutoTextarea";
import { Icon } from "./DialogHeader";
import PlainRefs from "./PlainRefs";

/**
 * The hold reason with Read and Edit like a description (0.33.0). Read shows
 * the text with record ids and Crew addresses as links titled with their
 * record; tapping the text (not a link) or Edit shows the raw text to change.
 * An empty reason opens in Edit. The stored text is never rewritten.
 */
export default function HoldReasonField({
  value,
  onValue,
  readOnly = false,
  label = "Hold reason",
  placeholder = "What needs to happen first?",
  maxLength = 2000,
}: {
  value: string;
  onValue: (value: string) => void;
  readOnly?: boolean;
  label?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(() => !value.trim());
  const focusOnEdit = useRef(false);
  const reading = !editing && !!value.trim();
  useLayoutEffect(() => {
    if (reading || !focusOnEdit.current) return;
    focusOnEdit.current = false;
    const el = box.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [reading]);
  const edit = () => {
    if (readOnly) return;
    focusOnEdit.current = true;
    setEditing(true);
  };
  return (
    <div className="crew-field crew-plain-field">
      <div className="crew-plain-field-head">
        <label htmlFor={id}>{label}</label>
        {!readOnly &&
          (reading ? (
            <button
              type="button"
              className="crew-plain-field-toggle"
              aria-label={`Edit ${label.toLowerCase()}`}
              onClick={edit}
            >
              <Icon name="pencil" />
              Edit
            </button>
          ) : value.trim() ? (
            <button
              type="button"
              className="crew-plain-field-toggle"
              onClick={() => setEditing(false)}
            >
              Done
            </button>
          ) : null)}
      </div>
      {/* Hidden rather than removed, so undo and the label survive Read. */}
      <AutoTextarea
        ref={box}
        id={id}
        hidden={reading}
        value={value}
        onValue={onValue}
        placeholder={placeholder}
        maxLength={maxLength}
      />
      {reading && (
        <div
          className="crew-plain-read"
          onClick={(e) => {
            // Links open; selecting text to copy it is not an edit.
            if ((e.target as Element).closest("a")) return;
            if (window.getSelection?.()?.toString()) return;
            edit();
          }}
        >
          <PlainRefs text={value} max={48} />
        </div>
      )}
    </div>
  );
}
