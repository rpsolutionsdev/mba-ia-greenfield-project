import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { Video } from '../entities/video.entity';
import { VideoStatus } from '../enums/video-status.enum';
import { StorageService } from '../storage/storage.service';
import {
  VIDEO_PROCESSING_QUEUE,
  VideoProcessingJobData,
} from '../queue/video-queue.service';
import { probeVideo, extractThumbnail } from './ffmpeg.helper';

@Injectable()
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepo: Repository<Video>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    const { videoId, rawStorageKey } = job.data;
    this.logger.log(
      `Starting processing for video ${videoId} (job ID: ${job.id}, attempt: ${job.attemptsMade + 1})`,
    );

    const video = await this.videoRepo.findOne({ where: { id: videoId } });
    if (!video) {
      throw new Error(`Video ${videoId} not found in database`);
    }

    // Update status to PROCESSING
    await this.videoRepo.update(videoId, {
      status: VideoStatus.PROCESSING,
      processing_error: null,
    });

    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `streamtube-video-${videoId}-`),
    );
    const tempVideoPath = path.join(tempDir, 'input.mp4');
    const tempThumbPath = path.join(tempDir, 'thumb.jpg');

    try {
      // 1. Download video from storage
      this.logger.log(
        `Downloading video stream from storage key: ${rawStorageKey}`,
      );
      const { stream } =
        await this.storageService.getObjectStream(rawStorageKey);
      const writeStream = fs.createWriteStream(tempVideoPath);
      await pipeline(stream, writeStream);

      // 2. Extract technical metadata via ffprobe
      this.logger.log(`Probing video metadata for ${videoId}`);
      const metadata = await probeVideo(tempVideoPath);

      // 3. Extract thumbnail image via ffmpeg
      this.logger.log(`Extracting thumbnail for ${videoId}`);
      await extractThumbnail(tempVideoPath, tempThumbPath);

      // 4. Upload thumbnail to object storage
      const thumbBuffer = fs.readFileSync(tempThumbPath);
      const thumbStorageKey = `thumbnails/${videoId}/thumb.jpg`;
      this.logger.log(`Uploading thumbnail to storage key: ${thumbStorageKey}`);
      await this.storageService.uploadBuffer(
        thumbStorageKey,
        thumbBuffer,
        'image/jpeg',
      );

      // 5. Update video entity with metadata and READY status
      await this.videoRepo.update(videoId, {
        status: VideoStatus.READY,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        codec: metadata.codec,
        bitrate: metadata.bitrate,
        thumbnail_storage_key: thumbStorageKey,
        processing_error: null,
      });

      this.logger.log(
        `Video ${videoId} successfully processed and marked READY`,
      );
    } catch (err: any) {
      this.logger.error(
        `Error processing video ${videoId}: ${err.message}`,
        err.stack,
      );

      // If this is the final attempt or a fatal error
      const maxAttempts = job.opts.attempts || 3;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await this.videoRepo.update(videoId, {
          status: VideoStatus.FAILED,
          processing_error: err.message || 'Unknown processing error',
        });
      }

      throw err;
    } finally {
      // Clean up temporary files
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanupErr: any) {
        this.logger.warn(
          `Failed to clean up temp dir ${tempDir}: ${cleanupErr.message}`,
        );
      }
    }
  }

  @OnWorkerEvent('failed')
  async onJobFailed(
    job: Job<VideoProcessingJobData>,
    err: Error,
  ): Promise<void> {
    const maxAttempts = job.opts.attempts || 3;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.warn(
        `Job ${job.id} for video ${job.data.videoId} permanently failed after ${job.attemptsMade} attempts`,
      );
      await this.videoRepo.update(job.data.videoId, {
        status: VideoStatus.FAILED,
        processing_error: err.message,
      });
    }
  }
}
