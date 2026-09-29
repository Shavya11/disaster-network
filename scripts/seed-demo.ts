// Seeds response teams, resource depots and shelters (imported once from OpenStreetMap). Safe to re-run.
import postgres from 'postgres';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL must be set');
const sql = postgres(DATABASE_URL, { prepare: false, max: 1 });

const pt = (lon: number, lat: number) => sql`st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography`;

// ---------------------------------------------------------------- teams
const teams = [
  { name: 'Mumbai Fire Brigade - Byculla', type: 'FIRE', lat: 18.9793, lon: 72.8330, members: 12 },
  { name: 'Mumbai Fire Brigade - Andheri', type: 'FIRE', lat: 19.1197, lon: 72.8468, members: 10 },
  { name: 'BMC Disaster Response - Kurla', type: 'SEARCH_RESCUE', lat: 19.0728, lon: 72.8826, members: 15 },
  { name: 'NDRF 5th Battalion - Mumbai', type: 'NDRF', lat: 19.0330, lon: 72.8990, members: 30 },
  { name: '108 Ambulance - Dadar', type: 'MEDICAL', lat: 19.0178, lon: 72.8478, members: 4 },
  { name: 'Mumbai Police QRT - Bandra', type: 'POLICE', lat: 19.0596, lon: 72.8295, members: 8 },
  { name: 'Civil Defence Volunteers - Thane', type: 'VOLUNTEER', lat: 19.2183, lon: 72.9781, members: 20 },
  { name: 'Delhi Fire Service - Connaught Place', type: 'FIRE', lat: 28.6315, lon: 77.2167, members: 12 },
  { name: 'NDRF 8th Battalion - Ghaziabad', type: 'NDRF', lat: 28.6692, lon: 77.4538, members: 35 },
  { name: 'CATS Ambulance - Chandni Chowk', type: 'MEDICAL', lat: 28.6506, lon: 77.2303, members: 4 },
];
for (const t of teams) {
  await sql`
    insert into public.teams (name, type, base_location, member_count)
    values (${t.name}, ${t.type}, ${pt(t.lon, t.lat)}, ${t.members})
    on conflict (name) do nothing
  `;
}
// The demo responder belongs to the Kurla rescue team.
await sql`
  update public.profiles set team_id = (select id from public.teams where name = 'BMC Disaster Response - Kurla')
  where id = (select id from auth.users where email = 'responder@demo.dn')
`;
console.log(`Teams: ${teams.length}`);

// ---------------------------------------------------------------- resources
const depots = [
  { depot: 'BMC Central Store - Parel', lat: 19.0008, lon: 72.8416 },
  { depot: 'NDRF Store - Andheri East', lat: 19.1136, lon: 72.8697 },
  { depot: 'Delhi DDMA Warehouse - Shastri Park', lat: 28.6720, lon: 77.2540 },
];
const kit = [
  { type: 'boat', name: 'Inflatable rescue boat', unit: 'boats', qty: [6, 10, 2] },
  { type: 'water', name: 'Drinking water (20 L)', unit: 'cans', qty: [800, 400, 600] },
  { type: 'food', name: 'Dry ration kit', unit: 'kits', qty: [1200, 500, 900] },
  { type: 'medical', name: 'First-aid kit', unit: 'kits', qty: [300, 150, 250] },
  { type: 'shelter', name: 'Family tent', unit: 'tents', qty: [150, 80, 200] },
  { type: 'pump', name: 'Dewatering pump', unit: 'pumps', qty: [20, 8, 6] },
  { type: 'rescue', name: 'Hydraulic cutter set', unit: 'sets', qty: [4, 6, 5] },
];
let resourceCount = 0;
for (const [d, depot] of depots.entries()) {
  for (const k of kit) {
    const q = k.qty[d]!;
    const [exists] = await sql`select 1 from public.resources where name = ${k.name} and depot_name = ${depot.depot}`;
    if (exists) continue;
    await sql`
      insert into public.resources (type, name, unit, quantity, available, depot_name, location)
      values (${k.type}, ${k.name}, ${k.unit}, ${q}, ${q}, ${depot.depot}, ${pt(depot.lon, depot.lat)})
    `;
    resourceCount++;
  }
}
console.log(`Resources added: ${resourceCount}`);

// ---------------------------------------------------------------- shelters from OpenStreetMap
// Capacities are not in OSM; these are stated estimates for the demo.
const CAPACITY_ESTIMATE: Record<string, number> = { hospital: 150, shelter: 300, school: 400, community_centre: 250 };

interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

// The main Overpass server is often overloaded; fall back to public mirrors.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

async function overpass(query: string): Promise<{ elements: OsmElement[] }> {
  const errors: string[] = [];
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'disaster-network/0.1 (student project)' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) return (await res.json()) as { elements: OsmElement[] };
      errors.push(`${new URL(url).host}: HTTP ${res.status}`);
    } catch (err) {
      errors.push(`${new URL(url).host}: ${(err as Error).message}`);
    }
  }
  throw new Error(errors.join('; '));
}

async function importArea(label: string, lat: number, lon: number, radiusM: number) {
  const around = `(around:${radiusM},${lat},${lon})`;
  const query = `[out:json][timeout:60];
(
  nwr["amenity"="hospital"]${around};
  nwr["emergency"="assembly_point"]${around};
  nwr["social_facility"="shelter"]${around};
  nwr["amenity"="community_centre"]${around};
);
out center 400;`;
  const { elements } = await overpass(query);

  let added = 0;
  for (const e of elements) {
    const p = e.center ?? (e.lat != null && e.lon != null ? { lat: e.lat, lon: e.lon } : null);
    const name = e.tags?.name ?? e.tags?.['name:en'];
    if (!p || !name) continue;
    const t = e.tags!;
    const kind = t.amenity === 'hospital' ? 'hospital' : t.amenity === 'community_centre' ? 'community_centre' : 'shelter';
    const facilities = [
      kind === 'hospital' ? 'medical' : null,
      t.emergency === 'yes' ? 'emergency' : null,
      t.wheelchair === 'yes' ? 'wheelchair' : null,
    ].filter((f): f is string => f != null);
    const beds = Number(t.beds ?? t.capacity);
    const capacity = Number.isFinite(beds) && beds > 0 ? beds : CAPACITY_ESTIMATE[kind]!;

    const r = await sql`
      insert into public.shelters (name, kind, location, capacity, facilities, contact_phone, osm_id)
      values (${name}, ${kind}, ${pt(p.lon, p.lat)}, ${capacity}, ${facilities},
              ${t.phone ?? t['contact:phone'] ?? null}, ${`${e.type}/${e.id}`})
      on conflict (osm_id) do nothing
      returning id
    `;
    added += r.count;
  }
  console.log(`Shelters ${label}: ${elements.length} from OSM, ${added} new`);
}

for (const [label, lat, lon] of [['Mumbai', 19.076, 72.8777], ['Delhi', 28.6448, 77.2167]] as const) {
  try {
    await importArea(label, lat, lon, 15000);
  } catch (err) {
    console.warn(`Shelter import for ${label} failed (${(err as Error).message}); re-run later.`);
  }
}

await sql.end();
