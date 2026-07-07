# Secret Notes — Backend

Backend API for **Secret Notes**, a semester project for course S4-CONINT (Continuous Integration). Implements encrypted note storage (Feature A) and key-gated retrieval (Feature B).

## Stack

- Node.js + [Fastify](https://fastify.dev/)
- PostgreSQL (AWS RDS in production, local Docker Postgres for dev)
- Docker / Docker Compose
- Encryption: SHA-256-derived key + AES-256-CBC (per-note random IV)

## API

| Method | Path                  | Description                                      |
|--------|-----------------------|---------------------------------------------------|
| GET    | `/api/notes`          | List notes (id + title only, never content)       |
| POST   | `/api/notes`          | Create a note — body: `{ title, content, key }`   |
| POST   | `/api/notes/unlock`   | Decrypt a note — body: `{ id, key }`; 403 if key is wrong |

Content is only ever returned in plaintext from `/api/notes/unlock`, and only with the correct key.

## Local development

```bash
cp .env.example .env   # fill in DB_PASSWORD / DATABASE_URL
docker compose up
```

Runs a local Postgres (`db`) + the backend on `http://localhost:3000`.

## Testing

```bash
npm ci
npm test        # Jest + Supertest, 10+ tests, coverage threshold enforced (70%)
npm run lint     # ESLint
```

## Production deployment (blue/green)

This repo owns the shared deploy/infra for the whole project. On the EC2 host, it expects `CI-Secret-Notes-frontend` checked out as a **sibling directory**:

```
~/CI-Secret-Notes-backend    (this repo)
~/CI-Secret-Notes-frontend
```

```bash
docker compose -f docker-compose.prod.yml up -d      # app (blue/green)
docker compose -f docker-compose.tooling.yml up -d   # Jenkins + SonarQube
```

Cutting traffic over to a newly-deployed color:
```bash
./deploy/switch-blue-green.sh green   # or blue
```

Requires a `.env` file (never committed) with `DATABASE_URL` (RDS connection string, `sslmode=no-verify`) and `SONARQUBE_DB_PASSWORD`.

## CI/CD

Two parallel pipelines, same 6 stages (Lint → Test → Build → Deliver → Deploy → E2E/Performance & Switch):

- **GitHub Actions** — `.github/workflows/backend-ci.yml`, cloud-hosted.
- **Jenkins** — `jenkins/Jenkinsfile.backend`, self-hosted on the project's EC2 instance.

`main` runs Lint/Test/Build only. `deploy/production` runs all 6 stages, including the blue/green deploy and cutover.

E2E (Playwright) and load testing (k6) live in `e2e/` and run against the newly-deployed "green" containers before traffic is switched.

## Related

- [CI-Secret-Notes-frontend](https://github.com/Continuous-Integration-Learning-SS2026/CI-Secret-Notes-frontend) — UI, built and deployed alongside this repo.