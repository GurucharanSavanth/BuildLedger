# BuildLedger V8 — Construction Finance & Cost Classification

A responsive construction-expense manager with a minimalist interface, persistent local SQLite and HTTP API, instalments, receipts, file storage and a Stage → Substage → Material → Bill drill-down.

**Important:** This is tested source code for a **single owner**, not a certified multi-user public financial platform. Before using it for important financial records, complete a real-browser HTTPS acceptance test, security review, and independent transaction reconciliation.

## Start here

**GitHub upload and live deployment:** [GITHUB_DEPLOY_GUIDE_V7.md](GITHUB_DEPLOY_GUIDE_V7.md)  
**Changes:** [CHANGELOG_V8.md](CHANGELOG_V8.md)

**Testing:** [IMPLEMENTATION_REPORT_V8.md](IMPLEMENTATION_REPORT_V8.md)
**REST endpoints:** [API_REFERENCE.md](API_REFERENCE.md)

### V8 expense classification

Cost heads are independent of work stages. Add Entry supports direct amounts by default, independently classified invoice lines, optional quantity/rate calculations, explicit Sq Ft to SQ conversion and a visible multiplier. The default catalog contains all 19 construction expense heads, 186 subheads and 31 material/service details. Owner-created categories, units and descriptions can extend it; categories can be renamed, reordered and deactivated without losing their identity.

Explore offers Cost Heads, Work Stages and cost-nature reports. Both hierarchies allocate the same recorded invoices, including freight, tax and discount, exactly once. Payments, supplier advances, agreements and future instalments remain separate. Historical invoices without a classification remain in Unclassified / Legacy until deliberately edited with an audit record.

In Categories, choose Cost Heads or Work Stages. Cost catalog changes retain precise audit evidence. Source invoice details and CSV exports show classification, calculation and financial evidence. Optional contract quotations use the same exact calculator; a quoted agreement creates commitments and planned instalments, not invoices.

Schema 1 remains unchanged. IndexedDB, SQLite and MongoDB keep the optional fields in their existing state/record JSON. Encrypted backups preserve the catalog, classifications, audits and original files. Old backups remain readable; opening them does not silently classify their expenses. Downgrading to an older application is not supported for new calculation metadata.

See [CHANGELOG_V8.md](CHANGELOG_V8.md) and [IMPLEMENTATION_REPORT_V8.md](IMPLEMENTATION_REPORT_V8.md) for changes, test commands and remaining limits. Deployment requirements in the V7 guide still apply: static hosting uses only IndexedDB; the full API needs Node, persistent storage, authentication for network access and HTTPS.

### Local installation, no password

Install Node.js **24.21.0** (pinned in `.node-version`, although current core code also supports tested Node 22.16). Extract the project and run:

```bash
npm run setup
npm run dev
```

Then visit **http://127.0.0.1:8080**. The app opens without asking for a password in localhost-only mode. On Windows PowerShell, use `npm.cmd run setup` and `npm.cmd run dev` if `npm.ps1` is blocked.

Run the tests:

```bash
npm test
python tests/browser_smoke.py
python tests/browser_v2.py
python tests/browser_hierarchy.py
```

Python browser scripts require `playwright`, Chromium and an appropriate test environment. They use a browser storage stub, *not* a live server/database connection. The Node suite covers a real SQLite-backed API.

### New hierarchical analytics

In **Explore → Stage → substage → material**, choose a stage, then a work package/substage, then a material, then the original source invoice. Use the breadcrumb to navigate back. All financial amounts are integer paise and reconcile to the source invoice totals, including proportional allocation of documented tax, freight and discount.

In **Explore → + Categories**, add a custom stage and substage. Future material purchases can use them through **Add Entry → Bought materials → Work stage / Substage**. Other expenses and wage/service bills also have an optional substage field. Existing records without one remain in `Not specified`; old invoices are never silently rewritten.

This hierarchy shows **recorded bill costs**, not cash outflow or construction progress. Separate summaries track actual money paid, outstanding liabilities and future planned payments. Statistical clustering is not yet implemented, and no fake ML-generated work groupings are displayed.

### Existing functionality retained

- Home: cash paid, bills owed, upcoming payment plans, category breakdown and activity.
- Add Entry: purchases with optional quantity/unit/rate and direct-amount default, partial/full/unpaid status, labour, other bills, payments, supplier advances, contracts and engineer instalments, notes/timer.
- Activity: timestamped event history, search, filters and CSV export.
- Files: original PDF/photo/DWG/DXF and other binary files (current single-file import cap 250 MiB), metadata, drawing revisions, in-app supported previews, explicit download/share, deleting original with audit.
- Explore: categorical charts, hierarchy, month-by-month cash paid and payment calendar.
- Backup & Restore: password-encrypted archive of records and original uploaded files. The browser determines file saving location.
- SQLite: persistence through `server/http.mjs` and `server/sqlite-store.mjs` with API-level conflict detection, duplicate posting keys and atomic source file updates.

