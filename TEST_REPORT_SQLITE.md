# SQLite server verification - 22 October 2026

The server uses SQLite through Node's built-in database module. Browser-only mode uses IndexedDB; native Android uses Room over SQLite.

## Changes

- Removed the unused alternate database adapter, database driver dependency, deployment assets and adapter-specific tests.
- Kept the existing SQLite schema, financial rules, authentication, archive formats and configured database path.
- Unsupported database configuration now exits before opening or creating a database.
- Rewrote database guidance and updated API documentation, setup comments and source checksums.

## Executed checks

- `npm.cmd test` on Node v24.19.0: **89 passed, 0 failed, 0 skipped**.
- The suite includes actual disposable SQLite reopen/persistence, original file bytes and deletion, authentication/access control, financial allocation, conflict/replay protection, encrypted archive roundtrips and the new unsupported-configuration startup guard.
- The existing private configuration already selects SQLite and has no alternate database settings. Its values and data files were preserved.

The installed runtime is within package engines; `.node-version` pins 24.21.0. Historical versioned reports describe earlier runs and are not the current suite count.

Not repeated: Android build/device tests, browser automation, production-host validation and physical database recovery drills. This change does not alter the Android persistence implementation.
