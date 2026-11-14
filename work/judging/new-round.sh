#!/usr/bin/env bash
# Freeze what the judges of one round see: the built UI, the docs, the video. Starts one clean instance per judge.
# Usage: work/judging/new-round.sh <round number>
set -euo pipefail
cd "$(dirname "$0")/../.."
N=${1:?round}
R=/bulk2/runs/linearcodereview/judging/r$N
mkdir -p "$R/submission" "$R/dist" "$R/verdicts"
rsync -a --delete web/dist/ "$R/dist/"
cp docs/CONCEPT.md docs/WALKTHROUGH.md docs/LESSONS.md README.md "$R/submission/"
cp /bulk2/runs/linearcodereview/demo/countersign-demo.mp4 "$R/submission/countersign-demo.mp4"
i=0
for j in sol opus fable; do
  port=$((4319 + i)); i=$((i + 1))
  work/judge-instance.sh "$port" "$R/dist"
  mkdir -p "$R/submission-$j"
  cp "$R/submission/"* "$R/submission-$j/"
  sed -e "s|\`DEMO_URL\`|http://localhost:$port (live product, your own private copy: you can click, decide and sign freely)|" -e "s|\`VIDEO_URL\`|countersign-demo.mp4 (in this folder)|" -e 's|`docs/CONCEPT.md`|CONCEPT.md|g; s|`docs/WALKTHROUGH.md`|WALKTHROUGH.md|g; s|`docs/LESSONS.md`|LESSONS.md|g' docs/SUBMISSION.md > "$R/submission-$j/SUBMISSION.md"
  cat > "$R/brief-$j.md" <<BRIEF
You are a judge at Junction 2026, Europe's largest hackathon, on the panel for one partner challenge. You are a senior engineering leader at the partner company. You have forty team submissions to get through today; this is one of them. Judge it exactly as the real panel would. Do the work yourself, start no subagents.

## The challenge and the official judging criteria
Read every line of /home/ubuntu/junction/linearcodereview/work/judging/CHALLENGE.md first. The four criteria and their weights at the end of that file are the only scoring rubric.

## The submission
Everything the team submitted is in $R/submission-$j/ :
- SUBMISSION.md  (the submission form text; start here)
- CONCEPT.md, WALKTHROUGH.md, LESSONS.md, README.md  (the deliverables the challenge asks for)
- countersign-demo.mp4  (the demo video)
- The live product: http://localhost:$port  (your own private copy; nothing you do there leaves this machine)
The source code is at /home/ubuntu/junction/linearcodereview (read only; look if you want to check a claim, do not modify anything, do not run its scripts).

## How to judge
1. Watch the demo video the way a judge does, start to finish, as a first-time viewer. You cannot play video directly: extract a frame every second with ffmpeg into a scratch folder under /tmp, look at the frames in order, and transcribe the audio (the Python package faster_whisper is installed, use: from faster_whisper import WhisperModel; model "small" on CPU is enough) so you know what is said when. Note what you understood after 15 seconds, and where you got lost or bored.
2. Use the live product in a real browser, as a judge would at the team's table: open it, follow the team's WALKTHROUGH.md, then go off script and try to break their claims. Drive headless Chrome with Playwright (playwright-core and /usr/bin/google-chrome are installed; \`cd /bulk2/runs/linearcodereview/shoot\` has node_modules with playwright-core; write your own scripts and screenshots under /tmp/judge-$j-r$N/, and LOOK at the screenshots). Go through a whole review of at least one pull request to the end, including making the decisions and signing. Open at least one other pull request, the ledger and the concept page.
3. Read the written deliverables critically. Check claims against what the product actually does. A claim you catch being inflated should cost them.
4. Compare against what a strong field of 40 teams at a top European hackathon would bring to this same challenge.

## Scoring
Be harsh and calibrated: 5 = average submission, 7 = solid hackathon project, 8 = podium candidate, 9 = wins the challenge, 10 = the best thing you have seen at a hackathon. Do not be polite. Do not reward effort, only what a judge would see and believe.

Write your verdict to $R/verdicts/$j.md AND return the same text as your final answer, in exactly this structure:

SCORES
Clarity: N/10 - one sentence why
Practicality: N/10 - one sentence why
Measurement: N/10 - one sentence why
Evidence: N/10 - one sentence why
Overall: N/10
Placement: where it finishes in a strong field of 40 teams (e.g. "top 3", "5th-8th", "mid-pack") and why

THE 3 REASONS IT LOSES
1. …
2. …
3. …

WHAT WOULD MOVE EACH SCORE TO 9+  (concrete, per criterion)

BROKEN OR UNCONVINCING  (every bug, confusing screen, inflated claim, ugly moment, with where you saw it)

FIRST 15 SECONDS OF THE VIDEO  (what you understood, verbatim impression)

ANSWERS TO THE JUDGE QUESTIONS  (did the submission answer: what would make you not trust your own output; who owns the decision; how would this scale; one line each on how well)

Finally add one last line to the file, machine readable, exactly like:
JSON {"clarity":N,"practicality":N,"measurement":N,"evidence":N,"overall":N}
BRIEF
done
echo "round $N ready in $R"
