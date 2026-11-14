#!/usr/bin/env bash
set -euo pipefail

# Countersign's author-agent replay. It only sees the repository and the newest fix-request comment.
PR_URL=${1:?usage: work/author-agent/run.sh <PR url>}
ROOT=/home/ubuntu/junction/linearcodereview
RUN_ROOT=/bulk2/runs/linearcodereview/author-agent
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SCRATCH="$RUN_ROOT/$STAMP"
mkdir -p "$SCRATCH" "$RUN_ROOT/provenance"

OWNER=$(gh pr view "$PR_URL" --json repository --jq '.repository.owner.login')
REPO=$(gh pr view "$PR_URL" --json repository --jq '.repository.name')
NUMBER=$(gh pr view "$PR_URL" --json number --jq .number)
BRANCH=$(gh pr view "$PR_URL" --json headRefName --jq .headRefName)
AUTHOR_NAME=$(gh pr view "$PR_URL" --json commits --jq '.commits[-1].authors[0].name // "author-agent"')
AUTHOR_EMAIL=$(gh pr view "$PR_URL" --json commits --jq '.commits[-1].authors[0].email // "author-agent@users.noreply.github.com"')
HEAD_BEFORE=$(gh pr view "$PR_URL" --json headRefOid --jq .headRefOid)

# Fetch only the reviewed repository and branch.
gh repo clone "$OWNER/$REPO" "$SCRATCH/repo" -- --quiet --branch "$BRANCH"
cd "$SCRATCH/repo"
git config user.name "$AUTHOR_NAME"
git config user.email "$AUTHOR_EMAIL"

# Entire is local-only here: no login and no mirror. Refs are inspected after the session.
ENTIRE_LOG="$SCRATCH/entire.log"
if command -v entire >/dev/null 2>&1; then
  entire enable --agent claude-code --checkpoint-backend refs --local --skip-push-sessions --yes >"$ENTIRE_LOG" 2>&1 || true
else
  echo "Entire CLI was not installed; capture unavailable" >"$ENTIRE_LOG"
fi

COMMENTS=$(gh api "repos/$OWNER/$REPO/issues/$NUMBER/comments?per_page=100")
FIX_JSON=$(python3 -c 'import json,sys,re
cs=json.load(sys.stdin)
for c in reversed(cs):
    if "<!-- countersign-fix-request -->" not in c.get("body",""): continue
    m=re.search(r"<!-- countersign-fix-request-json\\s*(.*?)\\s*-->", c["body"], re.S)
    if m:
        print(m.group(1)); break
' <<<"$COMMENTS")
if [[ -z "$FIX_JSON" ]]; then
  echo "No fix request comment found" >&2
  exit 3
fi
printf '%s\n' "$FIX_JSON" > "$SCRATCH/fix-request.json"

PROMPT=$(python3 - "$SCRATCH/fix-request.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]))
parts=["You are the coding agent that authored this pull request. You can see only this repository and this fix-request comment.",
       "Make the smallest correct change that makes every listed failing test pass. Add the regression tests to the normal test suite.",
       "Do not resolve open decisions. Do not weaken or delete existing tests. Run the listed tests and relevant focused tests.",
       "Commit the changes on the current branch. The commit message must say what you changed and what you left alone.", "", "Fix request JSON:", json.dumps(r,indent=2)]
print("\n".join(parts))
PY
)
printf '%s\n' "$PROMPT" > "$SCRATCH/prompt.txt"

# Match pipeline/lib/agent.ts: Claude Code runs through the seat pool, never a paid key.
SESSION_OUT="$SCRATCH/claude.json"
START=$(date +%s)
hsec exec --only CLIPROXY_API_KEY -- bash -lc 'export ANTHROPIC_BASE_URL=http://127.0.0.1:8317; export ANTHROPIC_API_KEY="$CLIPROXY_API_KEY"; claude -p --model "'${CS_MODEL:-claude-opus-5-5}'" --tools Read,Grep,Glob,Write,Edit,Bash --allowedTools Read,Grep,Glob,Write,Edit,Bash --permission-mode acceptEdits --strict-mcp-config --setting-sources "" --no-session-persistence --output-format json' <<<"$PROMPT" >"$SESSION_OUT"
END=$(date +%s)

# The model is allowed to make the commit; ensure a clean, attributable commit exists if it forgot.
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "Fix Countersign reproductions; leave open decisions unchanged"
fi
if [[ "$(git rev-parse HEAD)" == "$HEAD_BEFORE" ]]; then
  echo "Author agent made no commit" >&2
  exit 4
fi
NEW_SHA=$(git rev-parse HEAD)
git push origin "HEAD:$BRANCH"

# Keep a local, machine-readable export for Countersign. It is author context, never evidence.
MODEL=$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("model",""))
except: print("")' "$SESSION_OUT")
TOOL_CALLS=$(python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get("num_turns",0))
except: print(0)' "$SESSION_OUT")
TESTS=$(grep -Eo '(dotnet test|pytest)[^"[:cntrl:]]*' "$SESSION_OUT" | tail -20 || true)
FILES=$(git diff-tree --no-commit-id --name-only -r "$NEW_SHA" | python3 -c 'import json,sys; print(json.dumps([x.strip() for x in sys.stdin if x.strip()]))')
SESSION_ID=$(entire checkpoint list --json 2>/dev/null | python3 -c 'import json,sys
try:
 j=json.load(sys.stdin); xs=j if isinstance(j,list) else j.get("checkpoints",[]); print((xs[-1].get("id") or xs[-1].get("sessionId")) if xs else "")
except: print("")' || true)
[[ -n "$SESSION_ID" ]] || SESSION_ID="local-entire-$NEW_SHA"
python3 - "$RUN_ROOT/provenance/$NEW_SHA.json" "$NEW_SHA" "$SESSION_ID" "$AUTHOR_NAME" "$MODEL" "$TOOL_CALLS" "$START" "$END" "$FILES" "$TESTS" <<'PY'
import json,sys
out,sha,sid,agent,model,calls,start,end,files,tests=sys.argv[1:]
json.dump({"sha":sha,"sessionId":sid,"agent":agent,"model":model,"prompt":open(os.path.join(os.path.dirname(out),"..",os.path.basename(out)),"w").name if False else "Make the listed failing tests pass with the smallest correct change.","toolCalls":int(calls or 0),"testCommands":[{"cmd":x,"lastOutcome":"observed in author session"} for x in tests.splitlines() if x],"files":json.loads(files),"wallSeconds":int(end)-int(start),"entireLog":""},open(out,"w"),indent=2)
PY

CS_BASIC=$(sed -n 's/^CS_BASIC=//p' "$ROOT/work/server.env")
PAYLOAD=$(python3 - "$PR_URL" <<'PY'
import json,sys
print(json.dumps({"action":"synchronize","pull_request":{"html_url":sys.argv[1]}}))
PY
)
curl -fsS -u "$CS_BASIC" -H 'content-type: application/json' -H 'x-github-event: pull_request' --data "$PAYLOAD" http://localhost:4317/api/github/webhook >/dev/null
printf 'author-agent: %s -> %s (%ss)\n' "$HEAD_BEFORE" "$NEW_SHA" "$((END-START))"
