// Small inline-SVG charts for the dashboard. Server-rendered, no chart library.

export function AreaChart({ points, height = 200 }: { points: { label: string; value: number }[]; height?: number }) {
  const w = 640;
  const h = height;
  if (points.length < 2) return <p className="faint small">Not enough weeks of sales to draw a trend.</p>;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.25 || hi * 0.1 || 1;
  const min = Math.max(0, lo - pad);
  const max = hi + pad;
  const x = (i: number) => 8 + (i * (w - 16)) / (points.length - 1);
  const y = (v: number) => h - 22 - ((v - min) / (max - min)) * (h - 40);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const step = Math.ceil(points.length / 6);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Units sold per week, latest ${last.value.toLocaleString("en-IN")}`}>
      {[0, 1, 2, 3].map((i) => {
        const gy = 18 + (i * (h - 40)) / 3;
        return <line key={i} x1="0" x2={w} y1={gy} y2={gy} stroke="var(--border)" />;
      })}
      <path d={`${line} L${x(points.length - 1)},${h - 22} L${x(0)},${h - 22} Z`} fill="rgb(74 222 128 / 0.12)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r="4.5" fill="var(--accent)" />
      {points.map((p, i) =>
        i % step === 0 || i === points.length - 1 ? (
          <text
            key={p.label}
            x={x(i)}
            y={h - 4}
            fontSize="10"
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            fill="currentColor"
          >
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function Donut({ parts, total, size = 136 }: { parts: { value: number; color: string }[]; total: number; size?: number }) {
  const r = 48;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 132 132" role="img" aria-label={`${total} SKUs`}>
      <circle r={r} cx="66" cy="66" fill="none" stroke="var(--surface-2)" strokeWidth="16" />
      {parts.map((p, i) => {
        const len = total ? (p.value / total) * c : 0;
        const el = len > 0 && (
          <circle
            key={i}
            r={r}
            cx="66"
            cy="66"
            fill="none"
            stroke={p.color}
            strokeWidth="16"
            strokeDasharray={`${Math.max(len - 2, 0.5)} ${c}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 66 66)"
          />
        );
        offset += len;
        return el;
      })}
      <text x="66" y="66" textAnchor="middle" fontSize="26" fontWeight="750" fill="var(--text)">{total}</text>
      <text x="66" y="84" textAnchor="middle" fontSize="11" fill="var(--text-3)">SKUs</text>
    </svg>
  );
}
