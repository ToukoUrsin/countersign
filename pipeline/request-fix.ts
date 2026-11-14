#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Dossier } from '../shared/dossier';
import { DATA } from './lib/util';
import { postFixRequest } from './stages/publish';
import { compactRound } from './lib/rounds';
import { append } from '../server/ledger';

const slug = process.argv[2] ?? 'toukoursin__junction26-messagepack-csharp__1';
const file = resolve(DATA, 'dossiers', slug, 'dossier.json');
if (!existsSync(file)) throw new Error(`dossier not found: ${slug}`);
const d = JSON.parse(readFileSync(file, 'utf8')) as Dossier;
if (!(d.rounds?.length)) d.rounds = [compactRound(d)];
const request = await postFixRequest(d);
if (!request) { console.log(JSON.stringify({ posted: false, reason: 'no reproduced findings or round limit' })); process.exit(0); }
d.rounds[d.rounds.length - 1].fixRequest = request;
writeFileSync(file + '.tmp', JSON.stringify(d, null, 1));
renameSync(file + '.tmp', file);
append({ type: 'fix-request', pr: d.id, actor: 'countersign', summary: `Fix request for ${d.id} round ${request.round}`, data: { round: request.round, findings: request.findings.map((f) => f.findingId), commentUrl: request.commentUrl } });
console.log(JSON.stringify({ posted: true, round: request.round, commentUrl: request.commentUrl, findings: request.findings.map((f) => f.findingId) }));
