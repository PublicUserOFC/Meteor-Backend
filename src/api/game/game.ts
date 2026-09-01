import express, { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { verifyToken } from '../../middleware/auth';
import { AuthRequest } from '../../types';
import { config } from '../../config';
import * as functions from '../../core/utils';
import qs from 'qs';
import * as error from '../../core/errors';
import { getReadyServer } from '../../core/serverRegistry';

const router: Router = express.Router();
const DATA = path.join(__dirname, '..', '..', '..', 'Base');
const buildUniqueId: { [accountId: string]: string } = {};

function resolveServer(playlist: string | null) {
  if (!playlist) return null;
  const reg = getReadyServer(playlist);
  if (reg) return { ip: reg.ip, port: reg.port, playlist: reg.playlist };
  const fb = config.matchmaking.gameServerIPs.find((s: string) => {
    const raw = s.split(':')[2]?.toLowerCase();
    if (!raw) return false;
    return raw === playlist.toLowerCase() || functions.PlaylistNames(raw).toLowerCase() === playlist.toLowerCase();
  });
  if (fb) { const p = fb.split(':'); return { ip: p[0], port: parseInt(p[1]), playlist: p[2] }; }
  return null;
}

router.get('/api/v1/events/Fortnite/download/:accountId', async (req: Request, res: Response) => {
  const f = path.join(DATA, 'responses', 'eventlistactive.json');
  let eventData: any;

  try {
    eventData = JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {
    eventData = { player: { gameId: 'Fortnite', accountId: req.params.accountId, tokens: [], teams: {}, pendingPayouts: [], pendingPenalties: {}, persistentScores: {}, events: [] }, events: [], templates: [] };
  }

  try {
    const { Arena } = await import('../../models/Stats');
    const arenaData = await Arena.findOne({ accountId: req.params.accountId }).lean();
    const hype = arenaData ? (arenaData as any).hype || 0 : 0;
    const division = arenaData ? (arenaData as any).division || 0 : 0;

    const divisionToken = `ARENA_S24_Division${division + 1}`;

    eventData.player = {
      ...eventData.player,
      accountId: req.params.accountId,
      gameId: 'Fortnite',
      persistentScores: { Hype: hype },
      tokens: [divisionToken],
      teams: {},
      pendingPayouts: [],
      pendingPenalties: {},
      events: [],
    };
  } catch {}

  res.json(eventData);
});

router.post('/egs/api/v1/platform/*/ownership', verifyToken, (_req: AuthRequest, res: Response) => res.json({ namespace: 'fn', itemId: 'fortnite', owned: true }));
router.get('/egs/api/v1/platform/*/ownership/:itemId', verifyToken, (req: AuthRequest, res: Response) => res.json({ namespace: 'fn', itemId: req.params.itemId, owned: true }));
router.post('/egs/api/v1/ecom/*/ownership', verifyToken, (_req: AuthRequest, res: Response) => res.json([]));
router.get('/egs/api/v1/ecom/*/ownership/:itemId', verifyToken, (req: AuthRequest, res: Response) => res.json({ namespace: 'fn', itemId: req.params.itemId, owned: true }));
router.get('/egs/api/v1/entitlements', verifyToken, (_req: AuthRequest, res: Response) => res.json([]));
router.post('/egs/api/v1/entitlements/query', verifyToken, (_req: AuthRequest, res: Response) => res.json([]));
router.get('/egs/api/v1/catalog/offers', (_req: Request, res: Response) => res.json([]));
router.get('/egs/api/v1/catalog/items', (_req: Request, res: Response) => res.json([]));
router.get('/egs/api/v1/sanctions/account/:accountId', verifyToken, (req: AuthRequest, res: Response) => res.json({ accountId: req.params.accountId, sanctions: [] }));
router.get('/egs/api/v1/player/sanctions', verifyToken, (_req: AuthRequest, res: Response) => res.json([]));
router.get('/fortnite/api/game/v2/world/info', (_req: Request, res: Response) => {
  try {
    const worldinfo = JSON.parse(fs.readFileSync(path.join(DATA, 'worldinfo.json'), 'utf-8'));
    res.json(worldinfo);
  } catch { res.json({}); }
});

router.get('/fortnite/api/game/v2/twitch/:accountId', verifyToken, (_req: AuthRequest, res: Response) => res.status(204).end());
router.post('/fortnite/api/game/v2/chat/:accountId/:platform/recommendGeneralChatRooms', verifyToken, (_req: AuthRequest, res: Response) => res.json({}));

router.get('/fortnite/api/matchmaking/session/findPlayer/*', (_req, res) => res.status(200).end());

router.get('/fortnite/api/game/v2/matchmakingservice/ticket/player/*', verifyToken, async (req, res) => {
  if (!req.user) return res.status(401).end();
  if (req.user.isServer === true) return res.status(403).end();
  if (req.user.matchmakingId == null) return res.status(400).end();
  const playerCustomKey = qs.parse(req.url.split('?')[1], { ignoreQueryPrefix: true })['player.option.customKey'];
  const bucketId = qs.parse(req.url.split('?')[1], { ignoreQueryPrefix: true })['bucketId'];
  if (typeof bucketId !== 'string' || bucketId.split(':').length !== 4) return res.status(400).end();
  const playlist = functions.PlaylistNames(bucketId.split(':')[3]).toLowerCase();
  const server = resolveServer(playlist);
  if (!server) { return error.createError('errors.com.epicgames.common.matchmaking.playlist.not_found', `No server available for playlist ${playlist}`, [], 1013, 'invalid_playlist', 404, res); }
  await global.kv.set(`playerPlaylist:${req.user.accountId}`, playlist);
  if (typeof playerCustomKey === 'string') {
    const MMCode = (await import('../../models/MMCode')).default;
    const codeDocument = await MMCode.findOne({ code_lower: playerCustomKey?.toLowerCase() });
    if (!codeDocument) return error.createError('errors.com.epicgames.common.matchmaking.code.not_found', `The matchmaking code "${playerCustomKey}" was not found`, [], 1013, 'invalid_code', 404, res);
    await global.kv.set(`playerCustomKey:${req.user.accountId}`, JSON.stringify({ ip: codeDocument.ip, port: codeDocument.port, playlist }));
  }
  if (typeof req.query.bucketId !== 'string' || (req.query.bucketId as string).split(':').length !== 4) return res.status(400).end();
  buildUniqueId[req.user.accountId] = (req.query.bucketId as string).split(':')[0];
  const mm = config.matchmaking.matchmakerIP;
  return res.json({ serviceUrl: mm.includes('ws') ? mm : `ws://${mm}`, ticketType: 'mms-player', payload: `${req.user.matchmakingId}`, signature: 'account' });
});

router.get('/fortnite/api/game/v2/matchmaking/account/:accountId/session/:sessionId', (req, res) => res.json({ accountId: req.params.accountId, sessionId: req.params.sessionId, key: 'none' }));

router.get('/fortnite/api/matchmaking/session/:sessionId', verifyToken, async (req, res) => {
  if (!req.user) return res.status(401).end();
  const playlist = await global.kv.get(`playerPlaylist:${req.user.accountId}`);
  const region = ((req.query.region as string) || 'EU').toUpperCase();
  let kvDocument = await global.kv.get(`playerCustomKey:${req.user.accountId}`);
  if (!kvDocument) {
    const server = resolveServer(playlist);
    if (server) {
      kvDocument = JSON.stringify(server);
    } else {
      const regionServer = (config.matchmaking.regions as any)[region] || config.matchmaking.regions.EU;
      const [rIp, rPort] = regionServer.split(':');
      kvDocument = JSON.stringify({ ip: rIp, port: parseInt(rPort), playlist: playlist || 'playlist_defaultsolo' });
    }
  }
  const s = JSON.parse(kvDocument);
  res.json({ id: req.params.sessionId, ownerId: functions.MakeID().replace(/-/ig, '').toUpperCase(), ownerName: '[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968', serverName: '[DS]fortnite-liveeugcec1c2e30ubrcore0a-z8hj-1968', serverAddress: s.ip, serverPort: s.port, maxPublicPlayers: 220, openPublicPlayers: 175, maxPrivatePlayers: 0, openPrivatePlayers: 0, attributes: { REGION_s: 'EU', GAMEMODE_s: 'FORTATHENA', ALLOWBROADCASTING_b: true, SUBREGION_s: 'GB', DCID_s: 'FORTNITE-LIVEEUGCEC1C2E30UBRCORE0A-14840880', tenant_s: 'Fortnite', MATCHMAKINGPOOL_s: 'Any', STORMSHIELDDEFENSETYPE_i: 0, HOTFIXVERSION_i: 0, PLAYLISTNAME_s: s.playlist, SESSIONKEY_s: functions.MakeID().replace(/-/ig, '').toUpperCase(), TENANT_s: 'Fortnite', BEACONPORT_i: 15009 }, publicPlayers: [], privatePlayers: [], totalPlayers: 45, allowJoinInProgress: false, shouldAdvertise: false, isDedicated: false, usesStats: false, allowInvites: false, usesPresence: false, allowJoinViaPresence: true, allowJoinViaPresenceFriendsOnly: false, buildUniqueId: buildUniqueId[req.user.accountId] || '0', lastUpdated: new Date().toISOString(), started: false });
});

router.post('/fortnite/api/matchmaking/session/*/join', (_req, res) => res.status(204).end());
router.post('/fortnite/api/matchmaking/session/matchMakingRequest', (_req, res) => res.json([]));

router.get('/fortnite/api/entitlementCheck', (_req, res) => res.status(204).end());

router.post('/fortnite/api/storeaccess/v1/request_access/:accountId', (_req: Request, res: Response) => res.status(204).end());

router.get('/fortnite/api/game/v2/clientfeaturekeys/:accountId', (_req: Request, res: Response) => {
  res.status(400).json({ errorCode: 'errors.com.epicgames.fortnite.invalid_featurekey_request', errorMessage: 'Account access tier does not include any client feature keys', messageVars: [], numericErrorCode: -1, originatingService: 'fortnite', intent: 'prod-live' });
});

router.get('/fortnite/api/game/v2/accolades/:islandCode/:islandVersion', (_req: Request, res: Response) => {
  res.json({ accolades: [] });
});

router.get('/api/inventory/v3/:deploymentId/players/:productUserId/*', (req: Request, res: Response) => {
  const inventoryName = '/' + (req.params[0] || 'br');
  res.json({ binary: null, inventory: { playerId: req.params.productUserId, inventoryName, prefix: '/', instance: '00000000-0000-0000-0000-000000000000', contents: {} }, continuationToken: null });
});

router.get('/fortnite/api/game/v2/friendcodes/:accountId/:codeType', (_req: Request, res: Response) => {
  res.json([]);
});

router.get('/fortnite/api/game/v2/homebase/allowed-name-chars', (_req: Request, res: Response) => {
  res.json({ ranges: [48,57,65,90,97,122,192,255,260,265,280,281,286,287,304,305,321,324,346,347,350,351,377,380,1024,1279,1536,1791,4352,4607,11904,12031,12288,12351,12352,12543,12592,12687,12800,13055,13056,13311,13312,19903,19968,40959,43360,43391,44032,55215,55216,55295,63744,64255,65072,65103,65281,65470,131072,173791,194560,195103], singlePoints: [32,39,45,46,95,126], excludedPoints: [208,215,222,247] });
});

router.post('/fortnite/api/game/v2/world/validate', (req: Request, res: Response) => {
  res.json(req.body || {});
});

export default router;
