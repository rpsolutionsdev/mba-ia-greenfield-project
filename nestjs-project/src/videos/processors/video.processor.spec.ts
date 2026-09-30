import { VideoProcessor } from './video.processor';
import { VideoStatus } from '../enums/video-status.enum';
import { Readable, Writable } from 'stream';
import * as ffmpegHelper from './ffmpeg.helper';
import * as fs from 'fs';

jest.mock('./ffmpeg.helper');
jest.mock('fs');

describe('VideoProcessor (unit)', () => {
  let processor: VideoProcessor;
  let mockVideoRepo: any;
  let mockStorageService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVideoRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    };

    mockStorageService = {
      getObjectStream: jest.fn(),
      uploadBuffer: jest.fn().mockResolvedValue({}),
    };

    processor = new VideoProcessor(mockVideoRepo, mockStorageService);

    // Default mock filesystem behaviors
    (fs.mkdtempSync as jest.Mock).mockReturnValue('/tmp/test-dir');
    (fs.createWriteStream as jest.Mock).mockImplementation(() => {
      const writable = new Writable({
        write(chunk, encoding, callback) {
          callback();
        },
      });
      return writable;
    });
    (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from('fake-image'));
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.rmSync as jest.Mock).mockReturnValue(undefined);
  });

  it('should process video successfully and update status to READY', async () => {
    const videoId = '550e8400-e29b-41d4-a716-446655440000';
    const rawStorageKey = `videos/raw/${videoId}/test.mp4`;

    mockVideoRepo.findOne.mockResolvedValueOnce({
      id: videoId,
      status: VideoStatus.PROCESSING,
    });

    const stream = new Readable({
      read() {
        this.push('video-content');
        this.push(null);
      },
    });

    mockStorageService.getObjectStream.mockResolvedValueOnce({
      stream,
    });

    (ffmpegHelper.probeVideo as jest.Mock).mockResolvedValueOnce({
      duration: 120,
      width: 1920,
      height: 1080,
      codec: 'h264',
      bitrate: 4500000,
    });

    (ffmpegHelper.extractThumbnail as jest.Mock).mockResolvedValueOnce(
      '/tmp/test-dir/thumb.jpg',
    );

    const mockJob: any = {
      id: 'job-1',
      data: { videoId, rawStorageKey },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    await processor.process(mockJob);

    expect(mockVideoRepo.update).toHaveBeenCalledWith(videoId, {
      status: VideoStatus.PROCESSING,
      processing_error: null,
    });

    expect(ffmpegHelper.probeVideo).toHaveBeenCalled();
    expect(ffmpegHelper.extractThumbnail).toHaveBeenCalled();
    expect(mockStorageService.uploadBuffer).toHaveBeenCalledWith(
      `thumbnails/${videoId}/thumb.jpg`,
      expect.any(Buffer),
      'image/jpeg',
    );

    expect(mockVideoRepo.update).toHaveBeenCalledWith(videoId, {
      status: VideoStatus.READY,
      duration: 120,
      width: 1920,
      height: 1080,
      codec: 'h264',
      bitrate: 4500000,
      thumbnail_storage_key: `thumbnails/${videoId}/thumb.jpg`,
      processing_error: null,
    });
  });

  it('should mark video as FAILED when processing error occurs on final attempt', async () => {
    const videoId = '550e8400-e29b-41d4-a716-446655440000';
    const rawStorageKey = `videos/raw/${videoId}/test.mp4`;

    mockVideoRepo.findOne.mockResolvedValueOnce({
      id: videoId,
      status: VideoStatus.PROCESSING,
    });

    mockStorageService.getObjectStream.mockRejectedValueOnce(
      new Error('S3 Download Timeout'),
    );

    const mockJob: any = {
      id: 'job-1',
      data: { videoId, rawStorageKey },
      attemptsMade: 2, // 3rd attempt
      opts: { attempts: 3 },
    };

    await expect(processor.process(mockJob)).rejects.toThrow(
      'S3 Download Timeout',
    );

    expect(mockVideoRepo.update).toHaveBeenCalledWith(videoId, {
      status: VideoStatus.FAILED,
      processing_error: 'S3 Download Timeout',
    });
  });
});