## Essential privacy and storage notes

- `.env` and `data/` are private and ignored by Git. The distributed ZIP **does not contain a live project database**.
- **Do not overwrite your local `data/` directory or `.env` when upgrading.** Make a verified backup first.
- For **any public/network deployment**, change to `AUTH_MODE=owner`, configure owner password and cookie secret, and use HTTPS. Password-free mode explicitly refuses network hosting.
- A static GitHub Pages deployment cannot provide the Node API and durable SQLite storage. For this full stack, use a Node web service with **persistent disk**; see the deployment guide.
- The built-in encrypted export is portable but is not an automatic offsite backup. Test restoration periodically.
- No automatic synchronisation exists between browser-only (`npm run local`) and SQLite server mode. Do not switch storage modes expecting your entries to follow.

## Source layout

| File | Responsibility |
|---|---|
| `app.js`, `styles.css`, `index.html` | Frontend screens and interactions |
| `finance.js` | Exact money, allocation, ledger summaries |
| `hierarchy.js` | Deterministic Stage → Substage → Material aggregation and source ID tracing |
| `db.js` | IndexedDB/local or SQLite API adapters |
| `archive.js` | Encrypted archive and restore logic |
| `server/http.mjs` | HTTP/static server, authentication and API routes |
| `server/sqlite-store.mjs` | ACID persistence and original uploaded document bytes |
| `.github/workflows/test.yml` | Continuous integration on GitHub |
| `tests/` | Finance, hierarchy, archive and database integration tests |

## Audited entry changes and updated dashboard

Open an entry in Activity and choose **Edit** or **Delete**. Bills, payments, plans, contracts, advance allocations and work logs support these actions. Edits recalculate totals; deletion removes the active entry. The permanent **Change logs** filter shows the previous and new values, including changes to linked balances. Existing change logs cannot be edited or deleted during ordinary saves.

Deleting a bill releases its allocations without deleting cash payments. Deleting a payment reopens bill and plan balances. Deleting a plan or contract keeps payments and removes their schedule links. Attached documents remain in Files; delete an original separately if intended. Changes that would overpay a bill or plan, or link different recipients, are rejected.

The dashboard separates money paid, recorded cost, outstanding bills and upcoming plans. It includes monthly cash charts, budget usage, cost ranking and recent activity. Explore retains exact invoice drill-down and now shows every category in the full ranking.

If a save reply is lost, the browser retains and retries the exact request. **Retry save** verifies an unresolved write after a reload; other writes are blocked until that request is resolved. This temporary recovery request uses browser storage, and server writes require a current browser supporting IndexedDB and Web Locks.

The preview server serves frontend assets only. Replacement restores require a verified original for every file. Encrypted archives preserve the metadata content type, including files the HTTP server downloads as generic binary data.

### Real browser regression checks

CI runs `tests/browser_regressions.py` against a new disposable SQLite database. The test covers lost save replies, failed refreshes, reload recovery, SVG backup restoration, audited Edit/Delete, and desktop/mobile chart layout. It uses Selenium only for testing; no frontend or server dependency was added.

For local testing, install `selenium==4.47.0`, start `node scripts/browser-test-server.mjs`, set `BUILDLEDGER_TEST_DISPOSABLE=1`, and run `python tests/browser_regressions.py`. Optional `BUILDLEDGER_TEST_CHROME` and `BUILDLEDGER_TEST_DRIVER` select installed Chrome and ChromeDriver binaries. Screenshots are written under `.tools/`.

### Faster expense entry and finding records (8.1)

Search **Find a category** to select a complete category path. The live preview shows the recorded bill cost separately from money paid and the remaining balance. Optional calculators use the same exact paise helpers as posting; the final review remains required. Possible duplicate invoices produce a review warning, not an automatic merge or deletion.

Activity includes unpaid, unclassified, overdue-plan and settled filters, cost-head selection, date ranges, and matching-record totals. Cost-head matching includes classified agreements and plans; bill totals represent whole matching invoices. Use Explore for individual classified line costs. **Show 75 more** reaches older records, and **Clear filters** resets the view. CSV export still exports all records and is labeled accordingly.

Both browser scripts are regression checks against disposable data: `python tests/browser_regressions.py` and `python tests/browser_costs.py`. Use a newly started disposable server for independent reruns; the cost fixture inserts 155 pagination-test bills and is not intended for a real project database. CI runs the recovery suite followed by the cost suite. No database or encrypted-backup migration is needed for 8.1.
