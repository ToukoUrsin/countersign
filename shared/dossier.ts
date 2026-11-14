/**
 * Countersign — the Dossier contract.
 *
 * One Dossier per pull request. The pipeline writes it, the server serves it,
 * the web UI renders it, and the human sign-off (Attestation) is appended to it.
 *
 * Design rules baked into the types:
 *  - No free-floating confidence numbers. Confidence is the *kind of evidence*
 *    behind a statement: executed > verified-static > reasoned > none.
 *  - Every statement the AI makes is a Claim with Evidence ids, or it is listed
 *    under `notChecked`.
 *  - The AI never approves. `recommendation` is advice; `signoff` is a named human.
 */

// ───────────────────────────── primitives ─────────────────────────────

/** How strongly a statement is backed. This is the only "confidence" in the system. */
export type Strength =
  | 'executed' // a command was run in the sandbox and its output is attached
  | 'verified-static' // a deterministic check (quote match, AST/regex equivalence, reference count)
  | 'reasoned' // model reasoning only — always shown as weakest
  | 'none'; // nothing backs it

export type RiskTier = 'T0' | 'T1' | 'T2' | 'T3';
// T0 proof-covered (no human read), T1 skim, T2 read, T3 deep read by owner (+ second pair of eyes)

export interface CodeRef {
  path: string;
  /** line numbers in the head version unless side === 'base' */
  startLine: number;
  endLine: number;
  side?: 'head' | 'base';
  /** verbatim text at that location; the verifier checks it exists */
  quote?: string;
}

// ───────────────────────────── PR + requirement ─────────────────────────────

export interface PullRequestInfo {
  owner: string;
  repo: string;
  number: number;
  url: string;
  title: string;
  body: string;
  author: string;
  authorKind: 'agent' | 'human';
  baseRef: string;
  headRef: string;
  baseSha: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
}

export interface Criterion {
  id: string; // AC1, AC2 …
  text: string; // acceptance criterion derived from the requirement, NOT from the PR description
  /** where in the requirement this comes from (verbatim quote) */
  sourceQuote?: string;
  kind: 'functional' | 'non-functional' | 'implicit'; // implicit = "must not break X"
  status: 'proven' | 'supported' | 'unproven' | 'violated';
  evidenceIds: string[];
  note?: string;
}

export interface Requirement {
  id: string; // e.g. REQ-2283
  title: string;
  sourceUrl: string;
  /** markdown excerpt of the requirement text */
  body: string;
  criteria: Criterion[];
}

// ───────────────────────────── diff model ─────────────────────────────

export interface DiffLine {
  t: 'ctx' | 'add' | 'del';
  /** old line number (ctx/del) */
  o?: number;
  /** new line number (ctx/add) */
  n?: number;
  s: string; // text without the +/-/space prefix
}

export interface Hunk {
  id: string; // "F3.H2"
  header: string; // @@ -a,b +c,d @@ context
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
  unitId: string;
}

export interface FileDiff {
  id: string; // "F3"
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  language: string; // csharp, markdown, xml, t4 …
  hunks: Hunk[];
}

export type UnitKind =
  | 'core-logic' // the behavioural change itself
  | 'api-surface' // public API / attributes / diagnostics ids
  | 'test' // tests added or changed
  | 'generated' // generated output / snapshots / golden files
  | 'mechanical' // same transformation repeated (rename, attribute added everywhere)
  | 'docs'
  | 'build-config'; // csproj, props, CI, dependencies

