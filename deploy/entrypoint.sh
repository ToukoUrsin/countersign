#!/bin/sh
set -eu
d=/tmp/countersign-data
rm -rf "${d:?}"
mkdir -p "$d"
cp -a /app/deploy/demo-data-clean/. "$d/"
(
  while sleep 1800; do
    if find "$d/dossiers" -name dossier.json -type f -exec grep -l '"signoff"[[:space:]]*:[[:space:]]*{' {} \; | grep -q .; then
      rm -rf "${d:?}"
      mkdir -p "$d"
      cp -a /app/deploy/demo-data-clean/. "$d/"
    fi
  done
) &
exec bun server/index.ts
