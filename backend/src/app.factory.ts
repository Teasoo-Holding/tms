import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  // same-site lets the web portal (another port in development) display signed photo URLs.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '2mb' });
  app.enableCors({ origin: config.corsOrigins, credentials: false });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}

export const logger = new Logger('TMS');
