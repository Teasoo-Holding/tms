import { INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  // A client configured with a trailing slash calls "//api/v1/…"; treat it as "/api/v1/…".
  app.use((req: { url: string }, _res: unknown, next: () => void) => {
    if (req.url.startsWith('//')) req.url = req.url.replace(/^\/{2,}/, '/');
    next();
  });
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
