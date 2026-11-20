import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icon";
import { copyText } from "./projectAgents";
import { CopyGlyph, useCopyFeedback } from "./CopyFeedback";
import { t } from "./i18n";

export { Icon, type IconName } from "./Icon";

/**
 * The one floating header of every reader dialog (0.30.0), in the style of
 * iOS Mail: a fixed back/forward cluster on the left, the title (ellipsized,
 * never wrapping), one rounded pill of icon-only buttons ending in "More",
 * and a circular close button on the right. Controls that do not apply stay
 * in place, disabled, so nothing moves between items or views; the header is
 * one row at 320 px and up.
 */

/** A circular or pill icon button; the label is its name and tooltip. */
export function HeadButton({
  icon,
  label,
  onClick,
  disabled,
  className = "",
  ...rest
}: {
  icon: IconName | React.ReactElement;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  "aria-haspopup"?: "menu";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const { buttonRef, ...aria } = rest;
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`crew-head-button ${className}`.trim()}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      {...aria}
    >
      {typeof icon === "string" ? <Icon name={icon} /> : icon}
    </button>
  );
}

/**
 * An icon-only button with the shared high-contrast icon tokens (0.38.0):
 * --icon-ink glyphs with 2 px strokes on a 44 px circular target, filled
 * with --icon-fill and outlined with --icon-line. Review option cards and
 * their blocks use it for Copy, feedback and More.
 */
export function IconButton({
  icon,
  label,
  className = "",
  buttonRef,
  ...rest
}: {
  icon: IconName | React.ReactElement;
  label: string;
  className?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`crew-icon-button ${className}`.trim()}
      aria-label={label}
      title={label}
      {...rest}
    >
      {typeof icon === "string" ? <Icon name={icon} /> : icon}
    </button>
  );
}

export type MenuItem = {
  label: string;
  icon: IconName;
  disabled?: boolean;
  /** Shown in red, in the last group. */
  destructive?: boolean;
} & (
  | { onSelect: () => void; copy?: never }
  | { copy: { text: string; onResult: (ok: boolean, text: string) => void }; onSelect?: never }
);

/**
 * Extra "More" menu items a dialog's body adds (for example a note's History
 * or Archive); the header shows them after the dialog's own items.
 */
export const DialogMenuContext = createContext<
  ((items: MenuItem[]) => void) | null
>(null);
export const useDialogMenu = () => useContext(DialogMenuContext);

export const menuIsOpenIn = (element: Element | null) =>
  !!element?.querySelector(".crew-menu");

/**
 * The "More" button and its floating card menu (Gmail iOS style): icon and
 * label rows grouped by thin dividers, destructive items in red last. It
 * closes on selection, a tap outside and Escape, and moves with the arrow
 * keys, Home and End.
 */
