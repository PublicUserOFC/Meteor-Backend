import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { BotCommand } from './types';
import { getUserByDiscordId } from '../../core/users';
import { Profile } from '../../models/Profile';
import { Arena } from '../../models/Stats';

const Colors = { info: 0x3498db, error: 0xe74c3c } as const;

function errorEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.error)
    .setTitle(`❌ ${title}`)
    .setDescription(description ?? null)
    .setTimestamp()
    .setFooter({ text: 'Meteor' });
}

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('account')
    .setDescription('View your Meteoraccount information and stats'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const user = await getUserByDiscordId(interaction.user.id);

      if (!user) {
        return interaction.editReply({
          embeds: [errorEmbed('No Account Found', "You don't have a Meteoraccount yet.\nUse `/register` to create one!")],
        });
      }

      const profiles = await Profile.findOne({ accountId: user.accountId }).lean();
      const commonCore = profiles?.profiles?.['common_core'];
      let vbucks = 0;
      if (commonCore?.items) {
        const mtxItem = Object.values(commonCore.items as Record<string, any>).find(
          (i: any) => i?.templateId?.toLowerCase().startsWith('currency:mtx')
        );
        vbucks = mtxItem?.quantity ?? 0;
      }

      const arena = await Arena.findOne({ accountId: user.accountId }).lean();
      const athena = profiles?.profiles?.['athena'];
      const bpPurchased = athena?.stats?.attributes?.book_purchased ?? false;
      const bpLevel = athena?.stats?.attributes?.book_level ?? 1;

      const embed = new EmbedBuilder()
        .setColor(Colors.info)
        .setTitle(`👤 Account — ${user.username}`)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: '👤 Username', value: `\`${user.username}\``, inline: true },
          { name: '📧 Email', value: `\`${user.email}\``, inline: true },
          { name: '🆔 Account ID', value: `\`${user.accountId.slice(0, 16)}...\``, inline: true },
          { name: '🎮 V-Bucks', value: `**${vbucks.toLocaleString()}**`, inline: true },
          { name: '⭐ Level', value: `**${athena?.stats?.attributes?.level ?? 1}**`, inline: true },
          { name: '🏆 Wins', value: `**${athena?.stats?.attributes?.lifetime_wins ?? 0}**`, inline: true },
          { name: '🎫 Battle Pass', value: bpPurchased ? `✅ Owned (Level **${bpLevel}**)` : '❌ Not Owned', inline: true },
          { name: '🏆 Arena Hype', value: `**${(arena?.hype ?? 0).toLocaleString()}** (Div ${(arena?.division ?? 0) + 1})`, inline: true },
          { name: '📅 Registered', value: `<t:${Math.floor(new Date(user.created).getTime() / 1000)}:R>`, inline: true },
        )
        .setFooter({ text: 'Meteor • Use /exchangecode to login' })
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch {
      return interaction.editReply({ embeds: [errorEmbed('Error', 'Failed to retrieve account information.')] });
    }
  },
};
