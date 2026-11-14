# Countersign submission demo

Target: 1:45–2:15, 1920×1080, 30 fps, dark theme.

The narration is split into the same chapters as the recording. The browser footage is the real product at `http://localhost:4318`; the safe judge instance is reset before every render.

| Chapter | Product route / action | Narration |
|---|---|---|
| Hook | Inbox | An agent wrote this pull request. Your name goes on the approval. Countersign shows what was proven, what was not, and what only you can decide. |
| Inbox | `/` | Four agent pull requests wait here. The inbox is sorted by the work left for a person. This one needs 39 lines read out of 228. |
| Change | `?c=change` | The dossier starts with the change, before and after. The story is separate from findings. The diagram is an explanation, not evidence. |
| Criteria | `?c=asked` | The requirement becomes six acceptance criteria before the code is read. The criteria agent never saw the diff. This is the bar the change must meet. |
| Proof | `?c=proof` | Now the sandbox runs red to green tests, regression, and an ablation for each hunk. Three hunks are noticed. One is not. That code is routed to me. |
| Reviewer | `?c=reviewer` | The reviewer is tested on this diff. Four bugs were planted. The blind reviewer caught all four. The test suite caught two. |
| Finding | `?c=FN1` | A finding must survive a skeptic and a reproduction. This one is real: the fix silently drops a diagnostic for code the user owns. Killed findings stay visible. |
| Decision | `?c=R1` | The AI refuses product decisions. Should the diagnostic be dropped, reported without a location, or attached to the consuming member? The owner chooses. |
| Read | `?c=U1` | Only the routed units need my attention. I read the lines no run could settle. The rest is covered by proof that I can run again. |
| Ask | `?c=how`, `/` then type a question | I can ask the dossier a question. The answer is generated live and labelled explanation. It helps me read, but it never becomes evidence. |
| Not checked | `?c=skipped` | This is what nobody checked: other target frameworks, trimming, and prior behaviour. The gaps are part of the attestation. |
| Sign | `?c=sign` | The AI does not approve. I sign four lists: checked by AI, checked by me, not checked, and the risk I accept. The signature names the commit. A new commit needs a new name. |
| Ledger | `/ledger` | The ledger measures trust by code area: escapes, false alarms, time to merge, and how much is routed to people. Clean sign offs raise a level. One escape drops it. |
| Close | `/concept` | What would make us stop trusting this output? Missed planted bugs, failed stages, code no test notices, or a decision with missing context. The signer owns the decision. Reading follows risk, not diff size. Countersign: AI reviews. A named human countersigns. |

The exact text is also stored in `narration.json` after `make.sh` synthesises it.
