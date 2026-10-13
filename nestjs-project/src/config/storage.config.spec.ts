import storageConfig from './storage.config';

describe('storageConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return default values when env vars are not set', () => {
    delete process.env.STORAGE_ENDPOINT;
    delete process.env.STORAGE_REGION;
    delete process.env.STORAGE_ACCESS_KEY;
    delete process.env.STORAGE_SECRET_KEY;
    delete process.env.STORAGE_BUCKET_MEDIA;

    const config = storageConfig();

    expect(config).toEqual({
      endpoint: 'http://storage:9000',
      region: 'us-east-1',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucketMedia: 'streamtube-media',
    });
  });

  it('should return configured values from env vars', () => {
    process.env.STORAGE_ENDPOINT = 'http://custom-s3:9000';
    process.env.STORAGE_REGION = 'sa-east-1';
    process.env.STORAGE_ACCESS_KEY = 'my-access-key';
    process.env.STORAGE_SECRET_KEY = 'my-secret-key';
    process.env.STORAGE_BUCKET_MEDIA = 'my-bucket';

    const config = storageConfig();

    expect(config).toEqual({
      endpoint: 'http://custom-s3:9000',
      region: 'sa-east-1',
      accessKey: 'my-access-key',
      secretKey: 'my-secret-key',
      bucketMedia: 'my-bucket',
    });
  });
});
