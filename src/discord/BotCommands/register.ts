import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, EmbedBuilder } from 'discord.js';
import crypto from 'crypto';
import { BotCommand } from './types';
import { registerUser } from '../../core/users';
import { User } from '../../models/User';

export const command: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('register')
    .setDescription('Creates an account on Meteor.')
    .addStringOption(o =>
      o.setName('username')
        .setDescription('Your username.')
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(20)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const username = interaction.options.getString('username', true);
    const discordId = interaction.user.id;
    const email = `${interaction.user.username}@gmail.com`.toLowerCase();
    const password = crypto.randomBytes(6).toString('hex');

    if (username.length < 3) {
      return interaction.editReply({ content: 'Your username must be at least 3 characters long.' });
    }
    if (username.length > 20) {
      return interaction.editReply({ content: 'Your username must be 20 characters or less.' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return interaction.editReply({ content: 'Username can only contain letters, numbers, and underscores.' });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return interaction.editReply({ content: 'An account with your Discord username already exists!' });
    }

    const existingUser = await User.findOne({ username_lower: username.toLowerCase() });
    if (existingUser) {
      return interaction.editReply({ content: 'Username already exists. Please choose a different one.' });
    }

    const result = await registerUser(discordId, username, email, password);
    const isError = result.status >= 400;

    const embed = new EmbedBuilder()
      .setColor(isError ? 0xff0000 : 0x56ff00)
      .addFields(
        { name: 'Username', value: username, inline: true },
        { name: 'Email', value: email, inline: true },
        { name: 'Password', value: isError ? 'N/A' : `||${password}||`, inline: true },
      )
      .setTimestamp()
      .setFooter({ text: 'Meteor' });

    if (isError) {
      return interaction.editReply({ embeds: [embed] });
    }

    let dmSent = true;
    await interaction.user.send({
      content: `Hello ${interaction.user.username}, here are your account details for Meteor:`,
      embeds: [embed],
    }).catch(() => { dmSent = false; });

    const replyContent = dmSent
      ? 'Account created successfully! I have also sent your details to your DMs.'
      : "Account created successfully! (⚠️ Note: I couldn't DM you, please make sure your DMs are open next time)";

    return interaction.editReply({ content: replyContent });
  },
};
