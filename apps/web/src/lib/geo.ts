import type { GeoJSONPolygon, LatLon } from '@dn/shared';

/** A closed polygon approximating a circle, GeoJSON [lon, lat] order. */
export function circlePolygon(center: LatLon, radiusKm: number, steps = 48): GeoJSONPolygon {
  const ring: number[][] = [];
  const dLat = radiusKm / 110.574;
  const dLon = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([+(center.lon + dLon * Math.cos(a)).toFixed(6), +(center.lat + dLat * Math.sin(a)).toFixed(6)]);
  }
  ring.push(ring[0]!);
  return { type: 'Polygon', coordinates: [ring] };
}

export function distanceKm(a: LatLon, b: LatLon): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Browser position, or null if unavailable/denied within the timeout. */
export function currentPosition(timeoutMs = 8000): Promise<LatLon | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
