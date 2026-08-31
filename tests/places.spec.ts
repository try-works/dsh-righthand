import { describe, it, expect, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { placesTools } from '../src/index.ts'
import { normalizePlace, normalizePlaces, normalizeElevation, distanceKm, nearbyViewbox } from '../src/places-tools.ts'

// All DNS answers resolve to a public IP in tests.
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '8.8.8.8' }],
}))

const contexts: Context[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const ctx of contexts.splice(0)) await (ctx as any).dispose?.()
})

function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({ callId: ('t-' + name) as any, name, arguments: args, signal: new AbortController().signal })
}

// Real shapes captured from live keyless probes on 2026-08-31.
const BIG_BEN = {
  place_id: 280657512, osm_type: 'node', osm_id: 1802652184,
  lat: '51.5007042', lon: '-0.1245721', category: 'amenity', type: 'clock', place_rank: 30,
  importance: 9.307927061870783e-05, addresstype: 'amenity', name: 'Big Ben',
  display_name: 'Big Ben, Bridge Street, Westminster, Millbank, City of Westminster, Greater London, England, SW1A 2JR, United Kingdom',
  address: { amenity: 'Big Ben', road: 'Bridge Street', quarter: 'Westminster', suburb: 'Millbank', city: 'City of Westminster', state: 'England', postcode: 'SW1A 2JR', country: 'United Kingdom', country_code: 'gb' },
  boundingbox: ['51.5006542', '51.5007542', '-0.1246221', '-0.1245221'],
}

const NEARBY = [
  { place_id: 278533501, osm_type: 'node', osm_id: 653124873, lat: '51.5087508', lon: '-0.1254965', category: 'amenity', type: 'cafe', name: 'Social Bite', display_name: 'Social Bite, 448, Strand, London, United Kingdom', address: { amenity: 'Social Bite', road: 'Strand', city: 'City of Westminster', country: 'United Kingdom' } },
  { place_id: 290946035, osm_type: 'node', osm_id: 581058547, lat: '51.5072749', lon: '-0.1288860', category: 'amenity', type: 'pub', name: 'The Admiralty', display_name: 'The Admiralty, 66, Trafalgar Square, London, United Kingdom', address: { amenity: 'The Admiralty', road: 'Trafalgar Square', city: 'City of Westminster', country: 'United Kingdom' } },
]

describe('normalizers (real captured shapes)', () => {
  it('normalizePlace maps the Nominatim wire shape', () => {
    const out = normalizePlace(BIG_BEN)
    expect(out.name).toBe('Big Ben')
    expect(out.lat).toBe(51.5007042)
    expect(out.lon).toBe(-0.1245721)
    expect(out.category).toBe('amenity')
    expect(out.type).toBe('clock')
    expect(out.address.road).toBe('Bridge Street')
    expect(out.displayName.startsWith('Big Ben, Bridge Street')).toBe(true)
  })

  it('normalizePlace tolerates a missing name', () => {
    const out = normalizePlace({ lat: '1.5', lon: '2.5', display_name: 'x' })
    expect(out.name).toBe('')
    expect(out.lat).toBe(1.5)
  })

  it('normalizePlaces maps arrays and tolerates non-arrays', () => {
    expect(normalizePlaces(NEARBY)).toHaveLength(2)
    expect(normalizePlaces({ not: 'an array' })).toEqual([])
  })

  it('normalizeElevation maps { elevation: [8.0] }', () => {
    expect(normalizeElevation({ elevation: [8.0] })).toEqual({ elevation: 8 })
    expect(normalizeElevation({})).toEqual({ elevation: 0 })
  })
})

