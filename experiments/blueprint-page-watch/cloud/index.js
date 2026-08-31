// blueprint/page-watch CLOUD version - Cloudflare Worker
// fingerprint a page: fetch, normalize volatile bits, SHA-256 via WebCrypto.
// Stateless by design: the Worker returns the fingerprint; the CALLER (rh_store) diffs.
// SSRF discipline: an allowlist of pages, not an arbitrary url parameter.
// Endpoints: GET /watch?url=example|w3  GET /health

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGES = {
  example: 'https://example.com',
  w3: 'https://www.w3.org/',
};

async function fingerprint(target) {
  const r = await fetch(target, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  let html = await r.text();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { hash, bytes: html.length, title: title.replace(/\s+/g, ' ').trim(), at: new Date().toISOString() };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, at: new Date().toISOString() });
    if (url.pathname === '/watch') {
      const key = url.searchParams.get('url') || 'example';
      if (!(key in PAGES)) return Response.json({ error: 'unknown page', allowed: Object.keys(PAGES) }, { status: 400 });
      try {
        const f = await fingerprint(PAGES[key]);
        return Response.json({ meta: { page: key, url: PAGES[key] }, fingerprint: f });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 502 });
      }
    }
    return Response.json({ error: 'not found', endpoints: ['/watch', '/health'] }, { status: 404 });
  },
};