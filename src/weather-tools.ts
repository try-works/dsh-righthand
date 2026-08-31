/**
 * weather-tools — the worked example of the keyless data-adapter recipe
 * (blueprint/data-adapter). Two tools over Open-Meteo, a keyless API:
 *   rh_weather_forecast — current conditions + 3-day min/max
 *   rh_weather_air      — PM2.5 / PM10 / European AQI
 *
 * Every request goes through guardedFetch, the SSRF checklist from Mu's
 * safefetch: public destinations only (loopback, private, link-local incl.
 * the metadata address, multicast and unspecified are refused), every
 * redirect hop revalidated, response size and time capped.
 * @module dsh-righthand/weather-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { genCall, genResult } from './cards.ts'

export const name = 'righthand-weather'
export const inject = ['tools']

export interface WeatherConfig {
  /** Endpoint URLs; defaults are Open-Meteo (keyless). Tests override these. */
  forecastUrl?: string
  airUrl?: string
}

const DEFAULTS: Required<WeatherConfig> = {
  forecastUrl: 'https://api.open-meteo.com/v1/forecast',
  airUrl: 'https://air-quality-api.open-meteo.com/v1/air-quality',
}

const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5
const FETCH_TIMEOUT_MS = 10000

/**
 * Whether an IP must not be reached: the Mu safefetch set — loopback,
 * RFC1918 private, ULA, link-local (169.254/16, fe80::/10 — which includes
 * the 169.254.169.254 metadata address), multicast, and unspecified.
 */
export function isBlockedIP(ip: string): boolean {
  if (ip === '') return true
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a >= 224 && a <= 239) return true
    return false
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::' || lower === '::1') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true
    if (lower.startsWith('ff')) return true
    return false
  }
  return true
}

/**
 * Fetch one URL with the SSRF checklist. `fetchImpl` and `resolve` are
 * injectable for tests; production uses the globals.
 */
export interface GuardedFetchInit {
  method?: string
  body?: string
  headers?: Record<string, string>
}

export async function guardedFetch(
  url: string,
  deps: { fetchImpl?: typeof fetch; resolve?: (host: string) => Promise<string[]>; init?: GuardedFetchInit } = {},
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const resolve = deps.resolve ?? (async (host: string) => (await lookup(host, { all: true })).map(a => a.address))

  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('blocked: non-http(s) URL')
    const ips = await resolve(parsed.hostname)
    if (ips.length === 0 || ips.some(isBlockedIP)) throw new Error('blocked: destination is not a public host')
    const res = await fetchImpl(current, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'manual', method: deps.init?.method ?? 'GET', body: deps.init?.body, headers: deps.init?.headers })
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      if (next === null) throw new Error('blocked: redirect without location')
      current = new URL(next, current).toString()
      continue
    }
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + current)
    const reader = res.body?.getReader()
    if (reader === undefined) return ''
    const chunks: Uint8Array[] = []
    let bytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.length
      if (bytes > MAX_BODY_BYTES) throw new Error('response exceeds ' + MAX_BODY_BYTES + ' bytes')
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  throw new Error('too many redirects')
}

/**
 * Normalize the Open-Meteo forecast response into a stable digest shape:
 * what changed is the wire JSON; what callers see is this.
 */
export interface ForecastOut {
  latitude: number
  longitude: number
  timezone: string
  current: { time: string; temperature: number; windspeed: number; winddirection: number; weathercode: number } | null
  daily: { time: string[]; temperatureMax: number[]; temperatureMin: number[] }
}

