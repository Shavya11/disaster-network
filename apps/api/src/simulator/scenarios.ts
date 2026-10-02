import { randomUUID } from 'node:crypto';
import type { HazardType, SimulationResult } from '@dn/shared';
import { sql } from '../lib/db.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { correlateReport, correlateSignals, withCorrelationLock } from '../intelligence/correlate.js';

export const SIM_SOURCE = 'simulator';
const SIM_EMAIL_DOMAIN = 'sim.dn';
const SIM_USER_COUNT = 8;
const TAG = '[SIMULATION]';

interface SimSignal {
  hazard: HazardType;
  lat: number;
  lon: number;
  magnitude: number;
  title: string;
  minutesAgo?: number;
  /** For forecast-style signals: days from today (IST). */
  forecastDay?: number;
  payload: Record<string, unknown>;
}
interface SimReport {
  hazard: HazardType;
  lat: number;
  lon: number;
  description: string;
  people?: number;
  /** When the server received it. */
  minutesAgo: number;
  /** Written this long before it reached the server (queued on the phone with no signal). */
  offlineMinutes?: number;
}

/** Simulated feed data "arrived" this long ago, before the citizen reports. */
const SIGNAL_LEAD_MIN = 40;
interface Scenario {
  signals: SimSignal[];
  reports: SimReport[];
  closures: { coordinates: [number, number][]; reason: string }[];
  /** Where simulated citizens are placed (adds to exposure). */
  centre: { lat: number; lon: number };
}

const istDate = (daysFromToday: number) =>
  new Date(Date.now() + 5.5 * 3.6e6 + daysFromToday * 86_400_000).toISOString().slice(0, 10);

const SCENARIOS: Record<string, Scenario> = {
  'mumbai-flood': {
    centre: { lat: 19.072, lon: 72.88 },
    signals: [142, 186, 231].map((mm, day) => ({
      hazard: 'FLOOD',
      lat: 19.072,
      lon: 72.88,
      magnitude: mm,
      forecastDay: day,
      title: `${TAG} Heavy rain forecast in Mumbai (Kurla): ${mm} mm`,
      payload: { unit: 'mm', city: 'Mumbai', value: mm, forecast_date: istDate(day) },
    })),
    reports: [
      { hazard: 'FLOOD', lat: 19.0705, lon: 72.8795, description: 'Water knee-deep outside Kurla station', minutesAgo: 40 },
      { hazard: 'FLOOD', lat: 19.0748, lon: 72.8832, description: 'LBS Marg underpass flooded, cars stuck', people: 12, minutesAgo: 32 },
      { hazard: 'FLOOD', lat: 19.0662, lon: 72.8871, description: 'Ground floor homes taking water', people: 40, minutesAgo: 25 },
      { hazard: 'FLOOD', lat: 19.0791, lon: 72.8768, description: 'Mithi river very high near bridge', minutesAgo: 18 },
      { hazard: 'FLOOD', lat: 19.0689, lon: 72.8745, description: 'Buses stopped, road not visible', minutesAgo: 10 },
      { hazard: 'FLOOD', lat: 19.0731, lon: 72.8903, description: 'Elderly neighbours stranded on first floor', people: 6, minutesAgo: 5 },
    ],
    closures: [
      { coordinates: [[72.8791, 19.0716], [72.8812, 19.0751], [72.8836, 19.0789]], reason: `${TAG} LBS Marg flooded near Kurla` },
    ],
  },
  // Matches the RAKSHAK prototype story: Tapi basin flood, an offline SOS, a collapse on Ring Road, NH-48 closed.
  'surat-flood': {
    centre: { lat: 21.195, lon: 72.81 },
    signals: [118, 165, 212].map((mm, day) => ({
      hazard: 'FLOOD',
      lat: 21.1702,
      lon: 72.8311,
      magnitude: mm,
      forecastDay: day,
      title: `${TAG} Heavy rain forecast in Surat (Tapi basin): ${mm} mm`,
      payload: { unit: 'mm', city: 'Surat', value: mm, forecast_date: istDate(day) },
    })),
    reports: [
      { hazard: 'FLOOD', lat: 21.2045, lon: 72.7905, description: 'Tapi water entering homes in Adajan', people: 15, minutesAgo: 30 },
      // Submitted with no network; the timeline shows it synced later.
      { hazard: 'FLOOD', lat: 21.2189, lon: 72.7963, description: 'SOS — trapped on first floor, water rising', people: 6, minutesAgo: 3, offlineMinutes: 19 },
      { hazard: 'FLOOD', lat: 21.2240, lon: 72.8310, description: 'Katargam main road under water', minutesAgo: 14 },
      { hazard: 'FLOOD', lat: 21.1985, lon: 72.8120, description: 'Riverfront walkway submerged, people stranded', people: 20, minutesAgo: 8 },
      { hazard: 'BUILDING_COLLAPSE', lat: 21.1880, lon: 72.8290, description: 'Wall collapsed onto Ring Road', people: 4, minutesAgo: 12 },
      { hazard: 'BUILDING_COLLAPSE', lat: 21.1884, lon: 72.8296, description: 'Debris blocking Ring Road, two cars hit', minutesAgo: 10 },
      { hazard: 'BUILDING_COLLAPSE', lat: 21.1877, lon: 72.8285, description: 'Old building wall down near Ring Road', minutesAgo: 9 },
    ],
    closures: [
      { coordinates: [[72.9505, 21.2690], [72.9600, 21.2540], [72.9700, 21.2390]], reason: `${TAG} NH-48 near Kamrej — flooded, avoid` },
    ],
  },
  'delhi-earthquake': {
    centre: { lat: 28.656, lon: 77.231 },
    signals: [
      { hazard: 'EARTHQUAKE', lat: 28.652, lon: 77.236, magnitude: 5.8, minutesAgo: 20,
        title: `${TAG} M 5.8 - 3 km NE of Chandni Chowk, Delhi`, payload: { depth_km: 12, place: 'Delhi (simulated)' } },
      { hazard: 'EARTHQUAKE', lat: 28.671, lon: 77.214, magnitude: 4.7, minutesAgo: 6,
        title: `${TAG} M 4.7 aftershock - Delhi`, payload: { depth_km: 9, place: 'Delhi (simulated)' } },
    ],
    reports: [
      { hazard: 'BUILDING_COLLAPSE', lat: 28.6562, lon: 77.2310, description: 'Old 3-storey building collapsed', people: 25, minutesAgo: 15 },
      { hazard: 'BUILDING_COLLAPSE', lat: 28.6568, lon: 77.2318, description: 'People trapped under debris', people: 10, minutesAgo: 12 },
      { hazard: 'BUILDING_COLLAPSE', lat: 28.6559, lon: 77.2305, description: 'Collapse near the market lane', minutesAgo: 9 },
      { hazard: 'EARTHQUAKE', lat: 28.64, lon: 77.22, description: 'Strong shaking, cracks in walls', minutesAgo: 19 },
      { hazard: 'EARTHQUAKE', lat: 28.66, lon: 77.25, description: 'Felt very strongly, everyone outside', minutesAgo: 18 },
    ],
    closures: [],
  },
  'building-collapse': {
    centre: { lat: 19.2967, lon: 73.0631 },
    signals: [],
    reports: [
      { hazard: 'BUILDING_COLLAPSE', lat: 19.2967, lon: 73.0631, description: 'Building collapsed in Bhiwandi', people: 30, minutesAgo: 14 },
      { hazard: 'BUILDING_COLLAPSE', lat: 19.2972, lon: 73.0636, description: 'Loud crash, dust everywhere', minutesAgo: 12 },
      { hazard: 'BUILDING_COLLAPSE', lat: 19.2961, lon: 73.0627, description: 'Families trapped, need rescue', people: 8, minutesAgo: 8 },
      { hazard: 'GAS_LEAK', lat: 19.2969, lon: 73.0640, description: 'Smell of gas near the collapse', minutesAgo: 6 },
    ],
    closures: [],
  },
};