/** A ChangeUnit is the unit of review: a set of hunks that are one idea. */
export interface ChangeUnit {
  id: string; // U1 …
  title: string; // "Guard diagnostics that point outside the compilation"
  kind: UnitKind;
  summary: string; // 1–2 sentences, plain language
  hunkIds: string[];
  fileCount: number;
  additions: number;
  deletions: number;
  tier: RiskTier;
  /** explainable factors that produced the tier — every factor is a fact someone can check */
  riskFactors: RiskFactor[];
  /** requirement criteria this unit serves; empty = untraced change */
  criteriaIds: string[];
  traced: boolean;
  /** what the human is asked to do with this unit */
  ask: 'read' | 'skim' | 'none';
  /** why a human may skip it (only for ask === 'none'): the proof that replaces reading */
  skipProof?: { text: string; evidenceIds: string[] };
  /** order in the story (1-based); units are presented in narrative order, not file order */
  storyOrder: number;
  /** reviewer's note on what to look at when reading */
  readingNote?: string;
}

export interface RiskFactor {
  key:
    | 'blast-radius'
    | 'public-api'
    | 'security-sensitive'
    | 'untested'
    | 'untraced'
    | 'novel-logic'
    | 'size'
    | 'area-trust'
    | 'dependency'
    | 'mechanical-verified'
    | 'generated-verified'
    | 'docs-only'
    | 'test-only'
    | 'error-handling'
    | 'behaviour-change'
    | 'security-rule';
  label: string; // "Called from 14 places"
  detail: string; // how it was measured
  points: number; // signed contribution to the risk score
  evidenceIds?: string[];
}

// ───────────────────────────── evidence ─────────────────────────────

export interface RunResult {
  sha: string;
  /** what the worktree contained, e.g. "base source + PR tests" */
  label: string;
  outcome: 'pass' | 'fail' | 'build-error' | 'error';
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  /** names of failing tests (trimmed) */
  failing?: string[];
  /** short excerpt of the decisive output */
  excerpt?: string;
  /** relative path of the full log under the dossier's evidence dir */
  log?: string;
}

export type EvidenceKind =
  | 'build' // head builds
  | 'red-green' // PR tests fail on base, pass on head
  | 'regression' // existing suite: nothing that passed on base fails on head
  | 'ablation' // revert one unit of the change, run tests: do they notice?
  | 'repro' // agent-written reproduction of the requirement or of a finding
  | 'mechanical' // deterministic equivalence proof for mechanical/generated units
  | 'reference-scan' // blast radius measurement
  | 'quote-check' // cited code exists verbatim
  | 'canary' // reviewer self-test with planted bugs
  | 'analysis'; // model reasoning (weakest)

export interface Evidence {
  id: string; // E1 …
  kind: EvidenceKind;
  strength: Strength;
  title: string;
  /** one-sentence plain-language conclusion */
  conclusion: string;
  /** does this evidence support or undermine the change */
  polarity: 'supports' | 'undermines' | 'neutral';
  /** exact command a human can re-run */
  command?: string;
  base?: RunResult;
  head?: RunResult;
  /** for ablation: which unit was reverted and what the tests did */
  ablation?: { unitId: string; result: RunResult; killed: boolean };
  /** for mechanical proofs */
  mechanical?: { rule: string; matched: number; total: number; exceptions: string[] };
  /** for reference scans */
  references?: { symbol: string; count: number; sample: CodeRef[] };
  refs?: CodeRef[];
  /** generated test/probe source, when the agent wrote one */
  probeSource?: { path: string; language: string; code: string };
  producedBy: string; // stage or agent name
  durationMs?: number;
}

// ───────────────────────────── deterministic security lens ─────────────────────────────

export interface SecurityPackageChange {
  name: string;
  from?: string;
  to?: string;
  file: string;
}

export interface SecurityRuleHit {
  ruleId: string;
  description: string;
  path: string;
  line: number;
  text: string;
  /** Added lines are the only lines that are matched by the lens today. */
  change: 'new' | 'moved' | 'context';
  route: 'read' | 'skim' | 'none';
  points: number;
  unitId?: string;
}

export interface SecurityDependencies {
  comparedFiles: string[];
  added: SecurityPackageChange[];
  removed: SecurityPackageChange[];
  changed: SecurityPackageChange[];
  newSources: string[];
  changedBuildScripts: string[];
  changedCiWorkflows: string[];
  newAnalyzers: string[];
  newSourceGenerators: string[];
}

