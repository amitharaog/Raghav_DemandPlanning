// Freshroots mark: a sprout above the soil line with its roots below.
export function LogoMark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M16 12.6C12.8 12.6 10.6 10.4 10.6 7.4C13.8 7.4 16 9.6 16 12.6Z" fill="var(--brand-ink)" />
      <path d="M16 11C16 7.8 18.2 5.6 21.8 5.6C21.8 8.8 19.6 11 16 11Z" fill="var(--brand-ink)" opacity="0.85" />
      <path d="M16 10.8V17.2" stroke="var(--brand-ink)" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M8.2 17.2H23.8" stroke="var(--brand-ink)" strokeWidth="1.9" strokeLinecap="round" />
      <path
        d="M16 17.2V25.2M16 19.8C14.5 20.9 13.3 22.2 12.3 24.4M16 19.8C17.5 20.9 18.7 22.2 19.7 24.4"
        stroke="var(--brand-ink)"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
        opacity="0.75"
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
