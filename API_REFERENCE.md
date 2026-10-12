# Authentication update (V5)

## V8 cost classification read APIs

These endpoints use the same authentication rules as other project APIs:

| Method | Endpoint | Result |
|---|---|---|
| GET | `/api/v1/catalog/cost-heads` | Effective catalog `items` and `asOfRevision`, including inactive categories |
| GET | `/api/v1/analytics/cost-hierarchy?level=cost-03&level=cost-03-07` | Stable-ID path, allocated recorded-cost `total`, distinct source bill `count`, child nodes; source line evidence at depth three |
| GET | `/api/v1/analytics/costs?by=head` | Cost-head totals in integer `amountPaise` |
| GET | `/api/v1/analytics/costs?by=subhead` | Parent-qualified subhead totals |
| GET | `/api/v1/analytics/costs?by=nature` | Material, Labour, services and other optional cost-nature totals |

The existing work/place/vendor/material breakdowns and stage hierarchy endpoints retain their behavior. Cost-hierarchy paths have at most three category identifiers. Unknown paths return 404; invalid depth returns 400. Cost measures derive only from posted invoices and include the legacy/unclassified bucket. Linked payments and planned instalments are separate obligations, not additional costs.

Optional bill-line fields are `costHeadId`, `costSubheadId`, `costDetailId`, `costNature`, `unitId`, `quantityUnitId` and `multiplier`. Store taxonomy nodes in `settings.costCatalog`; do not replace the work-stage `settings.catalog`. State commits validate category ancestry, immutable identities, bounded catalog size, known units and exact audited edits. Category changes use `cost_catalog` audit records with exact `catalogChanges` before/after entity evidence. Existing full before/after catalog audit snapshots remain accepted. Existing commit revisions, idempotency keys and file verification requirements remain unchanged.

Default `AUTH_MODE=local` on `127.0.0.1` does **not** require login or a session. `GET /api/v1/session` responds with `authenticated: true, auth: not_required`. `POST /api/v1/login` returns 404 because it is unnecessary. The entire API remains inaccessible when bound to a non-local interface in this mode. `AUTH_MODE=owner` retains the password-based API described below.

---

# BuildLedger Web V4 — Versioned REST API

The **same Node HTTP process** serves the PWA and the authenticated REST API, which is backed by persistent local SQLite by default. No API keys are embedded in frontend JavaScript. Clients use a `HttpOnly; SameSite=Strict` owner session cookie after password login. Cross-site write requests with a mismatched `Origin` are blocked. This is one-owner, one-project architecture, not a multi-tenant system.

## Local setup

```bash
npm run setup
npm run dev
```

Open `http://127.0.0.1:8080` and sign in. Read the owner password printed by `npm run setup`; keep it private. SQLite records and original uploaded bytes are stored in `data/buildledger.sqlite`. Do not copy that database alone while the service is running with WAL.

