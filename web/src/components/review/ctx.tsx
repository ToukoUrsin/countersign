import { createContext, useContext } from 'react';
import type { Dossier } from '../../../../shared/dossier';
import type { Me, Statement } from '../../api';
import type { Chapter } from '../../lib/chapters';
import type { LiveInfo } from '../../lib/live';
import type { Composed } from '../../lib/review';

export interface Review {
  d: Dossier;
  me?: Me;
  c: Composed;
  list: Chapter[];
  readIds: Set<string>;
  /** signed, rejected or failed: nothing can be changed any more */
  readOnly: boolean;
  busy?: string;
  live: LiveInfo;
  seconds: number;
  go: (chapterId: string) => void;
  next: () => void;
  answer: (refusalId: string, optionId: string) => Promise<boolean>;
  feedback: (findingId: string, verdict: 'accepted' | 'rejected') => Promise<boolean>;
  setRead: (unitId: string, read: boolean) => void;
  /** what is selected inside a chapter (an evidence id, a criterion id …) */
  sel: Record<string, string | undefined>;
  select: (chapterId: string, id: string) => void;
  tab: Record<string, string | undefined>;
  setTab: (chapterId: string, tab: string) => void;
  /** unit ids to emphasise in the change map */
  hot: string[];
  setHot: (ids: string[]) => void;
  extraRisk: string[];
  /** on a change drawn for a spot check: what the signer's full read found */
  spot: { missed?: boolean; note: string };
  setSpot: (s: { missed?: boolean; note: string }) => void;
  setExtraRisk: (v: string[]) => void;
  /** the exact statement the server would sign right now; undefined until it has answered */
  statement?: Statement;
  /** the signer's written reason for accepting over confirmed problems */
  override: string;
  setOverride: (v: string) => void;
  /** seconds until the server will take a read mark for this unit (0 = now) */
  readWait: (unitId: string) => number;
  sign: (decision: 'accepted' | 'rejected') => Promise<void>;
  signErr?: string;
}

export const ReviewContext = createContext<Review | null>(null);
export const useReview = () => {
  const r = useContext(ReviewContext);
  if (!r) throw new Error('useReview outside a review');
  return r;
};
