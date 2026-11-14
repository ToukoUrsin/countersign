// Records the product by URL and keyboard. Each narrated shot gets a mark; setup steps between marks are cut out.
// :4317 is the real instance: it is only ever navigated to (no clicks, keys or posts).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const out = '/bulk2/runs/linearcodereview/demo';
const raw = path.join(out, 'raw');
fs.mkdirSync(raw, {recursive: true});
for (const f of fs.readdirSync(raw)) if (f.endsWith('.webm')) fs.unlinkSync(path.join(raw, f));
const spec = JSON.parse(fs.readFileSync(process.env.NARRATION || path.join(root, 'narration.json'), 'utf8'));
const durations = spec.shots.map((s: any, i: number) => JSON.parse(fs.readFileSync(path.join(out, 'audio', `${String(i).padStart(2, '0')}-${s.id}.json`), 'utf8')).dur as number);
const base = process.env.CS_URL || 'http://localhost:4318';
const GH = 'http://localhost:4317/pr/toukoursin__junction26-messagepack-csharp__5?c=sign';
const PR5 = base + '/pr/toukoursin__junction26-messagepack-csharp__5';

const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu']});
const context = await browser.newContext({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1, colorScheme: 'dark', recordVideo: {dir: raw, size: {width: 1920, height: 1080}}});
await context.addInitScript(() => {
  try { localStorage.setItem('cs-theme', 'dark'); } catch {}
  const add = () => {
    if (document.getElementById('demo-pointer')) return;
    const el = document.createElement('div'); el.id = 'demo-pointer';
    Object.assign(el.style, {position:'fixed', zIndex:'2147483647', width:'16px', height:'16px', borderRadius:'50%', background:'#f3c969', border:'2px solid #171717', boxShadow:'0 0 0 3px rgba(243,201,105,.3)', pointerEvents:'none', transform:'translate(-8px,-8px)', left:'50%', top:'50%', transition:'left .6s ease, top .6s ease'});
    document.documentElement.appendChild(el);
    window.addEventListener('demo-cursor', (e: any) => { const d=e.detail||{}; el.style.left=`${d.x}px`; el.style.top=`${d.y}px`; });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
});
const page = await context.newPage();
const t0 = Date.now();
const marks: any[] = [];
page.on('pageerror', e => console.error('PAGEERROR', String(e)));

async function cursor(x: number, y: number) {
  await page.evaluate(({x,y}) => window.dispatchEvent(new CustomEvent('demo-cursor', {detail: {x,y}})), {x,y}).catch(() => {});
  await page.mouse.move(x, y, {steps: 8});
}
const wait = (ms: number) => page.waitForTimeout(ms);

// Mark every unit read and answer the decision on #5 so Aino can hold to countersign. Not in the film.
async function prepareSign() {
  for (const c of ['U1', 'U2', 'U3']) {
    await page.goto(`${PR5}?c=${c}`, {waitUntil: 'networkidle'});
    for (let k = 0; k < 14; k++) { await page.keyboard.press('r'); await wait(1500); }
  }
  await page.goto(`${PR5}?c=R1`, {waitUntil: 'networkidle'});
  await wait(600); await page.keyboard.press('1'); await wait(1200);
}

for (let i = 0; i < spec.shots.length; i++) {
  const shot = spec.shots[i];
  if (shot.path === 'CARD') continue; // rendered in Remotion, not recorded
  const ms = Math.ceil(durations[i] * 1000);
  if (shot.act === 'hold') await prepareSign();
  await page.goto(shot.path === 'GH' ? GH : base + shot.path, {waitUntil: 'networkidle'});
  await wait(900);
  if (shot.act === 'scroll') { await page.mouse.move(1000, 500); for (let k = 0; k < 20; k++) { await page.mouse.wheel(0, 60); await wait(60); } await wait(900); }
  const [cx, cy] = shot.cam?.from ?? [960, 540];
  await page.evaluate(({x,y}) => window.dispatchEvent(new CustomEvent('demo-cursor', {detail: {x,y}})), {x: cx, y: cy}).catch(() => {});
  await wait(700);
  marks.push({id: shot.id, start: (Date.now() - t0) / 1000, duration: durations[i]});
  const end = Date.now() + ms;
  const [tx, ty] = shot.cam?.to ?? [960, 540];
  if (shot.act === 'readbtn') {
    await wait(1200);
    const b = page.getByRole('button', {name: /read it first|mark read/i}).first();
    const box = await b.boundingBox().catch(() => null);
    if (box) await cursor(box.x + box.width / 2, box.y + box.height / 2); else await cursor(tx, ty);
  } else if (shot.act === 'hold') {
    await wait(800);
    const b = page.getByRole('button', {name: /hold to countersign/i}).first();
    const box = await b.boundingBox().catch(() => null);
    if (box) { await cursor(box.x + box.width / 2, box.y + box.height / 2); await wait(600); await page.mouse.down(); await wait(2600); await page.mouse.up(); await cursor(tx, ty); }
    else { console.error('no hold button'); await cursor(tx, ty); }
  } else if (shot.path !== 'GH') { await wait(1500); await cursor(tx, ty); }
  const left = end - Date.now();
  if (left > 0) await wait(left);
}

await page.close();
await context.close();
await browser.close();
const files = fs.readdirSync(raw).filter(f => f.endsWith('.webm')).map(f => path.join(raw, f));
if (files.length !== 1) throw new Error(`expected one browser recording, got ${files.length}`);
fs.copyFileSync(files[0], path.join(out, 'raw.webm'));
fs.writeFileSync(path.join(out, 'record-timings.json'), JSON.stringify({marks}, null, 2));
console.log(`recorded ${path.join(out, 'raw.webm')}`);
