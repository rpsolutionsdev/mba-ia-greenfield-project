import { VideosController } from './videos.controller';
import { Readable } from 'stream';

describe('VideosController (unit)', () => {
  let controller: VideosController;
  let mockVideosService: any;

  const mockUser = {
    sub: 'user-uuid-1',
    email: 'user@streamtube.test',
  };

  beforeEach(() => {
    mockVideosService = {
      initiateUpload: jest.fn(),
      presignPart: jest.fn(),
      completeUpload: jest.fn(),
      findByIdOrSlug: jest.fn(),
      getStream: jest.fn(),
      getDownloadStream: jest.fn(),
      getThumbnailStream: jest.fn(),
    };

    controller = new VideosController(mockVideosService);
  });

  it('should delegate initiateUpload to videosService', async () => {
    const dto = {
      title: 'Video Title',
      filename: 'file.mp4',
      contentType: 'video/mp4',
    };
    mockVideosService.initiateUpload.mockResolvedValueOnce({
      videoId: 'v1',
      slug: 's1',
    });

    const res = await controller.initiateUpload(mockUser, dto);

    expect(res).toEqual({ videoId: 'v1', slug: 's1' });
    expect(mockVideosService.initiateUpload).toHaveBeenCalledWith(
      mockUser.sub,
      dto,
    );
  });

  it('should delegate presignPart to videosService', async () => {
    const dto = { videoId: 'v1', uploadId: 'u1', partNumber: 1 };
    mockVideosService.presignPart.mockResolvedValueOnce({
      partNumber: 1,
      presignedUrl: 'http://url',
    });

    const res = await controller.presignPart(mockUser, dto);

    expect(res).toEqual({ partNumber: 1, presignedUrl: 'http://url' });
    expect(mockVideosService.presignPart).toHaveBeenCalledWith(
      mockUser.sub,
      dto,
    );
  });

  it('should delegate completeUpload to videosService', async () => {
    const dto = {
      videoId: 'v1',
      uploadId: 'u1',
      parts: [{ partNumber: 1, eTag: 'etag' }],
    };
    mockVideosService.completeUpload.mockResolvedValueOnce({
      status: 'PROCESSING',
    });

    const res = await controller.completeUpload(mockUser, dto);

    expect(res).toEqual({ status: 'PROCESSING' });
    expect(mockVideosService.completeUpload).toHaveBeenCalledWith(
      mockUser.sub,
      dto,
    );
  });

  it('should delegate getVideoDetails to videosService', async () => {
    mockVideosService.findByIdOrSlug.mockResolvedValueOnce({
      id: 'v1',
      slug: 'slug-1',
    });

    const res = await controller.getVideoDetails('slug-1');

    expect(res).toEqual({ id: 'v1', slug: 'slug-1' });
    expect(mockVideosService.findByIdOrSlug).toHaveBeenCalledWith('slug-1');
  });

  it('should handle video streaming with partial content headers', async () => {
    const mockStream = new Readable({
      read() {
        this.push('chunk');
        this.push(null);
      },
    });

    mockVideosService.getStream.mockResolvedValueOnce({
      stream: mockStream,
      contentLength: 100,
      contentRange: 'bytes 0-99/1000',
      acceptRanges: 'bytes',
      contentType: 'video/mp4',
    });

    const mockReq: any = {
      headers: { range: 'bytes=0-99' },
    };

    const mockRes: any = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };

    mockStream.pipe = jest.fn();

    await controller.streamVideo('slug-1', mockReq, mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Range',
      'bytes 0-99/1000',
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', 100);
    expect(mockRes.status).toHaveBeenCalledWith(206);
    expect(mockStream.pipe).toHaveBeenCalledWith(mockRes);
  });

  it('should handle video download with attachment headers', async () => {
    const mockStream = new Readable({
      read() {
        this.push('data');
        this.push(null);
      },
    });

    mockVideosService.getDownloadStream.mockResolvedValueOnce({
      stream: mockStream,
      filename: 'my_video.mp4',
      contentLength: 5000,
      contentType: 'video/mp4',
    });

    const mockRes: any = {
      setHeader: jest.fn(),
    };

    mockStream.pipe = jest.fn();

    await controller.downloadVideo('slug-1', mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="my_video.mp4"',
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'video/mp4');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', 5000);
    expect(mockStream.pipe).toHaveBeenCalledWith(mockRes);
  });

  it('should handle thumbnail delivery with caching headers', async () => {
    const mockStream = new Readable({
      read() {
        this.push('thumb-data');
        this.push(null);
      },
    });

    mockVideosService.getThumbnailStream.mockResolvedValueOnce({
      stream: mockStream,
      contentLength: 300,
      contentType: 'image/jpeg',
    });

    const mockRes: any = {
      setHeader: jest.fn(),
    };

    mockStream.pipe = jest.fn();

    await controller.getThumbnail('slug-1', mockRes);

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'image/jpeg',
    );
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'public, max-age=86400',
    );
    expect(mockStream.pipe).toHaveBeenCalledWith(mockRes);
  });
});
