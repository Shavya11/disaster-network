import type { SeverityTier } from '@dn/shared';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { STATUS_COLOR, TIER_COLOR, TIER_LABEL, rgba, type DisplayStatus } from '../lib/format';

export function Badge({ color, children, dot }: { color: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className="badge" style={{ color, background: rgba(color, 0.1), border: `1px solid ${rgba(color, 0.3)}` }}>
      {dot && <span className="badge-dot" style={{ background: color }} />}
      {children}
    </span>
  );
}

export const TierBadge = ({ tier }: { tier: SeverityTier }) => (
  <Badge color={TIER_COLOR[tier]} dot>
    {TIER_LABEL[tier]}
  </Badge>
);

export const StatusBadge = ({ status }: { status: DisplayStatus }) => <Badge color={STATUS_COLOR[status]}>{status}</Badge>;

export function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="status-chip" style={{ background: rgba(color, 0.16), color }}>
      {children}
    </span>
  );
}

export function Kpi({ label, value, sub, icon: Icon, color }: { label: string; value: ReactNode; sub: ReactNode; icon: LucideIcon; color: string }) {
  return (
    <div className="card kpi-card">
      <div className="kpi-top">
        <span className="eyebrow">{label}</span>
        <div className="icon-chip" style={{ width: 34, height: 34, background: `linear-gradient(135deg,${rgba(color, 0.22)},${rgba(color, 0.06)})` }}>
          <Icon size={17} color={color} />
        </div>
      </div>
      <span className="kpi-value">{value}</span>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

export const Spinner = ({ size = 14 }: { size?: number }) => <LoaderCircle size={size} className="spin" />;

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  return error ? <div className="login-error">{error}</div> : null;
}

export function SectionCard({ title, extra, children }: { title: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="card section-card">
      <div className="section-head">
        <span className="section-title">{title}</span>
        {extra}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}
