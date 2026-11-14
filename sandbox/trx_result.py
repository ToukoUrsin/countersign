#!/usr/bin/env python3
"""Turns a run-tests.sh run (log.txt + TRX files) into <out>/result.json. Stdlib only."""
import argparse
import glob
import json
import os
import re
import xml.etree.ElementTree as ET

NS = {"t": "http://microsoft.com/schemas/VisualStudio/TeamTest/2010"}
MAX_EXCERPT = 1500
MAX_FAILING = 30
ANSI = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
# "path(1,2): error CS0103: ..." / "error MSB4018: ..." / "error NU1101: ..."
BUILD_ERROR = re.compile(r"(?:^|[\s:])error\s+[A-Z]{2,}\d+\s*:")
NETWORK_ERROR = re.compile(
    r"NU1301|Unable to load the service index|Resource temporarily unavailable|"
    r"Name or service not known|No such host is known|The SSL connection could not be established|"
    r"error NU1900|A connection attempt failed|timed out|TaskCanceledException"
)
SUMMARY = re.compile(r"^\s*(?:Passed!|Failed!)\s+-\s+Failed:.*$", re.M)


def clip(s, n=MAX_EXCERPT):
    s = s.strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def build_error_excerpt(log):
    seen, out = set(), []
    for line in log.splitlines():
        if not BUILD_ERROR.search(line):
            continue
        line = line.strip()
        key = re.sub(r"\s+\[[^\]]+\]$", "", line)  # msbuild repeats each error in its summary
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
    return clip("\n".join(out)) if out else ""


def tail(log, lines=15):
    return clip("\n".join([l for l in log.splitlines() if l.strip()][-lines:]))


def parse_trx(path):
    root = ET.parse(path).getroot()
    names = {}
    for ut in root.iterfind("t:TestDefinitions/t:UnitTest", NS):
        tm = ut.find("t:TestMethod", NS)
        if tm is None:
            continue
        cls, name = tm.get("className") or "", tm.get("name") or ut.get("name") or ""
        names[ut.get("id")] = name if (not cls or name.startswith(cls)) else cls + "." + name
    passed = failed = skipped = 0
    failures = []
    for r in root.iterfind("t:Results/t:UnitTestResult", NS):
        oc = r.get("outcome") or ""
        if oc == "Passed":
            passed += 1
        elif oc in ("Failed", "Error", "Timeout", "Aborted"):
            failed += 1
            msg = r.findtext("t:Output/t:ErrorInfo/t:Message", "", NS) or ""
            stack = r.findtext("t:Output/t:ErrorInfo/t:StackTrace", "", NS) or ""
            failures.append((names.get(r.get("testId")) or r.get("testName") or "?", msg, stack))
        else:  # NotExecuted, Inconclusive, ...
            skipped += 1
    return passed, failed, skipped, failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--status", required=True, choices=["ran", "restore-failed", "timeout", "infra"])
    ap.add_argument("--exit-code", type=int, default=0)
    ap.add_argument("--duration-ms", type=int, default=0)
    ap.add_argument("--restore-ms", type=int, default=0)
    ap.add_argument("--test-ms", type=int, default=0)
    ap.add_argument("--message", default="")
    a = ap.parse_args()

    log_path = os.path.join(a.out, "log.txt")
    try:
        with open(log_path, encoding="utf-8", errors="replace") as f:
            log = ANSI.sub("", f.read())
    except OSError:
        log = ""

    passed = failed = skipped = 0
    failures = []
    trx_files = sorted(glob.glob(os.path.join(a.out, "trx", "*.trx")))
    trx_problem = ""
    for p in trx_files:
        try:
            pa, fa, sk, fl = parse_trx(p)
        except ET.ParseError as e:
            trx_problem = f"unreadable TRX {os.path.basename(p)}: {e}"
            continue
        passed, failed, skipped = passed + pa, failed + fa, skipped + sk
        failures += fl

    if a.status == "infra":
        outcome, excerpt = "error", clip(a.message + "\n" + tail(log))
    elif a.status == "timeout":
        outcome, excerpt = "error", clip(f"{a.message}\n{tail(log)}")
    elif a.status == "restore-failed":
        errs = build_error_excerpt(log)
        if NETWORK_ERROR.search(log) or not errs:
            outcome, excerpt = "error", clip("restore failed (infrastructure)\n" + (errs or tail(log)))
        else:
            outcome, excerpt = "build-error", errs
    elif failed > 0:
        outcome = "fail"
        name, msg, stack = failures[0]
        head = "\n".join(stack.strip().splitlines()[:8])
        more = f"\n(+{failed - 1} more failing)" if failed > 1 else ""
        excerpt = clip(f"{name}\n{msg.strip()}\n{head}", MAX_EXCERPT - len(more)) + more
    elif trx_files and not trx_problem and a.exit_code == 0 and passed + skipped > 0:
        outcome = "pass"
        lines = SUMMARY.findall(log)
        excerpt = clip("\n".join(l.strip() for l in lines)) if lines else \
            f"Passed! - Failed: 0, Passed: {passed}, Skipped: {skipped}, Total: {passed + skipped}"
    else:
        errs = build_error_excerpt(log)
        if errs and not trx_files:
            outcome, excerpt = "build-error", errs
        elif "No test matches the given testcase filter" in log:
            outcome, excerpt = "error", "no tests matched the filter (0 tests ran)"
        else:
            why = trx_problem or (f"dotnet test exited {a.exit_code} without failed tests "
                                  "(test host crash / aborted run?)" if a.exit_code else "no test results were produced")
            outcome, excerpt = "error", clip(why + "\n" + (errs or tail(log)))

    failing = []
    for name, _, _ in failures:
        if name not in failing:
            failing.append(name)
    result = {
        "outcome": outcome,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "durationMs": a.duration_ms,
        "failing": failing[:MAX_FAILING],
        "excerpt": excerpt,
        "log": "log.txt",
        # extras (not part of the required contract)
        "exitCode": a.exit_code,
        "restoreMs": a.restore_ms,
        "testMs": a.test_ms,
    }
    tmp = os.path.join(a.out, "result.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, os.path.join(a.out, "result.json"))
    print(f"{outcome}: passed={passed} failed={failed} skipped={skipped} in {a.duration_ms}ms -> {a.out}/result.json")


if __name__ == "__main__":
    main()
