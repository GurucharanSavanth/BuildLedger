# BuildLedger 8.1 refinement verification

Changes are based on `9ec716ee0826a014d0d4fe807ad07761d113c2fc`, on `feature/buildledger-refinements`. No owner data, credentials, `.env`, storage schema, authentication or original attachment bytes were changed.

## Verified behavior

- Search and select an entire active cost-category path; preserve optional cost nature and existing chosen units. Archived ancestors are excluded from new search results.
- Display exact live totals for direct, quantity/rate, SQ conversion, multipliers, invoice charges and partial settlement. Invalid inputs produce a visible preview error; final review and persistence validation remain authoritative.
- Suggest existing supplier names and warn about possible duplicate invoices without automatically merging or rejecting legitimate repeated costs.
- Search Activity by invoice number, line description, category, stage, substage and location; filter bills, plans and agreements by cost head. Separate displayed bill cost, unpaid liability and cash totals. Head-filtered bill totals describe whole matching invoices, not just classified lines.
- Filter unpaid/unclassified bills, overdue plans and settled records; clear filters; reveal older activity in 75-record increments. Dashboard KPI links reset conflicting filters.
- Edit line classification using only the selectors that affect reports. Classification edits preserve posted costs, cash and allocations. Completed plans have an accurate calendar label; unsuccessful cost searches have a useful empty state.
- Keep zero-value invoice lines out of rounding remainders. Cost and stage totals remain reconciled to original invoices. Historical derived category allocations can move by a rounding remainder; invoice/payment amounts remain unchanged.
- Validate financial references, recipients, overpayments and integer overflow using per-call indexed totals, without persistent caches or separately stored category totals.

## Test results

Environment: Windows, Node 24.19.0, Python 3.14, Selenium 4.47.0, cached Chrome/ChromeDriver 152.0.7977.54. Tests used disposable SQLite databases and temporary browser profiles.

| Command | Result |
|---|---|
| `npm.cmd test` | 77 tests: 76 passed, 0 failed, 1 skipped |
| `node --check app.js` | Passed |
| `node --check finance.js` | Passed |
| `node --check sw.js` | Passed |
| `python -u tests/browser_costs.py` | Passed, including live previews/errors, category search, audited edits, status/head filters, 155-record pagination, cost empty state, keyboard/mobile checks |
| `python -u tests/browser_regressions.py` | Passed: save replay, failed refresh, reload recovery, encrypted SVG restore, audited edit/delete and desktop/mobile charts |
| `git diff --check` | Passed |

The browser cost suite passed against a fresh database and again after the recovery suite, matching CI order. Earlier reruns reused pagination data and failed fixture counts; they were corrected by starting fresh disposable servers. One native details-summary click needed explicit scrolling after taller readable fields; the updated fixture passed with native clicks.

The existing 12,000-bill/24,000-line fixture retained exact cost/stage reconciliation. Before optimization, full financial validation measured 6,341 ms; afterward it measured 312.5 ms during the full suite (146.8 ms in a focused run). These are local synthetic validation timings, not complete save latency or production performance guarantees. Other dashboard/event-list settlement scans have not been comprehensively optimized.

## Limits

Live MongoDB was skipped because no disposable replica-set URI was supplied; existing collection-contract adapter tests passed. Hosted CI, the pinned Node 24.21.0 runtime, production deployment, a screen-reader audit and the older three mock-browser scripts were not executed in this refinement pass. The new browser tests were run in server mode; the earlier V8 IndexedDB browser roundtrip was not repeated. Node archive/SQLite/storage regressions passed.

Database and encrypted-backup formats are unchanged. The updated service-worker cache includes the refined assets. Duplicate detection is a conservative warning, not a guarantee of duplicate prevention. CSV export deliberately remains an all-record export and is labeled accordingly.
