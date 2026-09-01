import express from 'express';
import User from '../../models/User';
import { verifyToken } from '../../middleware/auth';
import * as functions from '../../core/utils';
import { debug, error as logError } from '../../core/logger';

const router = express.Router();

router.get('/*/api/statsv2/leaderboards/:leaderboardName', async (req, res) => {
    
    try {
        let entries: any[] = [];
        let maxSize = 100;

        if (req.query.maxSize) {
            const size = Number(req.query.maxSize);
            if (size <= 150 && size > 0) {
                maxSize = size;
            } else {
                return res.json({
                    error: 'minSize: 1 / maxSize: 100'
                });
            }
        }

        if (req.params.leaderboardName.toLowerCase().includes('hype') || req.params.leaderboardName.toLowerCase().includes('reloadpoints')) {
            const Arena = (await import('../../models/Stats')).default;
            const arenaStats = await Arena.find({}).sort({ hype: -1 }).limit(maxSize);
            
            for (const stat of arenaStats) {
                const findUser = await User.findOne({ accountId: stat.accountId });
                if (!findUser) continue;

                entries.push({
                    displayName: findUser.username,
                    account: findUser.accountId,
                    value: stat.hype
                });
            }
        } else {
            let playlist = '';
            let typeStat = '';
            
            if (req.params.leaderboardName.includes('playlist_')) {
                playlist = req.params.leaderboardName.split('playlist_')[1];
                if (req.params.leaderboardName.includes('br_')) {
                    const parts = req.params.leaderboardName.split('_keyboardmouse')[0].split('br_');
                    if (parts.length > 1) typeStat = parts[1];
                }
            } else {
                playlist = req.params.leaderboardName.split('playlist_default')[1];
                if (req.params.leaderboardName.includes('br_')) {
                    typeStat = req.params.leaderboardName.split('_keyboardmouse')[0].split('br_')[1];
                }
            }
            
            if (!playlist || !typeStat) {
                return res.json({ maxSize: maxSize, entries: [] });
            }

            const UserStats = (await import('../../models/Stats')).default;
            const stats = await UserStats.find({});
            if (!stats) return res.status(404).end();

            for (const stat of stats) {
                const findUser = await User.findOne({ accountId: stat.accountId });
                if (!findUser) continue;
                
                let statValue = 0;
                if (stat[playlist] && stat[playlist][typeStat] !== undefined) {
                    statValue = stat[playlist][typeStat];
                } else if (stat['solo'] && stat['solo'][typeStat] !== undefined) {
                    statValue = stat['solo'][typeStat];
                }

                entries.push({
                    displayName: findUser.username,
                    account: findUser.accountId,
                    value: statValue
                });
            }
            
            entries.sort((a, b) => b.value - a.value);
            if (entries.length > maxSize) {
                entries = entries.slice(0, maxSize);
            }
        }

        res.json({
            maxSize: maxSize,
            entries: entries
        });
    } catch (err: any) {
        logError(`Leaderboard Error: ${err}`);
        res.json({
            error: 'stat not found'
        });
    }
});

router.post('/fortnite/api/leaderboards/type/global/stat/:leaderboardName/window/:typeLeaderboard', async (req, res) => {
    
    const playlist = functions.PlaylistNames(req.params.leaderboardName.split('m0_p')[1]).toLowerCase().replace('playlist_default', '');
    const typeStat = req.params.leaderboardName.split('_pc')[0].split('br_')[1];
    
    const UserStats = (await import('../../models/Stats')).default;
    const stats = await UserStats.find({});
    if (!stats) return res.status(404).end();
    
    const entries: any[] = [];

    for (const stat of stats) {
        const user = await User.findOne({ accountId: stat.accountId });
        if (!user) continue;

        entries.push({
            accountId: user.accountId,
            displayName: user.username,
            rank: 1,
            value: stat[playlist][typeStat] || 0
        });
    }

    entries.sort((a, b) => b.value - a.value);
    entries.forEach((entry, index) => entry.rank = index + 1);

    res.json({
        statName: req.params.leaderboardName,
        statWindow: req.params.typeLeaderboard,
        entries: entries
    });
});

router.post('/*/api/statsv2/query', verifyToken, async (req, res) => {
    
    if (!req.body.stats) return res.status(400).end();
    
    const statKey = req.body.stats[0];
    const playlist = statKey.split('playlist_default')[1];
    const typeStat = statKey.split('_keyboardmouse')[0].split('br_')[1];
    
    const UserStats = (await import('../../models/Stats')).default;
    const stats = await UserStats.find({});
    if (!stats) return res.status(404).end();
    
    const clientsStats: any[] = [];

    for (const owner of req.body.owners) {
        const individualStat = await UserStats.findOne({ accountId: owner });
        if (!individualStat) continue;
        if (individualStat[playlist] === undefined) continue;
        if (individualStat[playlist][typeStat] === undefined) continue;

        clientsStats.push({
            accountId: individualStat.accountId,
            endTime: req.body.endTime || 0,
            startTime: req.body.startTime || 0,
            stats: {
                [statKey]: individualStat[playlist][typeStat] || 0
            }
        });
    }

    res.json(clientsStats);
});

router.get('/fortnite/api/game/v2/leaderboards/cohort/:accountId', verifyToken, async (req, res) => {
    res.json({});
});

router.get('/api/v1/events/Fortnite/:eventId/history/:accountId', verifyToken, async (req, res) => {
    res.json({
        gameId: 'Fortnite',
        eventId: req.params.eventId,
        accountId: req.params.accountId,
        history: []
    });
});

