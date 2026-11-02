#!/bin/bash
# release-report.sh in dry-run mode: the report it would write for each case. Run: tests/release-report-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
A=$(printf 'a%.0s' {1..40})
fails=0
check() {  # name, expected python expression over r, args...
  local name=$1 expr=$2; shift 2
  local out
  if out=$(NETMON_REPORT_DRY_RUN=1 ./release-report.sh "$@" 2>/dev/null) &&
     python3 -c "import json,sys; r=json.loads(sys.argv[1]); sys.exit(0 if ($expr) else 1)" "$out"; then
    echo "ok   $name"
  else
    echo "FAIL $name: $out"; fails=$((fails + 1))
  fi
}
refuses() {  # name, args...
  local name=$1; shift
  if NETMON_REPORT_DRY_RUN=1 ./release-report.sh "$@" >/dev/null 2>&1; then
    echo "FAIL $name: accepted"; fails=$((fails + 1))
  else
    echo "ok   $name"
  fi
}

check "clean deploy" 'r["target"] == "netmon" and r["commit"] == "'"$A"'" and r["result"] == "deployed" and r["mechanism"] == "netmon-deploy" and r["dirty"] is False and r["message"] == "" and r["at"].endswith("+00:00")' deployed "$A" 0
check "dirty deploy says so" 'r["dirty"] is True and r["message"] == "deployed from uncommitted changes"' deployed "$A" 1
check "failed carries its step" 'r["result"] == "failed" and r["message"] == "Failed while reloading Prometheus" and "dirty" not in r' failed "$A" 1 "Failed while reloading Prometheus"
refuses "no commit" deployed "" 0
refuses "unknown result" rolled-back "$A" 0
refuses "too few arguments" deployed "$A"

# deploy.sh: hands the commit over, reports at the end, and reports a failure from the trap.
# shellcheck disable=SC2016 # the patterns are deploy.sh's own text, not expansions
if grep -q "bash -s -- '\$COMMIT' '\$DIRTY'" deploy.sh && grep -q 'report deployed "$commit" "$dirty"' deploy.sh &&
   grep -q 'report failed "$commit" "$dirty" "Failed while $step"' deploy.sh; then
  echo "ok   deploy.sh reports"
else
  echo "FAIL deploy.sh reports"; fails=$((fails + 1))
fi

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
echo "all passed"
