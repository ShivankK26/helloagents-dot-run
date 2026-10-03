// Small stroke icons, drawn to match the app's type weight.
const paths = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  plus: "M12 5v14M5 12h14",
  git: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  close: "M6 6l12 12M18 6 6 18",
  back: "m15 18-6-6 6-6",
  branch:
    "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 3-12 9",
  stop: "M7 7h10v10H7z",
  arrowUp: "M12 19V5M5 12l7-7 7 7",
  reveal: "M14 3h7v7M10 14 21 3M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  check: "M5 12l5 5 9-11",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  term: "m5 8 4 4-4 4M11 17h8",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  send: "M4 12 20 4l-5 16-3-7z",
  pin: "M9 4h6l-1 6 3 3H7l3-3zM12 13v7",
  merge:
    "M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9c0 4 12 2 12 6",
  chevron: "m9 6 6 6-6 6",
  runs: "M4 6h16M4 12h16M4 18h10",
  sidebar: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9.5 5v14",
  trace: "M4 5h7M7 10h9M10 15h10M5 20h6",
  alert: "M12 4 2.5 20h19L12 4zM12 10v4M12 17.5v.01",
  gauge: "M4.5 17a8 8 0 1 1 15 0M12 14l4-5",
} as const;

export function Icon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
