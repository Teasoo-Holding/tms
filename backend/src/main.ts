import 'reflect-metadata';
import { createApp, logger } from './app.factory';
import { config } from './config';

async function main() {
  const app = await createApp();
  await app.listen(config.port);
  logger.log(`TMS API listening on :${config.port} (storage: ${config.storageDriver})`);
}

main();
