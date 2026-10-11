# BuildLedger V8 — independent expense classification

- Added all 19 requested construction expense heads, 186 subheads and 31 construction material/service details with stable IDs and idempotent seeding.
- Preserved the independent Stage → Substage → Material → Original Bill hierarchy and the existing five navigation destinations.
- Added owner category creation, search, rename, ordering, deactivate/reactivate and compact immutable audit evidence. Referenced categories retain their identities.
- Classified individual invoice lines, simple expenses, contracts and instalments; historical records remain deliberately unclassified.
- Added optional units, explicit Sq Ft-to-SQ and kg/tonne conversion, and positive multipliers using BigInt intermediates with one half-up line rounding.
- Added optional area/rate agreement quotations and exact instalment splitting. Agreement edits propagate classification to linked plans; deleting an instalment retains commitment and audits that its schedule is incomplete.
- Added cost-head and cost-nature views, invoice tracing, linked upcoming instalments/agreements, source details, readable category/reclassification audits and formula-safe detailed CSV exports with distinct financial columns.
- Extended read APIs and frontend/offline asset allowlists. Retained schema 1 and existing database/backup formats and file integrity safeguards.
- Added targeted catalog, financial, analytics, storage, export, Mongo collection-contract and real-browser regressions. Updated CI to check new modules and run V8 browser scenarios.

No prices, statutory charges, density assumptions or automatic historical classifications were introduced. No live database, `.env`, credentials or deployment was changed. See the implementation report for exact verification and limitations.
