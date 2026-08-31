# blueprint/office-docs

> Hermes source: docx. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Office document pipelines: pandoc/python-docx convert and extract via rh_run, the store keeps text + receipts, rh_text_extract pulls the structured fields.

## The recipe

1. convert or extract the document text via CLI.
2. store the text and a receipt.
3. extract the structured fields.
4. publish converted artifacts.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| convert | rh_run | pandoc / python-docx |
| store | rh_store_put | doc:<slug> |
| extract | rh_text_extract | fields schema |
| publish | rh_files_put | converted artifact |

## Limits

local tooling only; no cloud office APIs (keyless rule).