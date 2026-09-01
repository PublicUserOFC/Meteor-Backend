import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  MessageFlags,
} from 'discord.js';
import { config } from '../config';
import { backend, error as logError } from '../core/logger';
import { commands, commandMap } from './BotCommands/index';

let client: Client | null = null;

async function registerCommands(): Promise<void> {
  if (!config.discord.clientId || !config.discord.botToken) {
    logError('Missing Discord client ID or bot token');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.discord.botToken);
  const body = commands.map(cmd => cmd.data.toJSON());

  try {
    backend('Registering Discord slash commands...');

    if (config.discord.guildId) {
      await rest.put(
        Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
        { body }
      );
      backend(`Successfully registered Discord commands to guild ${config.discord.guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(config.discord.clientId), { body });
      backend('Successfully registered Discord commands globally');
    }
  } catch (err) {
    logError('Error registering Discord commands:', err);
  }
}

export async function startDiscordBot(): Promise<void> {
  if (!config.discord.useBot) {
    backend('Discord bot is disabled in configuration');
    return;
  }

  if (!config.discord.botToken) {
    logError('Discord bot token is not configured');
    return;
  }

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  client.on('clientReady', () => {
    backend(`Discord bot logged in as ${client?.user?.tag}`);
    backend(`Connected to ${client?.guilds.cache.size} servers`);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commandMap.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      logError(`Error handling command /${interaction.commandName}:`, err);

      const msg = { content: '❌ An unexpected error occurred. Please try again.', flags: MessageFlags.Ephemeral as any };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ An unexpected error occurred. Please try again.' }).catch(() => {});
      } else {
        await interaction.reply(msg).catch(() => {});
      }
    }
  });

  await registerCommands();
  await client.login(config.discord.botToken);
}

export function getDiscordClient(): Client | null {
  return client;
}
