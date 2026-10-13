import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('VideoWorker');
  logger.log('Starting StreamTube video processing worker...');

  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();

  logger.log(
    'StreamTube video worker is running and listening for video processing jobs',
  );
}

void bootstrap();
