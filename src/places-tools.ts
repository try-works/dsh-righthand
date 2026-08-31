/**
 * places-tools - the second keyless data-adapter family (after weather).
 * Geocoding, reverse geocoding and nearby search over Nominatim
 * (OpenStreetMap, keyless), elevation over Open-Meteo (keyless).
 *
 * Every request goes through guardedFetch (the SSRF checklist from
 * blueprint/data-adapter); Nominatim requests carry a User-Agent per its
 * usage policy (max 1 req/s - agent-paced calls only).
 * @module dsh-righthand/places-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { guardedFetch } from './weather-tools.ts'
import { genCall, genResult } from './cards.ts'

export const name = 'righthand-places'
export const inject = ['tools']

export interface PlacesConfig {
  /** Nominatim endpoint; default https://nominatim.openstreetmap.org (keyless). */
  nominatimUrl?: string
  /** Open-Meteo elevation endpoint; default https://api.open-meteo.com/v1/elevation (keyless). */
  elevationUrl?: string
  /** User-Agent sent with Nominatim requests (its usage policy requires one). */
  userAgent?: string
}

const DEFAULTS: Required<PlacesConfig> = {
  nominatimUrl: 'https://nominatim.openstreetmap.org',
  elevationUrl: 'https://api.open-meteo.com/v1/elevation',
  userAgent: 'dsh-righthand (agent data adapter)',
}

/** The stable place shape callers see - the wire JSON is Nominatim's. */
export interface PlaceOut {
  name: string
  lat: number
  lon: number
  displayName: string
  category: string
  type: string
  address: Record<string, string>
}

/** Normalize one Nominatim result (search or reverse) to PlaceOut. */
export function normalizePlace(raw: any): PlaceOut {
  const address: Record<string, string> = {}
  if (raw !== null && typeof raw === 'object' && raw.address !== null && typeof raw.address === 'object') {
    for (const [k, v] of Object.entries(raw.address)) {
      if (typeof v === 'string') address[k] = v
    }
  }
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    lat: Number(raw.lat ?? 0),
    lon: Number(raw.lon ?? 0),
    displayName: typeof raw.display_name === 'string' ? raw.display_name : '',
    category: typeof raw.category === 'string' ? raw.category : '',
    type: typeof raw.type === 'string' ? raw.type : '',
    address,
  }
}

export function normalizePlaces(raw: any): PlaceOut[] {
  if (!Array.isArray(raw)) return []
  return raw.map(normalizePlace)
}

/** Normalize the Open-Meteo elevation response { elevation: [8.0] }. */
export interface ElevationOut {
  elevation: number
}

export function normalizeElevation(raw: any): ElevationOut {
  const arr = Array.isArray(raw.elevation) ? raw.elevation : []
  return { elevation: Number(arr[0] ?? 0) }
}

/** Haversine distance in km between two lat/lon pairs. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const sLat = Math.sin(dLat / 2)
  const sLon = Math.sin(dLon / 2)
  const a = sLat * sLat + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * sLon * sLon
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * The Nominatim viewbox for a radius around a point, as
 * left,top,right,bottom (lon,lat pairs) - the order the API expects.
 */
export function nearbyViewbox(latitude: number, longitude: number, radiusKm: number): string {
  const dy = radiusKm / 110.57
  const cos = Math.cos(latitude * Math.PI / 180)
  const dx = radiusKm / (111.32 * (cos === 0 ? 1 : cos))
  const left = longitude - dx
  const top = latitude + dy
  const right = longitude + dx
  const bottom = latitude - dy
  return [left, top, right, bottom].map(v => v.toFixed(6)).join(',')
}

