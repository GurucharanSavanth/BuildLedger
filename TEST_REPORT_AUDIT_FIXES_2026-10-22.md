# Web audit fixes — 22 October 2026

Scope: audit findings 12, 16 and 17. Assumed use remains one owner with a large local project history. Existing unrelated SQLite-only cleanup edits were preserved. No private configuration or database was opened.

## Changes

- Shared `verifyState` rejects negative, fractional, unsafe, missing or nonnumeric project budgets/revisions and plans referencing absent contracts. Existing standalone plans and supported format-1 archives remain valid. The local adapter rejects invalid input before opening IndexedDB; SQLite rejects it before replacement.
- SQLite compares keyed record JSON and position, then writes changed/new rows and explicit deletions within the existing validated transaction. Revision checks, replay responses, immutable audits and original-file handling remain in place.
- Activity HTTP requests use indexed SQLite pages rather than loading, validating and sorting the complete ledger. Revision, exact count and page share one read snapshot. Event mapping/search is shared with browser activity; equal timestamps use deterministic event-type/ID order. Returned rows receive shape, identity and amount checks. Full snapshots and complete write/import validation remain available.

## Verification

Runtime: pinned Node **24.21.0**, Windows. Run artifacts are under `.tools/audit-web-20261022/` (ignored local evidence).

- `npm.cmd test`: **97 passed, 0 failed, 0 skipped**. Receipt: `npm-test-final-97.txt`.
- Changed JavaScript modules and new tests passed `node --check`. Receipt: `syntax.txt`.
- `tests/browser_workflow_fixes.py` passed with Selenium 4.47.0/headless Chrome against the guarded disposable SQLite server on loopback port 18107. It exercised cross-tab drafts/files, validation, partial plan payments, timer, category drafts, dialog names, restore destination text and attachment limits. Receipt: `browser-workflows.txt`. This is one desktop browser journey, not mobile/HTTPS acceptance.
- Added regressions cover shared/format-1/browser-boundary validation; exact SQLite amount, revision and original-byte preservation; changed-row trigger counts; replay, deletion/order, rollback and restart; mixed-kind/time-zone/Unicode/literal-search pagination; a real HTTP path that forbids full reads; selected corrupted rows; and another SQLite connection committing between count and page.
- An initial full run found one UI test expecting insertion order for identical recorded timestamps. Its expectation now matches the required deterministic ID order. The failed receipt is preserved as `npm-test-initial.txt`; it was not treated as a passing run.

## Focused measurements

Synthetic fixture: 10,000 bills, fixed literal expected recorded cost **149,995,000 paise**, eight added notes, no private records. SQLite/WAL, warm local files. The baseline loads the SQLite store from Git revision `ab9a60fabab9aeb9614865b3470b943438220fcf`, with current shared validators/event mapping and the previous full-read activity route. The changed store includes its new indexes. These are local phase/request measurements, not a whole-app performance guarantee.

| Measurement | Baseline median | Changed median | Repetitions |
| --- | ---: | ---: | ---: |
| Append one note, validated SQLite commit | 154.97 ms | 95.96 ms | 7 measured commits after one warmup |
| HTTP activity, first 75 rows | 68.08 ms | 1.97 ms | 9 measured requests after one warmup |
| HTTP activity, bill filter, 75 rows | 68.60 ms | 2.29 ms | 9 measured requests after one warmup |
| HTTP activity, bill filter and literal `steel` search | 68.27 ms | 29.76 ms | 9 measured requests after one warmup |

For the seven append measurements, the baseline rewrote 10,002–10,008 record rows per commit. The changed store wrote exactly **one** record row each time. Project revision and operation receipts still change atomically.

`EXPLAIN QUERY PLAN` used `idx_records_activity` for the combined page and `idx_records_activity_type` for a type-filtered page, without a temporary order table in those checks. Raw samples, assertions and query plans: `benchmark.json`; reproducible local harness and baseline: `benchmark.mjs`, `sqlite-store-before.mjs`.

## Limits

Search counts still scan candidate event metadata; deep offsets still walk preceding index entries. Startup creates the activity/payment indexes for existing databases. Writes still perform complete validation and read the prior state, so write CPU/memory remain proportional to history. No concurrent multi-user, production HTTPS, real storage-exhaustion or 100,000-row guarantee follows from this fixture. No Android device check belongs to this web receipt.

## Follow-up fixes — 23 October 2026

- Aggregate bills and payments are rejected before commit/restore if totals exceed JavaScript's safe-integer range. Planned-payment windows share the 30-calendar-day validation rule with `summary()`. Contract schedules are totaled once per validation while preserving cancelled instalments and incomplete-contract behavior.
- Browser validation uses indexed maps where repeated `.find()` scans were quadratic; stricter recipient checks remain. Preview requests capture a generation and DOM identity across asynchronous reads/decoding so a late result cannot replace a newer dialog. File absence is reported only for HTTP 404; authentication, server and transport errors propagate.
- Reminder setup runs after successful authentication with one interval. A reminder is marked shown only after notification creation succeeds, and eligible reminders retry after permission or visibility changes.
- `npm.cmd test` passed **108/108, 0 failed/skipped** on pinned Node 24.21.0. Syntax checks passed for `app.js`, `finance.js`, `db.js`, `server/core.mjs`, `server/http.mjs` and `server/invariants.mjs`. Logs: `../.tools/audit-20261023/web-current-final-node24.21.log` and `../.tools/audit-20261023/web-syntax-final.txt`.
- Selenium/Chrome 156 journeys for browser regressions, costs and workflow fixes passed against fresh disposable SQLite servers; evidence: `../.tools/audit-20261023/browser-regressions-node24.21.log`, `../.tools/audit-20261023/browser-costs-indexeddb-restore-final.log` and `../.tools/audit-20261023/browser-workflow-fixes-node24.21.log`. The cost journey includes a real IndexedDB encrypted-archive restore/reopen and exact original-byte check.
- All 88 entries in `SOURCE_SHA256.txt` match; evidence: `../.tools/audit-20261023/web-source-hash-check-final.txt`. The corrected README limit states 25 MB for browser imports and 250 MiB for direct API uploads.

Browser/server error journeys use disposable local data only. Other browsers, production HTTPS, storage exhaustion, and physical-device flows remain unverified. The performance measurements in the parent audit are single emulator samples and do not establish a paired speedup.
