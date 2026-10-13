import { VideosService } from './videos.service';
import { VideoStatus } from './enums/video-status.enum';
import {
  ChannelNotFoundException,
  InvalidUploadPartException,
  UnauthorizedVideoAccessException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { Readable } from 'stream';

describe('VideosService (unit)', () => {
  let service: VideosService;
  let mockVideoRepo: any;
  let mockChannelsService: any;
  let mockStorageService: any;
  let mockVideoQueueService: any;

  const userId = 'user-1';
  const channelId = 'channel-1';
  const videoId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(() => {
    jest.clearAllMocks();

    mockVideoRepo = {
      create: jest.fn().mockImplementation((dto) => ({ id: videoId, ...dto })),
      save: jest
        .fn()
        .mockImplementation((video) =>
          Promise.resolve({ id: videoId, ...video }),
        ),
      findOne: jest.fn(),
    };

    mockChannelsService = {
      findByUserId: jest.fn(),
    };

    mockStorageService = {
      initiateMultipartUpload: jest.fn(),
      getPresignedUploadPartUrl: jest.fn(),
      completeMultipartUpload: jest.fn(),
      getObjectStream: jest.fn(),
    };

    mockVideoQueueService = {
      enqueueVideoProcessing: jest.fn().mockResolvedValue(undefined),
    };

    service = new VideosService(
      mockVideoRepo,
      mockChannelsService,
      mockStorageService,
      mockVideoQueueService,
    );
  });

  describe('initiateUpload', () => {
    it('should throw ChannelNotFoundException if user has no channel', async () => {
      mockChannelsService.findByUserId.mockResolvedValueOnce(null);

      await expect(
        service.initiateUpload(userId, {
          title: 'My Video',
          filename: 'video.mp4',
          contentType: 'video/mp4',
        }),
      ).rejects.toThrow(ChannelNotFoundException);
    });

    it('should create video draft and initiate multipart upload', async () => {
      mockChannelsService.findByUserId.mockResolvedValueOnce({ id: channelId });
      mockStorageService.initiateMultipartUpload.mockResolvedValueOnce(
        'upload-id-abc',
      );

      const result = await service.initiateUpload(userId, {
        title: 'My Video',
        description: 'Video description',
        filename: 'video.mp4',
        contentType: 'video/mp4',
      });

      expect(result.videoId).toBe(videoId);
      expect(result.slug).toBeDefined();
      expect(result.uploadId).toBe('upload-id-abc');
      expect(result.key).toContain(`videos/raw/${videoId}/`);
      expect(mockStorageService.initiateMultipartUpload).toHaveBeenCalled();
    });
  });

  describe('presignPart', () => {
    it('should throw VideoNotFoundException if video not found', async () => {
      mockVideoRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        service.presignPart(userId, {
          videoId,
          uploadId: 'upload-id-abc',
          partNumber: 1,
        }),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('should throw UnauthorizedVideoAccessException if video belongs to another channel', async () => {
      mockVideoRepo.findOne.mockResolvedValueOnce({
        id: videoId,
        channel_id: 'other-channel',
        raw_storage_key: 'key',
      });
      mockChannelsService.findByUserId.mockResolvedValueOnce({ id: channelId });

      await expect(
        service.presignPart(userId, {
          videoId,
          uploadId: 'upload-id-abc',
          partNumber: 1,
        }),
      ).rejects.toThrow(UnauthorizedVideoAccessException);
    });

    it('should return presigned part url for authorized user', async () => {
      mockVideoRepo.findOne.mockResolvedValueOnce({
        id: videoId,
        channel_id: channelId,
        raw_storage_key: 'videos/raw/1/test.mp4',
      });
      mockChannelsService.findByUserId.mockResolvedValueOnce({ id: channelId });
      mockStorageService.getPresignedUploadPartUrl.mockResolvedValueOnce(
        'http://presigned-url',
      );

      const result = await service.presignPart(userId, {
        videoId,
        uploadId: 'upload-id-abc',
        partNumber: 1,
      });

      expect(result).toEqual({
        partNumber: 1,
        presignedUrl: 'http://presigned-url',
      });
    });
  });

  describe('completeUpload', () => {
    it('should throw InvalidUploadPartException if parts array is empty', async () => {
      mockVideoRepo.findOne.mockResolvedValueOnce({
        id: videoId,
        channel_id: channelId,
        raw_storage_key: 'key',
      });
      mockChannelsService.findByUserId.mockResolvedValueOnce({ id: channelId });

      await expect(
        service.completeUpload(userId, {
          videoId,
          uploadId: 'upload-id-abc',
          parts: [],
        }),
      ).rejects.toThrow(InvalidUploadPartException);
    });

    it('should complete multipart upload, update status to PROCESSING, and enqueue job', async () => {
      mockVideoRepo.findOne.mockResolvedValueOnce({
        id: videoId,
        slug: 'slug-123',
        channel_id: channelId,
        raw_storage_key: 'videos/raw/1/test.mp4',
        status: VideoStatus.UPLOADING,
      });
      mockChannelsService.findByUserId.mockResolvedValueOnce({ id: channelId });
      mockStorageService.completeMultipartUpload.mockResolvedValueOnce(
        undefined,
      );

      const result = await service.completeUpload(userId, {
        videoId,
        uploadId: 'upload-id-abc',
        parts: [{ partNumber: 1, eTag: '"etag-1"' }],
      });

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(mockStorageService.completeMultipartUpload).toHaveBeenCalled();
      expect(mockVideoQueueService.enqueueVideoProcessing).toHaveBeenCalledWith(
        videoId,
        'videos/raw/1/test.mp4',
      );
    });
  });

  describe('findByIdOrSlug', () => {
    it('should return video details when found by slug', async () => {
      mockVideoRepo.findOne.mockResolvedValueOnce({
        id: videoId,
        slug: 'cK8wP9xL2qM',
        title: 'Title',
        description: 'Desc',
        status: VideoStatus.READY,
        duration: 100,
        width: 1920,
        height: 1080,
        codec: 'h264',
        bitrate: 4000000,
        created_at: new Date('2026-01-01'),
        channel: {
          id: channelId,
          name: 'My Channel',
          nickname: 'my_channel',
        },
      });

      const video = await service.findByIdOrSlug('cK8wP9xL2qM');

      expect(video.id).toBe(videoId);
      expect(video.slug).toBe('cK8wP9xL2qM');
      expect(video.streamUrl).toBe('/videos/cK8wP9xL2qM/stream');
      expect(video.downloadUrl).toBe('/videos/cK8wP9xL2qM/download');
      expect(video.thumbnailUrl).toBe('/videos/cK8wP9xL2qM/thumbnail');
    });

    it('should throw VideoNotFoundException when video is not found', async () => {
      mockVideoRepo.findOne.mockResolvedValueOnce(null);

      await expect(service.findByIdOrSlug('unknown')).rejects.toThrow(
        VideoNotFoundException,
      );
    });
  });

  describe('getStream', () => {
    it('should throw VideoNotReadyException if video status is not READY', async () => {
      mockVideoRepo.findOne.mockResolvedValueOnce({
        id: videoId,
        slug: 'slug-1',
        status: VideoStatus.PROCESSING,
        raw_storage_key: 'key',
      });

      await expect(service.getStream('slug-1')).rejects.toThrow(
        VideoNotReadyException,
      );
    });

    it('should return storage stream when video is READY', async () => {
      const mockStream = new Readable();
      mockVideoRepo.findOne.mockResolvedValueOnce({
        id: videoId,
        slug: 'slug-1',
        status: VideoStatus.READY,
        raw_storage_key: 'videos/raw/1/test.mp4',
      });

      mockStorageService.getObjectStream.mockResolvedValueOnce({
        stream: mockStream,
        contentLength: 1000,
        contentRange: 'bytes 0-999/5000',
        acceptRanges: 'bytes',
        contentType: 'video/mp4',
      });

      const result = await service.getStream('slug-1', 'bytes=0-999');

      expect(result.stream).toBe(mockStream);
      expect(result.contentRange).toBe('bytes 0-999/5000');
    });
  });

  describe('getDownloadStream', () => {
    it('should return download stream and sanitized filename', async () => {
      const mockStream = new Readable();
      mockVideoRepo.findOne.mockResolvedValueOnce({
        id: videoId,
        slug: 'slug-1',
        title: 'My Awesome Video!',
        status: VideoStatus.READY,
        raw_storage_key: 'videos/raw/1/test.mp4',
      });

      mockStorageService.getObjectStream.mockResolvedValueOnce({
        stream: mockStream,
        contentLength: 5000,
        contentType: 'video/mp4',
      });

      const result = await service.getDownloadStream('slug-1');

      expect(result.stream).toBe(mockStream);
      expect(result.filename).toBe('My_Awesome_Video_.mp4');
    });
  });
});
