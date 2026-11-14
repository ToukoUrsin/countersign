/**
 * Escapes read from the repository instead of reported by hand: a commit on the base branch that reverts a
 * countersigned, merged pull request is an escape. Read-only against GitHub; the caller writes the ledger.
 */
import { exec } from '../pipeline/lib/util';
import type { Dossier } from '../shared/dossier';

const norm = (s: string) => s.toLowerCase().replace(/\s*\(#\d+\)\s*$/, '').replace(/\s+/g, ' ').trim();

/**
 * Does this commit message revert that pull request? Three signs, any one is enough: it says it reverts the
 * pull request's merge or head commit; it is a revert that names the pull request's number; it is a revert
 * whose quoted subject is the pull request's title.
 */
export function revertsPr(message: string, pr: { number: number; title: string; headSha: string; mergeSha?: string }): boolean {
  const first = message.split('\n')[0].trim();
  const shas = [...message.matchAll(/\breverts? commit ([0-9a-f]{7,40})\b/gi)].map((m) => m[1].toLowerCase());
  if (shas.some((s) => pr.headSha.toLowerCase().startsWith(s) || !!pr.mergeSha?.toLowerCase().startsWith(s))) return true;
  if (!/^revert\b/i.test(first)) return false;
  const quoted = /^revert\s+"(.+)"/i.exec(first)?.[1];
  // 'Revert "Add X (#12)" (#15)': #12 is what was reverted, #15 is the revert's own pull request
  if (quoted !== undefined) return new RegExp(`\\(#${pr.number}\\)\\s*$`).test(quoted) || norm(quoted) === norm(pr.title);
  return new RegExp(`#${pr.number}\\b`).test(message);
}

export interface Revert {
  sha: string;
  subject: string;
  at: string;
}

/** Commits on the base branch, after the merge, that revert this pull request. Empty when it is not merged. */
export async function findReverts(d: Dossier): Promise<Revert[]> {
  const repo = `${d.pr.owner}/${d.pr.repo}`;
  const gh = async (args: string[]) => (await exec('gh', args, { timeoutMs: 30_000, check: true })).stdout;
  const v = JSON.parse(await gh(['pr', 'view', String(d.pr.number), '--repo', repo, '--json', 'state,mergeCommit,mergedAt,baseRefName'])) as { state: string; mergedAt?: string; baseRefName: string; mergeCommit?: { oid: string } };
  if (v.state !== 'MERGED' || !v.mergedAt) return [];
  const commits = JSON.parse(await gh(['api', `repos/${repo}/commits?sha=${encodeURIComponent(v.baseRefName)}&since=${v.mergedAt}&per_page=100`])) as { sha: string; commit: { message: string; committer?: { date?: string } } }[];
  return commits
    .filter((c) => c.sha !== v.mergeCommit?.oid && revertsPr(c.commit.message, { number: d.pr.number, title: d.pr.title, headSha: d.pr.headSha, mergeSha: v.mergeCommit?.oid }))
    .map((c) => ({ sha: c.sha, subject: c.commit.message.split('\n')[0].slice(0, 120), at: c.commit.committer?.date ?? '' }));
}
