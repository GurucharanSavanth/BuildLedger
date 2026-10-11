# BuildLedger V8 implementation and verification

## 1. Architecture and audit

Baseline and initial working-tree HEAD: `033edf8bcf832ba614166bb70544e172ad2df665`. The working tree was clean before implementation. Work is on `feature/buildledger-v8-cost-classification`; main has not been pushed or rewritten.

Repository instructions came from `../AGENTS.md`. Installed Cavecrew and Ponytail documentation was read and applied. Caveman documentation was inspected; Yangi was not found in the available skill/plugin inventory. Supported subagents performed bounded architecture, financial, frontend and independent review/QA work. No agents edited the same files concurrently.

The application remains a plain ES-module frontend with five navigation destinations. `app.js` renders forms, review, activity, files and analytical views. `finance.js` owns exact paise arithmetic, invoice/payment/advance/plan semantics, state verification and audited edits. `hierarchy.js` retains the Stage → Substage → Material → Source Bill read model.

The new independent cost axis is Cost Head → Subhead → Item/Service → Source Bill. Its immutable IDs live on the original invoice lines; its catalog lives in `settings.costCatalog`. The stage catalog in `settings.catalog`, and existing `work`, `substage` and `place` fields, retain their meaning. There is one ledger and no separately editable category totals.

`cost-catalog.js` owns the default taxonomy, units, bounded tree validation, normalized sibling-name uniqueness, stable category changes and compact audit evidence. `cost-analytics.js` derives cost allocations and invoice evidence. Each invoice total, including tax/freight/discount, is apportioned once with the existing `proportional()` algorithm. Both axes independently reconcile to the same recorded invoice total.

Persistence boundaries were inspected in `db.js`, `server/core.mjs`, `server/domain.mjs`, `server/invariants.mjs`, `server/sqlite-store.mjs`, `server/mongo-store.mjs`, `server/http.mjs` and `archive.js`. IndexedDB saves whole state, SQLite saves project settings and typed-record JSON, MongoDB preserves settings and typed document JSON, and encrypted archives preserve the complete state and authenticated original files. These existing formats support optional metadata without a database/schema/backup-format migration.

The audit also covered `index.html`, `styles.css`, existing tests, README/API documentation, deployment guidance, CI and the V7 changelog. Important compatibility risks addressed were import allowlists/offline assets, legacy missing classification, exact adjustment allocation, unchanged calculated lines during classification edits, compact category audit growth, mocked browser module scopes and double-counted cash in CSV exports.

## 2. Changed files

| Path | Change |
|---|---|
| `cost-catalog.js` | 19 heads, 186 subheads, 31 construction details; 25 units; stable IDs, ancestry/size/property validation, seeding, lookup, normalized duplicates and audited management |
| `cost-analytics.js` | Exact source allocations, stable-ID cost hierarchy, head/subhead/nature breakdowns and invoice tracing, including inactive and legacy categories |
| `finance.js` | Optional multiplier and explicit conversions; classification/catalog validation; compact and historical catalog audit enforcement; quoted-contract checks; audited linked-plan classification and incomplete schedule handling |
| `app.js` | Classification, contextual units, optional calculations/charges, quote agreements, reviews, category management, drilldowns, source details, audits and distinct financial CSV columns |
| `styles.css` | Readable cost selectors, category controls and mobile layouts |
| `server/domain.mjs` | Added head/subhead/nature dimensions to existing cost read API |
| `server/http.mjs` | Catalog/cost hierarchy read APIs and new frontend module allowlist entries |
| `dev-server.mjs` | Serve the new modules in browser-only mode |
| `sw.js` | Cache both new modules and update the offline cache identifier |
| `package.json` | Version 8.0.0; no new application dependency |
| `.github/workflows/test.yml` | Syntax checks for new modules and V8 Selenium suite |
| `tests/cost-catalog.test.mjs` | Seeding, stable IDs, custom nodes, duplicates, archive/reactivation, legacy editing, bounded trees and compact audit tampering |
| `tests/cost-calculation.test.mjs` | Direct/bathroom/SQ/multiplier/rounding/overflow, agreement quotation and schedule/edit/settlement invariants |
| `tests/cost-analytics.test.mjs` | Multi-head adjustments, legacy/inactive/no-line invoices, same-name subheads, source edits/deletions and 12,000-bill reconciliation/validation |
| `tests/cost-storage.test.mjs` | SQLite restart/read APIs, classified/custom/audited encrypted backup and original bytes, legacy backup and quoted commitment metadata |
| `tests/browser_costs.py` | Disposable SQLite + real browser/IndexedDB workflows, custom categories, calculations, quotes, linked plans, mobile/focus and screenshots |
| `tests/browser_module_source.py` | Preserve isolated ES-module scopes in older inline mock fixtures |
| `tests/browser_hierarchy.py` | Updated imports, explicit work view, UTF-8, configurable browser and ignored screenshot output |
| `tests/browser_smoke.py` | Updated module loading/dashboard wording, UTF-8/browser selection and ignored screenshots |
| `tests/browser_v2.py` | Updated module loading/unit display, UTF-8/browser selection and ignored screenshots |
| `tests/browser_regressions.py` | Deterministic native-click scrolling for taller forms |
| `tests/ui-render.test.mjs` | New module contexts, audit/source rendering, rectangular/formula-safe CSV and separate cost/cash/settlement/cancelled-plan assertions |
| `tests/server/mongo-replay.test.mjs` | Classified records and compact catalog changes through the collection-contract adapter |
| `README.md` | V8 operation, compatibility and deployment notes |
| `API_REFERENCE.md` | Added cost read APIs, identifiers and audit rules |
| `CHANGELOG_V8.md` | Release changes |
| `IMPLEMENTATION_REPORT_V8.md` | Architecture, data model, commands, results and limits |

