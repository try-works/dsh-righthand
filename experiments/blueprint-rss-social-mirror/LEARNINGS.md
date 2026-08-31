# blueprint/rss-social-mirror - run log

## Learnings

- the Reddit RSS learnings are shipped in daily-digest - this kit generalizes them.
- the ladder from blocked-page-recovery keeps the mirror alive.

## Cloud test build (2026-08-31)

- Deployed rh-rss-ladder. First run: reddit = 0 items. Root cause
  (measured locally too): Reddit's .rss now answers Atom, not RSS 2.0
  - an item-only parser silently yields zero on a 200.
- Fixed by parsing both <item> and <entry>; redeployed: reddit 24,
  lobsters 25, dedupe held. The 403/429 ladder never fired - the
  block was a format drift, not egress.