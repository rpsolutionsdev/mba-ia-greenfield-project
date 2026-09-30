import queueConfig from './queue.config';

describe('queueConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return default values when env vars are not set', () => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;

    const config = queueConfig();

    expect(config).toEqual({
      host: 'redis',
      port: 6379,
    });
  });

  it('should return configured values from env vars', () => {
    process.env.REDIS_HOST = 'custom-redis';
    process.env.REDIS_PORT = '6380';

    const config = queueConfig();

    expect(config).toEqual({
      host: 'custom-redis',
      port: 6380,
    });
  });
});
