// weather-alert cloud test
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const h = await (await fetch(base + '/health')).json();
if (!h.ok) throw new Error('health');
const c = await (await fetch(base + '/check?lat=51.5007&lon=-0.1246&tmin=-99&tmax=99&wmax=0')).json();
console.log('[check] tz=' + c.meta.timezone + ' crossings=' + c.crossings.length);
for (const x of c.crossings) console.log('  ' + x.param + ' ' + x.value + ' vs ' + x.threshold + ' at ' + x.at);
if (!c.meta || !Array.isArray(c.crossings)) throw new Error('missing check fields');
console.log('[test] PASS');