`hierarchy.js`, `db.js`, `archive.js`, `index.html`, store transaction mechanics, file integrity constraints and authentication safeguards were intentionally preserved. Existing budget, summary, due/advance calculations and settlement allocation semantics remain in use. No `.env`, live database, original user document or credential was modified. Test screenshots go to ignored `.tools/`; tracked product screenshots were restored after old fixtures initially generated them.

## 3. Representative saved data

An invoice can carry differently classified lines without duplicating payments:

```javascript
{
  id: "original-invoice-id",
  vendor: "User-entered supplier",
  total: 300000, // integer paise; source invoice total
  lines: [
    {
      label: "OPC cement", mode: "amount",
      directAmountPaise: 200000, value: 200000,
      costHeadId: "cost-05", costSubheadId: "cost-05-04",
      costDetailId: "cost-05-04-01", costNature: "Material",
      work: "Footing & plinth", substage: "PCC", place: "Ground floor"
    },
    {
      label: "Electrical labour", mode: "amount",
      directAmountPaise: 100000, value: 100000,
      costHeadId: "cost-03", costSubheadId: "cost-03-04",
      costDetailId: null, costNature: "Labour",
      work: "Electrical", substage: "Wiring", place: "Hall"
    }
  ]
}
```

Catalog entities have stable identities and independently editable labels/status:

```javascript
{
  id: "cost-05-04", label: "Cement", parentId: "cost-05",
  type: "subhead", order: 3, suggestedUnit: "bag",
  description: "", active: true, origin: "system", aliases: []
}
```

A calculated line or optional contract `calculation` can store:

```javascript
{
  mode: "calculated", qty: "100", rate: "38500",
  quantityUnitId: "sqft", unitId: "sq100", multiplier: "1.5"
}
// 100 Sq Ft / 100 × INR 38,500 per SQ × 1.5 = 5,775,000 paise.
```

Quantities/multipliers have at most three decimal places; rates have at most two. BigInt intermediates round half up once at the line's monetary boundary. Only explicit supported unit pairs convert: Sq Ft → SQ and kg ↔ tonne. Custom unit labels are descriptive; no density, bag weight, tanker capacity or system-capacity billing assumptions are introduced.

New category logs contain `catalogChanges: [{id, before, after}]` for precisely changed entities. Exact prior audits cannot be edited or deleted. Legacy full-catalog audit snapshots remain supported. Renaming/deactivation preserves relational IDs; deletion/reparenting of catalog identities is rejected during ordinary commits. Legacy absent fields remain valid and unclassified.

## 4. UI and user workflows

