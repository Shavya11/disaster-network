import type { AssignmentStatus, HazardType, Incident, SeverityTier, UserRole } from '@dn/shared';
import {
  Activity,
  Building2,
  CloudLightning,
  Construction,
  Flame,
  HeartPulse,
  Mountain,
  Siren,
  Thermometer,
  TriangleAlert,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react';

export const C = {
  primary: '#FF7A29',
  primary2: '#FFA94D',
  watch: '#5B8DEF',
  warning: '#FFC53D',
  critical: '#F0453A',
  nominal: '#3DDC84',
  signal: '#3DD9C7',
  dim: '#AB9F8C',
  faint: '#71685A',
  line: '#3A3122',
};

export const TIER_COLOR: Record<SeverityTier, string> = {
  EMERGENCY: C.critical,
  WARNING: C.warning,
  WATCH: C.watch,
  INFO: C.signal,
};

export const TIER_LABEL: Record<SeverityTier, string> = {
  EMERGENCY: 'EMERGENCY',
  WARNING: 'WARNING',
  WATCH: 'WATCH',
  INFO: 'ADVISORY',
};

export const TIER_ORDER: SeverityTier[] = ['INFO', 'WATCH', 'WARNING', 'EMERGENCY'];
export const tierRank = (t: SeverityTier) => TIER_ORDER.indexOf(t);

export const HAZARD_ICON: Record<HazardType, LucideIcon> = {
  EARTHQUAKE: Activity,
  FLOOD: Waves,
  CYCLONE: Wind,
  STORM: CloudLightning,
  WILDFIRE: Flame,
  HEATWAVE: Thermometer,
  LANDSLIDE: Mountain,
  BUILDING_COLLAPSE: Building2,
  GAS_LEAK: Siren,
  MEDICAL: HeartPulse,
  FIRE: Flame,
  ROAD_BLOCKAGE: Construction,
  OTHER: TriangleAlert,
};

export const HAZARD_LABEL: Record<HazardType, string> = {
  EARTHQUAKE: 'Earthquake',
  FLOOD: 'Flood',
  CYCLONE: 'Cyclone',
  STORM: 'Storm',
  WILDFIRE: 'Wildfire',
  HEATWAVE: 'Heatwave',
  LANDSLIDE: 'Landslide',
  BUILDING_COLLAPSE: 'Building collapse',
  GAS_LEAK: 'Gas leak',
  MEDICAL: 'Medical emergency',
  FIRE: 'Fire',
  ROAD_BLOCKAGE: 'Road blocked',
  OTHER: 'Other',
};

export type DisplayStatus = 'UNVERIFIED' | 'MONITORING' | 'VERIFIED' | 'RESOLVED' | 'DISMISSED';

/** Prototype wording for the incident lifecycle (API-CONTRACT §4a). */
export function displayStatus(i: Pick<Incident, 'status' | 'origin' | 'alert_permission'>): DisplayStatus {
  switch (i.status) {
    case 'REPORTED':
      return i.origin === 'citizen' || tierRank(i.alert_permission) >= tierRank('WARNING') ? 'UNVERIFIED' : 'MONITORING';
    case 'RESOLVED':
      return 'RESOLVED';
    case 'REJECTED':
      return 'DISMISSED';
    default:
      return 'VERIFIED';
  }
}

export const STATUS_COLOR: Record<DisplayStatus, string> = {
  UNVERIFIED: C.critical,
  MONITORING: C.dim,
  VERIFIED: C.nominal,
  RESOLVED: C.faint,
  DISMISSED: C.faint,
};

export const TASK_LABEL: Record<AssignmentStatus, string> = {
  ASSIGNED: 'New task',
  ACKNOWLEDGED: 'Accepted',
  EN_ROUTE: 'On the way',
  ON_SCENE: 'Arrived',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const TASK_COLOR: Record<AssignmentStatus, string> = {
  ASSIGNED: C.primary,
  ACKNOWLEDGED: C.warning,
  EN_ROUTE: C.watch,
  ON_SCENE: C.signal,
  COMPLETED: C.nominal,
  CANCELLED: C.faint,
};

/** Next step for the responder's "Advance status" button. */
export const TASK_NEXT: Partial<Record<AssignmentStatus, { status: AssignmentStatus; label: string }>> = {
  ASSIGNED: { status: 'ACKNOWLEDGED', label: 'Accept task' },
  ACKNOWLEDGED: { status: 'EN_ROUTE', label: 'On the way' },
  EN_ROUTE: { status: 'ON_SCENE', label: 'Arrived on scene' },
  ON_SCENE: { status: 'COMPLETED', label: 'Mark completed' },
};

export const ROLE_LABEL: Record<UserRole, string> = {
  CITIZEN: 'Citizen',
  RESPONDER: 'Responder',
  COORDINATOR: 'Coordinator',
  ADMIN: 'Administrator',
};

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const timeFmt = new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export const hhmm = (iso: string) => timeFmt.format(new Date(iso));

/** "09:32" for today, "2 Oct, 09:32" otherwise. */
export function when(iso: string): string {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? timeFmt.format(d) : dateTimeFmt.format(d);
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const num = (n: number) => n.toLocaleString('en-IN');

export function initials(name: string | null | undefined): string {
  return (name ?? '?')
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
