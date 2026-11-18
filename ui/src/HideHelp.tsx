import { useRef } from "react";
import { t } from "./i18n";
import { isHelpHidden, setHelpHidden, useReaderSettings } from "./sessionGuide";
import "./hideHelp.css";

/**
 * The help ids the reader hides with "Don't show this again" (0.37.0). Pages
 * use `page.<view>` for the How it works panel in their ⋯ menu; the Start a
 * session guide keeps its own setting (session_guide_off).
 */
export const helpIds = {
  homeGuideRow: "home.guide_row",
  homeGetStarted: "home.get_started",
  sessionGuide: "session_guide",
  page: (view: string) => `page.${view}`,
} as const;

/**
 * "Don't show this again" (0.37.0), the same control on every help that shows
 * by itself: a 44 px row under a hairline. Checked, that help stops showing by
 * itself; it stays available on demand (the page ⋯ How it works), where the
 * box shows checked and unchecking lets it show again. The owner's choice is
 * kept on the server, so it holds across browsers; Settings' Show all help
 * again clears every one.
 */
export default function HideHelp({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const prefs = useReaderSettings();
  return (
    <label className={`crew-hide-help${className ? ` ${className}` : ""}`}>
      <input
        type="checkbox"
        checked={isHelpHidden(prefs, id)}
        onChange={(e) =>
          void setHelpHidden(id, e.target.checked).catch(() => undefined)
        }
      />
      <span>{t("Don't show this again")}</span>
    </label>
  );
}

/**
 * Whether a help shows by itself here: decided once, when the preferences
 * have loaded, so ticking "Don't show this again" keeps the help on screen
 * until the owner leaves, and unknown preferences keep it quiet.
 */
export function useHelpShown(id: string): boolean {
  const prefs = useReaderSettings();
  const decided = useRef<boolean | null>(null);
  if (decided.current === null && prefs.loaded)
    decided.current = !isHelpHidden(prefs, id);
  return decided.current ?? false;
}
