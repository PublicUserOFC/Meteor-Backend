import { User } from '../models/User';
import AntiCheat from '../models/AntiCheat';
import { getDiscordClient } from '../discord/bot';
import { config } from '../config';
import { backend, error as logError } from './logger';

export interface BanOptions {
    accountId: string;
    reason: string;
    source: 'anticheat' | 'staff' | 'gameserver';
    details?: string;
    permanent?: boolean;
}

export async function banPlayer(opts: BanOptions): Promise<{ success: boolean; message: string }> {
    const { accountId, reason, source, details = '', permanent = true } = opts;

    const user = await User.findOne({ accountId });
    if (!user) return { success: false, message: 'User not found' };

    user.banned = true;
    user.banReason = reason;
    if (!permanent) user.bannedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.save();

    let ac = await AntiCheat.findOne({ accountId });
    if (!ac) ac = new AntiCheat({ accountId });
    ac.banned = true;
    ac.flagCount += 1;
    ac.lastDetection = new Date();
    ac.detectionLogs.push({ reason, details, timestamp: new Date() });
    if (ac.detectionLogs.length > 50) ac.detectionLogs = ac.detectionLogs.slice(-50);
    await ac.save();

    backend(`[AntiCheat] Banned ${user.username} (${accountId}) | Source: ${source} | Reason: ${reason}`);

    if (user.discordId) {
        try {
            const client = getDiscordClient();
            if (client) {
                const dmUser = await client.users.fetch(user.discordId).catch(() => null);
                if (dmUser) {
                    await dmUser.send(
                        `**You have been banned from Meteor.**\n\n` +
                        `**Reason:** ${reason}\n` +
                        `**Source:** ${source}\n\n` +
                        `If you believe this is a mistake, please appeal in our Discord server.`
                    ).catch(() => {});
                }
            }
        } catch {}
    }

    if (config.anticheat?.webhookUrl) {
        try {
            const { default: axios } = await import('axios');
            await axios.post(config.anticheat.webhookUrl, {
                embeds: [{
                    title: 'ðŸ”¨ Player Banned',
                    color: 0xff0000,
                    fields: [
                        { name: 'Player', value: `${user.username} (${accountId})`, inline: true },
                        { name: 'Source', value: source, inline: true },
                        { name: 'Reason', value: reason, inline: false },
                        { name: 'Details', value: details || 'N/A', inline: false },
                    ],
                    timestamp: new Date().toISOString(),
                }]
            });
        } catch {}
    }

    return { success: true, message: `${user.username} has been banned` };
}

export async function checkStatAnomalies(accountId: string, matchStats: {
    kills: number;
    won: boolean;
    durationMinutes: number;
}): Promise<void> {
    const { kills, won, durationMinutes } = matchStats;

    const reasons: string[] = [];

    if (kills > 30) reasons.push(`Suspicious kill count: ${kills} kills in one match`);
    if (won && durationMinutes < 10) reasons.push(`Suspicious win speed: won in ${durationMinutes} minutes`);

    if (reasons.length === 0) return;

    let ac = await AntiCheat.findOne({ accountId });
    if (!ac) ac = new AntiCheat({ accountId });

    for (const reason of reasons) {
        ac.flagCount += 1;
        ac.lastDetection = new Date();
        ac.detectionLogs.push({ reason, details: JSON.stringify(matchStats), timestamp: new Date() });
        backend(`[AntiCheat] Flag #${ac.flagCount} on ${accountId}: ${reason}`);
    }

    if (ac.detectionLogs.length > 50) ac.detectionLogs = ac.detectionLogs.slice(-50);
    await ac.save();

    if (ac.flagCount >= 3) {
        await banPlayer({
            accountId,
            reason: `Auto-ban: ${reasons[0]}`,
            source: 'anticheat',
            details: `Flag count reached ${ac.flagCount}. Stats: ${JSON.stringify(matchStats)}`,
        });
    }
}
