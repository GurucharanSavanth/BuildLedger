# BuildLedger V6 test report

> Historical document: retained for its original context and evidence. For current setup and maintenance, see [README](README.md); for deployment and recovery, see [SQLite deployment](SQLITE_DEPLOYMENT.md). Historical checks do not establish the status of the current revision.

## Automated tests
- `npm test`
- Result: 23 passed, 0 failed in this historical run. Current SQLite-only checks are recorded in TEST_REPORT_SQLITE.md.

### Added / relevant coverage
- Segmentation remains stable with many categories and blank labels.
- Monthly totals remain bounded and valid with larger payment datasets.
- Existing SQLite, backup, deletion, no-login and idempotency tests continue to pass.

## Browser smoke test
- Command: `python tests/browser_smoke.py`
- Result: passed.
- Verified: app boot, add entry, linked bill/payment flow, future plan, files page, calendar page, no runtime exceptions, no mobile horizontal overflow.
