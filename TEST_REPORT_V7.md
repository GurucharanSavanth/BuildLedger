# BuildLedger V7 verification report

## Automated regression tests

Run `npm test` from the source root. It covers finance, precise INR arithmetic, split invoicing, partial settlements, idempotency, encrypted backups, source files, SQLite and HTTP API, no-login local access, and hierarchical analytics. The MongoDB replica-set integration test is optional and skipped without an explicitly supplied disposable test database.

## New hierarchical tests
- Stage → substage → material → original invoice reconciliation in exact paise, including a 1-paise freight allocation.
- Historic invoices without explicit stages/substages displayed under `Uncategorised` / `Not specified` rather than guessing.
- 12,000-bill stress fixture, including many stages, work packages and materials, with 100% of value assigned once.
- New SQLite REST API path `GET /api/v1/analytics/hierarchy`, including source invoice identification, missing-path rejection and saved custom-category persistence.
- Exact money input/display round trip near `Number.MAX_SAFE_INTEGER` paise.

## Browser tests
- `tests/browser_smoke.py`: existing purchasing, payment, instalment, files and calendar workflows.
- `tests/browser_v2.py`: direct amount, optional quantities, labour, PDF view, CAD handling, file deletion and small-screen layout.
- `tests/browser_hierarchy.py`: custom category save, optional line-level substage, full breadcrumb drilldown, source bill opening and responsive mobile layout.

**Testing limitation:** Browser scripts inject a deterministic storage adapter because the restricted test browser blocks direct navigation to local HTTP endpoints (`net::ERR_BLOCKED_BY_ADMINISTRATOR`). A real SQLite API was separately tested over HTTP with Node's fetch. The browser has NOT been proven against a public hosted instance in these tests. Run full HTTPS host/browser acceptance before using live data.

## Residual risk
- No test suite guarantees zero defects. Externally hosted authentication, disk backups, file restoration, reverse-proxy/cookie behavior, concurrency with a large dataset and financial reconciliations must be verified after deployment.
- Hierarchical dashboard is calculated from recorded invoice lines; it is not an earned-value analysis, inventory consumption tracker or cash-flow allocation.
- Mass reclassification/merging of existing inconsistent category labels is not implemented. Creation of new category labels does not rewrite prior paid invoices.

### Most recent local execution (11 October 2026)
- `npm test`: **29 total, 28 passed, 0 failed, 1 optional MongoDB test skipped**.
- `python tests/browser_smoke.py`: passed.
- `python tests/browser_v2.py`: passed.
- `python tests/browser_hierarchy.py`: passed; full desktop drilldown + mobile overflow check.
- Node HTTP server: `/api/v1/health` returned HTTP 200 and the new `/hierarchy.js` static module returned HTTP 200.
- Real HTTP+SQLite hierarchy integration: passed independently of browser storage mocks.

## Audit fixes, entry changes and dashboard update (2026-10-11)

- All nine reported audit findings addressed in source.
- Added audited Edit/Delete for bills, payments, plans, contracts, advance allocations and work logs. Shared validation runs in browser storage, SQLite and MongoDB. Prior audit events remain immutable outside explicit project restoration.
- Dashboard now shows four separate totals, monthly cash flow, budget usage, cost ranking and recent activity. Logs display human-readable before/after values. Added keyboard focus handling to dialogs.
- Node regression suite: **40 passed, 1 live MongoDB test skipped**, using `node --test --test-isolation=none tests/*.test.mjs tests/server/*.test.mjs` on Node 24.19.0. Child-process isolation is restricted in this environment.
- Verified real HTTP + disposable SQLite: exact request replay after lost replies, recovery after adapter reload, protection against missing originals on replacement, SVG archive roundtrip and persisted audited deletion.
- MongoDB typed replay and audited deletion passed against the real store methods with collection substitutes. A live MongoDB replica set was unavailable.
- Browser regression script syntax checked and wired into CI. Local Chrome failed during startup before the test could execute; no connected browser was available. Actual rendered desktop/mobile layout and Selenium workflows are therefore **not locally verified**.
- No user's `.env` or live database was read or changed. Temporary test Chrome profile remains ignored under `.tools/` because sandbox policy rejected cleanup.
