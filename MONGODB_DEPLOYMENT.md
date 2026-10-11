# MongoDB Deployment and Data Safety

## Option A — Managed MongoDB Atlas (recommended for hosting)
1. Create a MongoDB Atlas cluster with transaction support, database account, and restrictive network policy. Never connect to an anonymous or publicly writable database.
2. Deploy the **whole Node.js repository** to a Node-capable host (VM, Render web service, Railway, Fly.io, etc.). Static-only hosting like GitHub Pages or Netlify Static does not run the MongoDB API.
3. Configure `MONGODB_URI` with the connection string, `MONGODB_DB=buildledger`, a strong `ADMIN_PASSWORD` and 32+ character random `APP_COOKIE_SECRET`. Do not check secrets into Git.
4. Install dependencies using `npm ci` if a lockfile is available, or `npm install` with Node.js 20+. Run `npm start`. Configure `HOST=0.0.0.0` and your platform's `PORT` environment setting.
5. Terminate TLS/HTTPS at the platform or reverse proxy. The website and `/api/v1/*` must be on the **same HTTPS origin** for the HttpOnly session cookie and CSP.
6. Verify health, sign in, add a small test invoice/payment, upload/open a PDF, create a backup, restore in a clean test instance, and compare file SHA-256 and all financial totals. Do this BEFORE entering real project data.
7. Configure database backups/retention in the provider as well as manually exporting BuildLedger's encrypted ZIP including originals.

## Option B — Local development with MongoDB Docker

`docker compose -f docker-compose.mongo.yml up -d`

Initiate a *single-node development replica set* once:

`docker exec buildledger-mongo-dev mongosh --quiet --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27017"}]})'`

Set the environment (PowerShell example):

```powershell
$env:MONGODB_URI = 'mongodb://127.0.0.1:27017/?replicaSet=rs0'
$env:MONGODB_DB = 'buildledger'
$env:ADMIN_PASSWORD = 'USE-YOUR-OWN-LONG-UNIQUE-PASSWORD'
$env:APP_COOKIE_SECRET = 'GENERATE-AT-LEAST-32-RANDOM-CHARACTERS-AND-KEEP-IT-PRIVATE'
npm install
npm start
```

Open `http://127.0.0.1:8080`. MongoDB replica-set transactions are required; do **not** run production on a standalone MongoDB server without transaction support.

## Restore and old data migration
Old V1 data remains in the previous browser's IndexedDB; the new server does not silently import it. In the old app, create a verified encrypted Backup ZIP. In the new authenticated site, choose Backup & Restore → Import and provide the old ZIP and its recovery password. The client validates its contents and the server stages all originals before replacing project state in a revision-protected transaction. Make a second independent backup first.

## Security and operational limits
- v2 is **one owner account / one project**, not customer signup, team roles or a general multi-tenant service. Publicly accessible sign-in does not mean visitors can register their own private projects.
- Server-side sessions are held in memory; restart logs out active users. Use a single server instance or external session storage before horizontal scaling.
- Session password recovery depends on your server administrator; encrypted ZIP recovery password is independent and cannot be recovered if lost.
- The API uses conditional revision writes. Concurrent editors must reload upon a conflict; it is not live collaboration or CRDT sync.
- Server must be monitored for database/storage quota, 5xx errors and backup verification failures; encrypted backup archives should be stored separately from the MongoDB host.
- Unstructured binaries are stored as 1 MiB NoSQL chunks with SHA-256, not as paths pointing to unstable local client files.
- No actual MongoDB integration test ran in the offline artifact-generation environment, because the MongoDB Node driver and mongod could not be installed there. API endpoint tests used a deterministic in-memory database substitute. Do not claim live production correctness before running the included acceptance steps against your own MongoDB replica set.
