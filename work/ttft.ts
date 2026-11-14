const KEY = process.env.GEMINI_API_KEY!;
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const list = await (await fetch(`${API}?pageSize=200`, { headers: { 'x-goog-api-key': KEY } })).json();
console.log((list.models ?? []).map((m: any) => m.name.replace('models/', '')).filter((n: string) => /gemini/.test(n) && !/embed|image|tts|audio|live|veo/.test(n)).join(' '));
const big = 'Context: ' + 'The filter drops diagnostics whose location is not in the compilation. '.repeat(400);
async function t(model: string, cfg: any) {
  const t0 = Date.now();
  let first = 0;
  try {
    const r = await fetch(`${API}/${model}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: big + '\n\nQUESTION: In 60 words, what does the filter do and what could go wrong?' }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 2000, ...cfg } }), signal: AbortSignal.timeout(60000) });
    if (!r.ok) return console.log(model, JSON.stringify(cfg), 'HTTP', r.status, (await r.text()).slice(0, 160).replace(/\s+/g, ' '));
    const rd = r.body!.getReader(); const dec = new TextDecoder(); let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; const s = dec.decode(value); if (!first && /"text"/.test(s) && !/"thought": true/.test(s)) first = Date.now() - t0; n += s.length; }
    console.log(model, JSON.stringify(cfg), 'first', first, 'ms total', Date.now() - t0, 'ms');
  } catch (e) { console.log(model, JSON.stringify(cfg), 'ERR', String(e).slice(0, 100)); }
}
const m = process.argv[2];
await t(m, {});
await t(m, { thinkingConfig: { thinkingBudget: 0 } });
await t(m, { thinkingConfig: { thinkingLevel: 'low' } });
await t(m, { thinkingConfig: { thinkingLevel: 'minimal' } });
