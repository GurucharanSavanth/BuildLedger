# V4 changes (relative to V3 and V1)

- Added **`server/sqlite-store.mjs`**: real persistent local SQLite relational tables for all typed finance records, audit, projects, file chunks, binary metadata and idempotency operations; one atomic commit, foreign key settings, WAL, synchronous FULL, proper restart persistence.
- Node server default mode is local **SQLite**, without third-party npm packages. Optional Mongo driver remains available if configured separately.
- New `npm run setup` generates unique owner password and session secret into a private `.env` (not included in source ZIP). `npm run dev` and `npm start` load `.env` automatically.
- Typed REST API create operations now have idempotency replay protection in SQLite mode, beyond project-revision conflict checks.
- Default material entry is **direct item amount** (₹0 default). You can optionally expand **Quantity / Rate / Unit** while keeping the manually entered amount authoritative, or explicitly select calculated mode. Transport, tax, discount all optional and default zero.
- In Files, **View** is an in-app document preview for supported image/PDF/text/media. **Share with app** invokes OS Web Share when supported or displays a limitation; it never silently saves/downloads. **Save a copy** intentionally downloads. **Delete file** removes the original bytes and metadata in one transaction after confirmation. Revision and drawing status metadata are preserved until deletion.
- More tests cover SQLite persistence, HTTP financial routes, file bytes and deletion, idempotency replay, direct amount optional metadata and browser preview.
- README/API/release instructions updated for local SQLite operations and public deployment limitations.

**Important:** No user records or `.env` credentials are included in the released source ZIP. The SQLite database is created locally when you first run the server.