/** Synthetic citizens so simulated reports never mix with real accounts. */
async function ensureSimUsers(centre: { lat: number; lon: number }): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= SIM_USER_COUNT; i++) {
    const email = `sim-citizen-${i}@${SIM_EMAIL_DOMAIN}`;
    const [existing] = await sql<{ id: string }[]>`select id from auth.users where email = ${email}`;
    let id = existing?.id;
    if (!id) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: `Simulated Citizen ${i}` },
      });
      if (error || !data.user) throw new Error(`Could not create simulated user: ${error?.message}`);
      id = data.user.id;
    }
    // Spread them ~1 km around the scenario centre.
    const lat = centre.lat + (Math.random() - 0.5) * 0.02;
    const lon = centre.lon + (Math.random() - 0.5) * 0.02;
    await sql`
      update public.profiles
      set last_location = st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography, location_updated_at = now()
      where id = ${id}
    `;
    ids.push(id);
  }
  return ids;
}

export async function runScenario(name: string, actorId: string): Promise<SimulationResult> {
  const s = SCENARIOS[name];
  if (!s) throw new Error(`Unknown scenario ${name}`);
  const runId = Date.now().toString(36);
  const users = await ensureSimUsers(s.centre);

  for (const [i, sig] of s.signals.entries()) {
    const occurredAt = sig.forecastDay != null
      ? new Date(`${istDate(sig.forecastDay)}T00:00:00+05:30`)
      : new Date(Date.now() - (sig.minutesAgo ?? 0) * 60_000);
    await sql`
      insert into public.raw_signals
        (source, source_event_id, hazard_type, location, magnitude, title, occurred_at, payload, ingested_at)
      values (${SIM_SOURCE}, ${`${name}-${runId}-${i}`}, ${sig.hazard},
              st_setsrid(st_makepoint(${sig.lon}, ${sig.lat}), 4326)::geography,
              ${sig.magnitude}, ${sig.title}, ${occurredAt},
              ${sql.json({ ...sig.payload, simulated: true, scenario: name } as never)},
              ${new Date(Date.now() - Math.max(SIGNAL_LEAD_MIN, sig.minutesAgo ?? 0) * 60_000)})
    `;
  }
  // Correlation also picks up any real signals waiting to be processed, so only incidents
  // holding this run's own signals count as simulated.
  await correlateSignals();
  const fromSignals = await sql<{ incident_id: string }[]>`
    select distinct incident_id from public.raw_signals
    where source = ${SIM_SOURCE} and source_event_id like ${`${name}-${runId}-%`} and incident_id is not null
  `;
  const incidentIds = new Set(fromSignals.map((r) => r.incident_id));

  for (const [i, r] of s.reports.entries()) {
    const incidentId = await withCorrelationLock(async (db) => {
      const [row] = await db<{ id: string }[]>`
        insert into public.reports
          (user_id, hazard_type, location, description, people_affected, client_generated_id, reported_at, received_at)
        values (${users[i % users.length]!}, ${r.hazard},
                st_setsrid(st_makepoint(${r.lon}, ${r.lat}), 4326)::geography,
                ${`${TAG} ${r.description}`}, ${r.people ?? null}, ${randomUUID()},
                ${new Date(Date.now() - (r.minutesAgo + (r.offlineMinutes ?? 0)) * 60_000)},
                ${new Date(Date.now() - r.minutesAgo * 60_000)})
        returning id
      `;
      return correlateReport(db, row!.id);
    });
    incidentIds.add(incidentId);
  }

  const firstIncident = [...incidentIds][0] ?? null;
  for (const c of s.closures) {
    await sql`
      insert into public.blocked_roads (segment, reason, incident_id, marked_by)
      values (st_setsrid(st_geomfromgeojson(${JSON.stringify({ type: 'LineString', coordinates: c.coordinates })}), 4326)::geography,
              ${c.reason}, ${firstIncident}, ${actorId})
    `;
  }

  // Incidents opened by the simulator are labelled so nobody mistakes them for real events,
  // and backdated to their first evidence so the timeline reads in order.
  await sql`
    update public.incidents i set
      title = case when i.title like ${TAG + '%'} then i.title else ${TAG} || ' ' || i.title end,
      created_at = least(i.created_at,
        coalesce((select min(s.ingested_at) from public.raw_signals s where s.incident_id = i.id), i.created_at),
        coalesce((select min(r.received_at) from public.reports r where r.incident_id = i.id), i.created_at))
    where i.id in ${sql([...incidentIds])}
  `;

  return {
    scenario: name,
    signals_created: s.signals.length,
    reports_created: s.reports.length,
    incident_ids: [...incidentIds],
  };
}

