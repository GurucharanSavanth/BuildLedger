# BuildLedger V4 — Test report

Date: 2026-10-11

## Executed automated tests
- `npm test`: **20** Node tests reported; **19 pass, 1 skipped**. The skipped test requires a disposable real MongoDB replica set; SQLite integration is included and passes. Modules covered: exact paise calculations, optional amount modes, payment allocation, cash vs cost, archive encryption/checksum, API auth and domain routes, upload and delete integrity, immutable file metadata, planned instalment payee verification, **real SQLite reopen and persistence, authenticated HTTP access, file checksums and deletion, idempotent request replay**.
- `python tests/browser_v2.py`: passed: default direct amount, optional quantity/unit/rate while keeping direct amount authoritative, direct labour, in-app PDF preview using blob URLs, share fallback without download, original-file deletion in mocked browser store, honest CAD unsupported handling, mobile layout, no JS exceptions.
- `python tests/browser_smoke.py`: passed: initial home, calculated purchase, partial payment, planning, Files navigation, calendar, mobile layout, no JS exceptions.
- Actual browser-to-localhost test: attempted; **blocked by sandbox browser network policy** (`ERR_BLOCKED_BY_ADMINISTRATOR`). Kept as optional test to run outside sandbox; NOT counted as a pass.
- Local server launched successfully at http://127.0.0.1:8177; `/` and `/api/v1/health` returned HTTP 200; `health` reports SQLite DB ready. This does **not** constitute an end-to-end browser-to-server test.

## Specific verified SQLite cases
- DB exists on disk; records recover after closing and reopening SQLite.
- Type-safe direct amount invoice creates a payable; partial payment reduces payable while total cost stays unchanged.
- Uploading original PDF chunks, posting metadata, viewing original bytes and HTTP content-disposition inline, explicit download content-disposition attachment.
- Denying an orphaning delete leaves both metadata and original intact; successful delete removes both atomically and preserves an audit record.
- Duplicate typed API request with same idempotency key returns same committed result; different content with reused key fails; overpayment is rejected.

## Remaining uncertainty
Zero defects cannot be guaranteed. Missing real-device/browser HTTPS+SQLite integration coverage, cross-browser PDF support, very large/unknown-format document handling, hostile network environments, operational recovery and independent accounting validation mean **this is not yet an audited public SaaS product**.
