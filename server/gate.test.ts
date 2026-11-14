/** bun test server/gate.test.ts — the sign-off gate on three frozen real dossiers (server/fixtures) and on each "read everything" condition. */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Dossier } from '../shared/dossier';
import { fullReadReason, gate, isSkim, mustRead } from '../shared/gate';

const load = (n: number): Dossier => JSON.parse(readFileSync(resolve(import.meta.dir, `fixtures/pr${n}.json`), 'utf8'));
const done = (d: Dossier): Dossier => {
  for (const f of d.findings) f.feedback = { verdict: 'accepted', by: 't', at: '' };
  for (const r of d.refusals) if (r.blocking) r.answer = { optionId: r.options[0].id, by: 't', at: '' };
  return d;
};
const ids = (d: Dossier, all = false) => d.units.filter((u) => all || u.ask !== 'none').map((u) => u.id);

test('nothing done: findings, decisions and reading all block', () => {
  const g = gate(load(1), { readUnitIds: [] });
  expect(g.unjudged.length).toBe(3);
  expect(g.undecided.length).toBe(1);
  expect(g.unread.map((u) => u.id)).toEqual(['U1', 'U2', 'U4']);
});

test('an unjudged finding alone blocks', () => {
  const d = done(load(1));
  delete d.findings[0].feedback;
  expect(gate(d, { readUnitIds: ids(d) }).reasons.length).toBe(1);
});

test('the routed units are enough when the plan stands', () => {
  const d = done(load(1));
  expect(fullReadReason(d)).toBeUndefined();
  expect(gate(d, { readUnitIds: ids(d), override: 'I reviewed and accept this confirmed risk.' }).reasons).toEqual([]);
});

test('a change drawn for a spot check needs every unit and the answer', () => {
  const d = done(load(3));
  expect(d.routing.spotCheck.selected).toBe(true);
  expect(mustRead(d).length).toBe(d.units.length);
  expect(gate(d, { readUnitIds: ids(d) }).unread.length).toBeGreaterThan(0);
  expect(gate(d, { readUnitIds: ids(d, true) }).spotCheckOpen).toBe(true);
  expect(gate(d, { readUnitIds: ids(d, true), spotCheck: { missed: true } }).spotCheckOpen).toBe(true); // a miss needs a note
  expect(gate(d, { readUnitIds: ids(d, true), spotCheck: { missed: false }, override: 'I reviewed and accept this confirmed risk.' }).reasons).toEqual([]);
});

for (const [name, mutate] of [
  ['no requirement', (d: Dossier) => void (d.requirement.id = 'NONE')],
  ['nothing executed', (_d: Dossier) => undefined],
  ['reviewer missed most planted bugs', (d: Dossier) => void (d.selfTest = { ...d.selfTest!, planted: 4, caught: 1 })],
] as const)
  test(`read everything: ${name}`, () => {
    const d = done(load(1));
    // the verdict does not matter: a change the AI already wants sent back gets no skipped line either
    if (name === 'nothing executed') d.evidence = d.evidence.filter((e) => e.strength !== 'executed');
    mutate(d);
    expect(fullReadReason(d)).toBeDefined();
    expect(gate(d, { readUnitIds: ids(d) }).unread.map((u) => u.id)).toEqual(['U3']);
    expect(gate(d, { readUnitIds: ids(d, true), override: 'I reviewed and accept this confirmed risk.' }).reasons).toEqual([]);
  });

test('a unit routed to skim needs its own mark: a skim is shorter, not optional', () => {
  const d = done(load(2));
  const skim = d.units.filter((u) => u.ask === 'skim');
  expect(skim.length).toBeGreaterThan(0);
  expect(isSkim(d, skim[0])).toBe(true);
  const onlyRead = d.units.filter((u) => u.ask === 'read').map((u) => u.id);
  expect(gate(d, { readUnitIds: onlyRead, override: 'I reviewed and accept this confirmed risk.' }).unread.map((u) => u.id)).toEqual(skim.map((u) => u.id));
  expect(gate(d, { readUnitIds: ids(d), override: 'I reviewed and accept this confirmed risk.' }).reasons).toEqual([]);
});
