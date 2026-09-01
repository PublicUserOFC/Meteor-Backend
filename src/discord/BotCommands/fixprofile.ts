import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { BotCommand } from './types';
import { successEmbed, errorEmbed, Emojis } from './embeds';
import { fixUserProfile } from '../../core/users';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('fixprofile')
    .setDescription('🔧 Regenerate your profile if you have login or inventory issues'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await fixUserProfile(interaction.user.id);

      if (!result.success) {
        return interaction.editReply({ embeds: [errorEmbed('Fix Failed', result.message || 'Could not fix your profile.')] });
      }

      return interaction.editReply({
        embeds: [successEmbed('Profile Fixed!', 'Your profile has been regenerated successfully.')
          .addFields(
            { name: `${Emojis.wrench} What was fixed?`, value: '• Profile data reset to defaults\n• Login issues resolved\n• Cosmetics preserved', inline: false },
            { name: '📋 Next Steps', value: 'Restart Fortnite and use `/exchangecode` to log back in.', inline: false },
          )],
      });
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Error', 'An unexpected error occurred.')] });
    }
  },
};
