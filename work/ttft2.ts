const KEY = process.env.GEMINI_API_KEY!;
const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const big = 'Context: ' + 'The filter drops diagnostics whose location is not in the compilation. '.repeat(400);
async function t(model: string, cfg: any) {
  const t0 = Date.now(); let first = 0, chunks = 0;
  try {
    const r = await fetch(`${API}/${model}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: big + '\n\nQUESTION: In 100 words, what does the filter do and what could go wrong?' }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 2000, ...cfg } }), signal: AbortSignal.timeout(60000) });
    if (!r.ok) return console.log(model, JSON.stringify(cfg), 'HTTP', r.status, (await r.text()).slice(0, 140).replace(/\s+/g, ' '));
    const rd = r.body!.getReader(); const dec = new TextDecoder();
    for (;;) { const { done, value } = await rd.read(); if (done) break; const s = dec.decode(value); const k = (s.match(/^data:/gm) ?? []).length; if (/"text"/.test(s) && !/"thought": true/.test(s)) { if (!first) first = Date.now() - t0; chunks += k; } }
    console.log(model, JSON.stringify(cfg), 'first', first, 'ms total', Date.now() - t0, 'ms chunks', chunks);
  } catch (e) { console.log(model, JSON.stringify(cfg), 'ERR', String(e).slice(0, 100)); }
}
for (const m of process.argv.slice(2)) { await t(m, { thinkingConfig: { thinkingBudget: 0 } }); await t(m, {}); }
