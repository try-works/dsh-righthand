import { describe, it, expect, vi, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { weatherTools, isBlockedIP, guardedFetch } from '../src/index.ts'
import { normalizeForecast, normalizeAir } from '../src/weather-tools.ts'

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

describe('isBlockedIP (SSRF checklist)', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.0.0.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['224.0.0.1', true],
    ['0.0.0.0', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['::1', true],
    ['::', true],
    ['fc00::1', true],
    ['fe80::1', true],
    ['ff02::1', true],
    ['2606:4700:4700::1111', false],
  ])('blocks %s -> %s', (ip, blocked) => {
    expect(isBlockedIP(ip)).toBe(blocked)
  })
})

describe('guardedFetch', () => {
  it('refuses a host that resolves to a private address', async () => {
    await expect(guardedFetch('https://example.test/data', {
      resolve: async () => ['10.0.0.5'],
      fetchImpl: (async () => { throw new Error('must not fetch') }) as unknown as typeof fetch,
    })).rejects.toThrow(/not a public host/)
  })

  it('follows one redirect and revalidates the next hop', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: any, opts: any) => {
      calls.push(String(url))
      if (String(url).startsWith('https://first.test')) {
        return new Response(null, { status: 302, headers: { location: 'https://second.test/data' } })
      }
      return new Response('{"ok":true}', { status: 200 })
    }) as unknown as typeof fetch
    const body = await guardedFetch('https://first.test/start', { fetchImpl, resolve: async () => ['8.8.8.8'] })
    expect(body).toBe('{"ok":true}')
    expect(calls).toEqual(['https://first.test/start', 'https://second.test/data'])
  })

  it('refuses a redirect onto a private address', async () => {
    const fetchImpl = (async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.9/x' } })) as unknown as typeof fetch
    await expect(guardedFetch('https://first.test/start', {
      fetchImpl,
      resolve: async (host: string) => host.startsWith('10.') ? ['10.0.0.9'] : ['8.8.8.8'],
    })).rejects.toThrow(/not a public host/)
  })
})

describe('normalizers', () => {
  it('normalizeForecast maps the Open-Meteo wire shape', () => {
    const out = normalizeForecast({
      latitude: 51.5, longitude: -0.1, timezone: 'GMT',
      current_weather: { time: '2026-08-30T12:00', temperature: 17.5, windspeed: 12.2, winddirection: 220, weathercode: 2 },
      daily: { time: ['2026-08-30', '2026-08-31'], temperature_2m_max: [20.1, 19.0], temperature_2m_min: [12.0, 11.5] },
    })
    expect(out.current?.temperature).toBe(17.5)
    expect(out.daily.temperatureMax).toEqual([20.1, 19.0])
  })

  it('normalizeAir maps PM2.5/PM10/AQI', () => {
    const out = normalizeAir({ latitude: 51.5, longitude: -0.1, current: { time: '2026-08-30T12:00', pm2_5: 8.2, pm10: 12.4, european_aqi: 32 } })
    expect(out).toEqual({ latitude: 51.5, longitude: -0.1, time: '2026-08-30T12:00', pm2_5: 8.2, pm10: 12.4, aqi: 32 })
  })
})

describe('rh_weather_* tools (stubbed network)', () => {
  it('forecast + air round-trip through the guarded fetcher', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'rh-weather-'))
    vi.stubGlobal('fetch', (async (url: any) => {
      const u = String(url)
      if (u.startsWith('https://open-meteo.test/forecast')) {
        return new Response(JSON.stringify({
          latitude: 51.5, longitude: -0.1, timezone: 'GMT',
          current_weather: { time: '2026-08-30T12:00', temperature: 17.5, windspeed: 12.2, winddirection: 220, weathercode: 2 },
          daily: { time: ['2026-08-30'], temperature_2m_max: [20.1], temperature_2m_min: [12.0] },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ latitude: 51.5, longitude: -0.1, current: { time: '2026-08-30T12:00', pm2_5: 8.2, pm10: 12.4, european_aqi: 32 } }), { status: 200 })
    }) as unknown as typeof fetch)

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(weatherTools, { forecastUrl: 'https://open-meteo.test/forecast', airUrl: 'https://open-meteo.test/air' })

    const f = await call(ctx, 'rh_weather_forecast', { latitude: 51.5, longitude: -0.1 })
    expect(f.isError).toBe(false)
    expect((f.value as any).current.temperature).toBe(17.5)
    expect((f.value as any).daily.temperatureMax).toEqual([20.1])

    const a = await call(ctx, 'rh_weather_air', { latitude: 51.5, longitude: -0.1 })
    expect(a.isError).toBe(false)
    expect((a.value as any).pm2_5).toBe(8.2)
    expect((a.value as any).aqi).toBe(32)
  })
})
