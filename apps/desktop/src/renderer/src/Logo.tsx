/** The helloagents mark: three agents' lines meet in one result. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <path
        d="M5 7.5c8 0 8 8.5 14 8.5M5 24.5c8 0 8-8.5 14-8.5M5 16h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24.5" cy="16" r="4.2" fill="var(--accent)" />
    </svg>
  );
}
