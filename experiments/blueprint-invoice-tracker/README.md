# blueprint/invoice-tracker

> Hermes source: Business & Finance. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Invoices with teeth: extract vendor/amount/due, store the record, schedule a reminder event at the due date, deliver through the reminder flow.

## The recipe

1. extract the fields from the invoice text.
2. store the invoice record.
3. schedule a due-date event.
4. the due check delivers and marks notified; cancel the event when paid.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| extract | rh_text_extract | invoice schema |
| store | rh_store_put | invoice:<id> |
| schedule | rh_events_create | due date |
| deliver | rh_events_due + rh_notify_send | exactly-once |

## Limits

no payment rails - the kit tracks, it does not pay.