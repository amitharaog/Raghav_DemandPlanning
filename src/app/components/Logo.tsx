// Freshroots mark: a sprout above the soil line with its roots below.
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M16 12.2C12.6 12.2 10.2 9.8 10.2 6.6C13.6 6.6 16 9 16 12.2Z" fill="#fff" />
      <path d="M16 10.6C16 7.2 18.4 4.8 22.2 4.8C22.2 8.2 19.8 10.6 16 10.6Z" fill="#fff" opacity="0.85" />
      <path d="M16 10.4V17" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.5 17H24.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M16 17V25.5M16 19.6C14.4 20.8 13.1 22.2 12 24.6M16 19.6C17.6 20.8 18.9 22.2 20 24.6"
        stroke="#fff"
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark />
      <span className="logo-text">
        <span className="logo-name">Freshroots</span>
        <span className="logo-sub">Demand planning</span>
      </span>
    </span>
  );
}
