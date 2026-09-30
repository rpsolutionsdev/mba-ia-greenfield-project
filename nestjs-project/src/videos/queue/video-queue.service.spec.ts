import { VideoQueueService, PROCESS_VIDEO_JOB } from './video-queue.service';
import { Queue } from 'bullmq';

describe('VideoQueueService (unit)', () => {
  let service: VideoQueueService;
  let mockQueue: Partial<Queue>;

  beforeEach(() => {
    mockQueue = {
      add: jest.fn().mockResolvedValue({} as any),
    };
    service = new VideoQueueService(mockQueue as Queue);
  });

  it('should enqueue a video processing job with retry backoff configuration', async () => {
    await service.enqueueVideoProcessing(
      '550e8400-e29b-41d4-a716-446655440000',
      'videos/raw/1/test.mp4',
    );

    expect(mockQueue.add).toHaveBeenCalledWith(
      PROCESS_VIDEO_JOB,
      {
        videoId: '550e8400-e29b-41d4-a716-446655440000',
        rawStorageKey: 'videos/raw/1/test.mp4',
      },
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
  });
});
