import express from 'express';
import Profile from '../../models/Profile';
import User from '../../models/User';
import { verifyToken } from '../../middleware/auth';
import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';
import { config } from '../../config';

const router = express.Router();

router.get('/affiliate/api/public/affiliates/slug/:slug', async (req, res) => {
  const lccode = req.params.slug.toLowerCase();
  const SACCode = (await import('../../models/SACCode')).default;
  const code = await SACCode.findOne({ code_lower: lccode });
  if (!code) return res.status(404).json({});
  res.json({ id: code.code, slug: code.code, displayName: code.code, code_higher: code.code_higher, status: 'ACTIVE', verified: false });
});

router.post('/fortnite/api/game/v2/profile/*/client/SetAffiliateName', verifyToken, async (req, res) => {
  const profiles = await Profile.findOne({ accountId: req.user.accountId });
  if (!profiles) return res.status(404).json({});
  const profile = profiles.profiles[req.query.profileId as string];
  const lccode = req.body.affiliateName?.toLowerCase();
  const SACCode = (await import('../../models/SACCode')).default;
  const code = await SACCode.findOne({ code_lower: lccode });
  if (!code) return res.status(404).json({});
  profile.stats.attributes.mtx_affiliate_set_time = new Date().toISOString();
  profile.stats.attributes.mtx_affiliate = code.code;
  await User.updateOne({ accountId: req.user.accountId }, { $set: { currentSACCode: code.code } });
  profile.rvn += 1; profile.commandRevision += 1;
  const changes = [{ changeType: 'statModified', name: 'mtx_affiliate_set_time', value: profile.stats.attributes.mtx_affiliate_set_time }, { changeType: 'statModified', name: 'mtx_affiliate', value: profile.stats.attributes.mtx_affiliate }];
  await profiles.updateOne({ $set: { [`profiles.${req.query.profileId}`]: profile } });
  res.json({ profileRevision: profile.rvn || 0, profileId: req.query.profileId || 'common_core', profileChangesBaseRevision: profile.rvn - 1, profileChanges: changes, profileCommandRevision: profile.commandRevision || 0, serverTime: new Date().toISOString(), responseVersion: 1 });
});

router.post('/fortnite/api/game/v2/toxicity/account/:unsafeReporter/report/:reportedPlayer', verifyToken, async (req, res) => {
  if (!config.reports.enableReports) return res.status(200).send({ success: true });
  try {
    const reporterData = await User.findOne({ accountId: req.user.accountId }).lean();
    const reportedPlayerData = await User.findOne({ accountId: req.params.reportedPlayer }).lean();
    await Profile.findOne({ accountId: req.params.reportedPlayer }).lean();
    if (!reportedPlayerData) return res.status(404).send({ error: 'Player not found' });
    await Profile.findOneAndUpdate({ accountId: req.params.reportedPlayer }, { $inc: { 'profiles.totalReports': 1 } }, { new: true, upsert: true });
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
    await new Promise((resolve, reject) => {
      client.once('ready', async () => {
        try {
          const embed = new EmbedBuilder().setTitle('New User Report').setColor(0xFFA500).addFields([{ name: 'Reporter', value: reporterData?.username || 'Unknown', inline: true }, { name: 'Reported', value: reportedPlayerData?.username || 'Unknown', inline: true }, { name: 'Reason', value: req.body.reason || 'N/A', inline: false }]);
          const channel = await client.channels.fetch(config.reports.reportChannelId);
          if (channel instanceof TextChannel) await channel.send({ embeds: [embed] });
          resolve(undefined);
        } catch (e) { reject(e); }
      });
      client.login(config.discord.botToken).catch(reject);
    });
    return res.status(200).send({ success: true });
  } catch (e) { return res.status(500).send({ error: 'Internal server error' }); }
});

export default router;
