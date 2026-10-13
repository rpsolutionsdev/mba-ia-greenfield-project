import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as path from 'path';
import { Video } from './entities/video.entity';
import { VideoStatus } from './enums/video-status.enum';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from './storage/storage.service';
import { VideoQueueService } from './queue/video-queue.service';
import { generateVideoSlug } from './slug.util';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { PresignPartDto } from './dto/presign-part.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import {
  ChannelNotFoundException,
  InvalidUploadPartException,
  UnauthorizedVideoAccessException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepo: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    private readonly videoQueueService: VideoQueueService,
  ) {}

  async initiateUpload(userId: string, dto: InitiateUploadDto) {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const slug = generateVideoSlug();
    const ext = path.extname(dto.filename) || '.mp4';

    const video = await this.videoRepo.save(
      this.videoRepo.create({
        title: dto.title,
        description: dto.description || null,
        channel_id: channel.id,
        slug,
        status: VideoStatus.UPLOADING,
      }),
    );

    const rawStorageKey = `videos/raw/${video.id}/${slug}${ext}`;
    const uploadId = await this.storageService.initiateMultipartUpload(
      rawStorageKey,
      dto.contentType,
    );

    video.raw_storage_key = rawStorageKey;
    await this.videoRepo.save(video);

    return {
      videoId: video.id,
      slug: video.slug,
      uploadId,
      key: rawStorageKey,
    };
  }

  async presignPart(userId: string, dto: PresignPartDto) {
    const video = await this.videoRepo.findOne({
      where: { id: dto.videoId },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || video.channel_id !== channel.id) {
      throw new UnauthorizedVideoAccessException();
    }

    if (!video.raw_storage_key) {
      throw new VideoNotReadyException();
    }

    const presignedUrl = await this.storageService.getPresignedUploadPartUrl(
      video.raw_storage_key,
      dto.uploadId,
      dto.partNumber,
    );

    return {
      partNumber: dto.partNumber,
      presignedUrl,
    };
  }

  async completeUpload(userId: string, dto: CompleteUploadDto) {
    const video = await this.videoRepo.findOne({
      where: { id: dto.videoId },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    const channel = await this.channelsService.findByUserId(userId);
    if (!channel || video.channel_id !== channel.id) {
      throw new UnauthorizedVideoAccessException();
    }

    if (!dto.parts || dto.parts.length === 0) {
      throw new InvalidUploadPartException();
    }

    if (!video.raw_storage_key) {
      throw new VideoNotReadyException();
    }

    await this.storageService.completeMultipartUpload(
      video.raw_storage_key,
      dto.uploadId,
      dto.parts.map((p) => ({
        PartNumber: p.partNumber,
        ETag: p.eTag,
      })),
    );

    video.status = VideoStatus.PROCESSING;
    await this.videoRepo.save(video);

    await this.videoQueueService.enqueueVideoProcessing(
      video.id,
      video.raw_storage_key,
    );

    return {
      videoId: video.id,
      slug: video.slug,
      status: VideoStatus.PROCESSING,
      message:
        'Upload completed successfully. Video is now queued for processing.',
    };
  }

  async findByIdOrSlug(idOrSlug: string) {
    const whereCondition = UUID_REGEX.test(idOrSlug)
      ? [{ id: idOrSlug }, { slug: idOrSlug }]
      : { slug: idOrSlug };

    const video = await this.videoRepo.findOne({
      where: whereCondition,
      relations: ['channel'],
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      description: video.description,
      status: video.status,
      duration: video.duration,
      width: video.width,
      height: video.height,
      codec: video.codec,
      bitrate: video.bitrate,
      thumbnailUrl: `/videos/${video.slug}/thumbnail`,
      streamUrl: `/videos/${video.slug}/stream`,
      downloadUrl: `/videos/${video.slug}/download`,
      channel: {
        id: video.channel?.id,
        name: video.channel?.name,
        nickname: video.channel?.nickname,
      },
      createdAt: video.created_at,
    };
  }

  async getStream(idOrSlug: string, rangeHeader?: string) {
    const whereCondition = UUID_REGEX.test(idOrSlug)
      ? [{ id: idOrSlug }, { slug: idOrSlug }]
      : { slug: idOrSlug };

    const video = await this.videoRepo.findOne({
      where: whereCondition,
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.READY || !video.raw_storage_key) {
      throw new VideoNotReadyException();
    }

    return this.storageService.getObjectStream(
      video.raw_storage_key,
      rangeHeader,
    );
  }

  async getDownloadStream(idOrSlug: string) {
    const whereCondition = UUID_REGEX.test(idOrSlug)
      ? [{ id: idOrSlug }, { slug: idOrSlug }]
      : { slug: idOrSlug };

    const video = await this.videoRepo.findOne({
      where: whereCondition,
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.READY || !video.raw_storage_key) {
      throw new VideoNotReadyException();
    }

    const { stream, contentLength, contentType } =
      await this.storageService.getObjectStream(video.raw_storage_key);

    const safeTitle = video.title.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    const filename = safeTitle.endsWith('.mp4')
      ? safeTitle
      : `${safeTitle}.mp4`;

    return {
      stream,
      filename,
      contentLength,
      contentType: contentType || 'video/mp4',
    };
  }

  async getThumbnailStream(idOrSlug: string) {
    const whereCondition = UUID_REGEX.test(idOrSlug)
      ? [{ id: idOrSlug }, { slug: idOrSlug }]
      : { slug: idOrSlug };

    const video = await this.videoRepo.findOne({
      where: whereCondition,
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    if (!video.thumbnail_storage_key) {
      throw new VideoNotReadyException();
    }

    return this.storageService.getObjectStream(video.thumbnail_storage_key);
  }
}
