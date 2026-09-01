import express, { Request, Response, Router } from 'express';
import { registerServer, heartbeat, setReady, unregisterServer, getAllServers } from '../../core/serverRegistry';
import { config } from '../../config';
import { backend } from '../../core/logger';

const router: Router = express.Router();

function requireApiKey(req: Request, res: Response): boolean {
    const key = req.headers['x-api-key'];
    if (key !== config.api.apiKey) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

// Called directly by Reboot Ultimate when bStartedListening = true
// Registers the server if not already known, then marks it ready
router.post('/gameserver/notify', (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;

    const { ip, port, playlist = 'playlist_defaultsolo', region = 'EU', maxPlayers = 100 } = req.body;
    if (!ip || !port) return res.status(400).json({ error: 'ip and port required' });

    const portNum = parseInt(port);
    const key = `${ip}:${portNum}`;
    const existing = getAllServers().find(s => s.ip === ip && s.port === portNum);

    if (!existing) {
        registerServer({
            ip,
            port: portNum,
            playlist,
            region,
            playerCount: 0,
            maxPlayers: parseInt(maxPlayers),
            ready: true,
            sessionId: require('crypto').randomUUID().replace(/-/g, '').toUpperCase(),
        });
        backend(`[GS] Reboot Ultimate registered and ready: ${key} | ${playlist}`);
    } else {
        setReady(ip, portNum, true);
        backend(`[GS] Reboot Ultimate notified ready: ${key}`);
    }

    res.json({ success: true, key });
});

router.post('/gameserver/register', (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;

    const { ip, port, playlist, region = 'EU', maxPlayers = 100 } = req.body;
    if (!ip || !port || !playlist) return res.status(400).json({ error: 'ip, port, and playlist are required' });

    const key = registerServer({
        ip,
        port: parseInt(port),
        playlist,
        region,
        playerCount: 0,
        maxPlayers: parseInt(maxPlayers),
        ready: false,
        sessionId: require('crypto').randomUUID().replace(/-/g, '').toUpperCase(),
    });
    res.json({ success: true, key });
});

router.post('/gameserver/ready', (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;

    const { ip, port } = req.body;
    if (!ip || !port) return res.status(400).json({ error: 'ip and port required' });

    const ok = setReady(ip, parseInt(port), true);
    if (!ok) return res.status(404).json({ error: 'Server not found - register first' });

    res.json({ success: true });
});

router.post('/gameserver/heartbeat', (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;

    const { ip, port, playerCount } = req.body;
    if (!ip || !port) return res.status(400).json({ error: 'ip and port required' });

    // Auto-register if not known (handles restart without re-notify)
    const existing = getAllServers().find(s => s.ip === ip && s.port === parseInt(port));
    if (!existing) {
        registerServer({
            ip,
            port: parseInt(port),
            playlist: 'playlist_defaultsolo',
            region: 'EU',
            playerCount: playerCount ?? 0,
            maxPlayers: 100,
            ready: true,
            sessionId: require('crypto').randomUUID().replace(/-/g, '').toUpperCase(),
        });
        backend(`[GS] Auto-registered from heartbeat: ${ip}:${port}`);
    } else {
        heartbeat(ip, parseInt(port), playerCount);
    }

    res.json({ success: true });
});

router.post('/gameserver/unregister', (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;

    const { ip, port } = req.body;
    if (!ip || !port) return res.status(400).json({ error: 'ip and port required' });

    unregisterServer(ip, parseInt(port));
    res.json({ success: true });
});

router.get('/gameserver/list', (req: Request, res: Response) => {
    if (!requireApiKey(req, res)) return;

    const servers = getAllServers().map(s => ({
        key: `${s.ip}:${s.port}`,
        playlist: s.playlist,
        region: s.region,
        players: `${s.playerCount}/${s.maxPlayers}`,
        ready: s.ready,
        lastHeartbeat: s.lastHeartbeat,
    }));

    res.json(servers);
});

export default router;
