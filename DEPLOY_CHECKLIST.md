# WARNING: PASSWORD-FREE LOCAL USE ONLY

V5 defaults to direct entry with `AUTH_MODE=local`, `HOST=127.0.0.1`. **Do not port-forward, reverse-proxy, publish or deploy this configuration to a cloud service.** Anyone with local OS access can read/change the data. Enable owner authentication (or implement production identity/access management) BEFORE network exposure. Review `NO_LOGIN_MODE.md`.

# BuildLedger V4 — pre-release checklist

## Built and verified in this coding environment
- [x] Material purchases: direct total (default ₹0), optional quantity/unit/rate metadata, alternate calculated mode; optional tax/transport/discount default zero.
- [x] Client financial review and separate bill, payment and plan effects.
- [x] SQLite-backed authenticated HTTP API and data persistence across DB reopen.
- [x] Typed API idempotency with repeated request replay and changed-payload conflict.
- [x] Atomic SQLite file import, verified original content, protected inline PDF retrieval, intentional download and audited file deletion.
- [x] Local browser UI tests of in-app PDF preview and honest unsupported CAD fallback, no automatic share download.
- [x] Encrypted ZIP archive roundtrip and integrity tests (unit-level).
- [x] Mobile browser UI smoke/layout checks (mock data adapter).

## REQUIRED before public production use
- [ ] Run end-to-end browser workflows against real authenticated server + SQLite on target operating systems. Development test browser blocked localhost navigation; not falsely marked complete.
- [ ] Test full encrypted backup/import from a real deployed site using real uploads, including cross-device transfer and large archives.
- [ ] Perform failure-injection tests for disk-full conditions, database corruption, server crashes and interrupted uploads/restores.
- [ ] Run real concurrency/revision-conflict tests against all client flows including multi-tab edits.
- [ ] Independently reconcile a known set of material lots, bills, multiple tenders, partial payments, advances, retained sums, refunds, and instalments; collect user sign-off.
- [ ] Test malicious files, MIME spoofing, very large files, upload exhaustion, account session expiration and server security against a real deployment.
- [ ] Add HTTPS, brute-force defence across restarts, audit monitoring, account recovery policy, reverse-proxy rules, secure headers and off-host data backups.
- [ ] Validate screen reader, font scaling, keyboard navigation and usability for intended 50–70 age group.
- [ ] Define durable secure business data retention (hard deletion of proof files can be a legal or financial issue).
- [ ] Implement user accounts and role-level permissions before opening access to unrelated users.
- [ ] Validate Node version and pin supported `node:sqlite` behaviour for chosen release environment.
- [ ] Add a local/business backup plan for the plaintext at-rest SQLite file; encrypted export ZIP alone is not automatic.

**Do not claim zero bugs or all previous aspirational features implemented.** In particular, full OCR, statistical clustering, stock valuation, ledger reversals, CAD rendering, native push while app closed, sophisticated recurring payments, bank feeds, and public multi-tenant API are not production features in this codebase.
