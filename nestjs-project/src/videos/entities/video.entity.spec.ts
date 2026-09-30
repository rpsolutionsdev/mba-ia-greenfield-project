import { Video } from './video.entity';
import { VideoStatus } from '../enums/video-status.enum';

describe('Video Entity (unit)', () => {
  it('should instantiate a video entity with correct properties', () => {
    const video = new Video();
    video.id = '550e8400-e29b-41d4-a716-446655440000';
    video.slug = 'cK8wP9xL2qM';
    video.title = 'Test Video';
    video.description = 'Test Description';
    video.channel_id = '770e8400-e29b-41d4-a716-446655440000';
    video.status = VideoStatus.DRAFT;
    video.duration = 120;
    video.width = 1920;
    video.height = 1080;
    video.codec = 'h264';
    video.bitrate = 5000000;

    expect(video.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(video.slug).toBe('cK8wP9xL2qM');
    expect(video.title).toBe('Test Video');
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.duration).toBe(120);
    expect(video.width).toBe(1920);
    expect(video.height).toBe(1080);
    expect(video.codec).toBe('h264');
  });
});
