import {
  ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder,
} from 'discord.js';
import { BotCommand } from './types';
import { deleteUserAccount } from '../../core/users';

const C = { success: 0x2ecc71, error: 0xe74c3c, warning: 0xf39c12, danger: 0xff4757 } as const;
const ok = (t: string, d?: string) => new EmbedBuilder().setColor(C.success).setTitle(`✅ ${t}`).setDescription(d ?? null).setTimestamp().setFooter({ text: 'Meteor' });
const err = (t: string, d?: string) => new EmbedBuilder().setColor(C.error).setTitle(`❌ ${t}`).setDescription(d ?? null).setTimestamp().setFooter({ text: 'Meteor' });
const warn = (t: string, d?: string) => new EmbedBuilder().setColor(C.warning).setTitle(`⚠️ ${t}`).setDescription(d ?? null).setTimestamp().setFooter({ text: 'Meteor' });

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('deleteaccount')
    .setDescription('⚠️ Permanently delete your Meteoraccount (cannot be undone)'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const confirmEmbed = warn(
      'Delete Account — Are You Sure?',
      '**This action is permanent and cannot be undone.**\n\nDeleting your account will remove:\n• Your profile and all cosmetics\n• Your V-Bucks balance\n• Your stats and match history\n\nClick **Confirm Delete** to proceed.'
    ).setColor(C.danger);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('confirm_delete').setLabel('Confirm Delete').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
      new ButtonBuilder().setCustomId('cancel_delete').setLabel('Cancel').setStyle(ButtonStyle.Secondary).setEmoji('✖️'),
    );

    const reply = await interaction.editReply({ embeds: [confirmEmbed], components: [row] });

    try {
      const btn = await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: 30_000,
      });

      if (btn.customId === 'cancel_delete') {
        await btn.update({ embeds: [err('Cancelled', 'Account deletion was cancelled. Your account is safe.')], components: [] });
        return;
      }

      await btn.deferUpdate();
      const result = await deleteUserAccount(interaction.user.id);

      if (!result.success) {
        return interaction.editReply({ embeds: [err('Failed', result.message || 'Failed to delete account.')], components: [] });
      }

      return interaction.editReply({
        embeds: [ok('Account Deleted', 'Your account and all data have been permanently removed.')
          .setColor(C.danger)
          .setTitle('🗑️ Account Deleted')
          .addFields({ name: 'What now?', value: 'You can create a new account with `/register`.', inline: false })],
        components: [],
      });
    } catch {
      return interaction.editReply({ embeds: [err('Timed Out', 'Confirmation timed out. Your account is safe.')], components: [] });
    }
  },
};
