import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Video } from './entities/video.entity';
import { ChannelsModule } from '../channels/channels.module';
import { StorageService } from './storage/storage.service';
import {
  VideoQueueService,
  VIDEO_PROCESSING_QUEUE,
} from './queue/video-queue.service';
import { VideoProcessor } from './processors/video.processor';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Video]),
    ChannelsModule,
    BullModule.registerQueue({
      name: VIDEO_PROCESSING_QUEUE,
    }),
  ],
  controllers: [VideosController],
  providers: [StorageService, VideoQueueService, VideoProcessor, VideosService],
  exports: [TypeOrmModule, StorageService, VideoQueueService, VideosService],
})
export class VideosModule {}
