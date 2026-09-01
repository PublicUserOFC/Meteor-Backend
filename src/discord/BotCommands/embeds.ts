import { EmbedBuilder } from 'discord.js';

export const Colors = {
  success: 0x2ecc71,
  error: 0xe74c3c,
  warning: 0xf39c12,
  info: 0x3498db,
  purple: 0x9b59b6,
  vbucks: 0x00d4ff,
  danger: 0xff4757,
  gold: 0xffd700,
} as const;

export const Emojis = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  vbucks: '🎮',
  account: '👤',
  key: '🔑',
  shield: '🛡️',
  ban: '🔨',
  trophy: '🏆',
  trash: '🗑️',
  wrench: '🔧',
  lock: '🔒',
} as const;

const FOOTER = 'Meteor';

export function successEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.success)
    .setTitle(`${Emojis.success} ${title}`)
    .setDescription(description ?? null)
    .setTimestamp()
    .setFooter({ text: FOOTER });
}

export function errorEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.error)
    .setTitle(`${Emojis.error} ${title}`)
    .setDescription(description ?? null)
    .setTimestamp()
    .setFooter({ text: FOOTER });
}

export function infoEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.info)
    .setTitle(`${Emojis.info} ${title}`)
    .setDescription(description ?? null)
    .setTimestamp()
    .setFooter({ text: FOOTER });
}

export function warningEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.warning)
    .setTitle(`${Emojis.warning} ${title}`)
    .setDescription(description ?? null)
    .setTimestamp()
    .setFooter({ text: FOOTER });
}

export function noPermissionEmbed(): EmbedBuilder {
  return errorEmbed('Access Denied', 'You do not have permission to use this command. This is restricted to **staff only**.');
}

export function notFoundEmbed(what: string): EmbedBuilder {
  return errorEmbed(`${what} Not Found`, `The requested ${what.toLowerCase()} could not be found.`);
}
