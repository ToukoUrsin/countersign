// Scratch helper: full-page stills of every route, to plan shots after a UI change.
// usage: bun stills.ts <outdir> <width>x<height> [chapter ...]
import { chromium } from 'playwright-core';
const [out, size, ...only] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const BASE = process.env.CS_URL || 'http://localhost:4318';
const PR = '/pr/toukoursin__junction26-messagepack-csharp__1';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark', deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try { localStorage.setItem('cs-theme', 'dark'); } catch {} });
const page = await ctx.newPage();
const errs: string[] = [];
page.on('pageerror', (e) => errs.push(String(e)));
const api = await (await fetch(`${BASE}/api/dossiers/toukoursin__junction26-messagepack-csharp__1`)).json().catch(() => null);
let chs = ['change', 'how', 'asked', 'proof', 'reviewer', 'FN1', 'FN2', 'FN3', 'R1', 'R2', 'U1', 'U2', 'U3', 'skipped', 'limits', 'sign'];
if (only.length) chs = only;
const routes = only.length ? [] : ['/', '/ledger', '/concept'];
for (const r of routes) {
  await page.goto(BASE + r, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/route-${r.replace(/\W+/g, '') || 'inbox'}.png` });
}
for (const c of chs) {
  await page.goto(`${BASE}${PR}?c=${c}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/ch-${c}.png` });
  console.log(c, new URL(page.url()).searchParams.get('c'));
}
if (errs.length) console.log('PAGE ERRORS:\n' + [...new Set(errs)].join('\n'));
void api;
await b.close();
