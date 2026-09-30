# CLAUDE.md

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with the following main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for `auth/`, `users/`, `channels/`, `videos/`, `mail/`, `common/`, `config/`, `database/`, and `swagger/`.
- `docs/` — Project documentation, architecture diagrams, technical decisions (`docs/decisions/`), and phase planning (`docs/phases/`).
- `next-frontend/` (Next.js) — Frontend (Fases 01–02 base; video interfaces planned for Fases 04+).

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams media
- **API** (NestJS) → business rules, auth, database access, presigned multipart upload management, enqueues video jobs to Redis, range streaming, download endpoints
- **Video Worker** (FFmpeg / FFprobe) → consumes `video-processing` jobs from BullMQ/Redis, extracts metadata (duration, width, height, codec, bitrate) and generates thumbnails to MinIO/S3
- **Database** (PostgreSQL 17) → users, channels, auth tokens, videos
- **Object Storage** (MinIO / S3) → raw videos, processed videos, and thumbnails
- **Message Queue** (BullMQ + Redis 7) → video processing job queue with exponential backoff retries
- **Email Service** (Mailpit / SMTP) → account confirmation and password recovery

## Videos Domain (Phase 03)

The `videos` module (`src/videos/`) implements large file uploads up to 10GB, asynchronous processing, metadata extraction, automatic thumbnail generation, unique URL slugs (NanoID), streaming with HTTP 206 Partial Content, and file download.

### Endpoints
- `POST /videos/upload/initiate` (Authenticated) — Pre-registers video in `UPLOADING` status linked to user's channel and initiates S3/MinIO multipart upload.
- `POST /videos/upload/presign-part` (Authenticated) — Generates S3/MinIO presigned PUT URL for a specific part number.
- `POST /videos/upload/complete` (Authenticated) — Completes S3/MinIO multipart upload, sets status to `PROCESSING`, and enqueues job to BullMQ.
- `GET /videos/:idOrSlug` (Public) — Returns public video metadata, channel info, and playback/download URLs.
- `GET /videos/:idOrSlug/stream` (Public) — Streams video with HTTP Range Requests (`206 Partial Content` / `200 OK`).
- `GET /videos/:idOrSlug/download` (Public) — Streams video file with `Content-Disposition: attachment; filename="{title}.mp4"`.
- `GET /videos/:idOrSlug/thumbnail` (Public) — Streams video thumbnail image (`image/jpeg`).

### Storage Keys & Bucket Structure (`streamtube-media`)
- Raw videos: `videos/raw/{videoId}/{slug}.mp4`
- Thumbnails: `thumbnails/{videoId}/thumb.jpg`

### Lifecycle Status Machine
`DRAFT` / `UPLOADING` → `PROCESSING` → `READY` | `FAILED` (persisting `processing_error` upon fatal failures).

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, storage, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

- **Correct:** `DB_HOST=db`, `STORAGE_ENDPOINT=http://storage:9000`, `REDIS_HOST=redis`
- **Wrong:** `DB_HOST=localhost`

## Working Principles

- **Single Responsibility:** Each module, service, and processor has a clear, focused responsibility.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Pyramid testing at all levels (Unit `*.spec.ts`, Integration `*.integration-spec.ts`, E2E `*.e2e-spec.ts`).
- **Code Quality:** ESLint and Prettier for consistent code style.

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0.
4. Lint passes: `npm run lint`.

## Git Conventions

- **Main branch:** `main` — never commit directly to it
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change
- **Workflow:** Git Flow conventions. Feature branches branch from `dev` and merge into `dev`.