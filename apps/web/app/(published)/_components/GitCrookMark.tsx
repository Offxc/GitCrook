/** The "Powered by" mark, next to the badge text — same spot GitBook's own logo sits in its sidebar. */
export function GitCrookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 130" className={className} fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="
        M64,6
        C80,6 93,18 100,30
        C107,18 120,6 136,6
        C162,6 180,24 180,50
        C180,66 173,79 162,88
        C173,96 180,105 180,110
        C180,120 158,126 136,124
        C118,122.5 107,116 100,108
        C93,116 82,122.5 64,124
        C42,126 20,120 20,110
        C20,105 27,96 38,88
        C27,79 20,66 20,50
        C20,24 38,6 64,6
        Z
      " />
      <circle cx="64" cy="40" r="19" />
      <circle cx="136" cy="40" r="19" />
      <circle cx="64" cy="40" r="5.5" fill="currentColor" stroke="none" />
      <circle cx="136" cy="40" r="5.5" fill="currentColor" stroke="none" />
      <path d="M92,70 Q96,79 91,85" strokeWidth="6" />
      <path d="M108,70 Q104,79 109,85" strokeWidth="6" />
    </svg>
  );
}
