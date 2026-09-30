---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-09-30T17:13:44-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-09-30T17:31:24-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-05-12T12:23:19-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-05-12T12:21:12-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-05-12T12:23:19-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** Telas e interface gráfica do frontend (player de vídeo, feed de sugestões, gerenciamento e edição de metadados do canal das Fases 04 e 05), interações sociais (likes/comentários da Fase 06).

**Deliverables:** upload de arquivos de até 10GB funcional via multipart presigned URLs, processamento automático assíncrono com extração de duração/metadados e geração de thumbnail via FFmpeg/FFprobe em worker dedicado, reprodução por streaming HTTP 206 Partial Content, download de vídeos, URLs únicas (NanoID), persistência no PostgreSQL via TypeORM migration, e infraestrutura completa de Object Storage (MinIO), Fila (Redis + BullMQ) e Worker no Docker Compose.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — interface gráfica do player e painel de vídeo diferidas para as Fases 04 e 05.

**Sequencing notes:** Depende da Fase 01 (Configuração Base) e da Fase 02 (Autenticação, Usuários e Canais — onde cada usuário possui 1 canal ao qual o vídeo se vincula).

**Neighbors (for boundary detection only):** Fase 02 — Cadastro, Login e Gerenciamento de Conta (prior), Fase 04 — Gerenciamento de Vídeos e Canal (next).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Message Queue & Asynchronous Processing Engine | decided | A (BullMQ + Redis) | @nestjs/bullmq@^11.x, bullmq@^5.x, ioredis@^5.x |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Cross-layer | Large File Upload Strategy (Up to 10GB) | decided | A (Direct S3/MinIO Presigned Multipart Upload) | @aws-sdk/client-s3@^3.x, @aws-sdk/s3-request-presigner@^3.x |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | Video Worker Architecture & FFmpeg Processing | decided | A (Dedicated Video Worker Container) | fluent-ffmpeg@^2.x, @types/fluent-ffmpeg@^2.x |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Object Storage Organization & Bucket Strategy | decided | A (Single Bucket com Prefixos Hierárquicos: `streamtube-media`) | @aws-sdk/client-s3@^3.x |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Unique Video Identifier (URL Strategy) | decided | A (NanoID de 11-12 Caracteres) | nanoid@^3.x |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Cross-layer | Video Playback & Streaming Strategy | decided | A (HTTP Range Requests `206 Partial Content` via API) | @aws-sdk/client-s3@^3.x |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Video Lifecycle State Machine & Failure Policy | decided | A (Máquina de Estados com Enum `DRAFT`, `UPLOADING`, `PROCESSING`, `READY`, `FAILED`) | — |
| phase-03-videos/TD-08 | technical-decisions-phase-03-videos.md | Backend | Video Download Delivery Strategy | decided | A (Endpoint Dedicado de Download na API com Stream do Storage) | @aws-sdk/client-s3@^3.x |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-04 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-01 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-02 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-07 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-01, phase-03-videos/TD-03, phase-03-videos/TD-07 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-03, phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-06 |
| Download do vídeo pelo usuário | phase-03-videos/TD-08 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** Option A (BullMQ + Redis) — É a solução padrão e mais eficiente no ecossistema NestJS para processamento de tarefas pesadas em background. Proporciona controle de concorrência, retentativas exponenciais e desacoplamento total da carga de banco de dados.

**Libraries:** `@nestjs/bullmq@^11.x`, `bullmq@^5.x`, `ioredis@^5.x`

### phase-03-videos/TD-02

**Recommendation:** Option A (Direct S3/MinIO Presigned Multipart Upload) — É a arquitetura padrão da indústria para upload de arquivos de grande porte (até 10GB). Desonera completamente a API NestJS e oferece tolerância a falhas através do reenvio de partes individuais.

**Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-03

**Recommendation:** Option A (Dedicated Video Worker Container) — Garante resiliência, alta disponibilidade da API e isolamento de processos intensivos em CPU/RAM, respeitando a arquitetura definida no C4 Container diagram (`docs/diagrams/software-arch.mermaid`).

**Libraries:** `fluent-ffmpeg@^2.x`, `@types/fluent-ffmpeg@^2.x`

### phase-03-videos/TD-04

**Recommendation:** Option A (Single Bucket com Prefixos Hierárquicos: `streamtube-media`) — Simples de manter, padronizado e plenamente compatível com o MinIO local e S3 em produção.

**Libraries:** `@aws-sdk/client-s3@^3.x`

### phase-03-videos/TD-05

**Recommendation:** Option A (NanoID de 11-12 Caracteres) — Oferece o equilíbrio perfeito entre estética de URL, segurança contra enumeração, imutabilidade e compatibilidade com o padrão consagrado de plataformas de vídeo.

**Libraries:** `nanoid@^3.x`

### phase-03-videos/TD-06

**Recommendation:** Option A (HTTP Range Requests 206 Partial Content via API com stream do S3/MinIO) — Atende integralmente aos requisitos de reprodução imediata, seeking nativo e download, mantendo alta confiabilidade e segurança de acesso em qualquer ambiente.

**Libraries:** `@aws-sdk/client-s3@^3.x`

### phase-03-videos/TD-07

**Recommendation:** Option A (Máquina de estados explícita com Enum `DRAFT`, `UPLOADING`, `PROCESSING`, `READY`, `FAILED` e retries no BullMQ) — Fornece clareza arquitetural, integridade de dados e tratamento de erros de nível profissional.

**Libraries:** —

### phase-03-videos/TD-08

**Recommendation:** Option A (Endpoint dedicado de download na API com stream do storage e headers `Content-Disposition`) — Garante que o arquivo seja baixado com o nome correto do vídeo e funciona de maneira transparente em todos os ambientes.

**Libraries:** `@aws-sdk/client-s3@^3.x`

## Inherited Decisions Detail

### phase-02-auth/TD-01
**Recommendation:** Argon2id para hashing de senhas.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02
**Recommendation:** Custom guards com `@nestjs/jwt` (JWT AuthGuard global com `@Public()` decorator).
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-06
**Recommendation:** `class-validator` e `class-transformer` para validação de DTOs.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07
**Recommendation:** Custom Domain Exception Filter padronizando respostas `{ statusCode, error, message }`.

### phase-02-auth/TD-08
**Recommendation:** `@nestjs/throttler` para rate limiting.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-01-configuracao-base/TD-01 & TD-03
**Recommendation:** `@nestjs/config` com factory `registerAs()` agrupado por namespace e validação via Joi.
**Libraries:** `@nestjs/config@^4.x`, `joi@^18.x`
