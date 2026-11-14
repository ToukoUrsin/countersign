import type { GitHubNow } from '../../shared/dossier';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PullRequestInfo } from '../../shared/dossier';
import { WORK, ensureDir, exec } from './util';

export function parsePrUrl(url: string) {
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) throw new Error(`not a GitHub PR url: ${url}`);
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

export const slugOf = (owner: string, repo: string, n: number) => `${owner}__${repo}__${n}`.toLowerCase();

/** `token`: act as that GitHub user instead of the server's own account (a sign-off is posted by the person who signed). */
async function gh(args: string[], input?: string, token?: string) {
  const r = await exec('gh', args, { input, check: true, timeoutMs: 120_000, env: token ? { GH_TOKEN: token } : undefined });
  return r.stdout;
}

export async function fetchPr(url: string): Promise<{ pr: PullRequestInfo; labels: string[] }> {
  const { owner, repo, number } = parsePrUrl(url);
  const j = JSON.parse(
    await gh(['pr', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'number,title,body,author,baseRefName,headRefName,baseRefOid,headRefOid,additions,deletions,changedFiles,createdAt,labels,url,commits']),
  );
  const labels: string[] = (j.labels ?? []).map((l: { name: string }) => l.name);
  const commitText = (j.commits ?? []).map((c: { messageHeadline: string; messageBody: string }) => `${c.messageHeadline}\n${c.messageBody}`).join('\n');
  const agent = labels.some((l) => /agent|ai-generated|copilot|bot/i.test(l)) || /agent|co-authored-by: (claude|copilot|codex|devin)/i.test(commitText) || /\bagent\b/i.test(j.body ?? '');
  return {
    labels,
    pr: {
      owner,
      repo,
      number,
      url: j.url,
      title: j.title,
      body: j.body ?? '',
      author: j.author?.login ?? 'unknown',
      authorKind: agent ? 'agent' : 'human',
      baseRef: j.baseRefName,
      headRef: j.headRefName,
      baseSha: j.baseRefOid,
      headSha: j.headRefOid,
      additions: j.additions,
      deletions: j.deletions,
      changedFiles: j.changedFiles,
      createdAt: j.createdAt,
    },
  };
}

/** Local clone of the reviewed repo with the PR head and base fetched. Returns the repo dir and the merge base. */
export async function prepareRepo(pr: PullRequestInfo) {
  const dir = resolve(ensureDir(resolve(WORK, 'repos')), `${pr.owner}__${pr.repo}`.toLowerCase());
  if (!existsSync(resolve(dir, '.git'))) {
    await exec('gh', ['repo', 'clone', `${pr.owner}/${pr.repo}`, dir, '--', '--quiet'], { check: true, timeoutMs: 600_000 });
  }
  // Reviews of several PRs share this clone. `--refmap=` stops git from also moving refs/remotes/origin/*,
  // which made concurrent fetches fail on a ref lock; each review only writes its own refs/countersign/*-N.
  for (let attempt = 1; ; attempt++) {
    const r = await exec('git', ['fetch', '--quiet', '--refmap=', 'origin', `+refs/heads/${pr.baseRef}:refs/countersign/base-${pr.number}`, `+refs/pull/${pr.number}/head:refs/countersign/pr-${pr.number}`], { cwd: dir, timeoutMs: 300_000 });
    if (r.code === 0) break;
    if (attempt >= 4) throw new Error(`git fetch failed: ${r.stderr.slice(0, 300)}`);
    await new Promise((res) => setTimeout(res, 500 + Math.random() * 2000));
  }
  // the PR API reports the base sha at PR creation; the policy must come from the base branch as it is now
  const baseTip = (await exec('git', ['rev-parse', `refs/countersign/base-${pr.number}`], { cwd: dir, check: true })).stdout.trim();
  const mb = (await exec('git', ['merge-base', baseTip, pr.headSha], { cwd: dir, check: true })).stdout.trim();
  const diff = (await exec('git', ['diff', '--no-color', '-M', `${mb}..${pr.headSha}`], { cwd: dir, check: true })).stdout;
  return { repoDir: dir, mergeBase: mb, baseTip, diff };
}

export async function fetchIssue(repo: string, n: number) {
  const j = JSON.parse(await gh(['issue', 'view', String(n), '--repo', repo, '--json', 'title,body,url,state']));
  return j as { title: string; body: string; url: string; state: string };
}

export async function whoami() {
  const j = JSON.parse(await gh(['api', 'user']));
  return { login: j.login as string, name: (j.name as string) || j.login, avatarUrl: j.avatar_url as string };
}

