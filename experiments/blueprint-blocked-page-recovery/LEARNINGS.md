# blueprint/blocked-page-recovery - run log

## Learnings (earned in the daily-digest build, shipped as a ladder)

1. **Reddit's JSON API is IP-blocked (403); its RSS answers a
   browser User-Agent with Accept: application/rss+xml and spaced
   requests plus 429/403 backoff.
2. **Google News RSS answered 503 from Cloudflare egress** while
   other sources worked - a feed can be blocked at the egress, not
   the origin.
3. **HN dropped its titlelink selector** - the HTML parse broke; the
   Algolia JSON endpoint replaced it. Selector drift is a wall too.
4. **guardedFetch revalidates every redirect hop** - the recovery
   ladder inherits the SSRF checklist on every rung.
5. **Give up cleanly:** the receipt records the last rung, and the
   answer states what was and was not recovered.