import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface VideoProcessingJobData {
  videoId: string;
  rawStorageKey: string;
}

export const VIDEO_PROCESSING_QUEUE = 'video-processing';
export const PROCESS_VIDEO_JOB = 'process-video';

@Injectable()
export class VideoQueueService {
  private readonly logger = new Logger(VideoQueueService.name);

  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly videoQueue: Queue<VideoProcessingJobData>,
  ) {}

  async enqueueVideoProcessing(
    videoId: string,
    rawStorageKey: string,
  ): Promise<void> {
    this.logger.log(
      `Enqueuing video processing for video ${videoId} (key: ${rawStorageKey})`,
    );

    await this.videoQueue.add(
      PROCESS_VIDEO_JOB,
      {
        videoId,
        rawStorageKey,
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
  }
}