export async function setStatus(pr: PullRequestInfo, state: 'pending' | 'success' | 'failure' | 'error', description: string, targetUrl?: string, token?: string) {
  const args = ['api', `repos/${pr.owner}/${pr.repo}/statuses/${pr.headSha}`, '-f', `state=${state}`, '-f', 'context=countersign/sign-off', '-f', `description=${description.slice(0, 138)}`];
  if (targetUrl) args.push('-f', `target_url=${targetUrl}`);
  const j = JSON.parse(await gh(args, undefined, token));
  return j.url as string;
}

const MARK = '<!-- countersign-dossier -->';

/**
 * A review comment must not write into other repositories' timelines. GitHub turns `owner/repo#12`,
 * issue URLs and `@name` into cross-references and notifications, and that text comes from a model
 * that read untrusted code. References to anything but the reviewed repo are defused.
 */
export function quiet(md: string, pr: PullRequestInfo) {
  const own = `${pr.owner}/${pr.repo}`.toLowerCase();
  return md
    .replace(/https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)[^\s)]*/gi, (m, repo: string, kind: string, n: string) => (repo.toLowerCase() === own ? m : `\`${repo} ${kind === 'pull' ? 'PR' : 'issue'} ${n}\``))
    .replace(/\b([\w.-]+\/[\w.-]+)#(\d+)\b/g, (m, repo: string, n: string) => (repo.toLowerCase() === own ? m : `${repo} issue ${n}`))
    .replace(/(^|[^\w`@/])@([A-Za-z0-9][A-Za-z0-9-]{0,38})\b/g, (m, pre: string, name: string) => (name.toLowerCase() === pr.owner.toLowerCase() ? m : `${pre}\`@${name}\``));
}

/** Create or update the single Countersign comment on the PR. */
export async function upsertComment(pr: PullRequestInfo, body: string, marker = MARK, token?: string) {
  const full = `${marker}\n${quiet(body, pr)}`;
  const list = JSON.parse(await gh(['api', `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments?per_page=100`])) as { id: number; body: string; html_url: string }[];
  const mine = list.find((c) => c.body.startsWith(marker));
  if (mine) {
    const j = JSON.parse(await gh(['api', '-X', 'PATCH', `repos/${pr.owner}/${pr.repo}/issues/comments/${mine.id}`, '--input', '-'], JSON.stringify({ body: full }), token));
    return j.html_url as string;
  }
  const j = JSON.parse(await gh(['api', '-X', 'POST', `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`, '--input', '-'], JSON.stringify({ body: full }), token));
  return j.html_url as string;
}

/** Post a second, explicitly marked comment (used for an author fix request). */
export async function postComment(pr: PullRequestInfo, body: string, marker: string, token?: string) {
  const full = `${marker}\n${quiet(body, pr)}`;
  const j = JSON.parse(await gh(['api', '-X', 'POST', `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`, '--input', '-'], JSON.stringify({ body: full }), token));
  return j.html_url as string;
}

/** Read-only: what GitHub itself says about this pull request right now. Nothing is written. */
export async function githubNow(pr: PullRequestInfo): Promise<GitHubNow> {
  const repo = `${pr.owner}/${pr.repo}`;
  const [st, cm, cur] = await Promise.all([
    gh(['api', `repos/${repo}/commits/${pr.headSha}/statuses?per_page=100`]),
    gh(['api', `repos/${repo}/issues/${pr.number}/comments?per_page=100`]),
    gh(['pr', 'view', String(pr.number), '--repo', repo, '--json', 'headRefOid,state,mergeStateStatus,baseRefName']),
  ]);
  const statuses = (JSON.parse(st) as { context: string; state: string; description: string | null; creator?: { login: string }; updated_at: string; target_url?: string | null }[]).filter((s) => s.context === 'countersign/sign-off');
  const comments = JSON.parse(cm) as { body: string; html_url: string; user?: { login: string }; updated_at: string }[];
  const mine = comments.find((c) => c.body.startsWith(MARK));
  const now = JSON.parse(cur) as { headRefOid: string; state: string; mergeStateStatus: string; baseRefName: string };
  // is the check required by the branch's protection rule? a branch without one answers 404
  const required = await gh(['api', `repos/${repo}/branches/${now.baseRefName}/protection/required_status_checks`])
    .then((x) => (JSON.parse(x) as { contexts?: string[] }).contexts?.includes('countersign/sign-off') ?? false)
    .catch(() => false);
  const s = statuses[0];
  return {
    status: s && { state: s.state, description: s.description ?? '', by: s.creator?.login ?? 'unknown', at: s.updated_at, url: s.target_url ?? undefined },
    statusCount: statuses.length,
    comment: mine && { url: mine.html_url, by: mine.user?.login ?? 'unknown', at: mine.updated_at },
    headSha: pr.headSha,
    headIsCurrent: now.headRefOid === pr.headSha,
    prState: now.state,
    required,
    base: now.baseRefName,
    mergeState: now.mergeStateStatus,
    readAt: new Date().toISOString(),
  };
}
