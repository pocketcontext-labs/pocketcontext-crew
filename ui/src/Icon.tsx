const paths = {
  back: "M15 5l-7 7 7 7",
  forward: "M9 5l7 7-7 7",
  up: "M5 15l7-7 7 7",
  down: "M5 9l7 7 7-7",
  close: "M6 6l12 12M18 6L6 18",
  more: "",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  share: "M12 3v12M7.5 7.5L12 3l4.5 4.5M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7",
  copy: "M9 9h10v10H9zM5 15V5h10",
  check: "M5 12.5l4.5 4.5L19 7.5",
  history: "M4 12a8 8 0 1 0 2.34-5.66L4 8.5M4 4v4.5h4.5M12 8v4.5l3 2",
  archive: "M4 5h16v4H4zM6 9v10h12V9M10 13h4",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
  note: "M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z",
  reject: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.6 5.6l12.8 12.8",
  unlock: "M6 11h12v9H6zM8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2",
  pencil: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
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
