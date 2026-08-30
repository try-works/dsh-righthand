// blueprint/daily-digest CLOUD version — Cloudflare Worker
// gather (HN front page + Google News RSS) -> extractive summarize -> emit
// Endpoints: GET /digest  GET /health

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const WINDOW_MS = 7 * 86400e3;

async function getText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function gatherHN() {
  // NOTE: HN front page no longer uses class="titlelink" (selector brittleness found locally) — use Algolia instead
  const j = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=10', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) }).then(r => r.json());
  return (j.hits || []).map((h, i) => ({ id: 'hn:' + h.objectID, source: 'hn', title: h.title || '', url: h.url || ('https://news.ycombinator.com/item?id=' + h.objectID), date: h.created_at_i ? new Date(h.created_at_i * 1000).toISOString() : null, snippet: '' }));
}

async function gatherNews() {
  const q = encodeURIComponent('technology OR cloud OR AI');
  const xml = await getText('https://news.google.com/rss/search?q=' + q + '&hl=en-US&gl=US&ceid=US:en');
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const e = m[1];
    const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = (e.match(/<link>([^<]+)<\/link>/) || [])[1] || '';
    const pub = (e.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || '';
    const ts = Date.parse(pub);
    if (!ts || ts < Date.now() - WINDOW_MS) continue;
    out.push({ id: 'news:' + link, source: 'news', title, url: link, date: pub, snippet: '' });
  }
  return out.slice(0, 10);
}

function tokenize(s) {
  const stop = new Set(['the','and','for','are','was','with','that','this','have','from','into','about']);
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
}

function summarize(articles, topN = 5) {
  const corpus = articles.map(a => a.title).join(' ');
  const toks = tokenize(corpus);
  const freq = new Map();
  for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
  const scored = articles.map(a => {
    const s = tokenize(a.title).reduce((sum, t) => sum + (freq.get(t) || 0), 0);
    return { sentence: a.title, score: s, from: a.source + ':' + a.id };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ ok: true, at: new Date().toISOString() });
    if (url.pathname === '/digest') {
      const articles = [];
      try { articles.push(...await gatherHN()); } catch (e) {}
      try { articles.push(...await gatherNews()); } catch (e) {}
      const top = summarize(articles);
      return Response.json({
        meta: { generated: new Date().toISOString(), source_count: articles.length, hn_count: articles.filter(a => a.source === 'hn').length, news_count: articles.filter(a => a.source === 'news').length },
        digest: top,
      });
    }
    return Response.json({ error: 'not found', endpoints: ['/digest', '/health'] }, { status: 404 });
  },
};
