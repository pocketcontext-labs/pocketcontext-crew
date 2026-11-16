import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * The one floating header of every reader dialog (0.30.0), in the style of
 * iOS Mail: a fixed back/forward cluster on the left, the title (ellipsized,
 * never wrapping), one rounded pill of icon-only buttons ending in "More",
 * and a circular close button on the right. Controls that do not apply stay
 * in place, disabled, so nothing moves between items or views; the header is
 * one row at 320 px and up.
 */

const paths = {
  back: "M15 5l-7 7 7 7",
  forward: "M9 5l7 7-7 7",
  close: "M6 6l12 12M18 6L6 18",
  more: "",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  share: "M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7",
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  history: "M4 12a8 8 0 1 0 2.34-5.66L4 8.5M4 4v4.5h4.5M12 8v4.5l3 2",
  archive: "M4 5h16v4H4zM6 9v10h12V9M10 13h4",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
} as const;
export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="crew-icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      {name === "more" ? (
        <g fill="currentColor" stroke="none">
          <circle cx="5.5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="18.5" cy="12" r="1.7" />
        </g>
      ) : (
        <path d={paths[name]} />
      )}
    </svg>
  );
}

/** A circular or pill icon button; the label is its name and tooltip. */
export function HeadButton({
  icon,
  label,
  onClick,
  disabled,
  className = "",
  ...rest
}: {
  icon: IconName;
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
      <Icon name={icon} />
    </button>
  );
}

export type MenuItem = {
  label: string;
  icon: IconName;
  onSelect: () => void;
  disabled?: boolean;
  /** Shown in red, in the last group. */
  destructive?: boolean;
};

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
export function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
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
      <HeadButton
        icon="more"
        label="More actions"
        buttonRef={button}
        disabled={!items.length}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div
          id={id}
          ref={menu}
          className="crew-menu"
          role="menu"
          aria-label="More actions"
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
                    item.onSelect();
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
    <div className="crew-trail-nav" role="group" aria-label="Link history">
      <HeadButton icon="back" label="Back" disabled={!back} onClick={back} />
      <HeadButton
        icon="forward"
        label="Forward"
        disabled={!forward}
        onClick={forward}
      />
    </div>
  );
}

export default function DialogHeader({
  title,
  nav,
  actions,
  menu,
  close,
  alert,
}: {
  title: string;
  /** The back/forward cluster; a disabled one when the dialog has no trail. */
  nav?: ReactNode;
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
      <div className="crew-head-pill" role="toolbar" aria-label="Actions">
        {actions}
        <MoreMenu items={menu} />
      </div>
      <HeadButton
        icon="close"
        label="Close dialog"
        className="crew-head-close"
        onClick={close}
      />
      {alert}
    </header>
  );
}
