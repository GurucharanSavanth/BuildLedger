# BuildLedger V7 — GitHub + Render deployment guide

**Deployment architecture:** GitHub stores only source code. Render runs the Node HTTP server, REST API and encrypted-session owner sign-in. A paid persistent disk contains the SQLite file and its original document chunks. The full app (frontend+API) is served at a single HTTPS origin.

This is a **single-owner deployment**. It is not yet a multi-account SaaS. Public internet access must never use no-password local mode, and it is not appropriate to claim release certification solely on this test suite.

## 0. Before anything: backup existing records

If upgrading an existing BuildLedger installation, open its Backup & Restore screen and create a verified encrypted archive containing all transactions and original uploaded drawings/photos. Copy the archive somewhere safe outside the project directory. For a direct source upgrade on the same computer, **never overwrite or delete your existing `data/` folder or `.env`**. The source ZIP deliberately does not include either one.

## 1. Prepare the V7 source on Windows

1. Extract `BuildLedger_V7_Hierarchical_Infographics_Full_Source.zip`.
2. Open the extracted `BuildLedger_Web_V7` folder in VS Code or Windows Explorer.
3. In Windows PowerShell, open a terminal in that folder.
4. Check `node -v` (use Node.js **24.21.0** as pinned in `.node-version`, or a locally tested Node >=22.13) and `git --version`.
5. Run `npm.cmd run setup` (generates a local `.env` on a new installation; preserves an existing one).
6. Run `npm.cmd test`.
7. Run `npm.cmd run dev`, then browse to `http://127.0.0.1:8080`.
8. In Explore, open **Stage → substage → material**, create a custom category, add a sample bill on a disposable database, and verify the drilldown.
9. Stop the local server with Ctrl+C.

If PowerShell script execution blocks `npm`, use `npm.cmd` rather than changing system-wide execution policy.

## 2. Push to a new PRIVATE GitHub repository

GitHub: open https://github.com/new and create a **Private** repository, e.g. `BuildLedger`. Do **not** pre-create a README or .gitignore on GitHub, since both are included in the ZIP. You can later change visibility intentionally.

In the extracted source folder:

```powershell
git init
git branch -M main
git add .
git status
git commit -m "BuildLedger V7 hierarchical construction-cost analytics"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/BuildLedger.git
git push -u origin main
```

Replace `YOUR_GITHUB_USERNAME`. Complete the GitHub authentication in your browser/Git credential manager. **Never put a password/token into the command line URL.** If `origin` already exists, use `git remote -v` and `git remote set-url origin <url>` instead.

Confirm that `.env`, database files (`data/*.sqlite`, `*-wal`, `*-shm`), backup archives, customer photos and other private project data are **not** listed in `git status` or published in the repository. `.gitignore` covers common secrets and local databases, but review staged files manually.

The `.github/workflows/test.yml` workflow runs Node code checks and automated tests after every push. The optional MongoDB test is skipped unless you configure a disposable replica set.

## 3. Deploy frontend AND backend to Render

**Do not use GitHub Pages for the full application.** GitHub Pages provides static files, not a continuously running Node HTTP API or durable server-side SQLite storage. Using static-only mode would leave records isolated to individual browsers.

1. Sign in to https://dashboard.render.com.
2. Click **New → Web Service**, connect GitHub, and select your `BuildLedger` repository.
3. Runtime: **Node**. Branch: `main`.
4. Build command: `npm install --omit=optional` (or use Render's default Node dependency installer).
5. Start command: `npm start`.
6. Choose a **paid web service with a persistent disk**. Render Free web services cannot attach the durable disk used by this SQLite configuration.
7. In Advanced / Disk, add a persistent disk with mount path `/var/data`; choose enough storage for original CAD drawings, images and the SQLite database. **Only content under this mount path persists across redeploys.**
8. Under Environment, set the following exact names (values below are illustrative, not real secrets):

| Variable | Value or rule |
|---|---|
| `DATABASE_MODE` | `sqlite` |
| `SQLITE_PATH` | `/var/data/buildledger.sqlite` |
| `AUTH_MODE` | `owner` **(required for network deployment)** |
| `HOST` | `0.0.0.0` |
| `PORT` | Leave unset so Render injects its assigned port; the app reads `$PORT` |
| `NODE_VERSION` | `24.21.0` (or let `.node-version` supply it) |
| `ADMIN_PASSWORD` | A unique long owner password, at least 12 characters. Use a password manager. |
| `APP_COOKIE_SECRET` | An independent random secret at least 32 characters; ideally 64 hexadecimal characters. |

Generate a random cookie secret **locally** in PowerShell if needed:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy this output into the Render Environment setting; do not commit it to GitHub. Use a *different* random value for `ADMIN_PASSWORD`, generated by your password manager. `npm run setup:secure` is optional for local use only; do **not** run `npm run setup` on the Render build pipeline.

9. Add health check path `/api/v1/health` if the Render screen offers that setting.
10. Click **Deploy Web Service**. Render will build and launch the app with HTTPS.
11. Open the `https://your-name.onrender.com/` URL. You should see the owner password screen. Sign in and check Explore → Hierarchy, Files, and Add Entry.

**Important:** You previously requested no password for local use. That remains supported at `127.0.0.1`. On a public network the password screen MUST be enabled; publishing a no-password financial/document server would expose all records to anyone reaching the URL.

## 4. Move existing local data to a NEW hosted instance

1. Back up local BuildLedger from Files / Backup & Restore (include originals); store the encryption password safely.
2. Deploy the new server and sign in.
3. Import the encrypted archive using the app's Restore flow **only on a new/empty hosted database** or after deliberately preserving a separate rollback backup of hosted content.
4. Reopen the dashboard and verify a sample of invoice/payment totals, engineer instalments, drawings, file revisions and the complete Stage→Substage→Material hierarchy. Historical records that lack substages will appear under `Not specified`.
5. Create a fresh hosted archive and verify its restore on a separate disposable instance before trusting your only copy.

The existing archive is a portable application export; it is not Git source control. Never upload an unencrypted database or raw receipt photos to GitHub.

## 5. Routine updates after publishing

```powershell
git add .
git commit -m "Refine BuildLedger"
git push origin main
```

Render normally starts a deployment on a new GitHub commit. Preserve the Render disk; source deployments must not replace `/var/data/buildledger.sqlite`. If updating a running production instance, generate a fresh backup beforehand and verify release notes for schema/finance changes. With a persistent disk, Render's deployments can have short downtime.

## 6. Risks and release requirements

- Do not host SQLite on an ephemeral filesystem: a redeploy could erase your records.
- The owner-password mode is basic single-owner access, **not** complete identity management, multi-factor authentication, role permissions or a multi-user system.
- Validate HTTPS cookies and login/session handling through the actual provider's reverse proxy, not just localhost tests.
- Maintain off-host, tested encrypted backups and a written recovery procedure. Persistent disks alone are not enough.
- Test with the real browser and hosted HTTPS server (upload/preview/delete CAD/PDF/photo, record partial payments, create categories, check backup/restore and mobile scaling) before real financial use.
- Monitor server logs, filesystem usage and disk space. Large-file uploads have explicit size limits.
- Independent security review and reconciled financial acceptance tests are required before offering the app to unrelated users or marketing it as a secure financial platform.

## Sources
- [GitHub: Adding locally hosted code](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- [Render web services](https://render.com/docs/web-services)
- [Render persistent disks](https://render.com/docs/disks)
- [Render Node version configuration](https://render.com/docs/node-version)
- [Render environment variables](https://render.com/docs/configure-environment-variables)