export interface SecurityBuildComponent {
  name: string;
  version?: string;
  purl?: string;
}

export interface SecurityBuildSide {
  buildId: string;
  components: SecurityBuildComponent[];
}

export interface SecurityBuildEvidence {
  provider: 'craci';
  base: SecurityBuildSide;
  head: SecurityBuildSide;
  added: SecurityPackageChange[];
  removed: SecurityPackageChange[];
  changed: SecurityPackageChange[];
  networkHosts?: string[];
  strength: 'executed';
  evidenceId?: string;
}

export interface SecurityReport {
  dependencies: SecurityDependencies;
  hits: SecurityRuleHit[];
  evidenceIds: string[];
  build?: SecurityBuildEvidence;
  cannotSee: string[];
}

/** A compact, immutable record of one review head.  It is optional for old dossiers. */
export interface ReviewRound {
  headSha: string;
  at: string;
  verdict: Recommendation['verdict'];
  findings: { id: string; title: string; severity: Finding['severity']; strength: Strength; reproTest?: { evidenceId: string; command?: string; source?: string } }[];
  signoff?: { signer: string; decision: Attestation['decision']; at: string };
  fixRequest?: FixRequest;
}

export interface ReproofEntry {
  fromRound: number;
  findingId: string;
  title: string;
  status: 'fixed' | 'still-fails' | 'could-not-rerun';
  evidenceId: string;
  reason?: string;
}

export interface ProvenanceCommit {
  sha: string;
  sessionId: string;
  agent: string;
  model?: string;
  prompt: string;
  toolCalls: number;
  testCommands: { cmd: string; lastOutcome: string }[];
  files: string[];
}

export interface Provenance {
  tool: 'entire';
  commits: ProvenanceCommit[];
  crossCheck?: string;
  /** The session is the author's account, never review evidence. */
  role: 'author-context-only';
}

export interface FixRequest {
  round: number;
  at: string;
  commentUrl?: string;
  findings: { findingId: string; title: string; severity: Finding['severity']; evidenceId: string; testSource: string; command?: string }[];
  contextFindings: { findingId: string; title: string }[];
  decisionsStayWithHuman: boolean;
}

// ───────────────────────────── findings ─────────────────────────────

export interface Finding {
  id: string; // FN1 …
  title: string;
  severity: 'blocker' | 'major' | 'minor' | 'note';
  category: 'correctness' | 'security' | 'performance' | 'api-compat' | 'maintainability' | 'test-gap' | 'scope';
  /** what is wrong, in plain language */
  body: string;
  /** concrete failure scenario */
  scenario?: string;
  refs: CodeRef[];
  strength: Strength;
  evidenceIds: string[];
  suggestion?: string;
  unitId?: string;
  /** Where the finding came from. Audit findings have not been reproduced by default. */
  origin?: 'review' | 'audit';
  reproduced?: boolean;
  /** human feedback, feeds the trust ledger */
  feedback?: { verdict: 'accepted' | 'rejected'; by: string; at: string; note?: string };
}

/** A finding the reviewer raised and the verifier killed. Shown, never hidden. */
export interface DiscardedFinding {
  id: string;
  title: string;
  claimed: string;
  reason: 'quote-not-found' | 'repro-failed' | 'duplicate' | 'out-of-scope' | 'contradicted-by-evidence';
  detail: string;
}

// ───────────────────────────── refusals ─────────────────────────────

