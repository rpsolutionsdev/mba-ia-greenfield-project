---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-09-30
scope_description: "Decisões técnicas da Fase 03 (Vídeos): tecnologia de fila, estratégia de upload de 10GB, arquitetura do worker com FFmpeg, storage, URL única, streaming HTTP 206, ciclo de vida do vídeo e download."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend que entrega todos os endpoints de gerenciamento de vídeo, upload pré-assinado, streaming via Range Requests, download, entidade/tabela de vídeos, serviço de object storage (MinIO/S3), enfileiramento de jobs assíncronos (BullMQ) e o container worker de vídeo (FFmpeg/FFprobe).
- `next-frontend/` — Frontend fora do escopo da Fase 03 (a interface de visualização, player e painel de vídeo serão desenvolvidos nas Fases 04 e 05, conforme planejamento geral). Nenhum open decision de frontend neste documento.

---

## TD-01: Message Queue & Asynchronous Processing Engine

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** O processamento de vídeos (extração de metadados de duração, resolução, codec e captura de frames para thumbnail) é uma operação intensiva em CPU e I/O. Não pode ser executada de forma síncrona no ciclo de requisição HTTP da API. É necessária uma infraestrutura de fila distribuída para gerenciar jobs assíncronos, concorrência, retries com backoff e eventos de ciclo de vida.

**Options:**

### Option A: BullMQ + Redis
- Fila de jobs baseada em Redis para Node.js/NestJS, com integração oficial via `@nestjs/bullmq`. Oferece controle nativo de concorrência por worker, retentativas com backoff exponencial configurável, listeners de eventos (`completed`, `failed`, `progress`), dead-letter queue e persistência leve em memória com dump em disco no Redis (`redis:7-alpine`).
- **Pros:** Padrão consolidado no ecossistema NestJS; suporte nativo a decorators (`@Processor`, `@Process`, `@OnWorkerEvent`); altíssima performance e baixo footprint de recursos; isolamento total do banco de dados relacional.
- **Cons:** Adiciona o serviço Redis ao `compose.yaml`.

### Option B: RabbitMQ (AMQP Broker)
- Message broker robusto baseado no protocolo AMQP, integrado via `@golevelup/nestjs-rabbitmq` ou `@nestjs/microservices`.
- **Pros:** Recursos avançados de roteamento (exchanges direct, topic, fanout) e suporte a múltiplos consumidores heterogêneos.
- **Cons:** Maior complexidade de configuração e manutenção; não possui rastreamento nativo de progresso de jobs e backoff tão simples quanto BullMQ; maior consumo de memória e inicialização mais pesada no Docker.

### Option C: Fila em Banco de Dados Relacional (PostgreSQL via pg-boss)
- Implementação de fila utilizando tabelas e locks (`FOR UPDATE SKIP LOCKED`) dentro do próprio PostgreSQL existente.
- **Pros:** Não adiciona nenhum serviço novo (Redis) ao Docker Compose.
- **Cons:** Polling constante e locks de linhas competem diretamente por conexões e I/O com as consultas e transações da aplicação; degrada a performance do banco sob alta carga de jobs.

**Recommendation:** **Option A (BullMQ + Redis)** — É a solução padrão e mais eficiente no ecossistema NestJS para processamento de tarefas pesadas em background. Proporciona controle de concorrência, retentativas exponenciais e desacoplamento total da carga de banco de dados.

**Decision:** A (BullMQ + Redis)

---

## TD-02: Large File Upload Strategy (Up to 10GB)

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** O StreamTube precisa receber arquivos de até 10GB sem sobrecarregar a memória (heap), os sockets de rede e o event loop da API NestJS. O tráfego de dados de vídeo bruto deve ir diretamente para o Object Storage (MinIO/S3), evitando travamentos ou lentidão nos demais endpoints da plataforma.

**Options:**

### Option A: Direct S3/MinIO Presigned Multipart Upload (Client → Object Storage)
- O cliente solicita à API a inicialização do upload (gerando o registro do vídeo em estado rascunho e obtendo um `UploadId`). A API gera URLs pré-assinadas para cada parte (chunks de 5MB a 100MB) do S3/MinIO. O cliente envia as partes diretamente ao MinIO via HTTP `PUT` em paralelo/sequencial. Ao concluir todas as partes, o cliente notifica a API com a lista de ETags para finalizar o multipart upload e enfileirar o processamento.
- **Pros:** Zero bytes de vídeo trafegam pela API NestJS; conexões e memória da API permanecem 100% livres; falhas de rede em partes individuais exigem apenas o reenvio daquela parte específica (resiliência essencial para 10GB).
- **Cons:** Exige um fluxo de 3 passos coordenados (initiate → presigned parts → complete).

