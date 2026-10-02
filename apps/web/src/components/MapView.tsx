import type { BlockedRoad, GeoJSONPolygon, Incident, LatLon, Shelter, Team } from '@dn/shared';
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Box, Maximize, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { C, HAZARD_LABEL, TIER_COLOR, TIER_LABEL, displayStatus } from '../lib/format';

// Free, keyless vector tiles (OpenFreeMap / OpenStreetMap data).
const STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
const INDIA: { center: [number, number]; zoom: number } = { center: [78.9, 22.6], zoom: 3.9 };

export type LayerKey = 'incidents' | 'responders' | 'shelters' | 'roads';
const LAYER_IDS: Record<LayerKey, string[]> = {
  incidents: ['inc-halo', 'inc-dot', 'inc-label', 'inc-selected'],
  responders: ['team-icon'],
  shelters: ['shelter-icon'],
  roads: ['road-casing', 'road-line'],
};

export interface MapViewProps {
  incidents?: Incident[];
  teams?: Team[];
  shelters?: Shelter[];
  roads?: BlockedRoad[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Polygon to outline: the selected incident's area or a draft alert zone. */
  area?: GeoJSONPolygon | null;
  areaColor?: string;
  route?: [number, number][] | null;
  routeBlocked?: boolean;
  user?: LatLon | null;
  /** Where to start; defaults to all of India. */
  initialView?: { center: [number, number]; zoom: number };
  /** When this value changes, the map fits to `fitPoints`. */
  fitKey?: string;
  fitPoints?: LatLon[];
  showLayerToggles?: boolean;
  hint?: string;
  children?: React.ReactNode;
}

const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;

function warmTint(style: StyleSpecification): StyleSpecification {
  for (const layer of style.layers) {
    const paint = (layer as { paint?: Record<string, unknown> }).paint;
    if (!paint) continue;
    if (layer.type === 'background') paint['background-color'] = '#110e0a';
    else if (layer.id === 'water') paint['fill-color'] = '#0d1519';
    else if (layer.id === 'waterway') paint['line-color'] = '#0d1519';
    else if (layer.id === 'building') paint['fill-color'] = '#1b1610';
    else if (layer.type === 'line' && /road|highway|bridge|tunnel/.test(layer.id)) paint['line-color'] = '#2b2419';
    else if (layer.type === 'line' && /boundary/.test(layer.id)) paint['line-color'] = '#4a3e2c';
    else if (layer.type === 'symbol' && 'text-color' in paint) paint['text-color'] = '#8a7f6e';
  }
  return style;
}

/** Canvas-drawn marker images (diamond for teams, square for shelters) in the legend's shapes. */
function shapeImage(kind: 'diamond' | 'square', fill: string, size = 22): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = fill;
  g.strokeStyle = '#15120E';
  g.lineWidth = 2;
  g.beginPath();
  if (kind === 'diamond') {
    const m = size / 2;
    g.moveTo(m, 2);
    g.lineTo(size - 2, m);
    g.lineTo(m, size - 2);
    g.lineTo(2, m);
  } else {
    g.roundRect(4, 4, size - 8, size - 8, 3);
  }
  g.closePath();
  g.fill();
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

export function MapView(props: MapViewProps) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ incidents: true, responders: true, shelters: true, roads: true });
  const [pitched, setPitched] = useState(false);
  const onSelect = useRef(props.onSelect);
  onSelect.current = props.onSelect;
  const initial = props.initialView ?? INDIA;

  // ---- create the map once
  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;
    fetch(STYLE_URL)
      .then((r) => r.json() as Promise<StyleSpecification>)
      .catch(() => null)
      .then((style) => {
        if (cancelled || !holder.current) return;
        if (!style) return setFailed(true);
        map = new maplibregl.Map({
          container: holder.current,
          style: warmTint(style),
          center: initial.center,
          zoom: initial.zoom,
          attributionControl: { compact: true },
          maxPitch: 70,
        });
        mapRef.current = map;
        map.on('load', () => setup(map!));
      });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setup(map: MLMap) {
    map.addImage('rk-diamond', shapeImage('diamond', C.primary));
    map.addImage('rk-square', shapeImage('square', C.nominal));
    map.addImage('rk-square-full', shapeImage('square', C.warning));
    for (const id of ['area', 'roads', 'route', 'incidents', 'teams', 'shelters', 'user']) map.addSource(id, { type: 'geojson', data: empty });

    map.addLayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': '#2a2218',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.85,
        },
      },
      map.getStyle().layers.find((l) => l.type === 'symbol')?.id,
    );

    map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 } });
    map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'road-casing', type: 'line', source: 'roads', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#15120E', 'line-width': 8 } });
    map.addLayer({ id: 'road-line', type: 'line', source: 'roads', layout: { 'line-cap': 'round' }, paint: { 'line-color': C.critical, 'line-width': 4, 'line-dasharray': [1.5, 1] } });
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'shelter-icon', type: 'symbol', source: 'shelters', layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 12, 0.85], 'icon-allow-overlap': true } });
    map.addLayer({ id: 'team-icon', type: 'symbol', source: 'teams', layout: { 'icon-image': 'rk-diamond', 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 1], 'icon-allow-overlap': true } });
    map.addLayer({
      id: 'inc-halo',
      type: 'circle',
      source: 'incidents',
      paint: { 'circle-color': ['get', 'color'], 'circle-radius': 16, 'circle-opacity': ['case', ['get', 'pulse'], 0.25, 0.12], 'circle-blur': 0.4 },
    });
    map.addLayer({
      id: 'inc-selected',
      type: 'circle',
      source: 'incidents',
      filter: ['==', ['get', 'selected'], true],
      paint: { 'circle-radius': 13, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#F7F1E8', 'circle-stroke-width': 2 },
    });
    map.addLayer({
      id: 'inc-dot',
      type: 'circle',
      source: 'incidents',
      paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 5, 10, 8], 'circle-stroke-color': '#15120E', 'circle-stroke-width': 1.5 },
    });
    map.addLayer({
      id: 'inc-label',
      type: 'symbol',
      source: 'incidents',
      minzoom: 6,
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.5], 'text-anchor': 'top' },
      paint: { 'text-color': '#F7F1E8', 'text-halo-color': '#15120E', 'text-halo-width': 1.5 },
    });
    map.addLayer({ id: 'user-dot', type: 'circle', source: 'user', paint: { 'circle-radius': 7, 'circle-color': C.watch, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });

    // Hover tooltips and click-to-select.
    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'map-pop', offset: 12 });
    for (const layer of ['inc-dot', 'team-icon', 'shelter-icon', 'road-line']) {
      map.on('mouseenter', layer, (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features?.[0];
        if (f) tip.setLngLat(e.lngLat).setHTML(String(f.properties.tip)).addTo(map);
      });
      map.on('mousemove', layer, (e) => tip.setLngLat(e.lngLat));
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
        tip.remove();
      });
    }
    map.on('click', 'inc-dot', (e) => {
      const id = e.features?.[0]?.properties.id;
      if (id) onSelect.current?.(String(id));
    });

    // Beacon pulse on urgent incidents.
    let frame = 0;
    const animate = (t: number) => {
      if (!map.getLayer('inc-halo')) return;
      const k = (t % 1600) / 1600;
      map.setPaintProperty('inc-halo', 'circle-radius', ['case', ['get', 'pulse'], 10 + 16 * k, 14]);
      map.setPaintProperty('inc-halo', 'circle-opacity', ['case', ['get', 'pulse'], 0.45 * (1 - k), 0.12]);
      frame = requestAnimationFrame(animate);
    };
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) frame = requestAnimationFrame(animate);
    map.once('remove', () => cancelAnimationFrame(frame));
    setReady(true);
  }

  // ---- data → sources
  const set = (id: string, data: GeoJSON.FeatureCollection) => (mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(data);

  useEffect(() => {
    if (!ready) return;
    set('incidents', {
      type: 'FeatureCollection',
      features: (props.incidents ?? []).map((i) => {
        const st = displayStatus(i);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [i.epicenter.lon, i.epicenter.lat] },
          properties: {
            id: i.id,
            label: i.reference,
            color: st === 'RESOLVED' || st === 'DISMISSED' ? C.faint : TIER_COLOR[i.severity_tier],
            pulse: (i.severity_tier === 'EMERGENCY' || i.severity_tier === 'WARNING') && st !== 'RESOLVED' && st !== 'DISMISSED',
            selected: i.id === props.selectedId,
            tip: `<b>${esc(i.reference)} · ${TIER_LABEL[i.severity_tier]}</b><br>${esc(i.title)}<br><span class="faint">${esc(HAZARD_LABEL[i.hazard_type])} · ${st}${i.place_name ? ' · ' + esc(i.place_name) : ''}</span>`,
          },
        };
      }),
    });
  }, [ready, props.incidents, props.selectedId]);

  useEffect(() => {
    if (!ready) return;
    set('teams', {
      type: 'FeatureCollection',
      features: (props.teams ?? []).map((t) => {
        const at = t.current_location ?? t.base_location;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [at.lon, at.lat] },
          properties: { tip: `<b>${esc(t.name)}</b><br>${t.type.replace('_', ' ')} · ${t.member_count} personnel<br><span class="faint">${t.status}${t.current_location ? '' : ' · at base'}</span>` },
        };
      }),
    });
  }, [ready, props.teams]);

  useEffect(() => {
    if (!ready) return;
    set('shelters', {
      type: 'FeatureCollection',
      features: (props.shelters ?? []).map((s) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.location.lon, s.location.lat] },
        properties: {
          icon: s.status === 'OPEN' ? 'rk-square' : 'rk-square-full',
          tip: `<b>${esc(s.name)}</b><br>${esc(s.kind.replace('_', ' '))} · ${s.status}<br><span class="faint">${s.current_occupancy} / ${s.capacity} occupied</span>`,
        },
      })),
    });
  }, [ready, props.shelters]);

  useEffect(() => {
    if (!ready) return;
    set('roads', {
      type: 'FeatureCollection',
      features: (props.roads ?? []).filter((r) => r.active).map((r) => ({ type: 'Feature', geometry: r.segment, properties: { tip: `<b>Road blocked</b><br>${esc(r.reason)}` } })),
    });
  }, [ready, props.roads]);

  useEffect(() => {
    if (!ready) return;
    set('area', props.area ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: props.area, properties: { color: props.areaColor ?? C.primary } }] } : empty);
  }, [ready, props.area, props.areaColor]);

  useEffect(() => {
    if (!ready) return;
    set('route', props.route ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: props.route }, properties: { color: props.routeBlocked ? C.warning : C.watch } }] } : empty);
  }, [ready, props.route, props.routeBlocked]);

  useEffect(() => {
    if (!ready) return;
    set('user', props.user ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [props.user.lon, props.user.lat] }, properties: {} }] } : empty);
  }, [ready, props.user]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const [k, ids] of Object.entries(LAYER_IDS)) for (const id of ids) map.setLayoutProperty(id, 'visibility', layers[k as LayerKey] ? 'visible' : 'none');
  }, [ready, layers]);

  // Fly to the selected incident.
  useEffect(() => {
    const map = mapRef.current;
    const inc = props.incidents?.find((i) => i.id === props.selectedId);
    if (!ready || !map || !inc) return;
    map.flyTo({ center: [inc.epicenter.lon, inc.epicenter.lat], zoom: Math.max(map.getZoom(), 9), speed: 1.4 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.selectedId]);

  // Fit to a set of points when fitKey changes.
  useEffect(() => {
    const map = mapRef.current;
    const pts = props.fitPoints ?? [];
    if (!ready || !map || pts.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    for (const p of pts) b.extend([p.lon, p.lat]);
    map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 800 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, props.fitKey]);

  // Declared after the fitKey effect so a selected area wins on first load.
  // Bring the outlined area (selected incident or draft alert zone) into view when it changes shape.
  const ring = props.area?.coordinates[0];
  const areaKey = ring ? `${props.areaColor}:${ring.length}:${ring[0]}:${ring[Math.floor(ring.length / 2)]}` : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !ring) return;
    const b = new maplibregl.LngLatBounds();
    for (const [lon, lat] of ring) b.extend([lon!, lat!]);
    map.fitBounds(b, { padding: 50, maxZoom: 13, duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, areaKey]);

  const zoom = (d: number) => mapRef.current?.easeTo({ zoom: (mapRef.current?.getZoom() ?? 5) + d });
  const reset = () => {
    setPitched(false);
    mapRef.current?.flyTo({ ...initial, pitch: 0, bearing: 0 });
  };
  const toggle3d = () => {
    const next = !pitched;
    setPitched(next);
    mapRef.current?.easeTo({ pitch: next ? 55 : 0, bearing: next ? -15 : 0, duration: 900 });
  };

  return (
    <div className="map-wrap">
      <div className="map-holder" ref={holder} />
      {!ready && (
        <div className="map-loading">
          {failed ? (
            <div className="map-loading-text">Map tiles unavailable — check your connection</div>
          ) : (
            <>
              <div className="map-loading-spin" />
              <div className="map-loading-text">Loading map…</div>
            </>
          )}
        </div>
      )}
      {props.children}
      <div className="map-controls">
        <button className="map-ctrl-btn" onClick={() => zoom(1)} title="Zoom in" aria-label="Zoom in"><Plus size={16} /></button>
        <button className="map-ctrl-btn" onClick={() => zoom(-1)} title="Zoom out" aria-label="Zoom out"><Minus size={16} /></button>
        <button className={`map-ctrl-btn${pitched ? ' on' : ''}`} onClick={toggle3d} title="Tilt to 3D" aria-label="Toggle 3D view"><Box size={15} /></button>
        <button className="map-ctrl-btn" onClick={reset} title="Reset view" aria-label="Reset view"><Maximize size={15} /></button>
      </div>
      {props.showLayerToggles && (
        <div className="map-layers">
          {(Object.keys(LAYER_IDS) as LayerKey[]).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ ...layers, [k]: e.target.checked })} />
              {k === 'roads' ? 'Blocked roads' : k[0]!.toUpperCase() + k.slice(1)}
            </label>
          ))}
        </div>
      )}
      {props.hint && <div className="map-hint">{props.hint}</div>}
    </div>
  );
}
