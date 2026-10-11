# BuildLedger V5 — No-Login Local Edition

- Changed default local SQLite server to `AUTH_MODE=local` (dashboard opens directly, no owner password).
- Updated first-run `npm run setup` to generate a localhost-only `.env` without an account password.
- Preserved optional `AUTH_MODE=owner` and `npm run setup:secure` for deployments requiring login.
- Explicit startup rejection of password-free non-loopback configuration.
- Request-level Host, loopback listener, forwarded-header and cross-origin write safeguards in password-free mode.
- `/api/v1/session` returns `authenticated:true` and `auth:not_required` when local; `/api/v1/health` reports same mode.
- Previous financial forms, documents, payment plans, SQLite database, import/export and ledger calculations unchanged.
- Bumped service-worker cache to avoid stale static asset shell.
- New tests: direct anonymous local dashboard and SQLite write; blocked network, Host spoofing, proxy and cross-origin writes.
- Created `NO_LOGIN_MODE.md` for upgrading without losing financial or document data.

**Security limitation:** password-free mode is for the same computer only, not public/shared servers. Backup ZIPs still have separate encryption passphrases.
