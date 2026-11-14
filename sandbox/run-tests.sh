#!/usr/bin/env bash
# run-tests.sh --worktree <abs dir> --project <csproj or dir, relative to worktree> --out <abs dir>
#              [--filter <dotnet test --filter expr>] [--framework <tfm>] [--timeout <seconds, default 1500>]
#              [--sdk <version, e.g. 9.0.100>]   (overrides the worktree's global.json inside the container only)
#
# Runs `dotnet test` for one project inside docker, as the host uid, in two steps:
#   1. restore  - network on,  shared NuGet cache read-write
#   2. build+test - `--network none`, shared NuGet cache read-only, all capabilities dropped
# Writes <out>/log.txt and <out>/result.json; exits 0 whenever result.json was written.
#
# Env knobs: SANDBOX_IMAGE, SANDBOX_NUGET_CACHE, SANDBOX_TEST_NETWORK (default none; "bridge" to allow network
# during tests), SANDBOX_DOCKER_ARGS (extra `docker run` args, e.g. "--cpus 16 --memory 16g").
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(dirname "$HERE")
IMAGE=${SANDBOX_IMAGE:-countersign-sandbox:dotnet8.0.402-r3}
NUGET=${SANDBOX_NUGET_CACHE:-$ROOT/.cache/nuget}
TEST_NETWORK=${SANDBOX_TEST_NETWORK:-none}

WT=""; PROJECT=""; OUT=""; FILTER=""; FRAMEWORK=""; TIMEOUT=1500; SDK=""
usage() { sed -n '2,4p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree)  WT=${2-}; shift 2 ;;
    --project)   PROJECT=${2-}; shift 2 ;;
    --out)       OUT=${2-}; shift 2 ;;
    --filter)    FILTER=${2-}; shift 2 ;;
    --framework) FRAMEWORK=${2-}; shift 2 ;;
    --timeout)   TIMEOUT=${2-}; shift 2 ;;
    --sdk)       SDK=${2-}; shift 2 ;;
    *) echo "run-tests.sh: unknown argument: $1" >&2; usage ;;
  esac
