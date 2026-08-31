// rss-social-mirror cloud test
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const h = await (await fetch(base + '/health')).json();
if (!h.ok) throw new Error('health');
for (const src of ['reddit', 'lobsters']) {
  const f = await (await fetch(base + '/feed?src=' + src)).json();
  console.log('[feed] src=' + src + ' count=' + f.meta.count);
  for (const i of f.items.slice(0, 2)) console.log('  ' + i.id.slice(0, 50) + ' | ' + i.title.slice(0, 60));
  if (!f.meta || !Array.isArray(f.items)) throw new Error('missing feed fields: ' + src);
  const ids = new Set(f.items.map(i => i.id));
  if (ids.size !== f.items.length) throw new Error('duplicate ids after dedupe: ' + src);
}
console.log('[test] PASS');