# blueprint/company-watch - run log

## Learnings (patterns reused from shipped kits)

1. **Material means new.** A claim already in the window is not news;
   the diff between digests is the monitor.
2. **The window is the trend.** Capped watch:<company>:<ts> records
   make the mention curve a prefix scan.
3. **Sources degrade.** The blocked-page-recovery ladder applies per
   source; the monitor must keep running on the sources that answer.
4. **Alert-once is a record.** watch:<company>:alerted dedupes the
   notify; without it every run re-fires.