# SQLite storage and deployment

The web server uses Node's built-in SQLite database. It needs no npm database driver or separate database service. Browser-only preview uses IndexedDB. Native Android uses Room over SQLite on the device. Each storage location is independent.

## Local setup

Use the Node version pinned in `.node-version`. From `BuildLedger_Web/`, run:

```powershell
npm.cmd run setup
npm.cmd test
npm.cmd run dev
```

Open `http://127.0.0.1:8080`. Setup preserves an existing `.env`.

```dotenv
DATABASE_MODE=sqlite
SQLITE_PATH=./data/buildledger.sqlite
AUTH_MODE=local
HOST=127.0.0.1
PORT=8080
```

`DATABASE_MODE` accepts only `sqlite`; omitting it selects SQLite. Unsupported configuration stops startup before creating a database. Keep the existing `SQLITE_PATH` during upgrades.

## Data and transactions

The database stores settings, financial records, audit history and original uploaded document chunks. Confirmed writes, idempotency keys and related file changes share a transaction. Write-ahead logging, FULL synchronization and revision checks protect committed state and reject conflicting writes.

Keep `.env`, `data/`, databases, original documents and backups private. Source updates must preserve the current database path and data directory.

## Network deployment

Use one application instance and a writable persistent disk. Set `DATABASE_MODE=sqlite` and an absolute `SQLITE_PATH` on that disk, such as `/var/data/buildledger.sqlite`.

Set `AUTH_MODE=owner`, a unique `ADMIN_PASSWORD` of at least 12 characters and an independent `APP_COOKIE_SECRET` of at least 32 characters. Serve the application through HTTPS. Password-free mode accepts loopback access only.

The Node server speaks HTTP behind your HTTPS reverse proxy. Set `TRUSTED_PROXY_IPS` to a comma-separated list of the proxy's exact IPv4 or IPv6 socket peer addresses as seen by Node, for example `127.0.0.1,::1` for a proxy on the same machine. The default is empty; hostnames, scoped addresses and CIDR ranges are rejected. IPv4-mapped IPv6 addresses normalize to their IPv4 equivalent. Configure the proxy to preserve the public `Host`, overwrite the client's `X-Forwarded-Proto` with the single value `https` for HTTPS traffic, and reject or redirect public HTTP at the edge. Restrict the backend port to that proxy; for a same-machine proxy, keep `HOST=127.0.0.1`.

Owner UI, login and project requests from a public host return 403 until the request is encrypted or comes from an allowed proxy peer with that HTTPS header. Public session cookies use `Secure`. Direct HTTP owner development still works when the Host and both socket endpoints are loopback and no forwarded headers are supplied. `GET /api/v1/health` remains available to HTTP health probes and returns only operational status; it never returns project records.

Use a provider only after verifying its actual proxy peers and header behavior. A platform's public outbound IP ranges are not an inbound proxy allowlist. The historical Render recipe below has not been verified with a stable exact peer list; do not bypass the allowlist to make a deployment start.

Static hosting serves the browser-only application; it does not run the SQLite API. See [the deployment guide](GITHUB_DEPLOY_GUIDE_V7.md) for the existing server deployment example.

## Backup and recovery

Create a verified encrypted archive through Backup & Restore and retain a copy outside the application's disk. Test restoration using a disposable installation.

For a filesystem backup, stop the application cleanly and preserve its entire data directory, including SQLite journal files that remain. Do not copy only the database file while the server is writing. Resume with the same `SQLITE_PATH` and verify health, financial totals and access to original documents.

## Verification

`npm.cmd test` runs finance, archive, HTTP and real disposable SQLite tests, including reopen, exact request replay, conflicts, original-byte storage and deletion. See [TEST_REPORT_SQLITE.md](TEST_REPORT_SQLITE.md) for this cleanup's results and [README.md](README.md) for browser checks.
