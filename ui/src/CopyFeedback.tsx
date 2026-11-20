import { useEffect, useRef, useState } from "react";
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

export function CopyControl({
  copy,
  label,
  successLabel,
  failureLabel,
  accessibleLabel,
  iconOnly,
  className = "",
  disabled,
  onResult,
  idleIcon,
  title,
  announce = false,
}: {
  copy: () => Promise<boolean>;
  label: string;
  successLabel?: string;
  failureLabel?: string;
  accessibleLabel?: string;
  iconOnly?: boolean;
  className?: string;
  disabled?: boolean;
  onResult?: (ok: boolean) => void;
  idleIcon?: IconName;
  title?: string;
  announce?: boolean;
}) {
  const feedback = useCopyFeedback();
  const { state } = feedback;
  const shown =
    (state === "copied" && successLabel) ||
    (state === "failed" && failureLabel) ||
    label;
  const name = accessibleLabel ?? shown;
  return (
    <>
      <button
        type="button"
        className={`crew-copy-control ${className}`.trim()}
        data-state={state || undefined}
        aria-label={name}
        title={title ?? name}
        disabled={disabled}
        onClick={() => void feedback.run(copy, onResult)}
      >
        <CopyGlyph state={state} idle={idleIcon} />
        {!iconOnly && (
          <span className="crew-copy-labels" aria-hidden="true">
            {Array.from(new Set([label, successLabel, failureLabel])).map(
              (text) =>
                text ? (
                  <span key={text} data-shown={text === shown || undefined}>
                    {text}
                  </span>
                ) : null,
            )}
          </span>
        )}
      </button>
      {announce && (
        <span className="crew-visually-hidden" aria-live="polite">
          {state === "copied"
            ? t("Copied")
            : state === "failed"
              ? t("Not copied")
              : ""}
        </span>
      )}
    </>
  );
}