## Authentication

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/v1/health` | Database check, operational status (`mode: "sqlite"`) |
| POST | `/api/v1/login` | `{ "password": "..." }`; sets HttpOnly session cookie |
| GET | `/api/v1/session` | `{authenticated: true/false, mode:"sqlite"}` |
| POST | `/api/v1/logout` | Invalidates current server session |

Account passwords and session secrets live only in `.env`, never in web assets or ZIP. Sessions expire and are kept in memory (server restart logs out existing sessions).

## Reading project state

| Method | Endpoint | Returns |
|---|---|---|
| GET | `/api/v1/state` | Complete typed project record projection with `rev` |
| GET | `/api/v1/dashboard` | Paid, invoices, open bills, advances, 30-day plans and metric definitions |
| GET | `/api/v1/activity?type=All&q=steel&limit=50&offset=0` | Filtered and paginated activity events |
| GET | `/api/v1/analytics/costs?by=work` | Stage/location/supplier/material cost sums in integer paise |
| GET | `/api/v1/calendar` | Scheduled payments and paid amounts |
| GET | `/api/v1/documents` | File metadata list and project revision |
| GET | `/api/v1/files/{id}` | Original file bytes; safe preview types inline, unsupported types attachment-only |
| GET | `/api/v1/files/{id}?download=1` | Explicit attachment download of original bytes |

All financial values in responses are integers representing **paise**. Dates are ISO `YYYY-MM-DD`; transaction event timestamps are ISO 8601 (display `DD-MM-YYYY :: HH:mm:ss` in client local zone). Avoid comparing a cash figure with an accrued cost figure as if they were additive.

Activity search `q` accepts at most 200 characters; `type` accepts at most 80. `limit` and `offset` must be non-negative integers. Results are capped at 200 per request; the maximum offset is 1,000,000. Invalid inputs return HTTP 400 before reading project data.

## Typed record posting

- `POST /api/v1/bills` — `{ "record": { "id": "uuid", "vendor": "Supplier", "title": "Sump steel", "date": "2026-10-11", "recordedAt": "...UTC...", "total": 125000, "lines": [{"label":"12 mm TMT", "mode":"amount", "directAmountPaise":125000,"value":125000,"qty":null,"rate":null,"unit":null,"work":"Sump & excavation"}], "type": "purchase", "extras":0,"tax":0,"discount":0 }, "key":"uuid" }`
- `POST /api/v1/payments` — `{ "record": {"id":"uuid","vendor":"Supplier","amount":50000,"date":"2026-10-11","recordedAt":"..."},"allocations":[{"billId":"existing-bill-uuid","amount":50000}],"key":"uuid" }`. Validated against outstanding invoice amount.
- `POST /api/v1/plans` — `{ "record": {"id":"uuid","vendor":"Engineer","title":"Stage 2","amount":3125000,"due":"2026-11-15","recordedAt":"..."},"key":"uuid" }`. Planning doesn't post a cash payment.

The `key` is an idempotency token. In SQLite and MongoDB modes, replaying the *same* create request with the same key returns the original successful revision; changing the payload under an existing key returns HTTP 409. The full-source `POST /commit` also supports versioned idempotency for the website's bulk/composite operations.

## Uploaded original files

1. `POST /api/v1/uploads/start`: `{id,name,size,sha256,type}`. Returns `{uploadId,chunkBytes,numChunks}`. Max one original: 250 MiB.
2. `PUT /api/v1/uploads/{uploadId}/chunks/{index}` with binary `application/octet-stream` body. Chunk size 1 MiB except final. Retry of identical chunk is allowed.
3. `POST /api/v1/uploads/{uploadId}/complete` verifies exact original length, ordered chunks and SHA-256.
4. `POST /api/v1/commit`: `{expectedRev,state,newFiles:[{id,uploadId}],removeFiles:[],key,replace:false}` posts metadata and verified bytes in one SQLite transaction, with project revision CAS validation. Deleting requires removing the file metadata **and** listing its ID in `removeFiles`.
5. A document's original bytes, MIME and hash cannot be edited in place. Save a new file as a revision, maintaining original evidence until explicitly deleted.

## Errors

`401`: unauthenticated; `403`: rejected origin; `409`: version or idempotency conflict; `413`: request/upload too large; `422`: validation, allocation, file integrity or financial errors; `503`: storage unavailable. JSON body `{ "code":"ERROR_CODE", "message":"Safe explanation" }`. The browser surfaces these errors without silently switching from SQLite to a different database.

## Storage schema

`project` stores revision and top-level settings; `records` stores typed JSON documents indexed by kind, date, and counterparty; `assets`, `file_chunks`, and `uploads` preserve original binary content and integrity metadata; `operations` stores committed idempotency responses; `schema_info` retains the local schema version. All these tables reside in SQLite. WAL and `synchronous=FULL` are configured; server files are created with restrictive OS permissions where supported.

## Security and versioning constraints

The API is not designed for general public registration or several independent customers. It has a single admin password and no per-user access controls. HTTP localhost is for personal development only; use HTTPS, a suitable reverse proxy, a protected persistent disk, backups, monitoring and a security review before internet exposure.


## V7: hierarchical analytics

`GET /api/v1/analytics/hierarchy` returns the root stage breakdown. Add `level` parameters in order to request deeper nodes:

`GET /api/v1/analytics/hierarchy?level=Sump%20%26%20excavation`

`GET /api/v1/analytics/hierarchy?level=Sump%20%26%20excavation&level=Reinforcement`

`GET /api/v1/analytics/hierarchy?level=Sump%20%26%20excavation&level=Reinforcement&level=12%20mm%20TMT`

The response provides `path`, `total` (paise), `count` (distinct bills), `children:[{name,total,count}]`. A three-level leaf also returns source `entries` with bill IDs and per-line allocated amounts. Bill totals are allocated exactly once across source lines including invoice-level tax/freight/discount, and no standalone payment is counted again. Path selection is exact (case-sensitive); missing substage is `Not specified`. Authentication follows the existing deployment mode.

Custom categories are persisted in `state.settings.catalog` via the same protected project revision/commit API as other project settings. Historical bill lines are never rewritten. 

## Audited edits and deletions

Entry changes use the existing versioned `POST /api/v1/commit`. The shared `changeEntry(state, kind, id, patch)` helper produces an edit and its audit log; omit `patch` for deletion. Supported kinds: `bill`, `payment`, `plan`, `contract`, `allocation`, `note`.

New `entry_edit` and `entry_delete` audit records contain `changes:[{kind,id,before,after}]`. `kind` names the state collection. `after:null` records deletion. Both stores verify that these snapshots exactly match all modified or removed posted records. Existing audit records cannot change. The operation remains atomic with the revision update and file changes.

`GET /api/v1/activity?type=audit` returns change logs, and `type=allocation` returns advance applications. The browser's CSV export includes contracts and logs. Replacement restores intentionally replace the imported project, but must include verified uploads for every desired file, even when an ID already exists.
