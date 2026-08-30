// blueprint/daily-digest LOCAL: gather -> extractive summarize -> emit
// Sources: HN front page (keyless) + Google News RSS. Summarizer = extractive (frequency sentence scoring), no LLM.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const NOW = Date.now(); const WINDOW_MS = 7 * 86400e3;

type Article = { id: string; source: string; title: string; url: string; date: string | null; snippet: string };

async function getText(url: string): Promise<string> { const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }

async function gatherHN(): Promise<Article[]> {
  const html = await getText('https://news.ycombinator.com/');
  const items = [...html.matchAll(/<a href=\x22([^\x22]+)\x22 class=\x22titlelink\x22[^>]*>([\s\S]*?)<\/a>/g)];
  return items.slice(0, 10).map((m, i) => ({ id: 'hn:' + i, source: 'hn', title: m[2].replace(/<[^>]+>/g, '').trim(), url: m[1], date: null, snippet: '' }));
}

async function gatherNews(): Promise<Article[]> {
  const q = encodeURIComponent('technology OR cloud OR AI');
  const xml = await getText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`);
  const out: Article[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) { const e = m[1];
    const title = (e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = (e.match(/<link>([^<]+)<\/link>/) || [])[1] || '';
    const pub = (e.match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || '';
    const ts = Date.parse(pub); if (!ts || ts < NOW - WINDOW_MS) continue;
    out.push({ id: 'news:' + link, source: 'news', title, url: link, date: pub, snippet: '' });
  }
  return out.slice(0, 10);
}

function tokenize(s: string): string[] { return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !['the','and','for','are','was','with','that','this','have','from','into','about'].includes(w)); }

// extractive summarizer: score sentences by term frequency, keep top-N
function summarize(articles: Article[], topN = 5): { sentence: string; score: number; from: string }[] {
  const corpus = articles.map(a => a.title).join(' ');
  const toks = tokenize(corpus);
  const freq = new Map<string, number>();
  for (const t of toks) freq.set(t, (freq.get(t) || 0) + 1);
  const scored = articles.map(a => {
    const s = tokenize(a.title).reduce((sum, t) => sum + (freq.get(t) || 0), 0);
    return { sentence: a.title, score: s, from: a.source + ':' + a.id };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

// ---- Run ----
const articles: Article[] = [];
try { articles.push(...await gatherHN()); console.log('hn:', articles.filter(a => a.source === 'hn').length); } catch (e) { console.log('[hn]', (e as Error).message); }
try { articles.push(...await gatherNews()); console.log('news:', articles.filter(a => a.source === 'news').length); } catch (e) { console.log('[news]', (e as Error).message); }

const summary = summarize(articles);
console.log('total articles:', articles.length, '| summary top', summary.length, ':');
for (const s of summary) console.log(`  [${s.from}] ${s.sentence.slice(0, 90)}`);

const digest = { generated: new Date().toISOString(), source_count: { hn: articles.filter(a => a.source === 'hn').length, news: articles.filter(a => a.source === 'news').length }, summary, full: articles };
const fs = await import('node:fs/promises');
await fs.writeFile(new URL('./digest.json', import.meta.url), JSON.stringify(digest, null, 2));
console.log('wrote digest.json');