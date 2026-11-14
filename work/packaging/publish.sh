#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
message=${1:?usage: work/packaging/publish.sh 'commit message'}
git add -A
scan_file=work/packaging/.staged-scan.txt
scan_dir="/tmp/countersign-staged-scan-$$"
mkdir -p "$scan_dir"
trap 'rm -rf "${scan_dir:?}"' EXIT
git checkout-index --all --prefix="$scan_dir/"
gitleaks dir --no-banner --redact "$scan_dir" > "$scan_file" 2>&1 || {
  echo "secret scan failed; see $scan_file" >&2
  git reset >/dev/null
  exit 1
}
if git grep --cached -n -I -E '(ghp_|gho_|github_pat_|(^|[^A-Za-z])sk-[A-Za-z0-9]|AIza|xox[baprs]-|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|https?://[^/]+:[^/@]+@|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)' -- \
  ':!work/packaging/publish.sh' ':!work/packaging/SCAN.md' ':!work/judging/brief-packaging.md' ':!work/author-agent/run.sh'; then
  echo "secret-pattern scan failed" >&2
  git reset >/dev/null
  exit 1
fi
git commit -m "$message"
git push origin main