/** Something the AI will not decide. It lays out the question and evidence; a human answers. */
export interface Refusal {
  id: string; // R1 …
  question: string; // "Is it acceptable to silently drop diagnostics for metadata types?"
  /** why this is a human decision (policy, product, compatibility, risk appetite …) */
  why: string;
  reasonKind: 'policy' | 'product-intent' | 'compatibility' | 'risk-appetite' | 'missing-context' | 'security-posture';
  options: { id: string; label: string; consequence: string; implemented?: boolean; implementedWhy?: string }[];
  /** what the AI knows that bears on the decision */
  context: string;
  evidenceIds: string[];
  refs?: CodeRef[];
  unitId?: string;
  /** must be answered before sign-off */
  blocking: boolean;
  answer?: { optionId: string; by: string; at: string; note?: string };
}

// ───────────────────────────── story + diagrams ─────────────────────────────

export interface Story {
  /** one sentence a non-author understands */
  headline: string;
  /** before: what was broken / missing */
  before: string;
  /** after: what the change makes true */
  after: string;
  /** how, 3–6 steps in narrative order; each step may point at units */
  steps: { text: string; unitIds: string[] }[];
  /** what else it touches (side effects, behaviour changes outside the requirement) */
  alsoTouches: string[];
}

/** Layout-free diagram spec; the UI lays it out and renders as Excalidraw. */
export interface Diagram {
  id: string;
  title: string;
  kind: 'change-map' | 'before-after' | 'sequence';
  caption: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups?: { id: string; label: string }[];
}

export interface DiagramNode {
  id: string;
  label: string;
  sublabel?: string;
  /** changed = touched by this PR; affected = downstream of a change; context = unchanged neighbour */
  role: 'changed' | 'added' | 'removed' | 'affected' | 'context' | 'test' | 'external' | 'requirement';
  group?: string;
  unitId?: string;
  tier?: RiskTier;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  style?: 'solid' | 'dashed';
  /** new = introduced by this PR; broken = path that failed before the change */
  role?: 'new' | 'removed' | 'existing' | 'broken';
}

// ───────────────────────────── reviewer self-test ─────────────────────────────

export interface Canary {
  id: string;
  /** what bug was planted, revealed only after the reviewer ran */
  description: string;
  path: string;
  line: number;
  endLine?: number;
  kind?: 'single-line' | 'multi-line' | 'cross-file';
  caughtByTests: boolean;
  caughtByReviewer: boolean;
  note?: string;
  missReason?: string;
  matchWhy?: string;
}

export interface SelfTest {
  planted: number;
  caught: number;
  canaries: Canary[];
  planterModel?: string;
  planterFamily?: string;
  /** plain-language reading of the result */
  reading: string;
}

// ───────────────────────────── routing + recommendation ─────────────────────────────

export interface Routing {
  tier: RiskTier;
  score: number;
  /** the area(s) of the codebase and their current trust level from the ledger */
  areas: { area: string; trustLevel: number; trustLabel: string }[];
  /** lines a human is asked to read / skim / may skip */
  readLines: number;
  skimLines: number;
  skipLines: number;
  totalLines: number;
  estMinutes: number;
  /** was this PR sampled for a full-read spot check of the AI reviewer */
  spotCheck: { selected: boolean; reason: string };
  policyVersion: string;
  /** rules from the policy that fired */
  rulesFired: string[];
}

export interface Recommendation {
  /** advice only. never an approval. */
  verdict: 'accept' | 'accept-after-decisions' | 'changes-requested' | 'full-read-required';
  summary: string;
  /** what would change the AI's mind / make it distrust this dossier */
  distrustIf: string[];
}

export interface NotChecked {
  what: string;
  why: string;
}

export interface AuditIssue {
  unitId: string;
  path: string;
  line: number;
  title: string;
  why: string;
  severity: Finding['severity'];
}

export interface AuditFinding {
  id: string;
  verdict: 'agrees' | 'disputes';
  why: string;
}

export interface Audit {
  model: string;
  family: string;
  linesAudited: number;
  unitsAudited: number;
  issues: AuditIssue[];
  findings: AuditFinding[];
  durationMs: number;
}

export interface Consistency {
  fixed: string[];
}

// ───────────────────────────── sign-off ─────────────────────────────