### Option B: Single Direct Presigned PUT URL
- A API gera uma única URL pré-assinada de `PUT` para o arquivo inteiro e o cliente faz o upload direto para o MinIO.
- **Pros:** Fluxo de apenas 1 requisição para obter a URL.
- **Cons:** Qualquer oscilação de rede interrompe o upload do arquivo de 10GB e exige reinício do zero; sem suporte a upload particionado ou progresso granular resiliente.

### Option C: API Streaming Proxy (Multer / Busboy no NestJS)
- O arquivo é enviado diretamente para a API NestJS, que faz o pipe/stream dos dados para o MinIO.
- **Pros:** O cliente conversa apenas com a API.
- **Cons:** Mantém sockets e descritores de arquivo ocupados na API por períodos prolongados (dezenas de minutos para arquivos grandes); alto risco de timeout e esgotamento de conexões; viola o requisito de não travar o sistema.

**Recommendation:** **Option A (Direct S3/MinIO Presigned Multipart Upload)** — É a arquitetura padrão da indústria para upload de arquivos de grande porte (até 10GB). Desonera completamente a API NestJS e oferece tolerância a falhas através do reenvio de partes individuais.

**Decision:** A (Direct S3/MinIO Presigned Multipart Upload)

---

## TD-03: Video Worker Architecture & FFmpeg Processing

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** Após a conclusão do upload, o vídeo bruto precisa ser processado: extração de metadados técnicos (duração em segundos, resolução width x height, bitrate, codec de vídeo e áudio via `ffprobe`) e extração de um frame representativo para gerar a imagem de thumbnail (`.jpg` via `ffmpeg`). O worker deve operar de forma desacoplada da API HTTP.

**Options:**

### Option A: Dedicated Video Worker Container (Processo/Container Separado)
- Um serviço Docker dedicado (`video-worker`) no `compose.yaml` construído com Node.js e binários `ffmpeg` e `ffprobe` instalados no container. Ele executa o processador BullMQ, consome os jobs da fila Redis, baixa o vídeo do MinIO (ou lê via stream), executa `ffprobe` e `ffmpeg`, envia a thumbnail gerada de volta ao MinIO e atualiza o status/metadados no PostgreSQL.
- **Pros:** Isolamento total de CPU e memória: picos de processamento do FFmpeg nunca afetam a latência da API REST; possibilidade de escalar a quantidade de réplicas do worker de forma independente.
- **Cons:** Requer a definição de um serviço adicional no Docker Compose e compartilhamento do schema de dados/módulos.

### Option B: In-Process Worker no Container da API NestJS
- A própria aplicação da API registra o `@Processor('video-processing')` e executa o FFmpeg localmente no mesmo container da API.
- **Pros:** Estrutura de container única no Docker Compose.
- **Cons:** Concorrência direta por recursos de CPU/RAM entre requisições HTTP da API e processamento de vídeo pesado; risco de indisponibilidade da API caso o FFmpeg cause sobrecarga ou crash de processo.

**Recommendation:** **Option A (Dedicated Video Worker Container)** — Garante resiliência, alta disponibilidade da API e isolamento de processos intensivos em CPU/RAM, respeitando a arquitetura definida no C4 Container diagram (`docs/diagrams/software-arch.mermaid`).

**Decision:** A (Dedicated Video Worker Container)

---

## TD-04: Object Storage Organization & Bucket Strategy

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** O sistema utiliza Object Storage compatível com a API S3 (MinIO no ambiente de desenvolvimento local via Docker e AWS S3 em produção). É necessário estruturar a organização de buckets, prefixos de chaves (keys) e convenções de nomenclatura para armazenar vídeos brutos, vídeos processados e thumbnails.

**Options:**

### Option A: Single Bucket com Prefixos Hierárquicos (`streamtube-media`)
- Utilização de um bucket unificado configurável (ex: `streamtube-media`), organizando os objetos em namespaces/prefixos bem definidos:
  - Vídeos brutos: `videos/raw/{videoId}/{uniqueFileName}`
  - Thumbnails geradas: `thumbnails/{videoId}/thumb.jpg`
- **Pros:** Centraliza a gestão de credenciais e permissões em uma única variável de bucket; facilita a inicialização local no MinIO; convenção limpa e extensível para futuras fases (ex: thumbnails customizadas na Fase 04).
- **Cons:** Requer padronização rigorosa na geração de keys no código.

### Option B: Múltiplos Buckets Dedicados (`streamtube-videos`, `streamtube-thumbnails`)
- Buckets separados para cada categoria de arquivo.
- **Pros:** Permite políticas de retenção (lifecycle policies) distintas por bucket.
- **Cons:** Maior complexidade operacional no setup do MinIO (criação de múltiplos buckets) e maior número de variáveis de ambiente no `.env`.

