// page-watch cloud test
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const h = await (await fetch(base + '/health')).json();
if (!h.ok) throw new Error('health');
const a = await (await fetch(base + '/watch?url=example')).json();
const b = await (await fetch(base + '/watch?url=example')).json();
console.log('[watch] hash=' + a.fingerprint.hash.slice(0, 16) + '... bytes=' + a.fingerprint.bytes + ' title=' + a.fingerprint.title);
if (!a.fingerprint || !a.fingerprint.hash) throw new Error('missing fingerprint');
if (a.fingerprint.hash !== b.fingerprint.hash) throw new Error('same page, different hash - normalization is not stable');
console.log('[test] PASS (stable across two runs)');