export interface Attestation {
  signer: string; // GitHub login
  signerName?: string;
  at: string;
  decision: 'accepted' | 'rejected';
  headSha: string;
  /** units the human marked as read */
  readUnitIds: string[];
  /** answers to refusals */
  answers: { refusalId: string; optionId: string; label: string; note?: string }[];
  /** findings accepted / rejected */
  findingFeedback: { findingId: string; verdict: 'accepted' | 'rejected' }[];
  checkedByAI: string[];
  checkedByHuman: string[];
  notChecked: string[];
  residualRisk: string[];
  reviewSeconds: number;
  /** sha256 over the canonical attestation + previous ledger hash */
  hash: string;
  prevHash: string;
  github?: { statusUrl?: string; commentUrl?: string };
  /** how the signer was identified: their own GitHub token, the server's GitHub account, or a synthetic demo reviewer */
  identity?: 'github' | 'server' | 'demo';
  /** seconds the server clocked on each unit the signer marked read */
  readSeconds?: Record<string, number>;
  /** risk the signer typed themselves, word for word (also listed in residualRisk) */
  humanRisk?: string[];
  /** confirmed problems this accept was given over, and the signer's written reason, word for word */
  override?: { items: string[]; reason: string };
  /** the review was faster than the floor for this reading plan: it never counts toward an area's trust */
  rushed?: boolean;
  /** second signature, required while an area of the change is on probation */
  cosign?: { signer: string; signerName?: string; at: string; readUnitIds: string[]; reviewSeconds: number; hash: string; prevHash: string };
}

/** One person's review of one dossier, kept by the server (not by the browser). */
export interface ReviewerState {
  login: string;
  name?: string;
  startedAt: string;
  /** seconds with the review open and in front, clocked by the server from heartbeats */
  activeSeconds: number;
  lastBeat?: string;
  lastUnit?: string;
  units: Record<string, { seconds: number; readAt?: string }>;
}

/** What the server adds to a dossier when it is fetched: the viewer and the state that is true right now. */
export interface LiveState {
  me: { login: string; name: string; avatarUrl?: string; kind: 'github' | 'server' | 'demo' };
  /** units this person has marked read, as recorded by the server */
  read: string[];
  activeSeconds: number;
  unitSeconds: Record<string, number>;
  /** seconds a unit must have been open before the server takes a read mark */
  floors: Record<string, number>;
  /** areas of this change that are on probation right now (after an escape): full read and a second signer */
  probation: string[];
  /** first signature taken, waiting for a different person to co-sign */
  firstSign?: { signer: string; signerName?: string; at: string };
  /** confirmed problems an accept would be given over (needs a written reason) */
  overrides: string[];
  /** false when this copy never posts to GitHub */
  publishes: boolean;
  cleanAfterDays: number;
}

// ───────────────────────────── pipeline trace ─────────────────────────────

export interface StageTrace {
  name: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  startedAt?: string;
  durationMs?: number;
  model?: string;
  /** metered cost of this stage's Claude model calls; absent when the stage made none (or only GPT calls on a Codex seat, which report no price) */
  costUsd?: number;
  agentCalls?: number;
  detail?: string;
}

// ───────────────────────────── the dossier ─────────────────────────────

export interface Dossier {
  schema: 1;
  id: string; // "owner/repo#12"
  slug: string; // "owner__repo__12"
  status: 'running' | 'ready' | 'signed' | 'rejected' | 'failed';
  generatedAt: string;
  pr: PullRequestInfo;
  requirement: Requirement;
  story: Story;
  diagrams: Diagram[];
  units: ChangeUnit[];
  files: FileDiff[];
  evidence: Evidence[];
  /** Deterministic dependency and sensitive-surface check. */
  security?: SecurityReport;
  findings: Finding[];
  discarded: DiscardedFinding[];
  refusals: Refusal[];
  notChecked: NotChecked[];
  selfTest?: SelfTest;
  audit?: Audit;
  consistency?: Consistency;
  /** Review history; absent on dossiers written before the fix loop. */
  rounds?: ReviewRound[];
  reproof?: ReproofEntry[];
  provenance?: Provenance;
  routing: Routing;
  recommendation: Recommendation;
  stages: StageTrace[];
  signoff?: Attestation;
  /** first of two signatures (area on probation); becomes `signoff` when a second person co-signs */
  firstSign?: Attestation;
  /** added by the server on fetch; never stored */
  live?: LiveState;
}

