import { FLAG_LABEL, type Flag } from "@/lib/rules";
import type { GateStatus } from "@/lib/killCriteria";

const FLAG_ICON: Record<Flag, string> = {
  HIGH_DEMAND: "▲",
  STOCKOUT: "!",
  OVERSTOCK: "■",
  OK: "✓",
  JUDGMENT: "?",
};

export function FlagBadge({ flag }: { flag: Flag }) {
  return (
    <span className={`pill f-${flag}`} title={FLAG_LABEL[flag]}>
      <span className="dot" aria-hidden />
      <span aria-hidden>{FLAG_ICON[flag]}</span> {FLAG_LABEL[flag]}
    </span>
  );
}

const STATUS_LABEL: Record<GateStatus, string> = { ok: "OK", watch: "Watch", kill: "Kill", "no-data": "No data yet" };

export function StatusBadge({ status }: { status: GateStatus }) {
  return (
    <span className={`pill s-${status}`}>
      <span className="dot" aria-hidden /> {STATUS_LABEL[status]}
    </span>
  );
}
