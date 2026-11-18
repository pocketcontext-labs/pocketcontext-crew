import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import logo from "./assets/brand/logo.svg?no-inline";
import { HelpModeContext } from "./Help";
import { guideHash, helpContent, textFor, type HelpTopic } from "./helpContent";
import { viewHashes, type View } from "./itemLink";
import "./chrome.css";

/* Line icons for the phone chrome; they take the text colour. */
const Svg = ({ children }: { children: ReactNode }) => (
  <svg
    className="crew-micon-svg"
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);
export const icons = {
  home: (
    <Svg>
      <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z" />
    </Svg>
  ),
  tasks: (
    <Svg>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </Svg>
  ),
  notes: (
    <Svg>
      <path d="M6 3.5h8.5L19 8v12a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20z" />
      <path d="M14 3.5V8.5h5M9 12.5h6.5M9 16h6.5" />
    </Svg>
  ),
  approvals: (
    <Svg>
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 12.2 2.4 2.4 4.8-5" />
    </Svg>
  ),
  more: (
    <Svg>
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" />
    </Svg>
  ),
  filter: (
    <Svg>
      <path d="M4.5 7h15M7.5 12h9M10.5 17h3" />
    </Svg>
  ),
  plus: (
    <Svg>
      <path d="M12 5.5v13M5.5 12h13" />
    </Svg>
  ),
  refresh: (
    <Svg>
      <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5" />
    </Svg>
  ),
  chevronLeft: (
    <Svg>
      <path d="m14.5 6-6 6 6 6" />
    </Svg>
  ),
  chevronRight: (
    <Svg>
      <path d="m9.5 6 6 6-6 6" />
    </Svg>
  ),
};

/**
 * A bottom sheet over the page: a modal dialog with a title and Done. Escape,
 * Done and a tap on the dimmed page close it; focus returns where it was.
 */
export function Sheet({
  title,
  onClose,
  className = "",
  children,
}: {
  title: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal?.();
    // The sheet itself takes focus, so no keyboard opens on a phone.
    ref.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);
  const outside = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target !== ref.current) return false;
    const box = ref.current.getBoundingClientRect();
    return (
      e.clientX < box.left ||
      e.clientX > box.right ||
      e.clientY < box.top ||
      e.clientY > box.bottom
    );
  };
  return (
    <dialog
      ref={ref}
      open={
        typeof HTMLDialogElement.prototype.showModal !== "function"
          ? true
          : undefined
      }
      className={`crew-sheet ${className}`.trim()}
      tabIndex={-1}
      aria-label={title}
      onMouseDown={(e) => {
        pressedBackdrop.current = outside(e);
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && outside(e)) onClose();
        pressedBackdrop.current = false;
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
    >
      <span className="crew-sheet-grip" aria-hidden="true" />
      <header className="crew-sheet-head">
        <h2>{title}</h2>
        <button type="button" className="crew-sheet-done" onClick={onClose}>
          Done
        </button>
      </header>
      <div className="crew-sheet-body">{children}</div>
    </dialog>
  );
}

export type PageAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

/**
 * The phone's one-row top bar: the mark, the page title, then search, the
 * page's filter (with its active count), + and the page menu (⋯), which holds
 * the page's intro, its help and Refresh.
 */
