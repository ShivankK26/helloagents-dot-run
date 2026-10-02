/** The helloagents mark: a speech bubble holding a terminal prompt. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <path
        d="M9 4h14a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H13.5L8 28.2V24H9a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6Z"
        fill="currentColor"
      />
      <path
        d="m10 10.2 4.3 3.8-4.3 3.8"
        stroke="var(--surface)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <rect x="16.6" y="16.4" width="6.4" height="2.8" rx="1.4" fill="#ff7a3d" />
    </svg>
  );
}
