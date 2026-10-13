import { StorageService } from './storage.service';
import {
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest
    .fn()
    .mockResolvedValue('http://storage:9000/streamtube-media/test?signed=true'),
}));

describe('StorageService (unit)', () => {
  let service: StorageService;
  let mockSend: jest.Mock;

  const mockConfig = {
    endpoint: 'http://storage:9000',
    region: 'us-east-1',
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
    bucketMedia: 'streamtube-media',
  };

  beforeEach(() => {
    mockSend = jest.fn();
    service = new StorageService(mockConfig);
    // Replace internal client's send with mock
    (service as any).s3Client.send = mockSend;
  });

  it('should initiate multipart upload and return uploadId', async () => {
    mockSend.mockResolvedValueOnce({ UploadId: 'upload-id-123' });

    const uploadId = await service.initiateMultipartUpload(
      'videos/raw/1/test.mp4',
      'video/mp4',
    );

    expect(uploadId).toBe('upload-id-123');
    expect(mockSend).toHaveBeenCalledWith(
      expect.any(CreateMultipartUploadCommand),
    );
  });

  it('should throw error when initiate multipart upload returns no uploadId', async () => {
    mockSend.mockResolvedValueOnce({});

    await expect(
      service.initiateMultipartUpload('videos/raw/1/test.mp4', 'video/mp4'),
    ).rejects.toThrow('Failed to initiate multipart upload');
  });

  it('should generate presigned part upload url', async () => {
    const url = await service.getPresignedUploadPartUrl(
      'videos/raw/1/test.mp4',
      'upload-id-123',
      1,
    );

    expect(url).toContain('signed=true');
  });

  it('should complete multipart upload with sorted parts', async () => {
    mockSend.mockResolvedValueOnce({});

    const parts = [
      { PartNumber: 2, ETag: '"etag-2"' },
      { PartNumber: 1, ETag: '"etag-1"' },
    ];

    await service.completeMultipartUpload(
      'videos/raw/1/test.mp4',
      'upload-id-123',
      parts,
    );

    expect(mockSend).toHaveBeenCalledWith(
      expect.any(CompleteMultipartUploadCommand),
    );
  });

  it('should abort multipart upload', async () => {
    mockSend.mockResolvedValueOnce({});

    await service.abortMultipartUpload(
      'videos/raw/1/test.mp4',
      'upload-id-123',
    );

    expect(mockSend).toHaveBeenCalledWith(
      expect.any(AbortMultipartUploadCommand),
    );
  });

  it('should get object head metadata', async () => {
    mockSend.mockResolvedValueOnce({
      ContentLength: 1048576,
      ContentType: 'video/mp4',
    });

    const head = await service.getObjectHead('videos/raw/1/test.mp4');

    expect(head.contentLength).toBe(1048576);
    expect(head.contentType).toBe('video/mp4');
    expect(mockSend).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
  });

  it('should get object stream with range', async () => {
    const stream = new Readable();
    stream.push('video-data');
    stream.push(null);

    mockSend.mockResolvedValueOnce({
      Body: stream,
      ContentLength: 1000,
      ContentRange: 'bytes 0-999/5000',
      AcceptRanges: 'bytes',
      ContentType: 'video/mp4',
    });

    const result = await service.getObjectStream(
      'videos/raw/1/test.mp4',
      'bytes=0-999',
    );

    expect(result.stream).toBe(stream);
    expect(result.contentLength).toBe(1000);
    expect(result.contentRange).toBe('bytes 0-999/5000');
    expect(result.contentType).toBe('video/mp4');
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetObjectCommand));
  });

  it('should upload buffer', async () => {
    mockSend.mockResolvedValueOnce({});
    const buffer = Buffer.from('image-data');

    await service.uploadBuffer('thumbnails/1/thumb.jpg', buffer, 'image/jpeg');

    expect(mockSend).toHaveBeenCalledWith(expect.any(PutObjectCommand));
  });

  it('should delete object', async () => {
    mockSend.mockResolvedValueOnce({});

    await service.deleteObject('videos/raw/1/test.mp4');

    expect(mockSend).toHaveBeenCalledWith(expect.any(DeleteObjectCommand));
  });
});
