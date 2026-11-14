/**
 * Live explanations: diagrams and answers generated on request while the reviewer reads.
 * They explain the dossier. They are never evidence and never change it.
 */
import type { Diagram } from '../../../shared/dossier';

export interface LiveInfo {
  enabled: boolean;
  drawModel: string;
  askModel: string;
}
export type FocusKind = 'unit' | 'finding' | 'refusal' | 'evidence' | 'criterion';

const enc = encodeURIComponent;
let info: Promise<LiveInfo> | undefined;
export const liveInfo = (): Promise<LiveInfo> =>
  (info ??= fetch('/api/live')
    .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<LiveInfo>) : { enabled: false, drawModel: '', askModel: '' }))
    .catch(() => ({ enabled: false, drawModel: '', askModel: '' })));

const diagrams = new Map<string, Promise<{ diagram: Diagram; model: string }>>();
export function liveDiagram(slug: string, kind: 'unit' | 'finding', id: string) {
  const key = `${slug}|${kind}|${id}`;
  let p = diagrams.get(key);
  if (!p) {
    p = fetch(`/api/dossiers/${enc(slug)}/live/diagram?kind=${kind}&id=${enc(id)}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Could not draw this (${r.status})`);
      return j as { diagram: Diagram; model: string };
    });
    diagrams.set(key, p);
    p.catch(() => diagrams.delete(key));
  }
  return p;
}

/** Streams an answer. Returns a function that stops it. */
export function ask(slug: string, q: string, focus: { kind: FocusKind; id: string } | undefined, on: { text: (chunk: string) => void; done: (model: string) => void; error: (message: string) => void }): () => void {
  const url = `/api/dossiers/${enc(slug)}/ask?q=${enc(q)}${focus ? `&kind=${focus.kind}&id=${enc(focus.id)}` : ''}`;
  const es = new EventSource(url);
  let ended = false;
  const end = () => {
    ended = true;
    es.close();
  };
  es.addEventListener('text', (e) => {
    try {
      on.text(JSON.parse((e as MessageEvent).data));
    } catch {
      /* skip a malformed chunk */
    }
  });
  es.addEventListener('done', (e) => {
    end();
    on.done((e as MessageEvent).data);
  });
  es.addEventListener('error', (e) => {
    if (ended) return;
    end();
    on.error((e as MessageEvent).data || 'The answer stopped before it finished.');
  });
  return end;
}
