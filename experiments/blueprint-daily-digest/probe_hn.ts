const UA = 'Mozilla/5.0';
const html = await (await fetch('https://news.ycombinator.com/', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) })).text();
// print the anchor tags in the storylist area
const anchors = [...html.matchAll(/<a[^>]*href=\x22([^\x22]+)\x22[^>]*>([\s\S]*?)<\/a>/g)];
console.log('total anchors:', anchors.length);
for (const m of anchors.slice(0, 20)) console.log(JSON.stringify(m[1].slice(0, 70)), '=>', JSON.stringify(m[2].replace(/<[^>]+>/g,'').slice(0, 50)));
console.log('has titlelink class:', html.includes('titlelink'));