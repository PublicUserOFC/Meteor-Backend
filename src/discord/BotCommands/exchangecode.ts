import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { BotCommand } from './types';
import { successEmbed, errorEmbed, Colors, Emojis } from './embeds';
import { generateExchangeCode } from '../../core/users';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('exchangecode')
    .setDescription('Generate a one-time login code for Fortnite'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await generateExchangeCode(interaction.user.id);

      if (!result.success) {
        return interaction.editReply({
          embeds: [errorEmbed('Failed', result.message || 'Could not generate a code. Make sure you have an account.')],
        });
      }

      const embed = successEmbed('Exchange Code Generated')
        .setColor(Colors.gold)
        .setTitle(`${Emojis.key} Exchange Code`)
        .setDescription('Use this code to log into Fortnite. It expires in **5 minutes**.')
        .addFields(
          { name: '🔐 Your Code', value: `\`\`\`${result.code}\`\`\``, inline: false },
          { name: '⏰ Expires', value: `<t:${Math.floor((Date.now() + 5 * 60 * 1000) / 1000)}:R>`, inline: true },
        )
        .setFooter({ text: '⚠️ Keep this code private — it grants access to your account' });

      return interaction.editReply({ embeds: [embed] });
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Error', 'Failed to generate exchange code.')] });
    }
  },
};