router.get('/fortnite/api/stats/accountId/:accountId/bulk/window/:windowType', verifyToken, async (req, res) => {
    const UserStats = (await import('../../models/Stats')).default;
    const stats = await UserStats.findOne({ accountId: req.params.accountId });
    if (!stats) return res.json([]);

    const allStats = ['solo', 'duo', 'squad'];
    const statsList: any[] = [];
    const allTypesStats: any = {
        all: ['br_kills', 'br_score', 'br_matchesplayed', 'br_minutesplayed'],
        solo: ['br_placetop1', 'br_placetop10', 'br_placetop25'],
        duo: ['br_placetop1', 'br_placetop5', 'br_placetop12'],
        squad: ['br_placetop1', 'br_placetop3', 'br_placetop6']
    };

    for (const stat of allStats) {
        for (const typeStat of allTypesStats.all) {
            statsList.push({
                name: `${typeStat}_pc_m0_p${functions.PlaylistNames(stat)}`,
                value: stats[stat][typeStat.replace('br_', '')] || 0,
                window: req.params.windowType,
                ownerType: 1
            });
        }

        for (const typeStats of allTypesStats[stat]) {
            statsList.push({
                name: `${typeStats}_pc_m0_p${functions.PlaylistNames(stat)}`,
                value: stats[stat][typeStats.replace('br_', '')] || 0,
                window: req.params.windowType,
                ownerType: 1
            });
        }
    }

    res.json(statsList);
});

router.get('/*/api/statsv2/account/:accountId', verifyToken, async (req, res) => {
    const UserStats = (await import('../../models/Stats')).default;
    const stats = await UserStats.findOne({ accountId: req.params.accountId });

    if (!stats) return res.json({
        accountId: req.params.accountId,
        endTime: 0,
        startTime: req.query.startTime || 0,
        stats: {}
    });

    res.json({
        accountId: req.params.accountId,
        endTime: 0,
        startTime: req.query.startTime || 0,
        stats: {
            br_placetop1_keyboardmouse_m0_playlist_defaultsolo: stats.solo.placetop1 || 0,
            br_placetop1_keyboardmouse_m0_playlist_defaultduo: stats.duo.placetop1 || 0,
            br_placetop1_keyboardmouse_m0_playlist_defaultsquad: stats.squad.placetop1 || 0,
            br_placetop1_keyboardmouse_m0_playlist_solidgold_solo: stats.ltm.wins || 0,
            br_placetop10_keyboardmouse_m0_playlist_defaultsolo: stats.solo.placetop10 || 0,
            br_placetop5_keyboardmouse_m0_playlist_defaultduo: stats.duo.placetop5 || 0,
            br_placetop3_keyboardmouse_m0_playlist_defaultsquad: stats.squad.placetop3 || 0,
            br_placetop25_keyboardmouse_m0_playlist_defaultsolo: stats.solo.placetop25 || 0,
            br_placetop12_keyboardmouse_m0_playlist_defaultduo: stats.duo.placetop12 || 0,
            br_placetop6_keyboardmouse_m0_playlist_defaultsquad: stats.squad.placetop6 || 0,
            br_kills_keyboardmouse_m0_playlist_defaultsolo: stats.solo.kills || 0,
            br_kills_keyboardmouse_m0_playlist_defaultduo: stats.duo.kills || 0,
            br_kills_keyboardmouse_m0_playlist_defaultsquad: stats.squad.kills || 0,
            br_kills_keyboardmouse_m0_playlist_solidgold_solo: stats.ltm.kills || 0,
            br_matchesplayed_keyboardmouse_m0_playlist_defaultsolo: stats.solo.matchesplayed || 0,
            br_matchesplayed_keyboardmouse_m0_playlist_defaultduo: stats.duo.matchesplayed || 0,
            br_matchesplayed_keyboardmouse_m0_playlist_defaultsquad: stats.squad.matchesplayed || 0,
            br_matchesplayed_keyboardmouse_m0_playlist_solidgold_solo: stats.ltm.matchesplayed || 0,
            br_minutesplayed_keyboardmouse_m0_playlist_defaultsolo: stats.solo.minutesplayed || 0,
            br_minutesplayed_keyboardmouse_m0_playlist_defaultduo: stats.duo.minutesplayed || 0,
            br_minutesplayed_keyboardmouse_m0_playlist_defaultsquad: stats.squad.minutesplayed || 0,
            br_minutesplayed_keyboardmouse_m0_playlist_solidgold_solo: stats.ltm.minutesplayed || 0,
            br_playersoutlived_keyboardmouse_m0_playlist_defaultsolo: stats.solo.playersoutlived || 0,
            br_playersoutlived_keyboardmouse_m0_playlist_defaultduo: stats.duo.playersoutlived || 0,
            br_playersoutlived_keyboardmouse_m0_playlist_defaultsquad: stats.squad.playersoutlived || 0,
            br_playersoutlived_keyboardmouse_m0_playlist_solidgold_solo: stats.ltm.playersoutlived || 0,
            br_score_keyboardmouse_m0_playlist_defaultsolo: stats.solo.score || 0,
            br_score_keyboardmouse_m0_playlist_defaultduo: stats.duo.score || 0,
            br_score_keyboardmouse_m0_playlist_defaultsquad: stats.squad.score || 0,
            br_score_keyboardmouse_m0_playlist_solidgold_solo: stats.ltm.score || 0
        }
    });
});

export default router;
