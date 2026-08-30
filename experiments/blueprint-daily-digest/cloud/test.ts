// daily-digest cloud test
const base = process.argv[2] ?? 'https://rh-digest.ambiens.workers.dev';
const h = await (await fetch(base + '/health')).json();
if (!h.ok) throw new Error('health');
const d = await (await fetch(base + '/digest')).json();
console.log('[digest] sources=' + d.meta.source_count + ' hn=' + d.meta.hn_count + ' news=' + d.meta.news_count);
console.log('[digest] top:');
for (const s of d.digest) console.log('  ' + s.score + ' | ' + s.sentence.slice(0, 80));
if (!d.meta || !Array.isArray(d.digest)) throw new Error('missing digest fields');
console.log('[test] PASS');