/** What GitHub itself says about this pull request right now, read live by the server. Proof that the gate is on the pull request and not only in this app. */
import { ArrowUpRight } from 'lucide-react';
import { api } from '../../api';
import { useQuery } from '../../lib/hooks';
import { cx, relTime, shortSha } from '../../lib/util';
import { Label } from './atoms';

const STATE: Record<string, { word: string; dot: string }> = {
  success: { word: 'passing', dot: 'bg-green' },
  failure: { word: 'failing', dot: 'bg-red' },
  error: { word: 'failing', dot: 'bg-red' },
  pending: { word: 'pending', dot: 'bg-amber' },
};

export function OnGitHub({ slug }: { slug: string }) {
  // re-read while the page is open, so a signature shows up here without a reload
  const q = useQuery(() => api.github(slug), [slug], { pollMs: () => 20_000 });
  const g = q.data;
  if (q.loading || (!g && !q.error)) return null;
  return (
    <>
      <Label aside={g ? `read ${relTime(g.readAt)}` : undefined}>On GitHub right now</Label>
      {!g ? (
        <p className="text-base text-fg-3">GitHub could not be read just now, so its state is not shown. Nothing is assumed.</p>
      ) : (
        <>
          <div className="divide-y divide-line rounded-lg border border-line">
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <span className={cx('mt-[7px] h-2 w-2 shrink-0 rounded-full', g.status ? (STATE[g.status.state]?.dot ?? 'bg-fg-4') : 'bg-fg-4')} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-base">
                  <span className="mono text-md text-fg">countersign/sign-off</span>
                  <span className="text-fg-2">{g.status ? (STATE[g.status.state]?.word ?? g.status.state) : 'not set'}</span>
                </div>
                <p className="mt-0.5 text-sm text-fg-3">
                  {g.status ? (
                    <>
                      “{g.status.description}” Set by @{g.status.by} {relTime(g.status.at)} on commit <span className="mono">{shortSha(g.headSha)}</span>.
                    </>
                  ) : (
                    <>
                      No Countersign check on commit <span className="mono">{shortSha(g.headSha)}</span>.
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <span className={cx('mt-[7px] h-2 w-2 shrink-0 rounded-full', g.prState === 'MERGED' ? 'bg-purple' : !g.required ? 'bg-fg-4' : g.mergeState === 'BLOCKED' ? 'bg-amber' : 'bg-green')} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-base">
                  <span className="text-fg">Merge</span>
                  <span className="text-fg-2">{g.prState === 'MERGED' ? 'merged' : g.prState === 'CLOSED' ? 'closed' : !g.required ? 'not gated' : g.mergeState === 'BLOCKED' ? 'blocked by GitHub' : 'allowed'}</span>
                </div>
                <p className="mt-0.5 text-sm text-fg-3">
                  {g.required ? (
                    <>
                      The protection rule on <span className="mono">{g.base}</span> requires this check, so the merge button stays locked until a named person signs.
                    </>
                  ) : (
                    <>
                      <span className="mono">{g.base}</span> has no rule requiring this check, so the check informs but does not block.
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 px-3 py-2.5">
              <span className={cx('mt-[7px] h-2 w-2 shrink-0 rounded-full', g.comment ? 'bg-fg-3' : 'bg-fg-4')} />
              <div className="min-w-0 flex-1">
                <div className="text-base text-fg">Dossier comment</div>
                <p className="mt-0.5 text-sm text-fg-3">{g.comment ? `Posted by @${g.comment.by}, last updated ${relTime(g.comment.at)}.` : 'Not posted on this pull request.'}</p>
              </div>
              {g.comment && (
                <a href={g.comment.url} target="_blank" rel="noreferrer" className="mt-0.5 flex shrink-0 items-center gap-1 text-sm text-fg-3 transition-colors hover:text-fg">
                  Open
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
          {!g.headIsCurrent && <p className="mt-2 text-sm text-amber">The pull request has moved past commit {shortSha(g.headSha)}. A signature covers only the commit that was reviewed, so the new commit has no passing check.</p>}
          <p className="mt-2 text-sm text-fg-4">
            Read from GitHub by the server, not from this app's own data.{g.publishes ? '' : ' This copy never posts there, so signing here changes nothing above.'}
          </p>
        </>
      )}
    </>
  );
}
