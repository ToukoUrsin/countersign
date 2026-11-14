#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP=${CS_DATA_BACKUP:-/bulk2/runs/linearcodereview/data-backup}
DEMO_DATA=${CS_DEMO_DATA:-deploy/demo-data}
[ -d "$BACKUP/dossiers" ] || { echo "clean data backup not found: $BACKUP" >&2; exit 1; }
mkdir -p "$DEMO_DATA"
d="$DEMO_DATA"; f=dossiers; rm -rf "${d:?}/${f:?}"
mkdir -p "$DEMO_DATA/dossiers"
rsync -a --delete "$BACKUP/dossiers/" "$DEMO_DATA/dossiers/"
cp "$BACKUP/ledger.jsonl" "$DEMO_DATA/ledger.jsonl"
./deploy/capture-github-snapshot.sh
echo "demo data refreshed from $BACKUP"
