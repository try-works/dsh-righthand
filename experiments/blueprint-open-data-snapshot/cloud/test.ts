// open-data-snapshot cloud test
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const h = await (await fetch(base + '/health')).json();
if (!h.ok) throw new Error('health');
const s = await (await fetch(base + '/snapshot?days=1&minmag=2.5')).json();
console.log('[snapshot] days=' + s.meta.windowDays + ' count=' + s.meta.count);
for (const f of s.features.slice(0, 3)) console.log('  ' + f.id + ' | M' + f.mag + ' ' + (f.place || '').slice(0, 60));
if (!s.meta || !Array.isArray(s.features) || s.features.length === 0) throw new Error('missing features');
if (s.ids.length !== s.features.length) throw new Error('ids/features mismatch - diffing would break');
console.log('[test] PASS');