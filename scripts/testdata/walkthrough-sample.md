# Walkthrough: Export invoices as CSV
Commit 4e1c9b0 · 6 files · 212 lines

## What and why
- Problem: members copy invoices by hand into spreadsheets. (matrix row AC-1)
- Approach: one CSV endpoint that streams rows, so large accounts don't time out. `lib/invoices/export.ex:12`
- Not chosen: a background job with an email link; it needs mail set-up for one download.
- Shortcoming: dates are UTC, not the member's time zone. `lib/invoices/export.ex:40`

## Changes, in build order: data, then endpoint, then screen
### 1. Rows for export
Builds one row per invoice line.
- `lib/invoices/export.ex` (new): selects and orders the rows. `lib/invoices/export.ex:8-31`
- `test/invoices/export_test.exs` (new): 5 cases, including an empty account.
### 2. Download endpoint
- `lib/web/invoice_controller.ex` (changed): `GET /invoices.csv`, streamed. `lib/web/invoice_controller.ex:55-70`
### 3. Export button
- `lib/web/invoices_page.ex` (changed): an **Export CSV** button. `lib/web/invoices_page.ex:102`
### Other changes
- `priv/gettext/default.pot`: one new text.

## Criteria
| Criterion | Changes | Evidence |
|---|---|---|
| AC-1, "A member downloads a CSV of their invoices" | 1, 2, 3 | matrix row AC-1 |

## Risk on merge
- Undo: reverting the merge is enough; no stored data changes.
- Affects: the invoices page and a new endpoint.

## Not checked
- The CSV library's quoting of commas inside names: its source was not read.
