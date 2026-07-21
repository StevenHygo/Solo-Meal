import { createApp } from './app.js';
import { readConfig } from './config/env.js';
import { createRepository } from './repositories/create-repository.js';

const config = readConfig();
const repository = createRepository(config);
const app = await createApp({ config, repository });

const close = async (signal: string) => {
  app.log.info({ signal }, 'Stopping API');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => { void close('SIGINT'); });
process.once('SIGTERM', () => { void close('SIGTERM'); });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
