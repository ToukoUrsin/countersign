#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
. work/server.env
set +a
BASE_URL=${CS_LOCAL_URL:-http://localhost:4317}
DEMO_DATA=${CS_DEMO_DATA:-deploy/demo-data}
tmp="/tmp/countersign-github-snapshot-$$"
mkdir -p "$tmp"
trap 'rm -rf "${tmp:?}"' EXIT
curl --fail --silent --show-error -u "$CS_BASIC" "$BASE_URL/api/dossiers" > "$tmp/dossiers.json"
bun -e 'const x=await Bun.file(process.argv[1]).json(); for (const d of x) console.log(d.slug)' "$tmp/dossiers.json" > "$tmp/slugs"
while IFS= read -r slug; do
  [ -n "$slug" ] || continue
  curl --fail --silent --show-error -u "$CS_BASIC" "$BASE_URL/api/dossiers/$slug/github" > "$tmp/$slug.json"
done < "$tmp/slugs"
python3 - "$tmp" "$DEMO_DATA/github-snapshot.json" <<'PY'
import datetime, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
dossiers = {}
for slug in (root / "slugs").read_text().splitlines():
    if not slug:
        continue
    value = json.loads((root / f"{slug}.json").read_text())
    value.pop("publishes", None)
    # The local instance's status target points at a throwaway tunnel. The public copy is
    # read-only, so omit that dead/private link rather than exposing it in the snapshot.
    if isinstance(value.get("status"), dict):
        value["status"].pop("url", None)
    dossiers[slug] = value
captured = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"capturedAt": captured, "dossiers": dossiers}, indent=1) + "\n")
PY
echo "captured GitHub snapshot for $(wc -l < "$tmp/slugs") dossier(s)"
