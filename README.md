# BuildLedger Web

BuildLedger records construction costs, cash payments, supplier advances, commitments, schedules and original documents for one owner across multiple projects. The application provides a browser interface and a Node HTTP API backed by SQLite. Browser-only preview uses IndexedDB. Neither store synchronizes with the other or with the Android application.

## Start locally

Install the Node version in `.node-version` (24.21.0), then run from this directory:

```powershell
npm.cmd run setup
npm.cmd run dev
```

Open `http://127.0.0.1:8080`. Setup preserves an existing `.env`. Default local mode has no password and accepts loopback access only. On other shells use `npm` in place of `npm.cmd`.

For browser-only preview, run `npm.cmd run local`. It uses separate IndexedDB data and does not provide the SQLite API. Do not switch modes expecting records to follow.

## Maintain the application

| Area | Responsibility |
| --- | --- |
| `app.js`, `index.html`, `styles.css` | Browser screens, forms and interactions. |
| `finance.js`, `hierarchy.js`, `cost-analytics.js`, `cost-catalog.js` | Financial rules, allocations and classification. |
| `db.js` | Server and IndexedDB adapters, project scope and unresolved-write recovery. |
| `archive.js`, `project-export.js` | Encrypted project archive, original-file checks and project export. |
| `server/http.mjs` | HTTP routes, authentication and transport restrictions. |
| `server/sqlite-store.mjs` | SQLite transactions, project data, file chunks, revisions and idempotency. |
| `server/core.mjs`, `server/domain.mjs`, `server/invariants.mjs` | Request, record and file invariants. |
| `tests/`, `.github/workflows/test.yml` | Node, SQLite/API and disposable browser regression checks. |

Posted money is safe integer paise. Recorded invoice cost, cash paid, advances, commitments and schedules are separate measures. Do not silently classify historical invoices. Preserve source documents, IDs, audit records, revision checks and idempotent write recovery. Browser imports accept files up to 25 MB; the direct API permits up to 250 MiB per original.

## Data protection and deployment

SQLite defaults to `./data/buildledger.sqlite`; the server uses Node's built-in SQLite and requires no database service or npm database driver. Keep the existing `SQLITE_PATH`, `.env` and data directory during upgrades. Never commit private configuration, databases, original uploads or backups.

Create encrypted backups for each project and verify restoration in a disposable installation. Backups are not automatic. See [SQLite deployment and recovery](SQLITE_DEPLOYMENT.md) for WAL, proxy, HTTPS and backup requirements. Network hosting requires owner authentication and HTTPS; password-free mode is loopback-only. Static hosting cannot provide the SQLite API.

## Verification

```powershell
npm.cmd test
node --check app.js
```

Run `node --check` for every changed JavaScript module. The Node suite exercises financial logic, archives and a disposable SQLite API. For affected browser journeys, install Selenium 4.47.0 and Chrome/ChromeDriver, start `node scripts/browser-test-server.mjs` in a separate terminal, set `BUILDLEDGER_TEST_DISPOSABLE=1`, and run the relevant script, for example:

```powershell
$env:BUILDLEDGER_TEST_DISPOSABLE = '1'
python tests/browser_regressions.py
```

The server uses a temporary SQLite database, not `.env` or the owner's data. Some journeys also require a preview server on port 8098 or owner-mode settings. Follow the matrix in `.github/workflows/test.yml` and the selected script's guards; never run fixtures against a real ledger. Older smoke, V2 and hierarchy scripts use mock storage and do not establish SQLite acceptance.

## Reference

- [API reference](API_REFERENCE.md): routes, project scope and write contracts.
- [SQLite deployment](SQLITE_DEPLOYMENT.md): configuration, security, backup and recovery.
- [Maintainer instructions](AGENTS.md): invariants, checks and source map.
- [SQLite test report](TEST_REPORT_SQLITE.md) and dated `TEST_REPORT*.md`: historical results, not proof for a new revision.
- `CHANGELOG*.md`, `IMPLEMENTATION_REPORT_V8.md` and `GITHUB_DEPLOY_GUIDE_V7.md`: historical release material; current operating guidance above takes precedence.

The application is designed for one owner, not a multi-tenant service. Hosted HTTPS, other browsers and production deployment need their own acceptance checks; a passing local suite does not prove them.
