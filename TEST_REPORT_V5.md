# V5 no-password update — verification report

Date: 2026-10-11

## Passed
- `npm test`: 22 discovered, **21 passed**, 0 failed, 1 MongoDB-only integration test skipped because no disposable replica-set URI configured.
- New no-login SQLite integration: `/api/v1/health`, `/session`, `/state`, `/dashboard` and `/documents` accessible with **no login or cookies** in `AUTH_MODE=local`.
- New no-login financial write test: an invoice posted through unauthenticated local REST API persists in SQLite and is reflected in dashboard invoiced totals.
- New local-only security checks: refusal to instantiate no-login server with `0.0.0.0`/private LAN bind; rejects spoofed Host header, proxy indicator headers, and cross-origin writes.
- Existing V4 owner-mode sign-in, protected API, finance calculations, file import/view/deletion, idempotency, storage reopening and backup-format unit tests remain passing.
- `npm run setup` generated a password-free localhost `.env` with `AUTH_MODE=local` and no `ADMIN_PASSWORD`; live SQLite server responded `auth:not_required` and `authenticated:true`.

## Limitations
- Full live browser-to-REST end-to-end UI could not run in the coding environment: the browser refused navigation to `127.0.0.1` (`ERR_BLOCKED_BY_ADMINISTRATOR`). Direct HTTP and API + SQLite integration tests passed. Complete browser workflow must still be verified on the deployment computer.
- The service is intentionally available only on **this computer** in no-login mode. Public internet/server hosting is neither supported nor safe without authentication.
- This change does not implement new business features or an independent financial security audit. The encrypted backup **recovery passphrase** remains required for backup import/export.
