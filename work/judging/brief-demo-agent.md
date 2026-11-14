You are the demo agent for Countersign, our entry to the Junction 2026 hackathon challenge "Earned Trust in AI Code" (Tieto). Your job each round: watch the whole demo as a first-time viewer, decide honestly whether it is at least as clear and as epic as our best previous hackathon demo, and then FIX it until it is. Do the work yourself, start no subagents.

## Watch first, in this order
1. Our best previous demo, the bar: /home/ubuntu/work/ycagentshack/film/out/clify-submission-v11.mp4 (source: /home/ubuntu/work/ycagentshack/film, a Remotion project with README.md, REVIEW.md, render-v11.sh, scripts/). Also /home/ubuntu/work/argonhack-submission/stormsim-sf-demo-final.mp4. Extract a frame every second with ffmpeg and LOOK at them in order; transcribe the audio (python package faster_whisper is installed). Write down what makes it work: the hook, pacing, how product footage is framed and zoomed, title cards, type, music, the ending.
2. The current Countersign demo: /bulk2/runs/linearcodereview/demo/countersign-demo.mp4 (2:12). Same treatment. Its pipeline: /home/ubuntu/junction/linearcodereview/work/demo/ (script.md, record.ts, tts.mjs, make.sh; one command `./work/demo/make.sh` from the project root re-records and re-renders). All binaries live in /bulk2/runs/linearcodereview/demo/.
3. A live run of the product as a first-time user: http://localhost:4318 (throwaway copy, open writes, never posts to GitHub; `/home/ubuntu/junction/linearcodereview/work/judge-instance.sh` resets it). Routes: `/` Inbox, `/pr/toukoursin__junction26-messagepack-csharp__1?c=<chapter>` (chapters: change, how, asked, proof, reviewer, FN1.., R1.., U1.., skipped, limits, sign), `/ledger`, `/concept`. Keys: →/J next, ←/K back, N next thing needing you, 1/2 judge a finding, 1–9 pick a decision option, R mark read, / Ask, [ ] switch tab, Space play/pause diagram, ⌘K palette. Playwright-core + /usr/bin/google-chrome are available (see /bulk2/runs/linearcodereview/shoot). NEVER write to http://localhost:4317.
4. The challenge and what judges score: /home/ubuntu/junction/linearcodereview/work/judging/CHALLENGE.md. The team's claims: /home/ubuntu/junction/linearcodereview/docs/SUBMISSION.md and docs/CONCEPT.md. Say nothing in the video that these and the product do not support.

## What is known to be wrong with the current video (my own first look; verify, then go further)
- It is a plain full-screen screen recording. At video size the UI text is unreadable, and four-line captions cover the lower half of the frame. The clify film never does this.
- No designed opening, no title cards, no zooms onto the thing being talked about, no visual variety, no build-up, no ending card. Nothing epic.
- A stranger does not get what it is and why it matters in 15 seconds from the picture alone.

## What "fixed" means
- Rebuild it as a designed film, the way clify was made (Remotion; reuse that project's structure, components and render approach): real product footage placed inside composed frames, cropped and zoomed so the words being discussed are readable on a phone, with callouts/highlights that point at the exact element (the "39 of 228 lines" budget, the red→green run, the planted bugs caught, the reproduced finding, the decision the AI refuses, the four lists you sign, the trust ledger chart), kinetic title cards for the hook, the three judge questions and the close, short one-line captions in a safe area, music bed if a licensed/generated track is at hand (clify's or ElevenLabs music), and the narration (ElevenLabs via `hsec exec --only ELEVENLABS_API_KEY -- <cmd>`; never print the key).
- The first 15 seconds must land the problem and the answer for someone who has never heard of it: an AI agent wrote the pull request, your name is on the approval, Countersign shows what was proven by running it, what was not, and what only you can decide; you read 39 of 228 lines and sign by name for the rest.
- It must show where trust comes from (evidence that ran, traced to the requirement), what the AI found, what it refused to decide and why, the named human sign-off, and how trust is measured in the ledger; and answer in plain words: what would make us not trust our own output, who owns the decision, how it scales.
- Length 1:45–2:20, 1920×1080, 30 fps, H.264 + AAC. Narration: plain spoken English, short sentences, no hype words, no em dashes, concrete numbers from the product.
- Keep it re-renderable: one command (update work/demo/make.sh) that re-records the product footage and renders the film, because the UI still changes tonight. Drive the product by URL and keyboard, not brittle selectors. Final file stays at /bulk2/runs/linearcodereview/demo/countersign-demo.mp4 with versioned copies next to it. Scripts and text in work/demo/, every binary under /bulk2/runs/linearcodereview/demo/.

## Quality gate
After each render: frames every second, look at all of them, transcribe the audio, check sync, readability at 50% size, dead time, and the first 15 seconds cold. Score it against clify on hook, clarity, pace, polish, epicness (each /10, be harsh). Iterate until every one is at least clify's, or you have truly run out of what can be done tonight.

## Rules
- Do not edit anything under web/, server/, pipeline/, shared/, data/, docs/ or README.md. Product bugs or ugly screens you notice: list them in your report.
- `rm` only literal paths. Do not use paid Anthropic API keys. Do not upload anything anywhere except TTS/music text to ElevenLabs.

## Report back (short)
Scores vs clify before and after (hook, clarity, pace, polish, epicness); what you changed; the re-render command and how long it takes; what is still weaker than clify and why; product bugs or ugly screens seen.
