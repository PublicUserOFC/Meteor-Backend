import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { BotCommand } from './types';
import { noPermissionEmbed, notFoundEmbed, Colors, Emojis } from './embeds';
import { config } from '../../config';
import { User } from '../../models/User';
import { Arena } from '../../models/Stats';
import { getNextDivision } from '../../core/utils';

const DIVISION_NAMES = [
  'Open League I', 'Open League II', 'Open League III', 'Open League IV',
  'Contender League I', 'Contender League II', 'Contender League III',
  'Champion League I', 'Champion League II', 'Champion League III',
];

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('sethype')
    .setDescription("Set a player's arena hype (staff only)")
    .addStringOption(o => o.setName('username').setDescription('Username').setRequired(true))
    .addIntegerOption(o =>
      o.setName('amount').setDescription('Hype amount (0–100000)').setRequired(true).setMinValue(0).setMaxValue(100000)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!config.moderators.includes(interaction.user.id)) {
      return interaction.editReply({ embeds: [noPermissionEmbed()] });
    }

    const username = interaction.options.getString('username', true);
    const amount = interaction.options.getInteger('amount', true);

    const user = await User.findOne({ username_lower: username.toLowerCase() }).lean();
    if (!user) return interaction.editReply({ embeds: [notFoundEmbed('User')] });

    const oldArena = await Arena.findOne({ accountId: user.accountId }).lean();
    const division = getNextDivision(amount, 0);
    const divisionName = DIVISION_NAMES[division] ?? `Division ${division + 1}`;

    await Arena.findOneAndUpdate(
      { accountId: user.accountId },
      { $set: { accountId: user.accountId, hype: amount, division } },
      { upsert: true }
    );

    const diff = amount - (oldArena?.hype ?? 0);

    const embed = new EmbedBuilder()
      .setColor(Colors.purple)
      .setTitle(`${Emojis.trophy} Arena Hype Updated`)
      .addFields(
        { name: '👤 Player', value: `\`${user.username}\``, inline: true },
        { name: '🏆 New Hype', value: `**${amount.toLocaleString()}** (${diff >= 0 ? '+' : ''}${diff.toLocaleString()})`, inline: true },
        { name: '📊 Division', value: `**${divisionName}**`, inline: true },
        { name: '📈 Previous', value: `${(oldArena?.hype ?? 0).toLocaleString()}`, inline: true },
        { name: '🛡️ Set By', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: 'Meteor' });

    return interaction.editReply({ embeds: [embed] });
  },
};
