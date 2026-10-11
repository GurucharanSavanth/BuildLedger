# Password-free BuildLedger — local device only (V5)

**Default:** Opening `http://127.0.0.1:8080` goes directly to the dashboard. There is no sign-in/password prompt when the built-in local SQLite server is running.

## Fresh setup

1. Install Node.js 22.13+ and extract the source ZIP.
2. Open a terminal in the folder containing `package.json`.
3. Run `npm run setup` once. It writes `.env` with `AUTH_MODE=local` and `HOST=127.0.0.1` and generates **no login password**.
4. Run `npm run dev` and open `http://127.0.0.1:8080`.

For Windows PowerShell with a script execution restriction, use `npm.cmd run setup` and `npm.cmd run dev`.

## If updating from V4 while keeping existing SQLite records

1. Stop the app.
2. Back up `data/` **consistently** (stop server first), and also create an in-app encrypted backup if possible. Do not delete `data/buildledger.sqlite` or its WAL files blindly.
3. Replace the application source with V5 **but keep your existing `.env` and `data/`**. Do not overwrite or delete the database.
4. Open `.env` and set `AUTH_MODE=local` and `HOST=127.0.0.1`. The old `ADMIN_PASSWORD` and `APP_COOKIE_SECRET` lines may remain, but the local mode does not require them. You can remove those lines after recording any credentials needed elsewhere.
5. Start with `npm run dev` and open `http://127.0.0.1:8080`. No login is needed.
6. Verify a few existing invoices, payments, documents and the total balance before continuing work.

There is no database schema reset or automatic deletion during this change; the app continues to use the same SQLite file if your `SQLITE_PATH` is unchanged.

## Security consequences and restrictions

**Anyone who can use the computer and open its local BuildLedger site can read and change the project's financial records.** Lock your computer and control operating-system accounts. SQLite is not encrypted at rest by the app.

`AUTH_MODE=local` is restricted to the local server (`127.0.0.1` or equivalent). It refuses a non-loopback bind, rejects non-local Host headers, rejects proxy indicators and checks cross-origin browser writes. It is *not* suitable for port forwarding, reverse proxies, cloud hosting, public URLs, local-network access from another device, or shared multi-user applications. Never disable these safeguards. A gateway which strips proxy headers, SSH tunnelling or unusual OS-level forwarding can still expose loopback ports; firewall and host controls remain important.

For other devices or a public/reachable domain, use `AUTH_MODE=owner` with TLS, secure generated credentials, and additional deployment hardening; no-login remote hosting is intentionally unsupported. For a fresh secure setup use `npm run setup:secure` instead of `npm run setup`.

## Portable backups

The **website login password has been removed in local mode, but the recovery passphrase for encrypted Backup & Restore is retained.** Do not remove backup encryption to bypass a login. Secure backup archives remain essential if the device fails.

## Verification

`npm test` includes tests for unauthenticated access to local dashboard/state, actual SQLite write, refusal of a network interface bind, spoofed Host header, proxy hints and cross-site write rejection; existing owner-authentication regression tests still pass.
