import express, { Request, Response, Router } from 'express';
import { banPlayer } from '../../core/ban';
import AntiCheat from '../../models/AntiCheat';
import { User } from '../../models/User';
import { config } from '../../config';

const router: Router = express.Router();

function requireApiKey(req: Request, res: Response): boolean {
    const key = req.headers['x-api-key'] || req.query.apiKey;
    if (key !== config.api.apiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

router.post('/anticheat/report', async (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;

    const { accountId, reason, details } = req.body;
    if (!accountId || !reason) return res.status(400).json({ error: 'accountId and reason required' });

    const result = await banPlayer({ accountId, reason, source: 'gameserver', details });
    res.json(result);
});

router.get('/anticheat/info/:accountId', async (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;

    const ac = await AntiCheat.findOne({ accountId: req.params.accountId }).lean();
    const user = await User.findOne({ accountId: req.params.accountId }).lean();

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
        accountId: req.params.accountId,
        username: user.username,
        status: ac?.banned ? 'Banned' : 'Clean',
        flagCount: ac?.flagCount || 0,
        lastDetection: ac?.lastDetection || null,
        recentLogs: (ac?.detectionLogs || []).slice(-3).reverse(),
    });
});

export default router;
