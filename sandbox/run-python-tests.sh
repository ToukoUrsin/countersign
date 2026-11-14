#!/usr/bin/env bash
# Python/pytest adapter. Dependencies are restored with network access; pytest itself
# runs in a separate container with network disabled and all capabilities dropped.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
IMAGE=${SANDBOX_PYTHON_IMAGE:-countersign-sandbox:python3.12-r1}
WT=""; PROJECT=""; OUT=""; FILTER=""; TIMEOUT=1500
while [ $# -gt 0 ]; do case "$1" in
  --worktree) WT=${2-}; shift 2;; --project) PROJECT=${2-}; shift 2;; --out) OUT=${2-}; shift 2;;
  --filter) FILTER=${2-}; shift 2;; --timeout) TIMEOUT=${2-}; shift 2;; --framework) shift 2;; --sdk) shift 2;;
  *) echo "run-python-tests.sh: unknown argument: $1" >&2; exit 2;; esac; done
[ -n "$WT" ] && [ -n "$PROJECT" ] && [ -n "$OUT" ] || exit 2
mkdir -p "$OUT"; : > "$OUT/log.txt"; T0=$(date +%s%3N)
finish() { python3 "$HERE/junit_result.py" --out "$OUT" --status "$1" --exit-code "${2:-0}" --duration-ms "$(( $(date +%s%3N)-T0 ))" --message "${3-}"; exit 0; }
[ -d "$WT" ] || finish infra 0 "worktree not found: $WT"
[ -e "$WT/$PROJECT" ] || finish infra 0 "test root not found: $PROJECT"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  (flock 9; docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -q -t "$IMAGE" -f "$HERE/python.Dockerfile" "$HERE") 9>"$HERE/.python-image.lock" >>"$OUT/log.txt" 2>&1 || finish infra 0 "could not build python sandbox image"
fi
# Restore declared dependencies while online, before the isolated test container starts.
if [ -f "$WT/requirements.txt" ]; then
  docker run --rm --user "$(id -u):$(id -g)" --network bridge -v "$WT:$WT" -w "$WT" "$IMAGE" sh -c 'python -m pip install --user -r requirements.txt' >>"$OUT/log.txt" 2>&1 || finish infra 0 "dependency restore failed"
fi
TARGET="$PROJECT"
# Independently generated probes are deliberately kept outside the PR suite.  Point
# pytest at the generated module explicitly; its filename is not test_*.py.
if [ -f "$WT/$PROJECT/CountersignProbes.py" ] && [ -n "$FILTER" ]; then
  # pytest's unittest collector requires test* method names, while the probe
  # contract deliberately lets the agent name criteria AC1_....  A tiny wrapper
  # exposes each unittest method as an ordinary pytest test without changing the
  # generated source or the PR worktree.
  WRAP="$WT/$PROJECT/test_CountersignProbes_generated.py"
  cat > "$WRAP" <<'PY'
import importlib.util, pathlib, unittest
_p = pathlib.Path(__file__).with_name("CountersignProbes.py")
_s = importlib.util.spec_from_file_location("countersign_generated", _p)
_m = importlib.util.module_from_spec(_s); _s.loader.exec_module(_m)
_cls = getattr(_m, "CountersignProbes")
for _name in dir(_cls):
    if _name.startswith("_") or not (_name.startswith("AC") or _name.startswith("test_")): continue
    def _make(name):
        def _test():
            case = _cls(name); result = unittest.TestResult(); case.run(result)
            if not result.wasSuccessful():
                details = [str(x[1]) for x in result.failures + result.errors]
                raise AssertionError("; ".join(details) or "generated probe failed")
        _test.__name__ = "test_" + name
        return _test
    globals()["test_" + _name] = _make(_name)
PY
fi
CMD=(pytest "$TARGET" --junitxml=/out/junit.xml -q)
[ -n "$FILTER" ] && CMD+=( -k "$FILTER" )
timeout --signal=TERM --kill-after=15 "$TIMEOUT" docker run --rm --init --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges --network none -v "$WT:$WT" -v "$OUT:/out" -w "$WT" "$IMAGE" "${CMD[@]}" >>"$OUT/log.txt" 2>&1
rc=$?; [ "$rc" -eq 124 ] && finish timeout 124 "pytest timed out"; finish ran "$rc"
