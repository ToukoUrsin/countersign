# Countersign demo pass

Compared with clify-submission-v11 and the original Countersign export as a first-time viewer. Final render: `/bulk2/runs/linearcodereview/demo/countersign-demo.mp4`.

| score /10 | clify bar | Countersign before | Countersign after |
|---|---:|---:|---:|
| hook | 9 | 4 | 8 |
| clarity | 9 | 4 | 8 |
| pace | 8 | 5 | 8 |
| polish | 9 | 3 | 8 |
| epicness | 8 | 2 | 7 |

Changed the plain recording into a Remotion film: framed product footage, focused crops and callouts, chapter labels, kinetic opening and closing cards, one-line safe-area captions, key fact cards for 39/228, red→green proof, 4/4 planted bugs, the human decision, four sign-off lists, and the trust ledger. The source lives in `work/demo/film/`; `work/demo/make.sh` still resets the disposable judge instance, re-records, synthesizes narration, and renders the film in one command.

The render command takes about 20 minutes on this three-core box after the recording/TTS step. The final file is 132.544 seconds, 1920×1080, 30 fps, H.264/AAC. I extracted one-second frames for the full cut and transcribed the final audio; the narration remains synchronized with the 14 chapters.

Still weaker than clify: clify has more visual variety and a more dramatic score, while Countersign's underlying UI is dense and dark, so some raw code text remains small even inside the frame. The zoomed change/proof views clip a little source text at the left edge by design.

Product ugliness seen: the dossier's raw code and evidence panes are very dark at video scale, and the long left navigation plus dense tables compete with the evidence panel. I did not change product code under the protected directories.
