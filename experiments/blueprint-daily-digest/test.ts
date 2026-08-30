// blueprint/daily-digest LOCAL test — asserts run.ts digest.json
import { readFile } from 'node:fs/promises';
const digest = JSON.parse(await readFile(new URL('./digest.json', import.meta.url), 'utf8'));
if (!digest.generated) throw new Error('generated missing');
if (!digest.source_count || typeof digest.source_count.hn !== 'number' || typeof digest.source_count.news !== 'number') throw new Error('source_count invalid');
if (!Array.isArray(digest.summary)) throw new Error('summary missing');
if (!Array.isArray(digest.full)) throw new Error('full missing');
console.log('[local] generated=' + digest.generated + ' hn=' + digest.source_count.hn + ' news=' + digest.source_count.news + ' summary=' + digest.summary.length);
if (digest.summary.length > 0) console.log('  top: ' + digest.summary[0].sentence.slice(0, 60));
console.log('[local test] PASS');
