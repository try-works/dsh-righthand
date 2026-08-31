// blueprint/rss-social-mirror CLOUD version - Cloudflare Worker
// keyless RSS with the 403/429 ladder: browser UA + Accept header, one backoff retry
// SSRF discipline: an allowlist, not an arbitrary url parameter
// Endpoints: GET /feed?src=reddit|lobsters  GET /health

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const SOURCES = {
  reddit: 'https://www.reddit.com/r/programming/.rss',
  lobsters: 'https://lobste.rs/rss',
};
const WINDOW_MS = 7 * 86400e3;

function decode(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").trim();
}

async function getText(src) {
  const target = SOURCES[src];
  const opts = { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, text/xml, */*' }, signal: AbortSignal.timeout(15000) };
  let r = await fetch(target, opts);
  if (r.status === 403 || r.status === 429) {
    await new Promise(res => setTimeout(res, 2000)); // ladder rung: backoff
    r = await fetch(target, opts);
  }
  if (!r.ok) throw new Error('HTTP ' + r.status + ' after ladder');
  return r.text();
}

function parseItems(xml) {
  // Reddit's .rss answers Atom (<entry>), Lobsters answers RSS 2.0 (<item>) -
  // parse both element shapes or a format drift silently yields zero items.
  const out = [];
  const bodies = [...xml.matchAll(/<(item|entry)([\s\S]*?)<\/\1>/g)].map(m => m[2]);
  for (const e of bodies) {
    const grab = (tag) => (e.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>')) || [])[1] || '';
    const title = decode(grab('title')).replace(/\s+/g, ' ');
    const link = decode(grab('link')) || (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    const guid = decode(grab('guid')) || decode(grab('id'));
    const pub = grab('pubDate') || grab('updated') || grab('dc:date');
    const ts = Date.parse(pub);
    if (!ts || ts < Date.now() - WINDOW_MS) continue;
    out.push({ id: guid || link, title, url: link, date: new Date(ts).toISOString() });
  }
  return out;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, at: new Date().toISOString() });
    if (url.pathname === '/feed') {
      const src = url.searchParams.get('src') || 'reddit';
      if (!(src in SOURCES)) return Response.json({ error: 'unknown source', allowed: Object.keys(SOURCES) }, { status: 400 });
      try {
        const xml = await getText(src);
        const items = parseItems(xml);
        const seen = new Set();
        const deduped = items.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });
        return Response.json({ meta: { generated: new Date().toISOString(), source: src, count: deduped.length }, items: deduped });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 502 });
      }
    }
    return Response.json({ error: 'not found', endpoints: ['/feed', '/health'] }, { status: 404 });
  },
};