**Recommendation:** **Option A (Single Bucket com Prefixos Hierárquicos: `streamtube-media`)** — Simples de manter, padronizado e plenamente compatível com o MinIO local e S3 em produção.

**Decision:** A (Single Bucket com Prefixos Hierárquicos)

---

## TD-05: Unique Video Identifier (URL Strategy)

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Cada vídeo precisa de um identificador público único, amigável para URLs e compartilhamento (`/videos/{id}` ou `/watch?v={id}`), que seja imutável, seguro contra enumeração sequencial e resistente a colisões.

**Options:**

### Option A: NanoID (11-12 Caracteres Alfanuméricos URL-Safe)
- Geração de identificadores curtos (ex: `cK8wP9xL2qM`), baseados em alfabeto URL-friendly (A-Z, a-z, 0-9, `_`, `-`), similar ao padrão do YouTube (11 caracteres).
- **Pros:** URLs compactas, estéticas e ideais para compartilhamento; não sequenciais (impede scraping por enumeração); alta densidade entrópica com probabilidade negligenciável de colisão; indexação ultra-rápida no PostgreSQL com constraint `UNIQUE`.
- **Cons:** Requer biblioteca `nanoid` ou helper criptográfico.

### Option B: UUID v4 Padrão (36 Caracteres com Hífens)
- Utilização de UUIDv4 padrão gerado nativamente pelo PostgreSQL (`gen_random_uuid()`).
- **Pros:** Nativo sem dependências externas.
- **Cons:** URLs excessivamente longas e poluídas (`/videos/550e8400-e29b-41d4-a716-446655440000`), inadequadas para a experiência visual de uma plataforma de vídeo.

### Option C: Slug Derivado do Título do Vídeo (`meu-video-incrivel`)
- Geração de slug textual a partir do título fornecido pelo usuário.
- **Pros:** Amigável para motores de busca (SEO).
- **Cons:** No momento do upload o vídeo ainda é um rascunho sem título definitivo; se o usuário editar o título na Fase 04, a URL quebraria ou exigiria redirecionamentos complexos; alto índice de colisões para títulos comuns.

**Recommendation:** **Option A (NanoID de 11-12 Caracteres)** — Oferece o equilíbrio perfeito entre estética de URL, segurança contra enumeração, imutabilidade e compatibilidade com o padrão consagrado de plataformas de vídeo.

**Decision:** A (NanoID de 11-12 Caracteres)

---

## TD-06: Video Playback & Streaming Strategy

**Scope:** Cross-layer

**Capability:** Reprodução via streaming (sem necessidade de download completo)

**Context:** A reprodução do vídeo pelo usuário deve iniciar instantaneamente, permitindo avançar e retroceder na timeline (seeking) sem exigir que o arquivo inteiro seja descarregado previamente.

**Options:**

### Option A: HTTP Range Requests (`206 Partial Content`) via API Proxy/Stream
- O cliente solicita fatias do arquivo através de requisições HTTP com o cabeçalho `Range: bytes=start-end`. A API NestJS interpreta o intervalo solicitado, busca exatamente essa fatia no Object Storage (usando o parâmetro `Range` do comando `GetObjectCommand` do SDK S3) e transmite a resposta com status `HTTP 206 Partial Content`, cabeçalhos `Content-Range`, `Accept-Ranges: bytes` e `Content-Length`.
- **Pros:** Suporte nativo e automático em todos os navegadores modernos e elementos HTML5 `<video>`; seeking instantâneo para qualquer ponto do vídeo; não requer transcodificação complexa para HLS na Fase 03; suporte direto tanto a streaming quanto a download.
- **Cons:** Para streaming adaptativo multi-resolução (ABR), HLS é necessário futuramente.

### Option B: Transcodificação HLS (HTTP Live Streaming) Obrigatória
- O worker divide o vídeo em fragmentos `.ts` e gera um manifesto `.m3u8`.
- **Pros:** Suporte a bitrate adaptativo.
- **Cons:** Processamento muito mais demorado e intensivo em disco/CPU no worker; complexidade desnecessária para a Fase 03, que exige apenas reprodução via streaming e download do arquivo.

### Option C: Redirecionamento 302 para Presigned GET URL do MinIO
- A API redireciona o streaming diretamente para uma URL temporária do MinIO.
- **Pros:** Descarrega a banda da API.
- **Cons:** Exige que o MinIO seja publicamente acessível pelo host na mesma URL/porta resolvida internamente, o que frequentemente causa falhas de rede em ambientes Docker (`minio:9000` vs `localhost:9000`).

**Recommendation:** **Option A (HTTP Range Requests 206 Partial Content via API com stream do S3/MinIO)** — Atende integralmente aos requisitos de reprodução imediata, seeking nativo e download, mantendo alta confiabilidade e segurança de acesso em qualquer ambiente.

