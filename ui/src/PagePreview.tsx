import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import DialogHeader, { HeadButton, type MenuItem } from "./DialogHeader";
import { isStandaloneApp } from "./Login";
import { t } from "./i18n";
import "./pagePreview.css";

/** The installed home-screen app (any platform), not a browser tab. */
export const isStandaloneDisplay = isStandaloneApp;

/**
 * In-app preview of a published page (`/a/<token>`) for the installed
 * home-screen app (0.33.0). A standalone app has no browser Back, and iOS
 * keeps in-scope links in the app window even with target="_blank", so
 * opening a public page there would leave the owner stuck on a page with no
 * Crew navigation. Instead the page opens in this full-window sheet over the
 * page it came from (which stays mounted, so its scroll and filters are
 * kept): Back (or ✕, Escape) returns; More holds Copy link, Open in Safari
 * and Share.
 *
 * The frame loads the same-origin public page, which allows framing only by
 * Crew's own origin (`frame-ancestors 'self'`). The page has no script; the
 * sandbox adds none, allows same-origin only so its images (same-origin
 * resource policy) load, and lets its external links open as new top-level
 * tabs. The `#in-crew` fragment hides the page's standalone "Back to Crew"
 * bar inside the frame (CSS `:target`, no script).
 */

const publicPage = /^\/a\/[A-Za-z0-9]{32}$/;

/** The path of a same-origin published page link (`/a/<token>`), else "". */
export function publicPagePath(href: string): string {
  try {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !publicPage.test(url.pathname))
      return "";
    return url.pathname;
  } catch {
    return "";
  }
}

/** Opens a URL as a new top-level tab (Safari, or iOS's in-app browser). */
export function openOutside(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
}

const isIOS = () =>
  typeof (navigator as Navigator & { standalone?: boolean }).standalone ===
    "boolean" || /iPhone|iPad|iPod/.test(navigator.userAgent);

export default function PagePreview({
  url,
  title,
  backLabel,
  onClose,
}: {
  /** The page's full public link (copied and shared as is). */
  url: string;
  title: string;
  backLabel?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [notice, setNotice] = useState<"" | "copied" | "failed">("");
  const path = publicPagePath(url);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (dialog && typeof dialog.showModal === "function" && !dialog.open)
      dialog.showModal();
    dialog
      ?.querySelector<HTMLButtonElement>(".crew-trail-nav button")
      ?.focus({ preventScroll: true });
    return () => {
      if (dialog?.open && typeof dialog.close === "function") dialog.close();
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  const menu: MenuItem[] = [
    {
      label: t("Copy link"),
      icon: "copy",
      copy: { text: url, onResult: (ok) => setNotice(ok ? "copied" : "failed") },
    },
    {
      label: isIOS() ? t("Open in Safari") : t("Open in browser"),
      icon: "forward",
      onSelect: () => openOutside(url),
    },
  ];
  if (typeof navigator.share === "function")
    menu.push({
      label: t("Share"),
      icon: "share",
      onSelect: () => {
        navigator.share({ title, url }).catch(() => {});
      },
    });
  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };
  return createPortal(
    <dialog
      ref={ref}
      className="crew-dialog crew-page-preview"
      aria-label={t("Shared page: {title}", { title })}
      open={
        typeof HTMLDialogElement.prototype.showModal !== "function"
          ? true
          : undefined
      }
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DialogHeader
        title={title}
        nav={
          <div className="crew-trail-nav" role="group" aria-label={t("Back")}>
            <HeadButton
              icon="back"
              label={backLabel ?? t("Back")}
              onClick={onClose}
            />
          </div>
        }
        menu={menu}
        close={onClose}
        alert={
          notice === "failed" ? (
            <span role="alert" className="crew-head-alert">
              {t("Could not copy automatically: {url}", { url })}
            </span>
          ) : notice === "copied" ? (
            <span role="status" className="crew-page-preview-copied">
              {t("Link copied")}
            </span>
          ) : null
        }
      />
      {path ? (
        <iframe
          className="crew-page-preview-frame"
          title={title}
          src={`${path}#in-crew`}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
        />
      ) : (
        <p className="crew-page-preview-none">
          {t("This page can only open outside Crew.")}
        </p>
      )}
    </dialog>,
    document.body,
  );
}
