const MARK_GRADIENT_ID = 'sentinel-mark-gradient';

export function LogoMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <linearGradient
          id={MARK_GRADIENT_ID}
          x1="0"
          y1="0"
          x2="32"
          y2="32"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#6366F1" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${MARK_GRADIENT_ID})`} />
      <path
        d="M6.5 16.5h4.2l2.6-6 5.4 11 2.6-5h4.2"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="7" r="1.6" fill="#fff" fillOpacity="0.85" />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-8 w-8" />
      <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        Sentinel
      </span>
    </span>
  );
}
