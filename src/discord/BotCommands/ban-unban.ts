import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { BotCommand } from './types';
import { successEmbed, errorEmbed, noPermissionEmbed, notFoundEmbed, Colors, Emojis } from './embeds';
import { config } from '../../config';
import { User } from '../../models/User';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban or unban a player (staff only)')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Ban a player')
        .addStringOption(o => o.setName('username').setDescription('Username to ban').setRequired(true))
        .addStringOption(o => o.setName('reason').setDescription('Ban reason').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 1h, 7d, permanent)').setRequired(false))
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Unban a player')
        .addStringOption(o => o.setName('username').setDescription('Username to unban').setRequired(true))
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!config.moderators.includes(interaction.user.id)) {
      return interaction.editReply({ embeds: [noPermissionEmbed()] });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const username = interaction.options.getString('username', true);
      const reason = interaction.options.getString('reason', true);
      const durationStr = interaction.options.getString('duration') ?? 'permanent';

      const user = await User.findOne({ username_lower: username.toLowerCase() });
      if (!user) return interaction.editReply({ embeds: [notFoundEmbed('User')] });

      if (user.banned && !user.bannedUntil) {
        return interaction.editReply({ embeds: [errorEmbed('Already Banned', `\`${user.username}\` is already permanently banned.`)] });
      }

      let banExpires: Date | null = null;
      let durationDisplay = 'Permanent';

      if (durationStr && durationStr !== 'permanent') {
        const match = durationStr.match(/^(\d+)([hdm])$/i);
        if (!match) {
          return interaction.editReply({ embeds: [errorEmbed('Invalid Duration', 'Use formats like `1h`, `7d`, `30m`, or `permanent`.')] });
        }
        const amount = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        banExpires = new Date();
        if (unit === 'h') { banExpires.setHours(banExpires.getHours() + amount); durationDisplay = `${amount} hour(s)`; }
        else if (unit === 'd') { banExpires.setDate(banExpires.getDate() + amount); durationDisplay = `${amount} day(s)`; }
        else if (unit === 'm') { banExpires.setMinutes(banExpires.getMinutes() + amount); durationDisplay = `${amount} minute(s)`; }
      }

      await user.updateOne({ $set: { banned: true, bannedUntil: banExpires, banReason: reason } });

      if (global.accessTokens) {
        const idx = global.accessTokens.findIndex((t: any) => t.accountId === user.accountId);
        if (idx !== -1) global.accessTokens.splice(idx, 1);
      }

      let dmStatus = '';
      if (user.discordId) {
        try {
          const discordUser = await interaction.client.users.fetch(user.discordId);
          const dmEmbed = new EmbedBuilder()
            .setColor(Colors.danger)
            .setTitle(`${Emojis.ban} You Have Been Banned`)
            .setDescription(`Your account **${user.username}** has been banned from **Meteor**.`)
            .addFields(
              { name: '📋 Reason', value: reason, inline: true },
              { name: '⏳ Duration', value: durationDisplay, inline: true },
            )
            .setTimestamp()
            .setFooter({ text: 'Meteor' });
          if (banExpires) dmEmbed.addFields({ name: '📅 Expires', value: `<t:${Math.floor(banExpires.getTime() / 1000)}:F>`, inline: false });
          await discordUser.send({ embeds: [dmEmbed] });
          dmStatus = ' • User notified via DM';
        } catch {
          dmStatus = ' • Could not DM user';
        }
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.danger)
        .setTitle(`${Emojis.ban} Player Banned`)
        .addFields(
          { name: '👤 Player', value: `\`${user.username}\``, inline: true },
          { name: '📋 Reason', value: reason, inline: true },
          { name: '⏳ Duration', value: durationDisplay, inline: true },
          { name: '🛡️ Banned By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: `Meteor${dmStatus}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'remove') {
      const username = interaction.options.getString('username', true);

      const user = await User.findOne({ username_lower: username.toLowerCase() });
      if (!user) return interaction.editReply({ embeds: [notFoundEmbed('User')] });

      if (!user.banned) {
        return interaction.editReply({ embeds: [errorEmbed('Not Banned', `\`${user.username}\` is not currently banned.`)] });
      }

      await user.updateOne({ $set: { banned: false, bannedUntil: null, banReason: null } });

      let dmStatus = '';
      if (user.discordId) {
        try {
          const discordUser = await interaction.client.users.fetch(user.discordId);
          await discordUser.send({
            embeds: [successEmbed('You Have Been Unbanned', `Your account **${user.username}** has been unbanned from **Meteor**. You can now log back in.`)],
          });
          dmStatus = ' • User notified via DM';
        } catch {
          dmStatus = ' • Could not DM user';
        }
      }

      const embed = new EmbedBuilder()
        .setColor(Colors.success)
        .setTitle(`${Emojis.success} Player Unbanned`)
        .addFields(
          { name: '👤 Player', value: `\`${user.username}\``, inline: true },
          { name: '🛡️ Unbanned By', value: `<@${interaction.user.id}>`, inline: true },
        )
        .setFooter({ text: `Meteor${dmStatus}` })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  },
};