describe('distance and viewbox', () => {
  it('distanceKm: Big Ben to Trafalgar Square is about 0.79 km', () => {
    expect(distanceKm(51.5007, -0.1246, 51.50727, -0.12889)).toBeCloseTo(0.79, 1)
  })

  it('nearbyViewbox brackets the point and grows with radius', () => {
    const v = nearbyViewbox(51.5, -0.12, 1).split(',').map(Number)
    expect(v).toHaveLength(4)
    const [left, top, right, bottom] = v
    expect(left).toBeLessThan(-0.12)
    expect(right).toBeGreaterThan(-0.12)
    expect(bottom).toBeLessThan(51.5)
    expect(top).toBeGreaterThan(51.5)
    expect(top - 51.5).toBeCloseTo(1 / 110.57, 5)
    const big = nearbyViewbox(51.5, -0.12, 4).split(',').map(Number)
    expect(big[2] - big[0]).toBeGreaterThan(v[2] - v[0])
  })
})

describe('rh_places_* tools (stubbed network)', () => {
  it('geocode/address/elevation/nearby round-trip through the guarded fetcher', async () => {
    const seen: { url: string; headers?: Record<string, string> }[] = []
    vi.stubGlobal('fetch', (async (url: any, opts: any) => {
      const u = String(url)
      seen.push({ url: u, headers: opts?.headers })
      if (u.includes('/reverse?')) return new Response(JSON.stringify(BIG_BEN), { status: 200 })
      if (u.startsWith('https://elevation.test')) return new Response(JSON.stringify({ elevation: [8.0] }), { status: 200 })
      if (u.includes('/search?')) {
        if (u.includes('bounded=1')) return new Response(JSON.stringify(NEARBY), { status: 200 })
        return new Response(JSON.stringify([BIG_BEN]), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }) as unknown as typeof fetch)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(placesTools, { nominatimUrl: 'https://nominatim.test', elevationUrl: 'https://elevation.test', userAgent: 'places.test-agent' })

    const g = await call(ctx, 'rh_places_geocode', { query: 'big ben london' })
    expect(g.isError).toBe(false)
    expect((g.value as any)[0].name).toBe('Big Ben')
    expect((g.value as any)[0].lat).toBe(51.5007042)
    const gUrl = seen.find(s => s.url.includes('/search?') && !s.url.includes('bounded=1'))?.url ?? ''
    expect(gUrl).toContain('format=jsonv2')
    expect(gUrl).toContain('q=big+ben+london')
    expect(seen.find(s => s.url.includes('/search?'))?.headers?.['User-Agent']).toBe('places.test-agent')

    const a = await call(ctx, 'rh_places_address', { latitude: 51.5007, longitude: -0.1246 })
    expect(a.isError).toBe(false)
    expect((a.value as any).name).toBe('Big Ben')
    expect((a.value as any).displayName.startsWith('Big Ben')).toBe(true)

    const e = await call(ctx, 'rh_places_elevation', { latitude: 51.5007, longitude: -0.1246 })
    expect(e.isError).toBe(false)
    expect((e.value as any).elevation).toBe(8)
    expect((e.value as any).latitude).toBe(51.5007)

    const n = await call(ctx, 'rh_places_nearby', { query: 'cafe', latitude: 51.5074, longitude: -0.1277, radiusKm: 1 })
    expect(n.isError).toBe(false)
    const nUrl = seen.find(s => s.url.includes('bounded=1'))?.url ?? ''
    expect(nUrl).toContain('bounded=1')
    expect(nUrl).toContain('viewbox=')
    const arr = n.value as any[]
    expect(arr).toHaveLength(2)
    expect(arr[0].name).toBe('The Admiralty')
    expect(typeof arr[0].distanceKm).toBe('number')
    expect(arr[0].distanceKm).toBeLessThan(arr[1].distanceKm)
  })

  it('reverse geocode surfaces a Nominatim error cleanly', async () => {
    vi.stubGlobal('fetch', (async () => new Response(JSON.stringify({ error: 'Unable to geocode' }), { status: 200 })) as unknown as typeof fetch)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(placesTools, { nominatimUrl: 'https://nominatim.test', elevationUrl: 'https://elevation.test' })
    const r = await call(ctx, 'rh_places_address', { latitude: 0, longitude: 0 })
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r.error)).toContain('Unable to geocode')
  })
})