- Home retains four primary financial metrics and adds a compact recorded-cost-head distribution.
- Add Entry retains all nine existing transaction types. Simple bill/expense forms start with amount and purpose; classification, stage and location are optional. Direct amount is the default. Purchase lines have independent cost/stage/location fields and optional calculations. Unit suggestions never force a unit.
- Advanced calculation supports per-bathroom, area/SQ, hours, other units, custom labels and visible optional multipliers. Optional invoice-level freight/tax/discount use existing allocation logic. Review warns when transportation appears both as an item and as invoice-level freight.
- Contracts accept direct agreements or optional quoted calculations. Actual invoices are still separately recorded. Sixteen linked instalments distribute integer remainder paise exactly.
- Review distinguishes recorded expense, cash now, unpaid balance, linked bill/plan balances and contract commitment. Original bill details show each line's classification and calculation evidence.
- Categories offers separate Cost Heads and Work Stages modes. The cost catalog supports browse/search/add at all three levels, label rename, display order, active/inactive changes and historical bill counts. Financial and taxonomy changes have readable before/after audit views.
- Explore offers cost heads/nature alongside existing stages, location, supplier, material, monthly cash and calendar views. Cost navigation uses stable-ID breadcrumbs, search, source invoice links and progressive rows. Future classified plans and agreements are accessible even when that head has no invoice cost.
- CSV has distinct columns for recorded cost, actual payment cash, invoice amounts settled, invoice outstanding, active planned obligations and agreed commitments. Cancelled plans retain historical rows with zero remaining planned obligation. Spreadsheet formulas are escaped and rows have consistent columns.
- Existing light styling, keyboard focus, modal keyboard handling and mobile/desktop navigation are retained. Screenshot inspection found readable forms without horizontal overflow; this is not a screen-reader or accessibility certification.

## 5. Financial reconciliation

Recorded cost is the sum of valid posted invoices. Cost and stage allocations independently sum to this same value, including invoice adjustments and legacy/unclassified lines. A no-line historical invoice contributes its original total once. Deliberately classified no-line invoices retain their chosen cost head.

Cash paid is posted payments, including supplier advances. Applying an advance adds allocation evidence without another payment. Payments linked to both invoice and plan settle those balances without creating another invoice or another cash outflow. Actual bill costs, cash, unpaid liability, planned remaining obligations and agreement commitments are never added into a combined expense measure.

Classification-only edits preserve calculation metadata and monetary values. Changing a line's entered monetary total converts it deliberately to direct-amount mode; linked payment limits remain enforced. Agreement reclassification updates linked planned entries through the same audited change routine. Removing an instalment retains the agreement amount and audits its schedule as incomplete. Category totals are always recalculated from source transactions, never saved as editable ledger totals.

## 6. Verification evidence

Local environment: Windows PowerShell, Node `v24.19.0` (within package engines), Python 3.14, Chrome/ChromeDriver `152.0.7977.54`, Selenium 4.47.0. Playwright 1.63.0 was installed as a test tool to run retained fixtures; no project dependency or frontend framework was added. Node 22 and the CI-pinned Node 24.21.0 were not executed locally.

| Command | Final result |
|---|---|
| `npm.cmd test` (`npm test` script) | **65 tests: 64 passed, 0 failed, 1 skipped** |
| `node --check app.js` | Passed |
| `node --check finance.js` | Passed |
| `node --check hierarchy.js` | Passed |
| `node --check cost-catalog.js` | Passed |
| `node --check cost-analytics.js` | Passed |
| `node --check db.js` | Passed |
| `node --check archive.js` | Passed |
| `node --check dev-server.mjs` | Passed |
| `node --check sw.js` | Passed |
| `node --check server/http.mjs` | Passed |
| `node --check server/domain.mjs` | Passed |
| `python tests/browser_regressions.py` | Passed: actual disposable SQLite, uncertain/replayed saves, failed refresh, reload, SVG encrypted restore, audited edit/delete, desktop/mobile charts |
| `python -u tests/browser_costs.py` | Passed: classifications, child reset, custom search/archive/reactivation, native wages, optional charges/transport warning, bathroom/SQ/multiplier and agreement quotations, exact 16 plans, source bill, unchanged settlements, keyboard/mobile, real IndexedDB reload/encrypted backup |
| `python tests/browser_hierarchy.py` | Passed: retained desktop work-stage drilldown to invoice, mobile empty state/overflow |
| `python tests/browser_v2.py` | Passed: retained direct purchase/labour, supported PDF preview, intentional document deletion/share behavior and mobile entry |
| `python tests/browser_smoke.py` | Passed: Home/Add/posted invoice+payment/plan/Files/Calendar and mobile layout |
| `git diff --check` | Passed |

