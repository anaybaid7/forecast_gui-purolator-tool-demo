#!/usr/bin/env bash
#
# run_tests.sh
# ------------
# Runs the full test suite: backend math/API tests (pytest) and the
# frontend ratio-split tests (plain Node).
#
# Usage:
#   ./run_tests.sh
#
# Exits non-zero if anything fails, so it's safe to use as a pre-push check
# or CI step.

set -e

cd "$(dirname "$0")"

echo "== Backend tests (pytest) =="
python3 -m pytest tests/ -v

echo ""
echo "== Frontend ratio-split tests (node) =="
node tests/test_ratio_split.js

echo ""
echo "== Extra week smoke test =="
python3 tests/smoke_extra_week.py

echo ""
echo "All tests passed."
