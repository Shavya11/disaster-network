import { sql } from './db.js';

export const pointSql = (lon: number, lat: number) =>
  sql`st_setsrid(st_makepoint(${lon}, ${lat}), 4326)::geography`;

/** `{lat, lon}` JSON for a geography column, or null. Pass trusted column names only. */
export const latLonSql = (column: string) => {
  const c = sql.unsafe(column);
  return sql`case when ${c} is null then null
    else json_build_object('lat', st_y(${c}::geometry), 'lon', st_x(${c}::geometry)) end`;
};

export const distanceKmSql = (column: string, lon: number, lat: number) =>
  sql`round((st_distance(${sql.unsafe(column)}, ${pointSql(lon, lat)}) / 1000)::numeric, 2)::float8`;
