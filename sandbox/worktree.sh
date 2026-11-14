#!/usr/bin/env bash
# worktree.sh <dest abs dir> <commit-ish> [--overlay <other commit-ish> -- <path>...]
#
# Creates a detached git worktree of $REPO (default: vendor/mp) at <dest> for <commit-ish>.
# With --overlay, the listed paths are taken from <other commit-ish> on top of it
# ("base source + the PR's test files"). Paths missing in <other> are deleted from the worktree,
# paths missing in <commit-ish> are simply created.
# An existing <dest> is removed and recreated. <dest> must be under $WORK_ROOT.
set -euo pipefail

ROOT=/home/ubuntu/junction/linearcodereview
WORK_ROOT=$ROOT/work
REPO=${REPO:-$ROOT/vendor/mp}

die() { echo "worktree.sh: $*" >&2; exit 2; }

[ $# -ge 2 ] || die "usage: worktree.sh <dest abs dir> <commit-ish> [--overlay <other commit-ish> -- <path>...]"
dest=$1; commit=$2; shift 2

overlay=""; paths=()
if [ $# -gt 0 ]; then
  [ "$1" = "--overlay" ] || die "unknown argument: $1"
  [ $# -ge 4 ] || die "--overlay needs: <other commit-ish> -- <path>..."
  overlay=$2
  [ "$3" = "--" ] || die "expected -- after the overlay commit-ish"
  shift 3
  paths=("$@")
fi

# dest must be an absolute, already-normalised path strictly below work/.
case "$dest" in /*) ;; *) die "dest must be absolute: $dest" ;; esac
[ "$(realpath -m -- "$dest")" = "$dest" ] || die "dest must be a normalised path without symlinks or ..: $dest"
case "$dest" in "$WORK_ROOT"/?*) ;; *) die "refusing dest outside $WORK_ROOT/: $dest" ;; esac

git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repo: $REPO"
sha=$(git -C "$REPO" rev-parse --verify --quiet "$commit^{commit}") || die "unknown commit-ish: $commit"
osha=""
if [ -n "$overlay" ]; then
  osha=$(git -C "$REPO" rev-parse --verify --quiet "$overlay^{commit}") || die "unknown overlay commit-ish: $overlay"
fi

mkdir -p "$(dirname -- "$dest")"

# Worktree add/remove touch shared metadata in $REPO/.git, so serialise them per repo.
lock="$(git -C "$REPO" rev-parse --absolute-git-dir)/countersign-worktree.lock"
(
  flock 9
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    git -C "$REPO" worktree remove --force "$dest" >/dev/null 2>&1 || true
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      rm -rf -- "${dest:?}"   # not a registered worktree (or half-removed): only this literal path
    fi
  fi
  git -C "$REPO" worktree prune
  git -C "$REPO" worktree add --quiet --detach "$dest" "$sha"
) 9>"$lock"

if [ -n "$osha" ]; then
  for p in "${paths[@]}"; do
    case "$p" in /*|..|../*|*/../*|*/..) die "overlay path must be relative to the repo root: $p" ;; esac
    if git -C "$dest" cat-file -e "$osha:$p" 2>/dev/null; then
      git -C "$dest" checkout --quiet "$osha" -- "$p"
    elif git -C "$dest" ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then
      git -C "$dest" rm -r --quiet --force -- "$p"      # deleted in the overlay commit
    else
      echo "worktree.sh: warning: overlay path exists in neither commit: $p" >&2
    fi
  done
fi

echo "worktree $dest @ $sha${osha:+ + overlay $osha (${#paths[@]} path(s))}"