export function apply(ctx: Context, config: PlacesConfig = {}): void {
  const cfg: Required<PlacesConfig> = { ...DEFAULTS, ...config }

  const nomHeaders = { 'User-Agent': cfg.userAgent }

  ctx.tools.register(defineTool({
    name: 'rh_places_geocode',
    description: 'Geocode a place query with Nominatim (OpenStreetMap, keyless): text in, ranked places out. Covers search too. Respects the 1 req/s public usage policy - agent-paced calls only.',
    parameters: {
      query: { type: 'string', required: true, description: 'Free-text place query, e.g. "big ben london" or "Eiffel Tower".' },
      limit: { type: 'integer', description: 'Max results, default 5 (max 20).' },
    },
    output: {
      schema: { type: 'array', items: { type: 'json' } },
      render: (_args, value) => {
        const arr = value as any[]
        const text = arr.length === 0 ? '(no places found)' : arr.length + ' place(s): ' + arr.map(p => p.name !== '' ? p.name : p.displayName).join('; ')
        return [{ type: 'text', text }]
      },
    },
    presentCall: (args: any) => genCall('Places: ' + args.query, 'search'),
    presentResult: (_args, result) => genResult(result),
    async execute(args) {
      const limit = Math.min(Math.max(1, Math.round(args.limit ?? 5)), 20)
      const qs = new URLSearchParams({ q: args.query, format: 'jsonv2', addressdetails: '1', limit: String(limit) })
      const body = await guardedFetch(cfg.nominatimUrl + '/search?' + qs.toString(), { init: { headers: nomHeaders } })
      return normalizePlaces(JSON.parse(body)) as any[]
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_places_address',
    description: 'Reverse geocode a lat/lon with Nominatim (OpenStreetMap, keyless): coordinates in, the closest address out.',
    parameters: {
      latitude: { type: 'number', required: true, description: 'Latitude.' },
      longitude: { type: 'number', required: true, description: 'Longitude.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          lat: { type: 'number', required: true },
          lon: { type: 'number', required: true },
          displayName: { type: 'string', required: true },
          category: { type: 'string', required: true },
          type: { type: 'string', required: true },
          address: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.displayName }],
    },
    presentCall: (args: any) => genCall('Reverse geocode ' + args.latitude + ', ' + args.longitude, 'fetch'),
    presentResult: (_args, result) => genResult(result),
    async execute(args) {
      const qs = new URLSearchParams({ lat: String(args.latitude), lon: String(args.longitude), format: 'jsonv2', addressdetails: '1' })
      const body = await guardedFetch(cfg.nominatimUrl + '/reverse?' + qs.toString(), { init: { headers: nomHeaders } })
      const raw = JSON.parse(body)
      if (raw.error) throw new Error('Nominatim: ' + raw.error)
      return normalizePlace(raw) as any
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_places_elevation',
    description: 'Elevation at a lat/lon from Open-Meteo (keyless), in metres.',
    parameters: {
      latitude: { type: 'number', required: true, description: 'Latitude.' },
      longitude: { type: 'number', required: true, description: 'Longitude.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          latitude: { type: 'number', required: true },
          longitude: { type: 'number', required: true },
          elevation: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.elevation + ' m' }],
    },
    presentCall: (args: any) => genCall('Elevation at ' + args.latitude + ', ' + args.longitude, 'fetch'),
    presentResult: (_args, result) => genResult(result),
    async execute(args) {
      const qs = new URLSearchParams({ latitude: String(args.latitude), longitude: String(args.longitude) })
      const body = await guardedFetch(cfg.elevationUrl + '?' + qs.toString())
      const out = normalizeElevation(JSON.parse(body))
      return { latitude: args.latitude, longitude: args.longitude, elevation: out.elevation }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_places_nearby',
    description: 'Places matching a query within radiusKm of a point (Nominatim bounded search, keyless): results sorted nearest first with distanceKm attached.',
    parameters: {
      query: { type: 'string', required: true, description: 'What to look for, e.g. "cafe" or "pharmacy".' },
      latitude: { type: 'number', required: true, description: 'Centre latitude.' },
      longitude: { type: 'number', required: true, description: 'Centre longitude.' },
      radiusKm: { type: 'number', description: 'Search radius, default 1 (min 0.1, max 20).' },
      limit: { type: 'integer', description: 'Max results, default 5 (max 20).' },
    },
    output: {
      schema: { type: 'array', items: { type: 'json' } },
      render: (_args, value) => {
        const arr = value as any[]
        const text = arr.length === 0 ? '(no nearby places)' : arr.map((p: any) => (p.name !== '' ? p.name : p.displayName) + ' (' + p.distanceKm.toFixed(1) + ' km)').join('; ')
        return [{ type: 'text', text }]
      },
    },
    presentCall: (args: any) => genCall('Nearby: ' + args.query + ' within ' + (args.radiusKm ?? 1) + ' km', 'search'),
    presentResult: (_args, result) => genResult(result),
    async execute(args) {
      const radius = Math.min(Math.max(0.1, Number(args.radiusKm ?? 1)), 20)
      const limit = Math.min(Math.max(1, Math.round(args.limit ?? 5)), 20)
      const qs = new URLSearchParams({
        q: args.query,
        viewbox: nearbyViewbox(args.latitude, args.longitude, radius),
        bounded: '1',
        format: 'jsonv2',
        addressdetails: '1',
        limit: String(limit),
      })
      const body = await guardedFetch(cfg.nominatimUrl + '/search?' + qs.toString(), { init: { headers: nomHeaders } })
      return normalizePlaces(JSON.parse(body))
        .map(p => ({ ...p, distanceKm: distanceKm(args.latitude, args.longitude, p.lat, p.lon) }))
        .sort((a, b) => a.distanceKm - b.distanceKm) as any[]
    },
  }))
}