**Decision:** A (HTTP Range Requests 206 Partial Content)

---

## TD-07: Video Lifecycle State Machine & Failure Policy

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** Um vídeo percorre um fluxo bem definido desde a intenção de upload até a disponibilização para visualização. A entidade e as regras de negócio devem refletir com precisão cada estado do ciclo de vida, tratando falhas de processamento com retries e logs estruturados.

**Options:**

### Option A: Máquina de Estados com Enum (`DRAFT` → `UPLOADING` → `PROCESSING` → `READY` | `FAILED`) com Retries Exponenciais
- **`DRAFT` / `UPLOADING`:** Criado no momento em que o usuário inicia o multipart upload, vinculado obrigatoriamente ao canal do usuário autenticado.
- **`PROCESSING`:** Transicionado quando o cliente confirma a finalização do multipart upload e o job é colocado na fila BullMQ.
- **`READY`:** Transicionado pelo worker quando o processamento (metadados + thumbnail) é concluído com sucesso.
- **`FAILED`:** Transicionado se o processamento falhar após 3 tentativas com backoff exponencial (5s, 15s, 45s), persistindo a mensagem de erro na coluna `processingError` para diagnóstico.
- **Pros:** Transparência total do estado para o usuário e painel administrativo; resiliência com retentativas automáticas; idempotência na execução dos jobs.
- **Cons:** Requer campos adicionais de controle (`status`, `processingError`, `duration`, `width`, `height`, etc.) na entidade `Video`.

### Option B: Flag Booleana Simples (`isProcessed: boolean`)
- O vídeo possui apenas uma flag indicando se foi processado ou não.
- **Pros:** Menor quantidade de colunas no banco.
- **Cons:** Impossível distinguir entre upload em andamento, processamento ativo na fila ou falha definitiva do worker; péssima experiência de observabilidade.

**Recommendation:** **Option A (Máquina de estados explícita com Enum `DRAFT`, `UPLOADING`, `PROCESSING`, `READY`, `FAILED` e retries no BullMQ)** — Fornece clareza arquitetural, integridade de dados e tratamento de erros de nível profissional.

**Decision:** A (Máquina de estados explícita)

---

## TD-08: Video Download Delivery Strategy

**Scope:** Backend

**Capability:** Download do vídeo pelo usuário

**Context:** O sistema deve disponibilizar um endpoint para download direto do arquivo de vídeo pelo usuário, garantindo cabeçalhos HTTP apropriados (`Content-Disposition: attachment; filename="..."`).

**Options:**

### Option A: Endpoint Dedicado de Download na API com Stream do Storage
- O endpoint `GET /videos/:id/download` recupera o stream do vídeo no MinIO/S3 e o envia ao cliente com cabeçalhos `Content-Type: application/octet-stream` (ou MIME do vídeo) e `Content-Disposition: attachment; filename="{videoTitle}.mp4"`.
- **Pros:** Nome amigável do arquivo no download do cliente baseado no título do vídeo; controle de acesso centralizado e possibilidade de métricas de download; funciona perfeitamente em rede Docker.
- **Cons:** Tráfego de download é roteado através da API.

### Option B: Presigned Download URL
- Geração de URL pré-assinada com override de `response-content-disposition`.
- **Pros:** Banda servida diretamente pelo storage.
- **Cons:** Problemas de resolução de hostname entre Docker e host; menor controle de auditoria de downloads.

**Recommendation:** **Option A (Endpoint dedicado de download na API com stream do storage e headers `Content-Disposition`)** — Garante que o arquivo seja baixado com o nome correto do vídeo e funciona de maneira transparente em todos os ambientes.

**Decision:** A (Endpoint dedicado de download na API)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message Queue & Asynchronous Processing Engine | BullMQ + Redis | A |
| TD-02 | Cross-layer | Large File Upload Strategy (Up to 10GB) | Direct S3/MinIO Presigned Multipart Upload | A |
| TD-03 | Backend | Video Worker Architecture & FFmpeg Processing | Dedicated Video Worker Container | A |
| TD-04 | Backend | Object Storage Organization & Bucket Strategy | Single Bucket com Prefixos Hierárquicos (`streamtube-media`) | A |
| TD-05 | Backend | Unique Video Identifier (URL Strategy) | NanoID (11-12 Caracteres) | A |
| TD-06 | Cross-layer | Video Playback & Streaming Strategy | HTTP Range Requests (`206 Partial Content`) via API | A |
| TD-07 | Backend | Video Lifecycle State Machine & Failure Policy | Máquina de Estados com Enum (`DRAFT`, `UPLOADING`, `PROCESSING`, `READY`, `FAILED`) | A |
| TD-08 | Backend | Video Download Delivery Strategy | Endpoint Dedicado de Download na API com Stream | A |