/** Remove everything the simulator created. Audit entries are kept (append-only by design). */
export async function clearSimulation() {
  const result = await deleteSimulationData();

  // Real reports/signals that had merged into a simulated incident are re-correlated.
  const orphans = await sql<{ id: string }[]>`
    select id from public.reports where incident_id is null and received_at > now() - interval '7 days'
  `;
  for (const r of orphans) await withCorrelationLock((db) => correlateReport(db, r.id));
  await correlateSignals();
  return { ...result, relinked_reports: orphans.length };
}

async function deleteSimulationData(): Promise<{ incidents: number; signals: number; reports: number; closures: number }> {
  return sql.begin(async (tx) => {
    const simUsers = tx`select id from auth.users where email like ${'%@' + SIM_EMAIL_DOMAIN}`;
    const incidents = await tx`
      delete from public.incidents i
      where exists (select 1 from public.raw_signals s where s.incident_id = i.id and s.source = ${SIM_SOURCE})
         or exists (select 1 from public.reports r where r.incident_id = i.id and r.user_id in (${simUsers}))
      returning id
    `;
    // Their assignments went with them (on delete cascade); free the teams they had tied up.
    await tx`
      update public.teams t set status = 'AVAILABLE'
      where t.status = 'ASSIGNED'
        and not exists (
          select 1 from public.assignments a
          where a.team_id = t.id and a.status in ('ASSIGNED', 'ACKNOWLEDGED', 'EN_ROUTE', 'ON_SCENE')
        )
    `;
    const closures = await tx`delete from public.blocked_roads where reason like ${TAG + '%'} returning id`;
    const signals = await tx`delete from public.raw_signals where source = ${SIM_SOURCE} returning id`;
    const reports = await tx`delete from public.reports where user_id in (${simUsers}) returning id`;
    return {
      incidents: incidents.count,
      signals: signals.count,
      reports: reports.count,
      closures: closures.count,
    };
  });
}
