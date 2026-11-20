import { useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";
import { t } from "./i18n";
import "./copyFeedback.css";

type CopyState = "" | "copied" | "failed";

/** Start the write in the tap itself. Only the latest tap owns the confirmation. */
export function useCopyFeedback() {
  const [state, setState] = useState<CopyState>("");
  const sequence = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      sequence.current++;
      window.clearTimeout(timer.current);
    },
    [],
  );

  const run = async (
    copy: () => Promise<boolean>,
    onResult?: (ok: boolean) => void,
  ) => {
    const attempt = ++sequence.current;
    let ok = false;
    try {
      ok = await copy();
    } catch {
      // A rejected clipboard write has the same result as a refused fallback.
    }
    if (attempt !== sequence.current) return;
    window.clearTimeout(timer.current);
    setState(ok ? "copied" : "failed");
    timer.current = window.setTimeout(() => setState(""), 1300);
    onResult?.(ok);
  };
  return { state, run };
}

/** All glyphs occupy one cell throughout both directions of the crossfade. */
export function CopyGlyph({
  state,
  idle = "copy",
}: {
  state: CopyState;
  idle?: IconName;
}) {
  return (
    <span
      className="crew-copy-glyph"
      data-state={state || undefined}
      aria-hidden="true"
    >
      <Icon name={idle} />
      <Icon name="check" />
      <Icon name="close" />
    </span>
  );
}

/** Inline copy controls describe their content to assistive technology. */
function CopyIconButton({
  description,
  state,
  onClick,
  className = "",
  disabled,
}: {
  description: string;
  state: CopyState;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const descriptionId = useId();
  const name = t("Copy");
  const hasDescription = description !== name;
  return (
    <button
      type="button"
      className={`crew-copy-control crew-copy-icon ${className}`.trim()}
      data-state={state || undefined}
      aria-label={name}
      aria-describedby={hasDescription ? descriptionId : undefined}
      title={name}
      disabled={disabled}
      onClick={onClick}
    >
      <CopyGlyph state={state} />
      {hasDescription && (
        <span hidden id={descriptionId}>
          {description}
        </span>
      )}
    </button>
  );
}

type CopyActionProps = {
  copy: () => Promise<boolean>;
  label: string;
  className?: string;
  disabled?: boolean;
  onResult?: (ok: boolean) => void;
};

export function CopyControl({
  copy,
  label,
  className,
  disabled,
  onResult,
  successLabel,
}: CopyActionProps & { successLabel?: string }) {
  const { state, run } = useCopyFeedback();
  return (
    <>
      <CopyIconButton
        description={label}
        className={className}
        state={state}
        disabled={disabled}
        onClick={() => void run(copy, onResult)}
      />
      <span className="crew-visually-hidden" aria-live="polite">
        {state === "copied"
          ? (successLabel ?? t("Copied"))
          : state === "failed"
            ? t("Not copied")
            : ""}
      </span>
    </>
  );
}

/** Starting a coding session or rewriting its instructions is a named workflow. */
export function NamedCopyAction({
  copy,
  label,
  successLabel,
  accessibleLabel,
  className = "",
  disabled,
  onResult,
}: CopyActionProps & {
  successLabel: string;
  accessibleLabel?: string;
}) {
  const { state, run } = useCopyFeedback();
  const shown = state === "copied" ? successLabel : label;
  const name = accessibleLabel ?? shown;
  return (
    <button
      type="button"
      className={`crew-copy-control ${className}`.trim()}
      data-state={state || undefined}
      aria-label={name}
      title={name}
      disabled={disabled}
      onClick={() => void run(copy, onResult)}
    >
      <CopyGlyph state={state} />
      <span className="crew-copy-labels" aria-hidden="true">
        {[label, successLabel].map((text) => (
          <span key={text} data-shown={text === shown || undefined}>
            {text}
          </span>
        ))}
      </span>
    </button>
  );
}
