import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { BotCommand } from './types';
import { changeUserPassword } from '../../core/users';

const C = { success: 0x2ecc71, error: 0xe74c3c } as const;
const ok = (t: string, d?: string) => new EmbedBuilder().setColor(C.success).setTitle(`✅ ${t}`).setDescription(d ?? null).setTimestamp().setFooter({ text: 'Meteor' });
const err = (t: string, d?: string) => new EmbedBuilder().setColor(C.error).setTitle(`❌ ${t}`).setDescription(d ?? null).setTimestamp().setFooter({ text: 'Meteor' });

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('changepassword')
    .setDescription('Change your account password')
    .addStringOption(o =>
      o.setName('oldpassword').setDescription('Your current password').setRequired(true)
    )
    .addStringOption(o =>
      o.setName('newpassword').setDescription('Your new password (min 6 characters)').setRequired(true).setMinLength(6)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const oldPassword = interaction.options.getString('oldpassword', true);
    const newPassword = interaction.options.getString('newpassword', true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (oldPassword === newPassword) {
      return interaction.editReply({ embeds: [err('Same Password', 'Your new password must be different from your current one.')] });
    }

    try {
      const result = await changeUserPassword(interaction.user.id, oldPassword, newPassword);

      if (!result.success) {
        return interaction.editReply({ embeds: [err('Failed', result.message || 'Incorrect password or account not found.')] });
      }

      return interaction.editReply({
        embeds: [ok('Password Changed', 'Your password has been updated successfully.')
          .addFields({ name: '🔒 Tip', value: 'Never share your password with anyone.', inline: false })],
      });
    } catch {
      return interaction.editReply({ embeds: [err('Error', 'Failed to change password. Please try again.')] });
    }
  },
};
