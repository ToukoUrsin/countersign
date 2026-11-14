/**
 * The concept card's words. Layout lives in pages/Concept.tsx and reads only this shape,
 * so the text can be rewritten without touching the page.
 * Keep in line with docs/CONCEPT.md and docs/LESSONS.md. Every number here comes from the five
 * sample dossiers (bun work/facts.ts), data/backtest/summary.json or the policy file; seeded ledger numbers are named as seeded.
 */
export interface Concept {
  name: string;
  tagline: string;
  recommendation: string;
  /** who owns what: the AI owns evidence and advice, a named person owns decisions and the signature */
  owns: { who: string; what: string; items: string[] }[];
  /** the conditions under which the reading plan is void and every unit must be read */
  readEverything: { then: string; when: { title: string; body: string }[] };
  /** the routing table: score to depth, the floors no score can lower, and the facts that move the score */
  routing: { note: string; tiers: { depth: string; score: string; rule: string }[]; raises: string[]; lowers: string[] };
  principles: { title: string; body: string; balances: string }[];
  flow: { title: string; body: string }[];
  tradeoffs: { choice: string; gain: string; cost: string }[];
  limits: string[];
  failureModes: { mode: string; seen: string; mitigation: string }[];
  decisions: { when: string; decision: string; why: string }[];
  judgeAnswers: { q: string; a: string }[];
}

