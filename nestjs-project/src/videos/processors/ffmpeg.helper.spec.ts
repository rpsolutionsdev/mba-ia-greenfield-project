import { probeVideo, extractThumbnail } from './ffmpeg.helper';
import ffmpeg from 'fluent-ffmpeg';

jest.mock('fluent-ffmpeg');

describe('ffmpeg.helper (unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('probeVideo', () => {
    it('should correctly parse ffprobe output', async () => {
      (ffmpeg.ffprobe as unknown as jest.Mock).mockImplementation(
        (file, callback) => {
          callback(null, {
            format: {
              duration: 125.4,
              bit_rate: 4500000,
            },
            streams: [
              {
                codec_type: 'video',
                codec_name: 'h264',
                width: 1920,
                height: 1080,
              },
            ],
          });
        },
      );

      const metadata = await probeVideo('/tmp/test.mp4');

      expect(metadata).toEqual({
        duration: 125,
        width: 1920,
        height: 1080,
        codec: 'h264',
        bitrate: 4500000,
      });
    });

    it('should reject with error when ffprobe fails', async () => {
      (ffmpeg.ffprobe as unknown as jest.Mock).mockImplementation(
        (file, callback) => {
          callback(new Error('Corrupt file'), null);
        },
      );

      await expect(probeVideo('/tmp/corrupt.mp4')).rejects.toThrow(
        'FFprobe failed to inspect file: Corrupt file',
      );
    });
  });

  describe('extractThumbnail', () => {
    it('should configure ffmpeg screenshots and resolve on end', async () => {
      const mockScreenshots = jest.fn().mockReturnThis();
      const mockOn = jest.fn().mockImplementation(function (
        this: any,
        event: string,
        cb: () => void,
      ) {
        if (event === 'end') {
          cb();
        }
        return this;
      });

      (ffmpeg as unknown as jest.Mock).mockReturnValue({
        screenshots: mockScreenshots,
        on: mockOn,
      });

      const result = await extractThumbnail(
        '/tmp/input.mp4',
        '/tmp/output/thumb.jpg',
      );

      expect(result).toBe('/tmp/output/thumb.jpg');
      expect(mockScreenshots).toHaveBeenCalledWith({
        timestamps: ['00:00:01'],
        filename: 'thumb.jpg',
        folder: expect.stringContaining('output'),
        size: '1280x720',
      });
    });

    it('should reject when ffmpeg encounters error', async () => {
      const mockScreenshots = jest.fn().mockReturnThis();
      const mockOn = jest.fn().mockImplementation(function (
        this: any,
        event: string,
        cb: (err?: Error) => void,
      ) {
        if (event === 'error') {
          cb(new Error('Encoding failed'));
        }
        return this;
      });

      (ffmpeg as unknown as jest.Mock).mockReturnValue({
        screenshots: mockScreenshots,
        on: mockOn,
      });

      await expect(
        extractThumbnail('/tmp/input.mp4', '/tmp/output/thumb.jpg'),
      ).rejects.toThrow('FFmpeg failed to extract thumbnail: Encoding failed');
    });
  });
});
