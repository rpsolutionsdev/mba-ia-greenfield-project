import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Video } from '../src/videos/entities/video.entity';
import { User } from '../src/users/entities/user.entity';
import { Channel } from '../src/channels/entities/channel.entity';
import { VideoStatus } from '../src/videos/enums/video-status.enum';
import { StorageService } from '../src/videos/storage/storage.service';
import { VideoQueueService } from '../src/videos/queue/video-queue.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Readable } from 'stream';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepo: Repository<Video>;
  let userRepo: Repository<User>;
  let channelRepo: Repository<Channel>;
  let storageService: StorageService;
  let videoQueueService: VideoQueueService;

  let userToken: string;
  let _userId: string;
  let channelId: string;

  let otherUserToken: string;
  let _otherUserId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    videoRepo = dataSource.getRepository(Video);
    userRepo = dataSource.getRepository(User);
    channelRepo = dataSource.getRepository(Channel);
    storageService = moduleFixture.get(StorageService);
    videoQueueService = moduleFixture.get(VideoQueueService);

    // Mock storage operations to avoid external network dependencies during HTTP e2e tests
    jest
      .spyOn(storageService, 'initiateMultipartUpload')
      .mockResolvedValue('mock-upload-id');
    jest
      .spyOn(storageService, 'getPresignedUploadPartUrl')
      .mockResolvedValue('http://mock-storage/part-url');
    jest
      .spyOn(storageService, 'completeMultipartUpload')
      .mockResolvedValue(undefined);
    jest.spyOn(storageService, 'uploadBuffer').mockResolvedValue(undefined);
    jest
      .spyOn(storageService, 'getObjectStream')
      .mockImplementation(async (_key, range) => {
        const stream = new Readable({
          read() {
            this.push(Buffer.from('fake-video-content-stream'));
            this.push(null);
          },
        });
        if (range) {
          return {
            stream,
            contentLength: 100,
            contentRange: 'bytes 0-99/1000',
            acceptRanges: 'bytes',
            contentType: 'video/mp4',
          };
        }
        return {
          stream,
          contentLength: 1000,
          acceptRanges: 'bytes',
          contentType: 'video/mp4',
        };
      });

    jest
      .spyOn(videoQueueService, 'enqueueVideoProcessing')
      .mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);

    // Setup primary user and channel
    const user = await userRepo.save({
      email: 'creator@streamtube.test',
      password: 'hashedpassword',
      is_confirmed: true,
    });
    _userId = user.id;

    const channel = await channelRepo.save({
      name: 'Creator Channel',
      nickname: 'creator_channel',
      user_id: user.id,
    });
    channelId = channel.id;

    // Login primary user
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'creator@streamtube.test', password: 'password123' });

    // Fallback if login uses argon2 password hash
    const authService = app.get('AuthService' as any);
    if (authService && typeof authService.generateTokens === 'function') {
      const tokens = await authService.generateTokens(user.id, user.email);
      userToken = tokens.access_token;
    } else {
      userToken = loginRes.body.access_token;
    }

    // Setup second user and channel
    const otherUser = await userRepo.save({
      email: 'other@streamtube.test',
      password: 'hashedpassword',
      is_confirmed: true,
    });
    _otherUserId = otherUser.id;

    await channelRepo.save({
      name: 'Other Channel',
      nickname: 'other_channel',
      user_id: otherUser.id,
    });

    const otherTokens = await authService.generateTokens(
      otherUser.id,
      otherUser.email,
    );
    otherUserToken = otherTokens.access_token;
  });

  describe('Authentication & Authorization Guards', () => {
    it('should reject unauthenticated upload initiate with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/videos/upload/initiate')
        .send({
          title: 'Unauth Video',
          filename: 'video.mp4',
          contentType: 'video/mp4',
        });

      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated presign-part with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/videos/upload/presign-part')
        .send({
          videoId: '550e8400-e29b-41d4-a716-446655440000',
          uploadId: 'upload-id',
          partNumber: 1,
        });

      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated complete upload with 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/videos/upload/complete')
        .send({
          videoId: '550e8400-e29b-41d4-a716-446655440000',
          uploadId: 'upload-id',
          parts: [{ partNumber: 1, eTag: '"etag"' }],
        });

      expect(res.status).toBe(401);
    });
  });

  describe('Upload Flow Lifecycle', () => {
    it('should execute full upload lifecycle: initiate -> presign -> complete', async () => {
      // 1. Initiate upload
      const initiateRes = await request(app.getHttpServer())
        .post('/videos/upload/initiate')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          title: 'My First Video',
          description: 'A great introductory video',
          filename: 'presentation.mp4',
          contentType: 'video/mp4',
        });

      expect(initiateRes.status).toBe(201);
      expect(initiateRes.body.videoId).toBeDefined();
      expect(initiateRes.body.slug).toBeDefined();
      expect(initiateRes.body.uploadId).toBe('mock-upload-id');
      expect(initiateRes.body.key).toContain('videos/raw/');

      const videoId = initiateRes.body.videoId;
      const uploadId = initiateRes.body.uploadId;

      // Verify video is in UPLOADING status in database
      const videoInDb = await videoRepo.findOneBy({ id: videoId });
      expect(videoInDb?.status).toBe(VideoStatus.UPLOADING);
      expect(videoInDb?.channel_id).toBe(channelId);

      // 2. Presign Part 1
      const presignRes = await request(app.getHttpServer())
        .post('/videos/upload/presign-part')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          videoId,
          uploadId,
          partNumber: 1,
        });

      expect(presignRes.status).toBe(200);
      expect(presignRes.body.partNumber).toBe(1);
      expect(presignRes.body.presignedUrl).toBe('http://mock-storage/part-url');

      // 3. Complete Upload
      const completeRes = await request(app.getHttpServer())
        .post('/videos/upload/complete')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          videoId,
          uploadId,
          parts: [
            { partNumber: 1, eTag: '"etag-1"' },
            { partNumber: 2, eTag: '"etag-2"' },
          ],
        });

      expect(completeRes.status).toBe(200);
      expect(completeRes.body.status).toBe(VideoStatus.PROCESSING);

      // Verify status changed to PROCESSING in database
      const updatedVideo = await videoRepo.findOneBy({ id: videoId });
      expect(updatedVideo?.status).toBe(VideoStatus.PROCESSING);
      expect(videoQueueService.enqueueVideoProcessing).toHaveBeenCalledWith(
        videoId,
        initiateRes.body.key,
      );
    });

    it('should reject another user from presigning or completing upload on foreign video', async () => {
      // Create video under user 1
      const video = await videoRepo.save({
        title: 'User 1 Video',
        slug: 'user1-slug',
        channel_id: channelId,
        raw_storage_key: 'videos/raw/user1/test.mp4',
        status: VideoStatus.UPLOADING,
      });

      // User 2 attempts to presign part
      const presignRes = await request(app.getHttpServer())
        .post('/videos/upload/presign-part')
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send({
          videoId: video.id,
          uploadId: 'upload-id',
          partNumber: 1,
        });

      expect(presignRes.status).toBe(403);
      expect(presignRes.body.error).toBe('UNAUTHORIZED_VIDEO_ACCESS');

      // User 2 attempts to complete upload
      const completeRes = await request(app.getHttpServer())
        .post('/videos/upload/complete')
        .set('Authorization', `Bearer ${otherUserToken}`)
        .send({
          videoId: video.id,
          uploadId: 'upload-id',
          parts: [{ partNumber: 1, eTag: '"etag"' }],
        });

      expect(completeRes.status).toBe(403);
      expect(completeRes.body.error).toBe('UNAUTHORIZED_VIDEO_ACCESS');
    });
  });

  describe('Public Video Query, Streaming, Download & Thumbnail Endpoints', () => {
    it('should return video details for anonymous users', async () => {
      const video = await videoRepo.save({
        title: 'Public Video',
        description: 'Open to the world',
        slug: 'pub-slug-123',
        channel_id: channelId,
        status: VideoStatus.READY,
        duration: 250,
        width: 1920,
        height: 1080,
        codec: 'h264',
        bitrate: 5000000,
        raw_storage_key: 'videos/raw/1/pub.mp4',
        thumbnail_storage_key: 'thumbnails/1/thumb.jpg',
      });

      const res = await request(app.getHttpServer()).get(
        `/videos/${video.slug}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.slug).toBe('pub-slug-123');
      expect(res.body.title).toBe('Public Video');
      expect(res.body.status).toBe(VideoStatus.READY);
      expect(res.body.duration).toBe(250);
      expect(res.body.channel.name).toBe('Creator Channel');
      expect(res.body.streamUrl).toBe('/videos/pub-slug-123/stream');
      expect(res.body.downloadUrl).toBe('/videos/pub-slug-123/download');
      expect(res.body.thumbnailUrl).toBe('/videos/pub-slug-123/thumbnail');
    });

    it('should stream video with 206 Partial Content when Range header is provided', async () => {
      const video = await videoRepo.save({
        title: 'Streaming Video',
        slug: 'stream-slug',
        channel_id: channelId,
        status: VideoStatus.READY,
        raw_storage_key: 'videos/raw/1/stream.mp4',
      });

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.slug}/stream`)
        .set('Range', 'bytes=0-99');

      expect(res.status).toBe(206);
      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-range']).toBe('bytes 0-99/1000');
    });

    it('should download video with Content-Disposition attachment header', async () => {
      const video = await videoRepo.save({
        title: 'Download Me',
        slug: 'download-slug',
        channel_id: channelId,
        status: VideoStatus.READY,
        raw_storage_key: 'videos/raw/1/download.mp4',
      });

      const res = await request(app.getHttpServer()).get(
        `/videos/${video.slug}/download`,
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="Download_Me.mp4"',
      );
      expect(res.headers['content-type']).toBe('application/octet-stream');
    });

    it('should return thumbnail with caching header', async () => {
      const video = await videoRepo.save({
        title: 'Thumbnail Video',
        slug: 'thumb-slug',
        channel_id: channelId,
        status: VideoStatus.READY,
        thumbnail_storage_key: 'thumbnails/1/thumb.jpg',
      });

      const res = await request(app.getHttpServer()).get(
        `/videos/${video.slug}/thumbnail`,
      );

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('public, max-age=86400');
    });

    it('should return 409 Conflict when attempting to stream a video that is still PROCESSING', async () => {
      const video = await videoRepo.save({
        title: 'Processing Video',
        slug: 'proc-slug',
        channel_id: channelId,
        status: VideoStatus.PROCESSING,
        raw_storage_key: 'videos/raw/1/proc.mp4',
      });

      const res = await request(app.getHttpServer()).get(
        `/videos/${video.slug}/stream`,
      );

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });
  });
});
