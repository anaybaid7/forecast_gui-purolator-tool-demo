# Tests

Covers the math that's easy to silently break with a future edit: the
Total.Del.Pcs.N <-> {PCL.Del.Pcs.N, Agent.Del.Pcs.N} relationship and the
ratio-based split when editing Total directly.

## Running everything

```bash
pip install -r requirements-dev.txt --break-system-packages
./run_tests.sh
```

This runs both suites below. Exits non-zero if anything fails.

## What's covered

**`test_table_math.py`** (pytest, hits the real Flask app via its test
client) -- the backend half:

- Total = PCL + Agent for every forecast week, with and without overrides
- Overriding PCL or Agent individually shows up correctly when viewing Total
- The `base_a` / `base_b` / `fc_a` / `fc_b` fields the frontend depends on
  for the ratio split are correct
- A full round trip: edit Total -> compute the PCL/Agent split (same math
  the frontend uses) -> send those overrides back -> Total matches the edit
- `/api/export` (the CSV) matches what `/api/table` returned
- Table row labels are plain week numbers (`"3"`, not `"2026-3"` or `"P1"`)

**`test_ratio_split.js`** (plain Node, no framework) -- the frontend half:

- Editing PCL or Agent directly only touches that component's override
- Editing Total splits the delta by the base year's PCL:Agent ratio for
  that week, on top of each component's *current* (override-adjusted)
  value -- not the original
- Falls back to a 50/50 split when the base year has no data for that week
- Both directions (increase and decrease) sum back to the edited total
  exactly

## Why two suites instead of one

The ratio-split math exists in two places by necessity: the backend computes
`Total = PCL + Agent` and reports `base_a`/`base_b`/`fc_a`/`fc_b`; the
frontend (`static/ratio_split.js`) uses those numbers to decide what new
PCL/Agent overrides to send back when *Total* is the one being edited.
`test_table_math.py::test_ratio_split_end_to_end` exercises both halves
together by literally running the frontend's formula in Python and checking
the backend accepts the result -- but `test_ratio_split.js` is what actually
runs the frontend code, so a bug introduced only in `ratio_split.js` (e.g.
swapping which share goes to which component) gets caught here even if the
backend half is untouched and "looks fine" in isolation.

## Adding a test for a new bug you just fixed

If you find a bug in the override/ratio logic, the fastest way to lock in
the fix is:

1. Write a test that reproduces it (it should fail against the buggy code).
2. Fix the code.
3. Confirm the test now passes.

That's it -- both files already cover the realistic edit scenarios listed
above, so most new bugs will fit naturally into one of the existing test
functions or as a new one alongside it.
