import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import { BotCommand } from './types';
const _noPerms = () => new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Access Denied').setDescription('You do not have permission to use this command.').setTimestamp().setFooter({ text: 'Meteor' });
const _notFound = (w: string) => new EmbedBuilder().setColor(0xe74c3c).setTitle(`❌ ${w} Not Found`).setDescription(`The requested ${w.toLowerCase()} could not be found.`).setTimestamp().setFooter({ text: 'Meteor' });
import { config } from '../../config';
import { User } from '../../models/User';
import { Profile } from '../../models/Profile';
import { MakeID } from '../../core/utils';

const err = (t: string, d?: string) => new EmbedBuilder().setColor(0xe74c3c).setTitle(`❌ ${t}`).setDescription(d ?? null).setTimestamp().setFooter({ text: 'Meteor' });

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('givevbucks')
    .setDescription('Give V-Bucks to a player (staff only)')
    .addStringOption(o => o.setName('username').setDescription('Username').setRequired(true))
    .addIntegerOption(o =>
      o.setName('amount').setDescription('Amount of V-Bucks (1–100000)').setRequired(true).setMinValue(1).setMaxValue(100000)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!config.moderators.includes(interaction.user.id)) {
      return interaction.editReply({ embeds: [_noPerms()] });
    }

    const username = interaction.options.getString('username', true);
    const amount = interaction.options.getInteger('amount', true);

    const user = await User.findOne({ username_lower: username.toLowerCase() }).lean();
    if (!user) return interaction.editReply({ embeds: [_notFound('User')] });

    const profiles = await Profile.findOne({ accountId: user.accountId });
    if (!profiles) return interaction.editReply({ embeds: [err('Profile Not Found', `No profile found for \`${username}\`.`)] });

    const commonCore = profiles.profiles['common_core'];
    if (!commonCore) return interaction.editReply({ embeds: [err('Profile Error', 'common_core profile not found.')] });

    let mtxItemId = Object.keys(commonCore.items || {}).find(
      (k: string) => commonCore.items[k]?.templateId?.toLowerCase().startsWith('currency:mtx')
    );

    const previousBalance = mtxItemId ? (commonCore.items[mtxItemId].quantity ?? 0) : 0;

    if (mtxItemId) {
      commonCore.items[mtxItemId].quantity += amount;
    } else {
      mtxItemId = MakeID();
      if (!commonCore.items) commonCore.items = {};
      commonCore.items[mtxItemId] = { templateId: 'Currency:MtxPurchased', attributes: { platform: 'EpicPC' }, quantity: amount };
    }

    const newBalance = commonCore.items[mtxItemId!].quantity;
    commonCore.rvn += 1;
    commonCore.commandRevision += 1;
    await profiles.updateOne({ $set: { 'profiles.common_core': commonCore } });

    const embed = new EmbedBuilder()
      .setColor(0x00d4ff)
      .setTitle('🎮 V-Bucks Given')
      .setDescription(`Gave **${amount.toLocaleString()} V-Bucks** to **${user.username}**.`)
      .addFields(
        { name: '👤 Player', value: `\`${user.username}\``, inline: true },
        { name: '💰 Given', value: `**+${amount.toLocaleString()}**`, inline: true },
        { name: '💳 New Balance', value: `**${newBalance.toLocaleString()}**`, inline: true },
        { name: '📊 Previous', value: `${previousBalance.toLocaleString()}`, inline: true },
        { name: '🛡️ Given By', value: `<@${interaction.user.id}>`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: 'Meteor' });

    return interaction.editReply({ embeds: [embed] });
  },
};
