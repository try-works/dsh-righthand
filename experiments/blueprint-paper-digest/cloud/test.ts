// paper-digest cloud test
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const h = await (await fetch(base + '/health')).json();
if (!h.ok) throw new Error('health');
const p = await (await fetch(base + '/papers?q=agent&n=5')).json();
console.log('[papers] query=' + p.meta.query + ' count=' + p.meta.count);
for (const e of p.entries.slice(0, 3)) console.log('  ' + e.id + ' | ' + e.title.slice(0, 70));
if (!p.meta || !Array.isArray(p.entries) || p.entries.length === 0) throw new Error('missing entries');
const ids = new Set(p.entries.map(e => e.id));
if (ids.size !== p.entries.length) throw new Error('duplicate ids - diffing would break');
console.log('[test] PASS');