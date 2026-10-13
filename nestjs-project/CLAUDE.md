# CLAUDE.md (nestjs-project)

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, storage, redis) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Verify service readiness:
- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG`

## Development Environment

Services in `compose.yaml`:
- `nestjs-api` — NestJS API, port `3000`
- `worker` — Dedicated Video Worker process for background processing (FFmpeg/FFprobe/BullMQ)
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `mailpit` — SMTP port `1025`, Web UI port `8025`
- `storage` — MinIO Object Storage, API port `9000`, Console port `9001`
- `redis` — Redis 7 for BullMQ job queue, port `6379`

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host.

### Container commands (prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run start:worker                     # Dedicated video worker process
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting

npm run migration:run                    # Run TypeORM migrations
npm run migration:revert                 # Revert last migration
```

## Videos Domain (Phase 03)

The `videos` module (`src/videos/`) implements:
- Direct S3/MinIO presigned multipart upload for files up to 10GB.
- Background asynchronous processing with BullMQ + Redis (`video-processing` queue).
- Video metadata extraction (duration, resolution, codec, bitrate) with `ffprobe`.
- Automatic thumbnail generation with `ffmpeg`.
- Unique URL slugs using NanoID (11 characters).
- Video streaming with HTTP Range Requests (`206 Partial Content`).
- Direct file download with `Content-Disposition: attachment`.

## Test Type Selection

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |
