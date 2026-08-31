# blueprint/company-watch

> Hermes source: research/competitor-news-monitor. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The recipe

1. **Fetch** keyless sources (RSS/JSON, the daily-digest pattern).
2. **Extract**: rh_text_extract { company, claim, date } triples.
3. **Window**: watch:<company>:<ts> records, capped.
4. **Material check**: a NEW claim or a tone shift is material;
   repetition is not.
5. **Alert**: summarise + rh_notify_send once + watch:<company>:alerted.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | guardedFetch | keyless sources only |
| extract | `rh_text_extract` | claim triples |
| window | `rh_store_put` | watch:<company>:<ts> |
| digest | `rh_text_summarise` | material changes only |
| alert | `rh_notify_send` | alert-once record |

A source that 403s falls back through the blocked-page-recovery
ladder - the monitor must degrade, not die.