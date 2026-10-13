# Library References — Phase 03: Upload e Processamento de Vídeos

Este documento registra as versões oficiais, padrões de uso e APIs das bibliotecas introduzidas na Fase 03, garantindo conformidade arquitetural e prevenindo padrões depreciados.

---

## 1. @nestjs/bullmq & BullMQ (Message Queue & Job Processing)

### Versões
- `@nestjs/bullmq`: `^11.0.2`
- `bullmq`: `^5.41.0`
- `ioredis`: `^5.6.0`

### Padrões de Uso

#### Módulo de Configuração
```typescript
BullModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    connection: {
      host: configService.get<string>('queue.host', 'redis'),
      port: configService.get<number>('queue.port', 6379),
    },
  }),
});

BullModule.registerQueue({
  name: 'video-processing',
});
```

#### Produtor de Jobs (API Service)
```typescript
@Injectable()
export class VideosService {
  constructor(
    @InjectQueue('video-processing') private readonly videoQueue: Queue,
  ) {}

  async enqueueVideoProcessing(videoId: string, storageKey: string) {
    await this.videoQueue.add(
      'process-video',
      { videoId, storageKey },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
```

#### Consumidor / Worker (`Processor`)
```typescript
@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  async process(job: Job<{ videoId: string; storageKey: string }>): Promise<any> {
    const { videoId, storageKey } = job.data;
    // Processamento com FFmpeg / FFprobe
  }
}
```

---

## 2. AWS SDK for JavaScript v3 (S3 / MinIO Object Storage)

### Versões
- `@aws-sdk/client-s3`: `^3.758.0`
- `@aws-sdk/s3-request-presigner`: `^3.758.0`

### Padrões de Uso

#### Inicialização do S3Client (Compatível com MinIO)
```typescript
const s3Client = new S3Client({
  endpoint: configService.get<string>('storage.endpoint', 'http://storage:9000'),
  region: configService.get<string>('storage.region', 'us-east-1'),
  credentials: {
    accessKeyId: configService.get<string>('storage.accessKey', 'minioadmin'),
    secretAccessKey: configService.get<string>('storage.secretKey', 'minioadmin'),
  },
  forcePathStyle: true, // Obrigatório para MinIO
});
```

#### Multipart Upload Pré-Assinado
```typescript
// 1. Iniciar Multipart Upload
const initRes = await s3Client.send(
  new CreateMultipartUploadCommand({
    Bucket: bucketName,
    Key: storageKey,
    ContentType: contentType,
  }),
);
const uploadId = initRes.UploadId;

// 2. Gerar URL pré-assinada para cada parte
const presignedUrl = await getSignedUrl(
  s3Client,
  new UploadPartCommand({
    Bucket: bucketName,
    Key: storageKey,
    UploadId: uploadId,
    PartNumber: partNumber,
  }),
  { expiresIn: 3600 },
);

// 3. Concluir Multipart Upload
await s3Client.send(
  new CompleteMultipartUploadCommand({
    Bucket: bucketName,
    Key: storageKey,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts, // [{ PartNumber: 1, ETag: '"..."' }, ...]
    },
  }),
);
```

#### Streaming com HTTP Range Requests (`206 Partial Content`)
```typescript
const rangeHeader = req.headers.range; // e.g. "bytes=0-1048575"
const command = new GetObjectCommand({
  Bucket: bucketName,
  Key: storageKey,
  Range: rangeHeader,
});

const response = await s3Client.send(command);
// response.Body é um Readable stream para piping na resposta HTTP
```

---

## 3. fluent-ffmpeg (Extração de Metadados & Thumbnails)

### Versões
- `fluent-ffmpeg`: `^2.1.3`
- `@types/fluent-ffmpeg`: `^2.1.27`

### Padrões de Uso

#### Extração de Metadados com ffprobe
```typescript
import ffmpeg from 'fluent-ffmpeg';

export function extractVideoMetadata(filePath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  codec: string;
  bitrate?: number;
}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
      const duration = metadata.format.duration || 0;
      const width = videoStream?.width || 0;
      const height = videoStream?.height || 0;
      const codec = videoStream?.codec_name || 'unknown';
      const bitrate = metadata.format.bit_rate ? parseInt(String(metadata.format.bit_rate), 10) : undefined;

      resolve({ duration: Math.round(duration), width, height, codec, bitrate });
    });
  });
}
```

#### Geração de Thumbnail
```typescript
export function generateThumbnail(
  videoPath: string,
  outputFolder: string,
  filename: string,
  timestamp = '00:00:01',
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .screenshots({
        timestamps: [timestamp],
        filename: filename,
        folder: outputFolder,
        size: '1280x720',
      })
      .on('end', () => resolve(`${outputFolder}/${filename}`))
      .on('error', (err) => reject(err));
  });
}
```

---

## 4. nanoid (Identificador Único para URL)

### Versões
- `nanoid`: `^3.3.8` (versão CJS/ESM universalmente compatível com NestJS / ts-node)

### Padrão de Uso
```typescript
import { customAlphabet } from 'nanoid';

// Alfabeto URL-safe de 11 caracteres (estilo YouTube)
const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-', 11);

export function generateVideoSlug(): string {
  return nanoid();
}
```