Browser scripts used `BUILDLEDGER_TEST_DISPOSABLE=1` for live storage, `BUILDLEDGER_TEST_BASE_URL=http://127.0.0.1:8099`, `BUILDLEDGER_TEST_LOCAL_URL=http://127.0.0.1:8098` for IndexedDB, and explicit `BUILDLEDGER_TEST_CHROME` / `BUILDLEDGER_TEST_DRIVER` paths. Servers were started with `node scripts/browser-test-server.mjs` and `$env:PORT='8098'; node dev-server.mjs`. SQLite fixtures were disposable temp databases; browser profiles were temporary. The local-preview health 404 is expected and was narrowly excluded from browser error assertions.

The new 12,000-bill test uses 24,000 source lines, 1,000 additional catalog heads, decimal quantities, missing classifications and 12,000 partial payments linked to plans and invoices. Both cost and stage totals reconcile; `verifyState()` validates the saved fixture. Final full-suite measurement: cost hierarchy **108.0 ms**, full financial validation **6,301.1 ms**. A focused run measured 47.8 ms / 6,363.3 ms. These are synthetic local observations, not production-scale certification or timing guarantees.

Earlier test failures were repaired: incomplete fixtures omitted stored line values; JSON persistence drops undefined properties; older inline browser fixtures needed isolated new modules, UTF-8 reads and current view/label expectations; native Selenium clicks needed deterministic scrolling. Final results above are successful reruns, not claims that no intermediate failures occurred.

## 7. Compatibility and deployment

Schema stays at 1; SQLite tables, MongoDB collections, IndexedDB version and encrypted archive format remain unchanged. Shared validation reaches all normal save and restore boundaries. Tests confirm custom/default catalogs, classifications, audit snapshots, quoted commitments and original attachment bytes survive supported roundtrips. Old backups with no cost catalog restore unchanged. New optional arithmetic metadata should not be downgraded into V7.

HTTP read APIs use existing authentication and revision conventions. New modules are available in both servers and the offline cache. Atomic file/state persistence, optimistic revisions, exact idempotency replay and uncertain-save recovery remain operational. Browser-only storage does not synchronize with server storage.

Static GitHub Pages can run the browser/IndexedDB application only. It cannot run SQLite or the Node API and has no automatic durable server/offsite backup. Full server deployment still requires persistent storage, network-owner authentication, HTTPS and independently verified backups. No deployment, push or production configuration change was made.

## 8. Remaining limits and omitted work

- **Skipped:** live MongoDB integration needs `TEST_MONGODB_URI` pointing to a disposable replica set. Collection-contract tests passed, but they are not live Mongo transaction evidence.
- **Not executed:** legacy `tests/browser_live_sqlite.py`, which needs separately provisioned owner-login credentials/configuration; current disposable browser regressions cover live SQLite without reading `.env`. Owner authentication/access-control API tests passed.
- **Not executed:** hosted CI, Node 22/CI-pinned Node runtime, real production HTTPS, hosting/failover and an actual screen-reader audit. GitHub Actions was updated but not run remotely.
- Full financial verification still has pre-existing quadratic settlement scans. At the tested 12,000-record fixture it took about 6.3 seconds; large-project saves can pause. Analytics itself was much faster. The financial engine was not broadly refactored solely to optimize synthetic timing.
- Maximum-size files/backups, production hardware/storage latency, actual browser file-save dialogs and downloaded CSV reopening in Excel were not exhaustively tested. CSV content, formula protection, column consistency and monetary aggregates were asserted directly; encrypted original-byte restoration was exercised in Node and browser suites.
- No speculative prices/taxes, automatic historical reclassification, bulk category merges, independent editable totals, additional top-level navigation, framework migration or second backend was added. Bulk reclassification is intentionally absent; deliberate per-invoice classification changes are audited.
- Existing state/file size caps and browser backup limitations remain. Tests cannot guarantee zero defects or certify financial/security correctness in every deployment.

## 9. Git delivery

Feature branch: `feature/buildledger-v8-cost-classification`. The delivery commit SHA is supplied in the final handoff and can be read with `git log -1 --format=%H`. The table above is the exact changed-path list. No push was performed.

After review, publish the branch with:

```powershell
git push -u origin feature/buildledger-v8-cost-classification
```

Do not force-update main or overwrite a live `data/` directory or `.env` during upgrade.
