// blueprint/paper-digest CLOUD version - Cloudflare Worker
// keyless arXiv Atom API -> normalized JSON entries, diffable by arxiv id
// Endpoints: GET /papers?q=...&n=5  GET /health

const API = 'https://export.arxiv.org/api/query';
const UA = 'rh-arxiv (dsh-righthand test build)';

function decode(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function grab(entry, tag) {
  const m = entry.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>'));
  return m ? decode(m[1]) : '';
}

function parseEntries(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const link = (e.match(/<id>([^<]+)<\/id>/) || [])[1] || '';
    out.push({
      id: link.replace(/^.*\/abs\//, ''),
      title: grab(e, 'title').replace(/\s+/g, ' '),
      summary: grab(e, 'summary').replace(/\s+/g, ' '),
      published: grab(e, 'published'),
      authors: [...e.matchAll(/<name>([^<]+)<\/name>/g)].map(x => decode(x[1])),
      link,
    });
  }
  return out;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, at: new Date().toISOString() });
    if (url.pathname === '/papers') {
      const q = (url.searchParams.get('q') || 'agent').slice(0, 200);
      const n = Math.min(Math.max(1, Number(url.searchParams.get('n') || 5)), 20);
      try {
        const r = await fetch(API + '?search_query=all:' + encodeURIComponent(q) + '&start=0&max_results=' + n + '&sortBy=submittedDate&sortOrder=descending', {
          headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000), redirect: 'follow',
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const entries = parseEntries(await r.text());
        return Response.json({ meta: { generated: new Date().toISOString(), query: q, count: entries.length, source: 'arxiv' }, entries });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 502 });
      }
    }
    return Response.json({ error: 'not found', endpoints: ['/papers', '/health'] }, { status: 404 });
  },
};