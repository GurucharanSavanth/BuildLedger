# BuildLedger web agent instructions

This directory is its own Git repository. It is ignored by the parent ConstructionCost repository, so use Git status/diff here for web changes. If working in the full workspace, read the parent [project instructions](../AGENTS.md) and [memory map](../MEMORY.md); this file also supplies the essential context for a standalone web checkout.

## Database and data rules

The server supports SQLite only through Node's built-in `node:sqlite`. DATABASE_MODE defaults to `sqlite` and rejects any other value before opening/creating a database. No external database driver, service or database npm dependency is needed.

SQLITE_PATH defaults to `./data/buildledger.sqlite`; preserve the existing configured path and data during upgrades. Browser-only preview uses IndexedDB and does not synchronize with server SQLite or native Android Room/SQLite.

Keep posted money in safe integer paise. Reuse `finance.js` for calculation, rounding, allocation, edit/delete validation and historical evidence. Keep actual cash, recorded cost, available advances, commitments and future schedules distinct.

Preserve version conflicts, same-request idempotent replay, permanent audits and atomic record/original-file commits. Retrying a save with an uncertain reply must not create a second payment or erase the unresolved request. Never silently fall back from an established server ledger to new browser-local storage after a server failure.

## Code map

| File/area | Responsibility |
| --- | --- |
| `app.js`, `index.html`, `styles.css` | Forms, reviewed entry/edit/delete, activity, files and responsive browser UI. |
| `finance.js` | Exact money, shared financial validation, allocation and summaries. |
| `hierarchy.js`, `cost-analytics.js`, `cost-catalog.js` | Work/cost drilldown, reconciled allocations and stable catalog identity. |
| `db.js` | SQLite API versus IndexedDB adapter, pending writes, replay and snapshots. |
| `project-export.js` | Project-only workbook ZIP generation, attachment verification and export manifests. |
| `archive.js` | Encrypted portable archive and original-file integrity. |
| `server/http.mjs` | Routes, auth/session, origin/loopback restrictions and SQLite startup. |
| `server/sqlite-store.mjs` | SQLite records, file chunks, transactions, revisions and idempotency. |
| `server/core.mjs`, `server/domain.mjs`, `server/invariants.mjs` | Input/state limits, typed posting/queries and original-file mutation checks. |
| `scripts/setup.mjs` | Local/owner setup; keeps an existing private `.env`. |
| `scripts/browser-test-server.mjs` | Disposable SQLite browser server on loopback, normally port 8099. |
| `tests/*.test.mjs`, `tests/server/*.test.mjs`, `tests/browser_*.py` | Node domain, storage, real SQLite/API and browser regressions. |
| `.github/workflows/test.yml` | Syntax/Node tests and real disposable SQLite/Selenium journeys. |

## Commands and verification

Run commands from this directory, using Node pinned in `.node-version` (currently 24.21.0). Use `npm.cmd` on PowerShell if the npm script is blocked.

- `npm.cmd run setup`: create local configuration if absent; keep the existing file.
- `npm.cmd run dev` / `npm.cmd start`: SQLite application/API at localhost:8080 by default.
- `npm.cmd run local`: browser-only preview with separate local storage.
- `npm.cmd test`: Node financial, archive and SQLite/API regressions.
- `node --check app.js` and changed modules: syntax. No dedicated formatter/linter is configured.

Browser UI changes use disposable storage: start `node scripts/browser-test-server.mjs` for SQLite or set `PORT` to `8098` and run `node dev-server.mjs` for IndexedDB, set BUILDLEDGER_TEST_DISPOSABLE=1, then run the relevant browser journey. `tests/browser_projects.py` covers SQLite project workflows; `tests/browser_indexeddb_migration.py` covers v1 migration and project isolation on a fresh loopback origin. Read the selected script's guard and README procedure first; do not point it at private data. Selenium is a test tool, not an app dependency. Earlier browser smoke/V2/hierarchy scripts use mock storage; they are not live HTTP+SQLite acceptance evidence.

Use node:test, strict assertions and descriptive `*.test.mjs` names. Financial/persistence/recovery changes need literal expected amounts, replay/conflict checks and original-byte conservation where relevant. Do not add duplicate tests merely to replace a removed backend-specific test. Documentation-only changes need path and whitespace checks rather than another full test run.