export function normalizeForecast(json: any): ForecastOut {
  const cw = json.current_weather
  return {
    latitude: Number(json.latitude ?? 0),
    longitude: Number(json.longitude ?? 0),
    timezone: json.timezone ?? '',
    current: cw ? {
      time: String(cw.time ?? ''),
      temperature: Number(cw.temperature ?? 0),
      windspeed: Number(cw.windspeed ?? 0),
      winddirection: Number(cw.winddirection ?? 0),
      weathercode: Number(cw.weathercode ?? 0),
    } : null,
    daily: {
      time: (json.daily?.time ?? []).map(String),
      temperatureMax: (json.daily?.temperature_2m_max ?? []).map(Number),
      temperatureMin: (json.daily?.temperature_2m_min ?? []).map(Number),
    },
  }
}

/** Normalize the Open-Meteo air-quality response. */
export interface AirOut {
  latitude: number
  longitude: number
  time: string
  pm2_5: number | null
  pm10: number | null
  aqi: number | null
}

export function normalizeAir(json: any): AirOut {
  const c = json.current ?? {}
  const num = (v: unknown): number | null => (v === undefined || v === null ? null : Number(v))
  return {
    latitude: Number(json.latitude ?? 0),
    longitude: Number(json.longitude ?? 0),
    time: String(c.time ?? ''),
    pm2_5: num(c.pm2_5),
    pm10: num(c.pm10),
    aqi: num(c.european_aqi),
  }
}

export function apply(ctx: Context, config: WeatherConfig = {}): void {
  const cfg: Required<WeatherConfig> = { ...DEFAULTS, ...config }

  ctx.tools.register(defineTool({
    name: 'rh_weather_forecast',
    description: 'Weather forecast for a location from Open-Meteo (keyless): current conditions plus 3 days of min/max temperatures.',
    parameters: {
      latitude: { type: 'number', required: true, description: 'Latitude, e.g. 51.5074 for London.' },
      longitude: { type: 'number', required: true, description: 'Longitude, e.g. -0.1278 for London.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          latitude: { type: 'number', required: true },
          longitude: { type: 'number', required: true },
          timezone: { type: 'string', required: true },
          current: { type: 'json' },
          daily: { type: 'json', required: true },
        },
      },
      render: (_args, value) => { const c = value.current as any; return [{ type: 'text', text: c ? (value.timezone + ': ' + c.temperature + ' C, wind ' + c.windspeed + ' km/h') : value.timezone + ': current conditions unavailable' }] },
    },
    presentCall: (args: any) => genCall('Weather at ' + args.latitude + ', ' + args.longitude, 'fetch'),
    presentResult: (_args, result) => genResult(result),
    async execute(args) {
      const url = cfg.forecastUrl
        + '?latitude=' + args.latitude
        + '&longitude=' + args.longitude
        + '&current_weather=true&daily=temperature_2m_max,temperature_2m_min&forecast_days=3'
      const body = await guardedFetch(url)
      return normalizeForecast(JSON.parse(body))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'rh_weather_air',
    description: 'Air quality at a location from Open-Meteo (keyless): PM2.5, PM10 and the European AQI.',
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
          time: { type: 'string', required: true },
          pm2_5: { type: 'number' },
          pm10: { type: 'number' },
          aqi: { type: 'number' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: 'PM2.5 ' + value.pm2_5 + ', PM10 ' + value.pm10 + ', AQI ' + value.aqi }],
    },
    presentCall: (args: any) => genCall('Air quality at ' + args.latitude + ', ' + args.longitude, 'fetch'),
    presentResult: (_args, result) => genResult(result),
    async execute(args) {
      const url = cfg.airUrl
        + '?latitude=' + args.latitude
        + '&longitude=' + args.longitude
        + '&current=pm2_5,pm10,european_aqi'
      const body = await guardedFetch(url)
      const out = normalizeAir(JSON.parse(body))
      return {
        latitude: out.latitude,
        longitude: out.longitude,
        time: out.time,
        ...out.pm2_5 !== null ? { pm2_5: out.pm2_5 } : {},
        ...out.pm10 !== null ? { pm10: out.pm10 } : {},
        ...out.aqi !== null ? { aqi: out.aqi } : {},
      }
    },
  }))
}