/** Lightweight row for the inbox. */
export interface DossierSummary {
  id: string;
  slug: string;
  status: Dossier['status'];
  title: string;
  prUrl: string;
  number: number;
  repo: string;
  author: string;
  authorKind: 'agent' | 'human';
  requirementId: string;
  tier: RiskTier;
  verdict: Recommendation['verdict'];
  readLines: number;
  totalLines: number;
  estMinutes: number;
  /** the reading plan is void and every line is the signer's: drawn for a spot check, or no skip was earned */
  fullRead?: 'spot-check' | 'no-skip' | 'probation';
  changedFiles: number;
  criteriaProven: number;
  criteriaTotal: number;
  findings: number;
  blockers: number;
  refusalsOpen: number;
  signer?: string;
  generatedAt: string;
}

// ───────────────────────────── trust ledger ─────────────────────────────

export type LedgerEventType =
  | 'review' // dossier produced
  | 'fix-request' // evidence-only request sent to the author agent
  | 'signoff' // human accepted/rejected
  | 'finding-feedback' // human marked an AI finding real / not real
  | 'spot-check' // human did a full read on a sampled PR; did they find something the AI missed?
  | 'escape' // revert / incident traced to a signed PR
  | 'trust-change'; // an area's trust level moved

export interface LedgerEvent {
  id: string;
  at: string;
  type: LedgerEventType;
  pr?: string; // dossier id
  area?: string;
  actor: string; // github login or "countersign"
  summary: string;
  data?: Record<string, unknown>;
  /** true for seeded demo history */
  synthetic?: boolean;
  prevHash: string;
  hash: string;
}

export interface AreaTrust {
  area: string;
  paths: string[];
  criticality: 'low' | 'medium' | 'high';
  /** 0 Probation · 1 Supervised · 2 Trusted · 3 Proven */
  level: number;
  label: string;
  /** what the level means for routing */
  effect: string;
  signoffs: number;
  escapes: number;
  spotChecks: number;
  spotCheckMisses: number;
  findingsAccepted: number;
  findingsRejected: number;
  /** signed PRs since the last escape; drives promotion */
  cleanStreak: number;
  /** accepted sign-offs still inside the waiting period: they count once it has passed with no revert */
  provisional?: number;
  /** sign-offs that were faster than the floor and never count */
  rushed?: number;
  nextLevelAt?: number;
  history: { at: string; level: number; reason: string }[];
}

export interface WeeklyMetric {
  week: string; // ISO week start date
  prs: number;
  medianReviewMinutes: number;
  medianTimeToMergeHours: number;
  escapes: number; // reverts + incidents
  findingsRaised: number;
  findingsAccepted: number;
  routedT0: number;
  routedT1: number;
  routedT2: number;
  routedT3: number;
  spotChecks: number;
  spotCheckMisses: number;
  synthetic?: boolean;
}

export interface LedgerView {
  areas: AreaTrust[];
  events: LedgerEvent[];
  weekly: WeeklyMetric[];
  totals: {
    prs: number;
    signed: number;
    escapes: number;
    escapeRate: number;
    findingPrecision: number;
    humanReadShare: number; // share of changed lines a human was asked to read
    medianReviewMinutes: number;
    spotCheckAgreement: number;
  };
  /** what really happened on this server: never mixed into `totals` or `weekly`, which are the seeded history only */
  real: RealLedger;
  /** the backtest on merged history, when it has been run */
  backtest?: Backtest;
  /** days a sign-off waits, with no revert, before it counts toward an area's trust */
  cleanAfterDays: number;
  chainOk: boolean;
}