export function MoreMenu({
  items,
  label: labelProp,
  iconButton = false,
}: {
  items: MenuItem[];
  /** The button's and the menu's accessible name. */
  label?: string;
  /** The shared icon button (review option cards) instead of a header one. */
  iconButton?: boolean;
}) {
  const label = labelProp ?? t("More actions");
  const [open, setOpen] = useState(false);
  const feedback = useCopyFeedback();
  const hasCopy = items.some((item) => !!item.copy);
  const triggerIcon = hasCopy ? <CopyGlyph state={feedback.state} idle="more" /> : "more";
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const plain = items.filter((x) => !x.destructive);
  const destructive = items.filter((x) => x.destructive);
  const groups = [plain, destructive].filter((g) => g.length);
  const rows = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)',
      ) || [],
    );
  const shut = (focus = true) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    rows()[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) shut(false);
    };
    // Captured and cancelled so Escape closes only the menu, not the dialog.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        shut();
      } else if (e.key === "Tab") {
        shut(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = rows();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length].focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
  };
  return (
    <div className="crew-more-menu" ref={root}>
      {iconButton ? (
        <IconButton
          icon={triggerIcon}
          label={label}
          className={hasCopy ? "crew-icon-more crew-copy-trigger" : "crew-icon-more"}
          buttonRef={button}
          disabled={!items.length}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((v) => !v)}
        />
      ) : (
        <HeadButton
          className={hasCopy ? "crew-copy-trigger" : ""}
          icon={triggerIcon}
          label={label}
          buttonRef={button}
          disabled={!items.length}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={() => setOpen((v) => !v)}
        />
      )}
      {open && (
        <div
          id={id}
          ref={menu}
          className="crew-menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
        >
          {groups.map((group, g) => (
            <div className="crew-menu-group" role="group" key={g}>
              {group.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={item.disabled}
                  className={item.destructive ? "crew-menu-danger" : undefined}
                  onClick={() => {
                    shut();
                    const action = item.copy;
                    if (action) {
                      void feedback.run(
                        () => copyText(action.text),
                        (ok) => action.onResult(ok, action.text),
                      );
                    } else item.onSelect();
                  }}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Back and forward, always both, in one fixed cluster. */
export function NavCluster({
  back,
  forward,
}: {
  back?: () => void;
  forward?: () => void;
}) {
  return (
    <div className="crew-trail-nav" role="group" aria-label={t("Link history")}>
      <HeadButton icon="back" label={t("Back")} disabled={!back} onClick={back} />
      <HeadButton
        icon="forward"
        label={t("Forward")}
        disabled={!forward}
        onClick={forward}
      />
    </div>
  );
}

/**
 * Previous and next in the list the dialog was opened from, with the item's
 * place in it (0.32.0, iOS Mail style): one capsule after the title,
 * `[∧ 3 of 12 ∨]`. Vertical chevrons, so it never looks like the horizontal
 * back/forward history cluster. Disabled in place at the ends (no wrapping);
 * the position has a fixed width for the list, so the buttons never shift.
 * A record dialog with no list to step (0.35.0: an item its list is hiding)
 * keeps the capsule's slot, hidden, so More and close never shift.
 */
/**
 * The capsule's names for the nouns the reader passes, as whole sentences so
 * each language can inflect them; any other noun keeps the English pattern.
 */
function listNavTexts(noun: string, i: number, count: number) {
  const v = { i, count, noun };
  switch (noun) {
    case "task":
      return {
        group: t("task {i} of {count}", v),
        previous: t("Previous task (K)"),
        next: t("Next task (J)"),
      };
    case "note":
      return {
        group: t("note {i} of {count}", v),
        previous: t("Previous note (K)"),
        next: t("Next note (J)"),
      };
    case "bucket":
      return {
        group: t("bucket {i} of {count}", v),
        previous: t("Previous bucket (K)"),
        next: t("Next bucket (J)"),
      };
    case "agent":
      return {
        group: t("agent {i} of {count}", v),
        previous: t("Previous agent (K)"),
        next: t("Next agent (J)"),
      };
    case "review":
      return {
        group: t("review {i} of {count}", v),
        previous: t("Previous review (K)"),
        next: t("Next review (J)"),
      };
    case "result":
      return {
        group: t("result {i} of {count}", v),
        previous: t("Previous result (K)"),
        next: t("Next result (J)"),
      };
    case "shared page":
      return {
        group: t("shared page {i} of {count}", v),
        previous: t("Previous shared page (K)"),
        next: t("Next shared page (J)"),
      };
    case "item":
      return {
        group: t("item {i} of {count}", v),
        previous: t("Previous item (K)"),
        next: t("Next item (J)"),
      };
    default:
      return {
        group: `${noun} ${i} of ${count}`,
        previous: `Previous ${noun} (K)`,
        next: `Next ${noun} (J)`,
      };
  }
}

export function ListNavCluster({
  noun,
  index,
  count,
  previous,
  next,
  hidden = false,
}: {
  noun: string;
  /** Zero-based place in the list. */
  index: number;
  count: number;
  previous?: () => void;
  next?: () => void;
  /** Keeps the slot only: invisible, unfocusable and out of the accessibility tree. */
  hidden?: boolean;
}) {
  const digits = String(Math.max(count, 1)).length;
  const texts = listNavTexts(noun, index + 1, count);
  if (hidden)
    return (
      <div className="crew-list-nav crew-list-nav-hidden" aria-hidden="true">
        <HeadButton icon="up" label="" disabled />
        <span className="crew-list-position" style={{ width: `${digits * 2 + 3}ch` }} />
        <HeadButton icon="down" label="" disabled />
      </div>
    );
  return (
    <div className="crew-list-nav" role="group" aria-label={texts.group}>
      <HeadButton
        icon="up"
        label={texts.previous}
        disabled={!previous}
        onClick={previous}
      />
      <span
        className="crew-list-position"
        aria-hidden="true"
        style={{ width: `${digits * 2 + 3}ch` }}
      >
        {t("{i} of {count}", { i: index + 1, count })}
      </span>
      <HeadButton
        icon="down"
        label={texts.next}
        disabled={!next}
        onClick={next}
      />
    </div>
  );
}

export default function DialogHeader({
  title,
  nav,
  listNav,
  actions,
  menu,
  close,
  alert,
}: {
  title: string;
  /** The back/forward cluster; a disabled one when the dialog has no trail. */
  nav?: ReactNode;
  /** Previous/next and "x of y" in the source list, after the title (ListNavCluster); a hidden slot when the list hides the item; absent on non-record dialogs. */
  listNav?: ReactNode;
  /** Icon buttons in the pill, before More. */
  actions?: ReactNode;
  menu: MenuItem[];
  close: () => void;
  /** A message under the header, such as a failed copy. */
  alert?: ReactNode;
}) {
  return (
    <header className="crew-dialog-head">
      {nav ?? <NavCluster />}
      <h2 title={title}>{title}</h2>
      {listNav}
      <div className="crew-head-pill" role="toolbar" aria-label={t("Actions")}>
        {actions}
        <MoreMenu items={menu} />
      </div>
      <HeadButton
        icon="close"
        label={t("Close dialog")}
        className="crew-head-close"
        onClick={close}
      />
      {alert}
    </header>
  );
}