export const concept: Concept = {
  name: 'Countersign',
  tagline: 'Skip a line only when a run covers it, and sign by name for everything else.',
  recommendation:
    'Do not read AI-written pull requests line by line, and never let a model approve one. A line may go unread only when a named check that ran covers it. A named engineer reads the rest, makes the decisions the AI refuses to make, and signs a statement of exactly what was and was not checked. The server, not the browser, keeps the record of what that person did.',
  owns: [
    {
      who: 'The AI',
      what: 'Evidence and advice',
      items: [
        'Runs the tests in a sandbox and attaches the output',
        'Tries to refute each of its own findings, and re-runs the test that reproduces it',
        'Names the proof behind every line it lets you skip, and has a second model family audit those lines',
        'Lists what nobody checked',
        'Gives a verdict labelled advice. It never approves',
      ],
    },
    {
      who: 'A named engineer',
      what: 'Decisions and the signature',
      items: [
        'Makes the decisions the AI refuses to make: product intent, compatibility, risk appetite',
        'Judges each finding real or not real',
        'Reads the lines no run covers, for at least the floor the server sets per unit',
        'Signs for one commit, for exactly what was and was not checked, and writes a reason to accept over a problem they confirmed',
      ],
    },
  ],
  readEverything: {
    then: 'The reading plan is void: the server takes no signature until every unit is marked read.',
    when: [
      { title: 'No requirement is linked', body: 'Nothing can be traced to an intent. A blocking question asks what the change is for, and who asked for it.' },
      { title: 'Nothing could be executed', body: 'No run, so no skip was earned.' },
      { title: 'Under half of the planted bugs were caught', body: 'The reviewer failed its own test on this change.' },
      { title: 'An area is on probation', body: 'After an escape, every line is read, and a second person co-signs after their own read. The first signer cannot.' },
      { title: 'The change is drawn for a spot check', body: 'The draw follows the area’s trust level and the head commit. The signer records whether the full read found anything the AI missed.' },
    ],
  },
  routing: {
    note: 'From the points table in the policy file on the base branch. A model’s opinion is not an input. The plan is deterministic given the findings, but findings can differ between runs.',
    tiers: [
      { depth: 'Skip', score: 'Below 1', rule: 'Only with a named proof: tests that fail on base and pass on head, a golden-file test that passes, or a mechanical rule checked on every file' },
      { depth: 'Skim', score: '1 to 2', rule: 'The floor for any unit without a named proof, and for high-criticality areas. Needs its own mark after a sixth of a second per line (3 to 12 s)' },
      { depth: 'Read', score: '3 to 5', rule: 'The floor for public API, for behaviour nobody asked for, and for code that serves no criterion. Marked after half a second per line (4 to 30 s)' },
      { depth: 'Read closely', score: '6 and up', rule: 'Always for security-sensitive code, whatever the score' },
    ],
    raises: [
      'Kind of code: public API +4, core logic +3, build config +2, tests, generated and mechanical +1',
      'Public API, security-sensitive, behaviour nobody asked for, serves no criterion: +3 each',
      'No test notices the hunk when it is reverted: +3',
      'A verified major finding +2, a blocker +4, a planted bug nobody caught +2',
      'Referenced from 20 or more places +2, 300 or more changed lines +2',
      'Area on probation +2, supervised +1',
    ],
    lowers: [
      'Every changed line matches one mechanical rule: −3',
      'Its tests fail on base and pass on head: −2, cancelled by a verified finding that those tests are weak',
      'Golden files regenerated by a passing test run: −2',
      'A test notices the hunk when it is reverted: −1',
      'Area at the top trust level: −1',
    ],
  },
  principles: [
    {
      title: 'Only a run can replace a read',
      body: 'A unit is skipped only when it names its proof: tests that fail on base and pass on head, a golden-file test that passes, or a mechanical rule checked on every file. A verified finding that those tests are weak cancels the skip. A model’s opinion never lowers a risk score.',
      balances: 'Confidence against evidence',
    },
    {
      title: 'The requirement sets the bar before anyone sees the code',
      body: 'An agent that never sees the diff turns the requirement into acceptance criteria, and independent tests are written against them. Code that serves no criterion goes to a person.',
      balances: 'Quality against the author’s own framing',
    },
    {
      title: 'The reviewer is checked by something it does not control',
      body: 'Every finding must survive an agent told to refute it, and Countersign re-runs the test that reproduces it. A second model family (GPT) plants bugs in the change to test the reviewer, and reads every line the plan lets a person skip or skim.',
      balances: 'Hallucination against missed bugs',
    },
    {
      title: 'A points table routes. A person decides',
      body: 'The reading plan comes from a policy file on the base branch. Product intent, compatibility and risk appetite go to the owner as questions with options and no recommendation; blocking ones stop the signature.',
      balances: 'Risk against automation',
    },
    {
      title: 'The signer owns one statement, built by the server',
      body: 'One server function builds the statement the signer previews and the one that is signed, so they cannot differ. It lists what the AI checked with evidence IDs, what the signer read, what nobody checked, and the risk they accept. Accepting over a problem the signer confirmed takes a written reason, quoted word for word.',
      balances: 'Transparency against speed',
    },
    {
      title: 'Trust belongs to a code area, earned slowly and lost at once',
      body: '3, 8 and 20 clean sign-offs in a row raise an area one level. A sign-off counts as clean only 14 days after signing with no revert or incident, and a rushed one never counts. One escape drops the area two levels.',
      balances: 'Risk over time against less reading',
    },
  ],
  flow: [
    { title: 'Requirement', body: 'The PR, its diff and its requirement ID. An agent that never sees the diff writes the acceptance criteria.' },
    { title: 'Units', body: 'Hunks become change units. Repetitive edits become one rule plus exceptions: 221 of 222 snapshot files carry one 3-line edit.' },
    { title: 'Prove', body: 'Docker, no network while tests run. Red-green, regression, and each hunk reverted to see whether a test notices.' },
    { title: 'Probe and review', body: 'Independent tests per criterion. Two reviewer lenses. Each finding is reproduced, refuted or merged.' },
    { title: 'Self-test', body: 'A second model family plants bugs, single-line, multi-line and cross-file. A catch needs the right place and the right meaning.' },
    { title: 'Route and audit', body: 'Points table from the policy file, then a second model family reads what may be skipped or skimmed, and a deterministic pass removes contradictions.' },
    { title: 'Countersign', body: 'A one-screen Brief, then only what needs you. The server clocks the reading and takes the signature for one commit; GitHub blocks the merge until then.' },
    { title: 'Ledger', body: 'Hash-chained. Real sign-offs are provisional for 14 days. Measured, backtest and seeded data are kept apart.' },
  ],
  tradeoffs: [
    { choice: 'Compute over attention', gain: 'REQ-2204 touches 92 files and asks a person for 8 lines', cost: '5.3 to 8.5 minutes of pipeline wall time and $0.80 to $7.17 of metered model cost per sample PR. Too heavy for a one-line change' },
    { choice: 'A points table for routing, no model judgment of risk', gain: 'Every depth can be explained from the policy file', cost: 'Crude. REQ-2283 asks a person to read 29 and skim 199 of 228 lines; REQ-2129 is a full read of 1043' },
    { choice: 'Skipping test files whose tests fail on base and pass on head', gain: 'Test bodies need no line-by-line read when they demonstrably detect the change', cost: 'A test can tell base from head and still assert the wrong thing. A finding cancels the skip only if one is raised' },
    { choice: 'No recommendation on refused decisions', gain: 'The choice is the owner’s, recorded under their name', cost: '11 decisions on five PRs, 6 of them blocking. Owner time moves from reading to deciding' },
    { choice: 'A person signs every change, after a floor of time on each unit', gain: 'No merge without an owner, and no one-second sign-off', cost: 'No auto-merge. A change with almost nothing to read still waits for a name' },
  ],
  limits: [
    'Reading floors measure attention, not understanding. A unit can be marked read after half a second per changed line (4 to 30 s). Someone can leave a tab open and understand nothing.',
    'Identity is a stand-in. Signing in means pasting a personal GitHub token that the server checks with GitHub. No OAuth app or SSO. Without sign-in the server’s own GitHub account signs.',
    'Findings differ between runs, so plans do. REQ-2283 asked for 39 of 228 lines in one run, 218 in the next and 29 (plus 199 to skim) in the latest, on the same commit.',
    'The reviewer misses planted bugs. GPT planted 18 bugs on four samples: the blind reviewer caught 11, the tests 9, and 3 were caught by neither. The reviewer caught 2 of 6 cross-file bugs.',
    '“Proven” means one independent test passed. Criteria, tests and findings come from Claude models; only the planter and the audit are GPT.',
    'A weak self-test does not void the plan when the advice is already “request changes”. On REQ-2283 the reviewer caught 0 of 2 planted bugs and the plan of 29 lines to read stood.',
    'Escapes are reported by hand on the ledger. Nothing reads reverts or incidents from the repository yet.',
    'One stack: .NET, net8.0, Linux. The sandbox is not security reviewed, prompt injection through a PR is untested, and blast radius is a text search.',
  ],
  failureModes: [
    { mode: 'A failed review that looked like a pass', seen: 'One run lost its model login mid-way. Four stages failed and the dossier still said “ready, accept, nothing to read”.', mitigation: 'If intent, map, review, verify or route fails, the review is failed: no advice, nothing to sign.' },
    { mode: 'Rubber-stamping raised trust', seen: 'A judge signed in one second through the raw API, and the ledger counted it as clean.', mitigation: 'Server-side reading record and floors. Rushed sign-offs never count, real ones are provisional for 14 days, and real data is never blended with seeded.' },
    { mode: 'The browser was the witness', seen: 'Read marks and review seconds came from the client.', mitigation: 'The server keeps both, from a heartbeat clock that only counts gaps of 15 s or less.' },
    { mode: 'Advice softer than the evidence', seen: '“Accept after decisions” next to a reproduced major regression.', mitigation: 'A confirmed major finding or an unimplemented option makes “Request changes” the default. A consistency stage removes contradictions.' },
    { mode: 'The same commit, two reading plans', seen: 'REQ-2283: 39 of 228 lines to read in one run, 218 in the next, 29 in the latest, because findings changed and a finding can cancel a test skip.', mitigation: 'Not fixed. Disclosed: routing is deterministic given the findings, the findings are not.' },
    { mode: 'Silent downgrade', seen: 'A stale base commit had no policy file. The run skipped the sandbox and still produced a tidy dossier.', mitigation: 'Policy comes from the live base branch. Skipped and failed stages are printed under “What nobody checked”.' },
    { mode: 'A green run of zero tests', seen: 'The test filter matched a data class, so nothing ran.', mitigation: 'Zero tests is an error, never a pass.' },
    { mode: 'An explanation that looks like proof', seen: 'A generated diagram sat next to test output and read as just as certain.', mitigation: 'Anything generated while you read is labelled “not evidence” and never enters what you sign.' },
  ],
  decisions: [
    { when: 'Fri 19:30', decision: 'A dossier per PR in place of comments on a diff', why: 'The owner has to answer whether the change does what was asked.' },
    { when: 'Fri 19:40', decision: 'A strength ladder and no confidence scores', why: 'A model’s number cannot be audited. A run can be repeated.' },
    { when: 'Fri 19:45', decision: 'Criteria from the requirement only', why: 'Otherwise the change defines its own success.' },
    { when: 'Fri 19:50', decision: 'Routing from a points table in a policy file', why: 'A depth must be explainable.' },
    { when: 'Fri 19:55', decision: 'The AI never approves', why: 'Accountability needs a name.' },
    { when: 'Fri 20:00', decision: 'Policy from the base branch', why: 'A stale base silently skipped execution.' },
    { when: 'Fri 20:10', decision: 'Trust per code area', why: 'Docs and the generator core do not deserve the same leash.' },
    { when: 'Fri 20:25', decision: 'Synthetic ledger history, labelled', why: 'The challenge allows synthetic data only, and a trust curve needs months.' },
    { when: 'Fri 22:00', decision: 'A guided review replaces the dossier page', why: 'One long page was a wall to read.' },
    { when: 'Sat 00:55', decision: 'One gate definition shared by server and UI', why: 'The UI enforced more than the server.' },
    { when: 'Sat 01:00 to 02:30', decision: 'Server-side reading record, clock and identity; rushed and provisional sign-offs', why: 'Round-1 judges signed in one second through the API and raised an area’s trust.' },
    { when: 'Sat 01:00 to 02:30', decision: 'Overrides with a written reason; probation co-sign', why: 'Decisions and confirmed findings had no consequence, and probation was policy text only.' },
    { when: 'Sat 01:00 to 02:30', decision: 'Required check on the base branch; backtest; second-family planter and audit', why: 'The merge gate was claimed, not shown; every outcome number was seeded; one model family was checking itself.' },
  ],
  judgeAnswers: [
    { q: 'What would make you not trust your own output?', a: 'No linked requirement, nothing executed, the reviewer catching under half of the bugs planted in this change, an area on probation, or a spot-check draw. Then every unit must be read before the server takes a signature. Below that line each review prints its own reasons on the Brief, such as a criterion backed only by the author’s tests or a planted bug the reviewer missed.' },
    { q: 'Who owns the decision?', a: 'The engineer who signs, by name, for one commit, under a statement the server builds and a clock the server keeps. The AI’s verdict is labelled advice, and GitHub blocks the merge until the signature.' },
    { q: 'How would this scale?', a: 'Reading follows risk, not diff size: 92 files needed 8 lines read, 28 files a full read. The first thing to run out is the owner’s time for decisions, about three per PR, then sandbox minutes.' },
    { q: 'How is trust measured, and what is real today?', a: 'Three sources, never blended. Measured here: 23 findings shown of 34 raised, 16 reproduced; 18.2% of changed lines routed to read; no real sign-off has passed its 14 days. Backtest: 3 later-fixed PRs, all routed to a person, but every backtest line was routed, and the AI flagged 0 of 3 itself. Seeded: 118 sign-offs, labelled.' },
    { q: 'Why not let the AI approve low-risk changes?', a: 'Because then nobody is accountable for them. A change with almost nothing to read costs the owner a minute or two, and their name is still on it.' },
    { q: 'What happens when it is wrong?', a: 'A person reports the revert or incident against the signed PR and the area drops two levels. At level 0 every line is read and a second person co-signs.' },
  ],
};
