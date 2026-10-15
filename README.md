# factory-testbed

The pilot service for the SDLC factory. Deliberately small, with the surfaces the factory's checks exist to protect: authentication, per-object authorization, input validation and file uploads.

## The API

| Route | Auth | Does |
|---|---|---|
| `GET /healthz` | none | Status, plus the release (commit sha) and environment that are running |
| `POST /auth/register` | none | Create a user (`email`, `password` of 12–256 chars) |
| `POST /auth/login` | none | Returns a bearer token, valid 24 h |
| `POST /auth/logout` | bearer | Revokes the token |
| `GET/POST /notes` | bearer | List your notes, create one (`title` 1–200 chars, `body` up to 10 000) |
| `GET/PATCH/DELETE /notes/:id` | bearer | Read, update or delete one of **your** notes; anyone else's answers 404 |
| `POST /notes/:id/attachments` | bearer | Upload one PNG, JPEG or PDF up to 2 MiB (multipart field `file`) |
| `GET /notes/:id/attachments/:attachmentId` | bearer | Download it (always as an attachment) |

## Run it

Node 24 runs the TypeScript sources directly (type stripping); there is no build step.

```bash
npm ci --ignore-scripts
npm run check        # lint, typecheck, tests
npm start            # http://localhost:3000, in-memory database
```

`docker build -t factory-testbed .` builds the production image (port 10000, database and uploads under `/data`).

| Env var | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `DATABASE_PATH` | `:memory:` | SQLite file (Node's built-in `node:sqlite`) |
| `UPLOAD_DIR` | `data/uploads` | Where attachments are stored, under random ids |
| `RELEASE` | `dev` | Set by the image build to the commit sha |
| `APP_ENV` | `development` | `staging` or `production` on Render |
| `SENTRY_DSN` | unset | Error reporting; no DSN, no Sentry. Request bodies, headers, cookies and user data are never sent |

Render's free instances have no persistent disk, so data resets on every deploy or restart. That is fine for a testbed.

## CI and deploys

- **`ci.yml`** runs on every pull request and every push to `main`:
  - `vet`: lockfile sources and exact pins, checked before anything is installed
  - `test`, `lint` (+ typecheck)
  - `secrets` (gitleaks), `sast` (semgrep), `deps` (trivy)
  - `build`
  - `risk-class`, which uses the base branch's rules, so a PR cannot lower its own class
  - `pr-contract` (agent branches only)
  - `human-gate` (class `high`)
  - `ci-gate`: the one required status

  On `main`, `publish` pushes the image to GHCR and records its digest.
- **`deploy.yml`** (manual or gateway-triggered) deploys that exact digest to Render staging or production, then smoke-tests the live URL. Production requires the same digest to have passed staging, and a human approves the production environment.

Changes under `.github/`, `migrations/`, `src/auth/`, the Dockerfile, dependency files and tool configs are class `high`. So are changes that delete or skip tests, or add suppressions.

## Known gaps (good first factory tickets)

- No rate limiting on `/auth/login` or `/auth/register` (brute force, sign-up spam).
- No pagination on `GET /notes` (capped at 100).
- Expired sessions are never purged from the database.
