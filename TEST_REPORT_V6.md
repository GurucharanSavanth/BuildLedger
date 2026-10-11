# BuildLedger V6 test report

## Automated tests
- `npm test`
- Result: 24 tests total, 23 passed, 1 skipped (optional MongoDB integration), 0 failed.

### Added / relevant coverage
- Segmentation remains stable with many categories and blank labels.
- Monthly totals remain bounded and valid with larger payment datasets.
- Existing SQLite, backup, deletion, no-login and idempotency tests continue to pass.

## Browser smoke test
- Command: `python tests/browser_smoke.py`
- Result: passed.
- Verified: app boot, add entry, linked bill/payment flow, future plan, files page, calendar page, no runtime exceptions, no mobile horizontal overflow.