export interface RealSignoff {
  pr: string;
  signer: string;
  cosigner?: string;
  at: string;
  decision: 'accepted' | 'rejected';
  minutes: number;
  readLines: number;
  totalLines: number;
  /** provisional: inside the waiting period · clean: waited it out · escaped: reverted or caused an incident · rushed: faster than the floor, never counts */
  state: 'provisional' | 'clean' | 'escaped' | 'rushed' | 'rejected';
  countsFrom?: string;
}
export interface RealLedger {
  reviews: number;
  totalLines: number;
  readLines: number;
  readShare: number;
  findingsShown: number;
  findingsJudged: number;
  findingsAccepted: number;
  escapes: number;
  spotChecks: number;
  spotCheckMisses: number;
  signoffs: RealSignoff[];
  /** how the AI reviewer itself was tested on these reviews; computed from the dossiers, not from the ledger */
  reviewer?: ReviewerCheck;
}
/** The checks on the reviewer, added up over the real reviews on this server. */
export interface ReviewerCheck {
  reviews: number;
  /** reviews in which bugs were planted */
  selfTested: number;
  planted: number;
  caughtByReviewer: number;
  caughtByTests: number;
  caughtByNeither: number;
  byKind: { kind: string; planted: number; caught: number }[];
  planter?: string;
  /** findings: raised by the reviewer, killed before a person saw them, shown, shown with a reproducing run */
  raised: number;
  killed: number;
  killedBy: Record<string, number>;
  shown: number;
  executed: number;
  /** the second model family's read of the lines the plan lets a person skip or skim */
  audited: number;
  auditLines: number;
  auditIssues: number;
  auditModel?: string;
  /** the second family's opinion of the shown findings */
  auditAgrees: number;
  auditDisputes: number;
}
export interface BacktestRow {
  pr: number;
  title: string;
  mergedAt: string;
  kind: 'escaped' | 'control';
  fix?: { pr: number; title: string; daysLater: number; lines: { path: string; line: number }[] };
  tier: RiskTier;
  lines: { total: number; read: number; skim: number; skip: number };
  findingsShown: number;
  outcome: 'caught' | 'routed' | 'skim' | 'missed' | 'full-read' | 'clean' | 'failed';
  why: string;
  estMinutes: number;
  wallMinutes: number;
  costUsd: number;
}
export interface Backtest {
  generatedAt: string;
  method: string;
  population: { from: string; to: string; mergedPrsConsidered: number; eligible: number; seed: number };
  runs: number;
  completed: number;
  failed: number;
  escaped: { prs: number; caught: number; routed: number; skim: number; missed: number; fullRead: number };
  controls: { prs: number; findingsShown: number; findingsPerPr: number };
  lines: { total: number; read: number; skim: number; skip: number };
  readFraction: number;
  medianEstMinutes: number;
  medianWallMinutes: number;
  totalCostUsd: number;
  caveats: string[];
  rows: BacktestRow[];
}

/** What GitHub itself reports for a reviewed pull request, read live. */
export interface GitHubNow {
  /** the newest `countersign/sign-off` status on the reviewed head commit, as GitHub reports it */
  status?: { state: string; description: string; by: string; at: string; url?: string };
  /** how many times that status was set on this commit */
  statusCount: number;
  comment?: { url: string; by: string; at: string };
  headSha: string;
  /** false when the pull request has moved past the reviewed commit */
  headIsCurrent: boolean;
  prState: string;
  /** the base branch's protection rule requires the Countersign check before a merge */
  required: boolean;
  base: string;
  /** GitHub's own merge state for the pull request: BLOCKED, CLEAN, UNSTABLE, … */
  mergeState: string;
  readAt: string;
}
