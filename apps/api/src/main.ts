import { createApplication } from './bootstrap';
import { loadConfig } from './config';
async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApplication(config);
  await app.listen(config.port, '0.0.0.0');
}
main().catch(() => { console.error('API startup failed; check configuration and database availability.'); process.exitCode = 1; });