The latest SQLite cleanup receipt is [TEST_REPORT_SQLITE.md](TEST_REPORT_SQLITE.md): 89 passed, 0 failed, 0 skipped on Node 24.19.0. That supported-engine run is historical evidence, not proof of the exact pinned Node release or future changes. Current deployment/storage rules are in [SQLITE_DEPLOYMENT.md](SQLITE_DEPLOYMENT.md).

The 2026-10-22 audit fixes and fresh pinned-runtime checks are recorded in [TEST_REPORT_AUDIT_FIXES_2026-10-22.md](TEST_REPORT_AUDIT_FIXES_2026-10-22.md). Activity API reads use indexed SQLite pages with one revision/count/page snapshot; full snapshots and write/import validation remain separate. SQLite skips unchanged record JSON at the same position. Keep shared activity event mapping and literal search semantics consistent with browser history.

Follow-up 2026-10-23: owner-mode failed-login tracking isolates 255 IPs and shares one cooldown for overflow addresses; sessions are capped at 256. Saturation preserves tracked lockouts and a correct password still succeeds. Current verification includes 108/108 pinned Node 24.21.0 tests and fresh Selenium/Chrome 156 journeys against disposable SQLite: browser regressions, cost workflows and workflow fixes all passed. Browser regressions also cover concurrent stale file previews and HTTP 401/404/503 behavior. The cost flow used the localhost-only preview with real IndexedDB to restore an encrypted bill and original file, reload, and compare exact bytes. Syntax checks passed for `app.js`, `finance.js`, `db.js`, `server/core.mjs`, `server/http.mjs` and `server/invariants.mjs`. Exact receipts and remaining provider limits are in the parent [audit verification](../output/audit-fix-verification-2026-10-23.md). `SOURCE_SHA256.txt` covers the current web source and tests.

Project management uses independent project states in SQLite and IndexedDB v2. Existing web records migrate under the stable `legacy-project` ID; invalid legacy state aborts the IndexedDB upgrade. Project selection scopes reads, writes, files and exports. Project deletion is transactional in each store, and `project-export.js` creates and verifies a project-only workbook/attachment ZIP. Browser coverage is `tests/browser_projects.py` against disposable SQLite and `tests/browser_indexeddb_migration.py` against a fresh loopback origin.

Project-management verification (2026-10-24): pinned Node 24.21.0 `npm.cmd test` passed 117/117 (`../.tools/project-mgmt-20261024/web-tests-node24.21-idb-migration.log`). `BUILDLEDGER_TEST_DISPOSABLE=1` with the localhost preview on port 8098, then `python tests/browser_indexeddb_migration.py`, passed invalid-upgrade rollback, exact paise/original-byte migration, project isolation and final deletion (`../.tools/project-mgmt-20261024/web-indexeddb-migration.log`). The SQLite project-manager Selenium journey passed earlier in this task; screenshots are under `../.tools/project-mgmt-20261024/web-ui/`. All 94 `SOURCE_SHA256.txt` entries currently verify.

## Safety, style and handoff

Never commit `.env`, databases, uploaded originals, credentials or private backups. Tests must use temporary databases and cleanup only their own verified temporary paths. Network deployments need owner auth, strong credentials and HTTPS; password-free mode remains loopback-only. `TRUSTED_PROXY_IPS` accepts only exact literal socket peer IPs (default empty); trust a single `X-Forwarded-Proto: https` only from an allowed peer. Preserve the direct loopback owner-development path and generic GET health-probe exception while blocking public HTTP UI/login/project requests.

JavaScript uses ES modules and camelCase. Match surrounding whitespace; avoid reformatting unrelated files or adding a package for SQLite. Keep archive formats and validation when reorganizing code.

`SOURCE_SHA256.txt` inventories source files. Refresh entries for changed listed files and add new maintained source/instruction files; exclude the manifest itself and all private configuration/data. Keep release-era report counts clearly historical and record fresh results separately.

Use concise imperative commits. PRs describe behavior, actual checks and UI screenshots when applicable. Preserve unrelated working changes. When operating in the parent workspace, update MEMORY.md for changed ownership, commands, user decisions or dated verification state.
