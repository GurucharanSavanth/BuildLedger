# BuildLedger V7 — Hierarchical analytics and GitHub deployment

## Features
- Fully navigable **Stage → Substage → Material → Original source bill** hierarchy, with breadcrumbs, exact cost values and progressive row loading.
- A category management form for adding custom stages/substages. New categories persist in SQLite project settings and appear in expense entry.
- Optional substage field for individual purchase lines, labour, service expenses and received bills. Old records without a substage display `Not specified`.
- Dedicated `GET /api/v1/analytics/hierarchy?level=...&level=...&level=...` endpoint, validated on the actual persistent SQLite API. The frontend uses the same deterministic pure calculation module.
- Unit tests for 12,000 bills, split-line tax/freight allocation and missing substages; browser test of category creation, three drill levels and opening the original invoice.
- Fixed a saved-category runtime typo uncovered by browser testing.
- Exact paise string formatting for large safe-integer amounts (no float rounding in formatted output).
- Added GitHub CI, source `.gitignore`, Node version pin and production deployment instructions for a protected Node service with a persistent SQLite disk.

## Important financial interpretation
Hierarchical amounts represent **posted/recorded bill totals**, apportioned across invoice line values including freight, tax and discount. They are **not** actual cash outflow, stock consumption or a construction-progress valuation. They should not be summed together with cash payment totals. Empty stages/substages appear as `Uncategorised`/`Not specified`; no expenses are silently assigned by ML.

## Known limitations
- This is a single-owner app. No multi-user role permissions or 2FA.
- User-created labels are saved as immutable historical bill descriptions; advanced rename/merge migration tools are not implemented. Avoid creating near-duplicate labels (e.g. `Sump` vs `Sump Work`).
- Automatic material inventory consumption and advanced unsupervised clustering remain out of scope.
- Live hosting/browser/SSL/failover testing on your own provider remains required.
