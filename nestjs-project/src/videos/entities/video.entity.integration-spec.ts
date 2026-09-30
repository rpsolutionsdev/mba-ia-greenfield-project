import { DataSource, Repository } from 'typeorm';
import { Video } from './video.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { VideoStatus } from '../enums/video-status.enum';
import { createTestDataSource } from '../../test/create-test-data-source';

describe('Video Entity (integration)', () => {
  let dataSource: DataSource;
  let videoRepo: Repository<Video>;
  let channelRepo: Repository<Channel>;
  let userRepo: Repository<User>;
  let testChannel: Channel;

  beforeAll(async () => {
    dataSource = createTestDataSource([
      User,
      Channel,
      RefreshToken,
      VerificationToken,
      Video,
    ]);
    await dataSource.initialize();
    videoRepo = dataSource.getRepository(Video);
    channelRepo = dataSource.getRepository(Channel);
    userRepo = dataSource.getRepository(User);

    // Create user and channel for tests
    const user = await userRepo.save({
      email: 'creator@streamtube.test',
      password: 'hashed-password',
      is_confirmed: true,
    });

    testChannel = await channelRepo.save({
      name: 'Creator Channel',
      nickname: 'creator_channel',
      user_id: user.id,
    });
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      await videoRepo.delete({});
      await channelRepo.delete({});
      await userRepo.delete({});
      await dataSource.destroy();
    }
  });

  afterEach(async () => {
    if (dataSource && dataSource.isInitialized) {
      await videoRepo.delete({});
    }
  });

  it('should persist a video in DRAFT status by default', async () => {
    const video = await videoRepo.save({
      slug: 'slug-draft-1',
      title: 'Draft Video',
      channel_id: testChannel.id,
    });

    expect(video.id).toBeDefined();
    expect(video.slug).toBe('slug-draft-1');
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.created_at).toBeInstanceOf(Date);
    expect(video.updated_at).toBeInstanceOf(Date);
  });

  it('should enforce unique slug constraint', async () => {
    await videoRepo.save({
      slug: 'duplicate-slug',
      title: 'First Video',
      channel_id: testChannel.id,
    });

    await expect(
      videoRepo.save({
        slug: 'duplicate-slug',
        title: 'Second Video',
        channel_id: testChannel.id,
      }),
    ).rejects.toThrow();
  });

  it('should update video status and technical metadata', async () => {
    const video = await videoRepo.save({
      slug: 'meta-video',
      title: 'Metadata Video',
      channel_id: testChannel.id,
      status: VideoStatus.UPLOADING,
    });

    await videoRepo.update(video.id, {
      status: VideoStatus.READY,
      duration: 300,
      width: 1920,
      height: 1080,
      codec: 'h264',
      bitrate: 4000000,
      raw_storage_key: 'videos/raw/123/meta-video.mp4',
      thumbnail_storage_key: 'thumbnails/123/thumb.jpg',
    });

    const updated = await videoRepo.findOneBy({ id: video.id });
    expect(updated?.status).toBe(VideoStatus.READY);
    expect(updated?.duration).toBe(300);
    expect(updated?.width).toBe(1920);
    expect(updated?.height).toBe(1080);
    expect(updated?.codec).toBe('h264');
    expect(updated?.bitrate).toBe(4000000);
    expect(updated?.raw_storage_key).toBe('videos/raw/123/meta-video.mp4');
    expect(updated?.thumbnail_storage_key).toBe('thumbnails/123/thumb.jpg');
  });
});
