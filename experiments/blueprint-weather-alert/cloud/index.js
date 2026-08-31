// blueprint/weather-alert CLOUD version - Cloudflare Worker
// keyless Open-Meteo forecast -> threshold crossings; cron scheduled handler runs the same check
// Endpoints: GET /check?lat=&lon=&tmin=&tmax=&wmax=  GET /health

const API = 'https://api.open-meteo.com/v1/forecast';
const DEFAULT = { lat: 51.5007, lon: -0.1246 };

async function getForecast(lat, lon) {
  const r = await fetch(API + '?latitude=' + lat + '&longitude=' + lon + '&current_weather=true&daily=temperature_2m_max,temperature_2m_min&forecast_days=3', { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function crossings(f, t) {
  const out = [];
  const cur = f.current_weather || {};
  const max = (f.daily || {}).temperature_2m_max || [];
  const min = (f.daily || {}).temperature_2m_min || [];
  const day = (f.daily || {}).time || [];
  if (t.tmax != null && max[0] != null && max[0] >= t.tmax) out.push({ param: 'tmax', value: max[0], threshold: t.tmax, at: day[0] });
  if (t.tmin != null && min[0] != null && min[0] <= t.tmin) out.push({ param: 'tmin', value: min[0], threshold: t.tmin, at: day[0] });
  if (t.wmax != null && cur.windspeed != null && cur.windspeed >= t.wmax) out.push({ param: 'wind', value: cur.windspeed, threshold: t.wmax, at: cur.time });
  return out;
}

async function check(lat, lon, thresholds) {
  const f = await getForecast(lat, lon);
  return { meta: { generated: new Date().toISOString(), lat, lon, timezone: f.timezone }, crossings: crossings(f, thresholds) };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, at: new Date().toISOString() });
    if (url.pathname === '/check') {
      const num = (k, dflt) => { const v = url.searchParams.get(k); return v === null ? dflt : Number(v); };
      const lat = num('lat', DEFAULT.lat);
      const lon = num('lon', DEFAULT.lon);
      const thresholds = { tmax: num('tmax', null), tmin: num('tmin', null), wmax: num('wmax', null) };
      try {
        return Response.json(await check(lat, lon, thresholds));
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 502 });
      }
    }
    return Response.json({ error: 'not found', endpoints: ['/check', '/health'] }, { status: 404 });
  },
  async scheduled(_event, env, ctx) {
    // the cron escalation: run the same check with configured defaults; delivery is the
    // agent's rh_events_due + rh_notify_send, this handler only computes crossings.
    const thresholds = { tmax: Number(env.TMAX || 30), tmin: Number(env.TMIN || 0), wmax: Number(env.WMAX || 50) };
    ctx.waitUntil((async () => {
      try { const r = await check(DEFAULT.lat, DEFAULT.lon, thresholds); console.log('[scheduled] crossings=' + r.crossings.length); }
      catch (e) { console.error('[scheduled] ' + String(e)); }
    })());
  },
};