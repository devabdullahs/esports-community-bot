import { logger } from './lib/logger.js';
import { deployCommands } from './lib/commandRegistry.js';

// Registers slash commands with Discord. Run with `npm run deploy` whenever a command's
// definition changes. Guild-scoped (DISCORD_GUILD_ID set) = instant; global = up to 1h.
try {
  await deployCommands();
} catch (err) {
  logger.error('Command deployment failed:', err);
  process.exit(1);
}
