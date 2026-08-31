# blueprint/pdf-pipeline

> Hermes source: pdf. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

PDF operations as receipts: extract text, OCR scans, merge or fill via CLI, publish the result, keep one receipt per step.

## The recipe

1. extract text (or OCR when the page is a scan).
2. extract the structured fields.
3. merge/fill via CLI.
4. publish and receipt.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| extract | rh_run | pdftotext / OCR |
| fields | rh_text_extract | schema-in |
| merge | rh_run | CLI merge/fill |
| publish | rh_files_put + rh_store_put | receipt |

## Limits

OCR quality is the local tool's ceiling.