export function MobileTopBar({
  title,
  search,
  filter,
  add,
  description,
  help,
  actions = [],
  refresh,
}: {
  title: string;
  search: ReactNode;
  filter?: { label: string; count: number; open: boolean; onOpen: () => void };
  add?: PageAction;
  description: string;
  help?: HelpTopic;
  actions?: PageAction[];
  refresh: { busy: boolean; disabled: boolean; run: () => void };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const mode = useContext(HelpModeContext);
  const entry = help ? helpContent[help] : null;
  return (
    <header className="crew-mtopbar">
      <a
        className="crew-mlogo"
        href={viewHashes.home}
        aria-label="PocketContext Crew, go to Home"
      >
        <img src={logo} width="28" height="28" alt="" />
      </a>
      <h1>{title}</h1>
      <div className="crew-mactions">
        {search}
        {filter && (
          <button
            type="button"
            className={`crew-micon${filter.count ? " is-active" : ""}`}
            aria-label={
              filter.count
                ? `${filter.label}, ${filter.count} on`
                : filter.label
            }
            title={filter.label}
            aria-haspopup="dialog"
            aria-expanded={filter.open}
            onClick={filter.onOpen}
          >
            {icons.filter}
            {filter.count > 0 && (
              <b className="crew-micon-badge" aria-hidden="true">
                {filter.count}
              </b>
            )}
          </button>
        )}
        {add && (
          <button
            type="button"
            className="crew-micon crew-madd"
            aria-label={add.label}
            title={add.label}
            disabled={add.disabled}
            onClick={add.onClick}
          >
            {icons.plus}
          </button>
        )}
        <button
          type="button"
          className="crew-micon"
          aria-label="Page options"
          title="Page options"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          {icons.more}
        </button>
      </div>
      {menuOpen && (
        <Sheet
          title={title}
          className="crew-page-menu"
          onClose={() => setMenuOpen(false)}
        >
          <div className="crew-sheet-actions">
            {actions.map((action) => (
              <button
                type="button"
                key={action.label}
                disabled={action.disabled}
                onClick={() => {
                  setMenuOpen(false);
                  action.onClick();
                }}
              >
                {action.label}
              </button>
            ))}
            <button
              type="button"
              className={`crew-sheet-refresh${refresh.busy ? " is-refreshing" : ""}`}
              disabled={refresh.disabled}
              aria-busy={refresh.busy || undefined}
              onClick={() => {
                setMenuOpen(false);
                refresh.run();
              }}
            >
              <span className="crew-refresh-icon">{icons.refresh}</span>
              Refresh
            </button>
          </div>
          <section className="crew-sheet-about" aria-label="About this page">
            <p className="crew-sheet-intro">{description}</p>
            {entry && (
              <>
                <p>{textFor(entry.what, mode)}</p>
                <p>{textFor(entry.action, mode)}</p>
                <a href={guideHash(help!)} onClick={() => setMenuOpen(false)}>
                  Learn more in the Guide
                </a>
              </>
            )}
          </section>
        </Sheet>
      )}
    </header>
  );
}

const tabs: [View, string, keyof typeof icons][] = [
  ["home", "Home", "home"],
  ["board", "Tasks", "tasks"],
  ["memory", "Notes", "notes"],
  ["reviews", "Approvals", "approvals"],
];
const moreLinks: [View, string][] = [
  ["shared", "Shared"],
  ["agents", "Agents"],
  ["archive", "Archive"],
  ["connect", "Connect an agent"],
  ["guide", "Guide"],
];

/**
 * The phone's fixed bottom tabs: Home, Tasks, Notes, Approvals (with the
 * pending count) and More, whose sheet reaches every other page and Sign out.
 */
export function MobileTabBar({
  view,
  pending,
  onSignOut,
}: {
  view: View;
  pending: number;
  onSignOut: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const inMore = moreLinks.some(([key]) => key === view);
  return (
    <nav className="crew-tabbar" aria-label="Workspace">
      {tabs.map(([key, label, icon]) => (
        <a
          key={key}
          href={viewHashes[key]}
          aria-current={view === key ? "page" : undefined}
          aria-label={
            key === "reviews" && pending > 0
              ? `${label}, ${pending} pending`
              : undefined
          }
        >
          <span className="crew-tab-icon">
            {icons[icon]}
            {key === "reviews" && pending > 0 && (
              <b className="crew-tab-badge" aria-hidden="true">
                {pending}
              </b>
            )}
          </span>
          {label}
        </a>
      ))}
      <button
        type="button"
        className={inMore ? "is-current" : undefined}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen(true)}
      >
        <span className="crew-tab-icon">{icons.more}</span>
        More
      </button>
      {moreOpen && (
        <Sheet
          title="More"
          className="crew-more-sheet"
          onClose={() => setMoreOpen(false)}
        >
          <ul className="crew-more-links">
            {moreLinks.map(([key, label]) => (
              <li key={key}>
                <a
                  href={viewHashes[key]}
                  aria-current={view === key ? "page" : undefined}
                  onClick={() => setMoreOpen(false)}
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <p className="crew-more-foot">
            One owner. One shared context.
            <button type="button" onClick={onSignOut}>
              Sign out
            </button>
          </p>
        </Sheet>
      )}
    </nav>
  );
}