done
[ -n "$WT" ] && [ -n "$PROJECT" ] && [ -n "$OUT" ] || usage
case "$WT" in /*) ;; *) echo "run-tests.sh: --worktree must be absolute" >&2; exit 2 ;; esac
case "$OUT" in /*) ;; *) echo "run-tests.sh: --out must be absolute" >&2; exit 2 ;; esac
case "$TIMEOUT" in ''|*[!0-9]*) echo "run-tests.sh: --timeout must be whole seconds" >&2; exit 2 ;; esac
WT=${WT%/}; OUT=${OUT%/}

mkdir -p "$OUT/trx" || { echo "run-tests.sh: cannot create $OUT" >&2; exit 2; }
find "$OUT/trx" -maxdepth 1 -type f -name '*.trx' -delete
LOG=$OUT/log.txt
: > "$LOG"

now_ms() { date +%s%3N; }
T0=$(now_ms); RESTORE_MS=0; TEST_MS=0
NAME="countersign-$(basename "$WT" | tr -c 'A-Za-z0-9_.-' '_' | cut -c1-40)-$$-$RANDOM"
cleanup() { docker rm -f "$NAME-restore" "$NAME-test" >/dev/null 2>&1; }
trap cleanup EXIT
trap 'exit 130' INT TERM

finish() { # finish <status> <exit code> [message]
  python3 "$HERE/trx_result.py" --out "$OUT" --status "$1" --exit-code "$2" --message "${3-}" \
    --duration-ms $(( $(now_ms) - T0 )) --restore-ms "$RESTORE_MS" --test-ms "$TEST_MS" || exit 1
  exit 0
}
say() { echo "[run-tests] $*" >> "$LOG"; }

[ -d "$WT" ] || finish infra 0 "worktree not found: $WT"
[ -e "$WT/$PROJECT" ] || finish infra 0 "project not found in worktree: $PROJECT"
case "$(realpath -m -- "$WT/$PROJECT")" in "$WT"/*) ;; *) finish infra 0 "project escapes the worktree: $PROJECT" ;; esac

mkdir -p "$NUGET/packages" "$NUGET/http-cache" "$NUGET/plugins-cache" "$NUGET/scratch" "$NUGET/locks"

# obj/ and bin/ live inside the worktree, so two runs on the same worktree would corrupt each other:
# serialise per worktree (different worktrees run fully in parallel). Waiting counts against the timeout.
exec 8>"$NUGET/locks/wt-$(printf %s "$WT" | sha1sum | cut -c1-16).lock"
flock -w "$TIMEOUT" 8 || finish timeout 124 "timeout after ${TIMEOUT}s waiting for another run on the same worktree"

# Image: build once (serialised so parallel first runs do not stampede).
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  say "building image $IMAGE"
  ( flock 9; docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -q -t "$IMAGE" "$HERE" ) \
      9>"$NUGET/.image-build.lock" >> "$LOG" 2>&1 || finish infra 0 "could not build sandbox image $IMAGE"
fi

# Packages that tests fetch at run time (see prefetch-packages.txt): download once into the shared cache.
PREFETCH_ID=$(sha1sum "$HERE/prefetch-packages.txt" | cut -c1-12)
if [ ! -e "$NUGET/prefetch/$PREFETCH_ID/.done" ]; then
  say "prefetching run-time packages"
  (
    flock 9
    [ -e "$NUGET/prefetch/$PREFETCH_ID/.done" ] && exit 0
    mkdir -p "$NUGET/prefetch/$PREFETCH_ID"
    {
      echo '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup>'
      # one PackageDownload item per id, versions joined as "[a];[b]"
      awk '!/^[[:space:]]*(#|$)/ { v[$1] = (v[$1] ? v[$1] ";" : "") "[" $2 "]" }
           END { for (id in v) printf "  <PackageDownload Include=\"%s\" Version=\"%s\" />\n", id, v[id] }' "$HERE/prefetch-packages.txt"
      echo '</ItemGroup></Project>'
    } > "$NUGET/prefetch/$PREFETCH_ID/prefetch.csproj"
    timeout 600 docker run --rm --init --user "$(id -u):$(id -g)" -v "$NUGET:/nuget" -w "/nuget/prefetch/$PREFETCH_ID" \
      -e NUGET_PACKAGES=/nuget/packages -e NUGET_HTTP_CACHE_PATH=/nuget/http-cache -e NUGET_SCRATCH=/nuget/scratch \
      "$IMAGE" dotnet restore prefetch.csproj < /dev/null && touch "$NUGET/prefetch/$PREFETCH_ID/.done"
  ) 9>"$NUGET/.prefetch.lock" >> "$LOG" 2>&1 || finish infra 0 "could not prefetch run-time packages"
fi

# A git worktree keeps its metadata in the main repo's .git; mount that read-only at the same path so
# Nerdbank.GitVersioning / SourceLink inside the container can resolve HEAD.
MOUNTS=(-v "$WT:$WT")
if GITCOMMON=$(git -C "$WT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  case "$GITCOMMON" in "$WT"/*) ;; *) MOUNTS+=(-v "$GITCOMMON:$GITCOMMON:ro") ;; esac
fi

# --sdk: shadow global.json with a pinned one, in the container only (the worktree on disk is untouched).
if [ -n "$SDK" ] && [ -f "$WT/global.json" ]; then
  case "$SDK" in *[!0-9A-Za-z.-]*) finish infra 0 "bad --sdk value: $SDK" ;; esac
  printf '{ "sdk": { "version": "%s", "rollForward": "disable" } }\n' "$SDK" > "$OUT/global.json"
  MOUNTS+=(-v "$OUT/global.json:$WT/global.json:ro")
fi

COMMON=(--rm --init --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges
        -w "$WT"
        -e NUGET_PACKAGES=/nuget/packages -e NUGET_HTTP_CACHE_PATH=/nuget/http-cache
        -e NUGET_PLUGINS_CACHE_PATH=/nuget/plugins-cache)
# shellcheck disable=SC2206
EXTRA=(${SANDBOX_DOCKER_ARGS-})

run_step() { # run_step <container name> <docker args...> ; returns the step's exit code, 124 on timeout
  local name=$1; shift
  local left=$(( TIMEOUT - ( $(now_ms) - T0 ) / 1000 ))
  [ "$left" -gt 0 ] || return 124
  timeout --signal=TERM --kill-after=15 "$left" docker run --name "$name" "$@" >> "$LOG" 2>&1 < /dev/null
  local rc=$?
  if [ $rc -eq 124 ] || [ $rc -eq 137 ]; then docker kill "$name" >/dev/null 2>&1; docker rm -f "$name" >/dev/null 2>&1; return 124; fi
  return $rc
}

# ---- 1. restore (network on) ---------------------------------------------------------------------------------
say "image=$IMAGE worktree=$WT project=$PROJECT filter=${FILTER:-<none>} framework=${FRAMEWORK:-<all>} sdk=${SDK:-<global.json>} timeout=${TIMEOUT}s"
say "restore (network on)"
t=$(now_ms)
# NUGET_SCRATCH holds NuGet's cross-process lock files; it must be shared between containers, otherwise
# parallel restores race while extracting the same package into the shared cache.
run_step "$NAME-restore" "${COMMON[@]}" "${EXTRA[@]}" "${MOUNTS[@]}" -v "$NUGET:/nuget" -e NUGET_SCRATCH=/nuget/scratch \
  "$IMAGE" dotnet restore "$PROJECT"
rc=$?; RESTORE_MS=$(( $(now_ms) - t ))
[ $rc -eq 124 ] && finish timeout 124 "timeout after ${TIMEOUT}s (during restore)"
[ $rc -eq 125 ] || [ $rc -eq 126 ] || [ $rc -eq 127 ] && finish infra $rc "docker run failed (exit $rc)"
[ $rc -ne 0 ] && finish restore-failed $rc

# ---- 2. build + test (no network) ----------------------------------------------------------------------------
CMD=(dotnet test "$PROJECT" --no-restore --results-directory /out/trx --logger "trx;LogFilePrefix=results")
[ -n "$FILTER" ] && CMD+=(--filter "$FILTER")
[ -n "$FRAMEWORK" ] && CMD+=(--framework "$FRAMEWORK")
# Without network, point user-level NuGet at the shared cache so run-time package lookups resolve offline.
PRE=":;"
[ "$TEST_NETWORK" = none ] && PRE='mkdir -p "$HOME/.nuget/NuGet" && cp /opt/countersign/NuGet.offline.Config "$HOME/.nuget/NuGet/NuGet.Config" &&'
say "test (network=$TEST_NETWORK): ${CMD[*]}"
t=$(now_ms)
run_step "$NAME-test" "${COMMON[@]}" "${EXTRA[@]}" "${MOUNTS[@]}" --network "$TEST_NETWORK" \
  -v "$NUGET:/nuget:ro" -v "$OUT/trx:/out/trx" \
  "$IMAGE" sh -c "$PRE"' exec "$@"' sh "${CMD[@]}"
rc=$?; TEST_MS=$(( $(now_ms) - t ))
[ $rc -eq 124 ] && finish timeout 124 "timeout after ${TIMEOUT}s (during build/test)"
[ $rc -eq 125 ] || [ $rc -eq 126 ] || [ $rc -eq 127 ] && finish infra $rc "docker run failed (exit $rc)"
finish ran $rc
