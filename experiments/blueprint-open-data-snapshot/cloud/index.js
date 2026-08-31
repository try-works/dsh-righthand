// blueprint/open-data-snapshot CLOUD version - Cloudflare Worker
// keyless USGS earthquake GeoJSON -> diffable snapshot (stable ids + generated meta)
// Endpoints: GET /snapshot?days=1&minmag=2.5  GET /health

const FEED = 'https://earthquake.usgs.gov/fdsnws/event/1/query';
const UA = 'rh-quakes (dsh-righthand test build)';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, at: new Date().toISOString() });
    if (url.pathname === '/snapshot') {
      const days = Math.min(Math.max(1, Number(url.searchParams.get('days') || 1)), 30);
      const minmag = Math.max(0, Number(url.searchParams.get('minmag') || 2.5));
      try {
        const start = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
        const r = await fetch(FEED + '?format=geojson&starttime=' + start + '&minmagnitude=' + minmag + '&orderby=time', {
          headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        const features = (j.features || []).map(f => {
          const p = f.properties || {};
          const c = (f.geometry || {}).coordinates || [];
          return { id: f.id, place: p.place, mag: p.mag, time: new Date(p.time).toISOString(), url: p.url, lon: c[0], lat: c[1], depthKm: c[2] };
        });
        return Response.json({ meta: { generated: new Date().toISOString(), windowDays: days, minmag, count: features.length, source: 'usgs' }, ids: features.map(f => f.id), features });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 502 });
      }
    }
    return Response.json({ error: 'not found', endpoints: ['/snapshot', '/health'] }, { status: 404 });
  },
};