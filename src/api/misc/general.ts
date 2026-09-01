import express, { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';

const router: Router = express.Router();

// CDN Proxy - Proxy requests to Epic's CDN for lobby backgrounds and other assets
router.get('/cdn2-unrealengine/*', async (req: Request, res: Response) => {
  try {
    const axios = require('axios');
    const assetPath = req.params[0];
    const cdnUrl = `https://cdn2.unrealengine.com/${assetPath}`;
    console.log(`[CDN PROXY] Proxying request to: ${cdnUrl}`);
    
    const response = await axios.get(cdnUrl, {
      responseType: 'stream',
      timeout: 10000
    });
    
    // Forward the content type
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    
    // Pipe the response
    response.data.pipe(res);
  } catch (error: any) {
    console.error(`[CDN PROXY] Error proxying asset:`, error.message);
    res.status(404).send('Asset not found');
  }
});

// KWS/Supervised Settings routes - CRITICAL: These must return HTTP 200 with valid JSON
// The game calls these endpoints regardless of SDK configuration

// Main supervised settings endpoint - this is what the game actually calls
router.all('/v1/public/users/:accountId/settings', (req: Request, res: Response) => {
  console.log(`[SUPERVISED SETTINGS] ${req.method} ${req.url} - AccountId: ${req.params.accountId}`);
  res.status(200).json({
    accountId: req.params.accountId,
    settings: req.body?.settings || {},
    version: 1,
    supervised: false,
    parentalControls: {
      enabled: false
    }
  });
});

router.all('/kws/v1/*', (req: Request, res: Response) => {
  console.log(`[KWS] ${req.method} ${req.url} - Query: ${JSON.stringify(req.query)} - Body: ${JSON.stringify(req.body)}`);
  // Return valid KWS response with HTTP 200
  res.status(200).json({
    accountId: req.query?.accountId || req.params?.accountId || 'default',
    settings: req.body?.settings || {},
    version: 1,
    success: true,
    supervised: false,
    parentalControls: {
      enabled: false
    }
  });
});

router.all('*/supervisedsettings*', (req: Request, res: Response) => {
  console.log(`[SUPERVISED SETTINGS] ${req.method} ${req.url} - Query: ${JSON.stringify(req.query)} - Body: ${JSON.stringify(req.body)}`);
  res.status(200).json({
    accountId: req.params?.accountId || 'default',
    supervised: false,
    settings: {},
    version: 1,
    success: true
  });
});

// Additional KWS endpoints that might be called
router.all('/supervised-settings/v1/*', (req: Request, res: Response) => {
  console.log(`[SUPERVISED SETTINGS V1] ${req.method} ${req.url}`);
  res.status(200).json({
    accountId: req.query?.accountId || req.params?.accountId || 'default',
    supervised: false,
    settings: req.body?.settings || {},
    version: 1,
    success: true
  });
});

router.all('/api/v1/supervised-settings/*', (req: Request, res: Response) => {
  console.log(`[API SUPERVISED SETTINGS] ${req.method} ${req.url}`);
  res.status(200).json({
    accountId: req.query?.accountId || req.params?.accountId || 'default',
    supervised: false,
    settings: req.body?.settings || {},
    version: 1,
    success: true
  });
});

router.post('/datarouter/api/v1/public/data', (_req: Request, res: Response) => { res.json({ success: true }); });
router.post('/datarouter/api/v1/public/data/clients', (_req: Request, res: Response) => { res.json({ success: true }); });
router.post('/fortnite/api/game/v2/chat/*/*/*/pc', (_req: Request, res: Response) => { res.json({}); });
router.post('/fortnite/api/game/v2/tryPlayOnPlatform/account/*', (_req: Request, res: Response) => { res.setHeader('Content-Type', 'text/plain'); res.send(true); });
router.get('/launcher/api/public/distributionpoints/', (_req: Request, res: Response) => {
  res.json({ distributions: ['http://127.0.0.1:5353/', 'https://download.epicgames.com/', 'https://epicgames-download1.akamaized.net/', 'https://fastly-download.epicgames.com/'] });
});
router.get('/launcher/api/public/assets/:platform/:catalogItemId/:appName', (req: Request, res: Response) => {
  res.json({ appName: req.params.appName, labelName: `${req.query.label}-${req.params.platform}`, buildVersion: 'Meteor', catalogItemId: req.params.catalogItemId, expires: '9999-12-31T23:59:59.999Z', items: { MANIFEST: { signature: 'Meteor', distribution: 'http://127.0.0.1:5353/', path: 'Builds/Fortnite/Content/CloudDir/Meteor.manifest', additionalDistributions: [] } }, assetId: req.params.appName });
});
let manifestRequested = false;
router.get('/Builds/Fortnite/Content/CloudDir/*', async (req: Request, res: Response) => {
  try {
    const fs = require('fs'); const path = require('path');
    const reqPath = req.params[0] || '';
    const fileName = path.basename(reqPath);
    const cloudDir = path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'CloudDir');
    if (fileName.endsWith('.manifest')) {
      res.setHeader('Content-Type', 'application/octet-stream');
      const manifestFile = path.join(cloudDir, 'Meteor.manifest');
      if (!manifestRequested && fs.existsSync(manifestFile)) {
        manifestRequested = true;
        return res.send(fs.readFileSync(manifestFile));
      } else {
        manifestRequested = false;
        try {
          const axios = require('axios');
          const response = await axios.get(`https://fastly-download.epicgames.com${req.originalUrl}`, { responseType: 'stream' });
          return response.data.pipe(res);
        } catch { return res.send(fs.readFileSync(manifestFile)); }
      }
    }
    if (fileName.endsWith('.ini')) {
      const iniFile = path.join(cloudDir, 'Full.ini');
      if (fs.existsSync(iniFile)) {
        res.setHeader('Content-Type', 'application/octet-stream');
        return res.send(fs.readFileSync(iniFile));
      }
    }
    const directFile = path.join(cloudDir, fileName);
    if (fs.existsSync(directFile)) {
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(fs.readFileSync(directFile));
    }
    res.status(404).end();
  } catch { res.status(404).end(); }
});
router.get('/Builds/Fortnite/Content/CloudDir/Meteor.manifest', (_req: Request, res: Response) => {
  const fs = require('fs'); const path = require('path');
  const file = path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'CloudDir', 'Meteor.manifest');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(fs.readFileSync(file));
});
router.get('/Builds/Fortnite/Content/CloudDir/Meteor.chunk', (_req: Request, res: Response) => {
  const fs = require('fs'); const path = require('path');
  const file = path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'CloudDir', 'Meteor.chunk');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(fs.readFileSync(file));
});
router.get('/Builds/Fortnite/Content/CloudDir/Meteor.delta', (_req: Request, res: Response) => {
  const fs = require('fs'); const path = require('path');
  const file = path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'CloudDir', 'Meteor.delta');
  if (fs.existsSync(file)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(fs.readFileSync(file));
  } else {
    res.status(404).end();
  }
});
router.get('/Builds/Fortnite/Content/CloudDir/Full.ini', (_req: Request, res: Response) => {
  const fs = require('fs'); const path = require('path');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.send(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'CloudDir', 'Full.ini')));
});
router.get('/waitingroom/api/waitingroom', (_req: Request, res: Response) => { res.status(204).end(); });
router.get('/socialban/api/public/v1/*', (_req: Request, res: Response) => { res.json({ bans: [], warnings: [] }); });
router.get('/fortnite/api/statsv2/account/:accountId', (req: Request, res: Response) => { res.json({ startTime: 0, endTime: 0, stats: {}, accountId: req.params.accountId }); });
router.get('/fortnite/api/game/v2/enabled_features', (_req: Request, res: Response) => { res.json([]); });
router.post('/fortnite/api/feedback/*', (_req: Request, res: Response) => { res.status(200).end(); });
router.post('/fortnite/api/statsv2/query', (_req: Request, res: Response) => { res.json([]); });
router.get('/fortnite/api/receipts/v1/account/*/receipts', (_req: Request, res: Response) => { res.json([]); });
router.get('/region', (_req: Request, res: Response) => {
  res.json({ continent: { code: 'EU', geoname_id: 6255148, names: { en: 'Europe' } }, country: { geoname_id: 2635167, is_in_european_union: false, iso_code: 'GB', names: { en: 'United Kingdom' } } });
});
router.get('/v1/avatar/fortnite/ids', (_req: Request, res: Response) => res.json([]));
router.get('/content-controls/:accountId', (req: Request, res: Response) => res.json({ data: { ageGate: 0, controlsEnabled: false, maxEpicProfilePrivacy: 'none', principalId: req.params.accountId } }));
router.get('/content-controls/:accountId/rules/namespaces/:namespace', (_req: Request, res: Response) => res.json({ rules: [] }));
router.get('/content-controls/:accountId/settings', (req: Request, res: Response) => res.json({ data: { ageGate: 0, controlsEnabled: false, maxEpicProfilePrivacy: 'none', principalId: req.params.accountId } }));
router.post('/content-controls/:accountId/settings', (req: Request, res: Response) => res.json({ data: { ageGate: 0, controlsEnabled: false, maxEpicProfilePrivacy: 'none', principalId: req.params.accountId } }));
router.all('/content-controls/*', (_req: Request, res: Response) => res.json({ settings: [] }));
router.post('/api/v1/fortnite-br/surfaces/motd/interactions', (_req: Request, res: Response) => res.status(204).end());
router.get('/eulatracking/api/shared/agreements/fn', (_req: Request, res: Response) => res.json([]));
router.get('/eulatracking/api/public/agreements/*', (_req: Request, res: Response) => res.status(204).end());
router.put('/profiles', (_req: Request, res: Response) => res.status(204).end());
router.post('/profile/privacy_settings', (_req: Request, res: Response) => res.status(204).end());
router.put('/profile/privacy_settings', (_req: Request, res: Response) => res.status(204).end());
router.put('/profile/play_region', (_req: Request, res: Response) => res.status(204).end());
router.put('/profile/languages', (_req: Request, res: Response) => res.status(204).end());
router.patch('/friends/api/v1/:accountId/settings', (_req: Request, res: Response) => res.status(204).end());
router.post('/fortnite/api/game/v2/creative/discovery/surface/:accountId', (_req: Request, res: Response) => {
  try {
    const fs = require('fs'); const path = require('path');
    res.json(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'Discovery', 'discovery_frontend.json'), 'utf-8')));
  } catch { res.json({ Panels: [], TestCohorts: [], ModeSets: {} }); }
});
router.get('/presence/api/v1/_/:accountId/last-online', (_req: Request, res: Response) => res.json([]));
router.get('/presence/api/v1/_/:accountId/settings/subscriptions', (_req: Request, res: Response) => res.status(204).end());
// NOTE: do NOT add a wildcard presence catch-all here — specific handlers in social/index.ts must take priority
router.get('/api/v2/interactions/latest/Fortnite/:accountId', (_req: Request, res: Response) => res.json({ interactions: [] }));
router.get('/api/v2/interactions/aggregated/Fortnite/:accountId', (_req: Request, res: Response) => res.json({ interactions: [] }));
router.post('/api/v1/assets/Fortnite/*', (_req: Request, res: Response) => {
  try {
    const fs = require('fs'); const path = require('path');
    res.json(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'Discovery', 'discovery_api_assets.json'), 'utf-8')));
  } catch { res.json({ assets: [] }); }
});
router.get('/api/content/v2/launch-data', (_req: Request, res: Response) => res.json({}));
router.get('/fortnite/api/game/v2/br-inventory/account/:accountId', (_req: Request, res: Response) => res.json({ stash: { globalcash: 0 } }));
router.get('/statsproxy/api/statsv2/account/:accountId', (req: Request, res: Response) => res.json({ startTime: 0, endTime: 0, stats: {}, accountId: req.params.accountId }));
router.get('/party/api/v1/Fortnite/user/:accountId/notifications/undelivered/count', (_req: Request, res: Response) => res.json({ count: 0 }));
router.get('/fortnite/api/cloudstorage/system/config', (_req: Request, res: Response) => res.status(204).end());
router.get('/fortnite/api/game/v2/creative/favorites/:accountId', async (req: Request, res: Response) => {
  try {
    const User = require('../../models/User').default;
    const fs = require('fs'); const path = require('path');
    const user = await User.findOne({ accountId: req.params.accountId }).lean();
    const favs: string[] = (user as any)?.favorites || [];
    let frontend: any = { Panels: [{ Pages: [{ results: [] }] }] };
    try { frontend = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'Discovery', 'discovery_frontend.json'), 'utf-8')); } catch {}
    const allResults = frontend.Panels.flatMap((p: any) => p.Pages.flatMap((pg: any) => pg.results));
    const results = favs.map((mnemonic: string) => {
      const found = allResults.find((r: any) => r.linkData?.mnemonic === mnemonic);
      return found ? { ...found, isFavorite: true } : { linkData: { mnemonic, namespace: 'fn', linkType: 'BR:Playlist', active: true }, linkCode: mnemonic, isFavorite: true };
    });
    res.json({ results, total: results.length });
  } catch { res.json({ results: [], total: 0 }); }
});

router.get('/fortnite/api/game/v2/creative/history/:accountId', (_req: Request, res: Response) => res.json({ results: [], total: 0 }));

router.put('/fortnite/api/game/v2/creative/favorites/:accountId/:mnemonic', async (req: Request, res: Response) => {
  try {
    const User = require('../../models/User').default;
    await User.updateOne({ accountId: req.params.accountId }, { $addToSet: { favorites: req.params.mnemonic } });
  } catch {}
  res.status(204).end();
});

router.delete('/fortnite/api/game/v2/creative/favorites/:accountId/:mnemonic', async (req: Request, res: Response) => {
  try {
    const User = require('../../models/User').default;
    await User.updateOne({ accountId: req.params.accountId }, { $pull: { favorites: req.params.mnemonic } });
  } catch {}
  res.status(204).end();
});
router.get('/lightswitch/api/service/bulk/status', (_req: Request, res: Response) => {
  res.json([{ serviceInstanceId: 'fortnite', status: 'UP', message: 'Meteor', allowedActions: ['PLAY', 'DOWNLOAD'], banned: false, launcherInfoDTO: { appName: 'Fortnite', catalogItemId: '4fe75bbc5a674f4f9b356b5c90567da5', namespace: 'fn' } }]);
});
router.get('/lightswitch/api/service/:serviceId/status', (req: Request, res: Response) => {
  res.json({ serviceInstanceId: req.params.serviceId, status: 'UP', message: 'Meteor', allowedActions: [], banned: false });
});
router.get('/fortnite/api/game/v2/privacy/account/:accountId', (req: Request, res: Response) => { res.json({ accountId: req.params.accountId, optOutOfPublicLeaderboards: false }); });
router.get('/affiliate/api/public/affiliates/slug/:affiliateName', (req: Request, res: Response) => {
  res.json({ id: 'aabbccddeeff11223344556677889900', slug: req.params.affiliateName, displayName: req.params.affiliateName, status: 'ACTIVE', verified: true });
});
router.get('/fortnite/api/game/v2/content-controls/:accountId', (req: Request, res: Response) => { res.json({ data: { ageGate: 0, controlsEnabled: false, maxEpicProfilePrivacy: 'none', principalId: req.params.accountId } }); });
router.post('/fortnite/api/game/v2/content-controls/:accountId/verify-pin', (_req: Request, res: Response) => { res.json({ data: { pinCorrect: true } }); });
router.get('/lego/api/v1/worlds', (_req: Request, res: Response) => { res.json([]); });
router.post('/lego/api/v1/worlds', (_req: Request, res: Response) => { res.json({}); });
router.get('/lego/api/v1/worlds/:worldId/session', (req: Request, res: Response) => {
  res.status(404).json({ errorCode: 'errors.com.epicgames.dbs.wasp.world_session_not_found', errorMessage: `could not find a session record for world ID ${req.params.worldId}`, numericErrorCode: 1004, responseStatus: 404 });
});
router.get('/region-check', (_req: Request, res: Response) => { res.json({ content_id: 'AF9yLAAsklQALFTy', allowed: true, resolved: true, limit: 'Res=656' }); });
router.post('/region/check', (_req: Request, res: Response) => { res.json({ content_id: 'AF9yLAAsklQALFTy', allowed: true, resolved: true, limit: 'Res=656' }); });
router.post('/api/v1/user-settings', (req: Request, res: Response) => {
  res.json([{ accountId: req.body.accountId, key: 'avatar', value: 'cid_003_athena_commando_f_default' }, { accountId: req.body.accountId, key: 'avatarBackground', value: '["#B4F2FE","#00ACF2","#005679"]' }, { accountId: req.body.accountId, key: 'appInstalled', value: 'init' }]);
});
router.post('/api/v1/user/setting', (req: Request, res: Response) => {
  res.json([{ accountId: req.body.accountId, key: 'avatar', value: 'cid_003_athena_commando_f_default' }, { accountId: req.body.accountId, key: 'avatarBackground', value: '["#B4F2FE","#00ACF2","#005679"]' }, { accountId: req.body.accountId, key: 'appInstalled', value: 'init' }]);
});
router.get('/fortnite/api/game/v2/privacy-settings/:accountId', (_req: Request, res: Response) => { res.json({ privacySettings: { playRegion: 'PRIVATE', badges: 'PRIVATE', languages: 'PRIVATE' } }); });
router.get('/api/v1/events/Fortnite/:eventId/:eventWindowId/leaderboard', (req: Request, res: Response) => {
  res.json({ gameId: 'Fortnite', eventId: req.params.eventId, eventWindowId: req.params.eventWindowId, page: 0, totalPages: 1, updatedTime: new Date().toISOString(), entries: [], liveSessions: {} });
});
router.get('/api/v1/events/Fortnite/download/:accountId', (req: Request, res: Response) => {
  res.json({ player: { gameId: 'Fortnite', accountId: req.params.accountId, tokens: [], teams: {}, pendingPayouts: [], pendingPenalties: {}, persistentScores: {}, groupIdentity: {} }, events: [], templates: [], scores: [], leaderboardDefs: [], resolvedWindowLocations: {} });
});
router.get('/api/v1/events/Fortnite/players/:accountId', (req: Request, res: Response) => { res.json({ accounts: [{ accountId: req.params.accountId, tokens: [] }] }); });
router.get('/fortnite/api/game/v2/lfg/:accountId/settings', (_req: Request, res: Response) => { res.json({ isLookingForGroup: true, preferredRegion: 'EU' }); });
router.put('/fortnite/api/game/v2/lfg/:accountId/settings', (_req: Request, res: Response) => { res.status(204).end(); });
router.get('/api/v1/lfg/Fortnite/users/:accountId/settings', (_req: Request, res: Response) => { res.json({ isLookingForGroup: true, preferredRegion: 'EU' }); });
router.get('/api/v1/creator-followers/:accountId', (_req: Request, res: Response) => { res.json({ followed: [] }); });
router.get('/followers/api/v1/FortniteLive/:accountId/*', (_req: Request, res: Response) => res.json({ followed: [] }));
router.get('/fortnite/api/game/v2/quests/accountId/:accountId', (_req: Request, res: Response) => { res.json({ questProgress: {}, tokens: [] }); });
router.get('/api/v1/games/Fortnite/heraMesh', (_req: Request, res: Response) => { res.json({}); });
router.get('/api/v1/games/Fortnite/artemisMesh', (_req: Request, res: Response) => { res.json({}); });
router.get('/api/v1/public/accounts', (req: Request, res: Response) => { res.json({ accounts: [{ accountId: req.query.accountId, tags: [] }] }); });
router.get('/launcher/api/public/assets/v2/platform/:platform/catalogItem/:catalogItemId/app/:appName/label/:label', (req: Request, res: Response) => {
  res.json({ appName: req.params.appName, labelName: `${req.query.label}-${req.params.platform}`, buildVersion: 'Meteor', catalogItemId: req.params.catalogItemId, expires: '9999-12-31T23:59:59.999Z', items: { MANIFEST: { signature: 'Meteor', distribution: 'http://127.0.0.1:5353/', path: 'Builds/Fortnite/Content/CloudDir/Meteor.manifest', additionalDistributions: [] } }, assetId: req.params.appName });
});
router.get('/content/api/pages/fortnite-game/seasonpasses', (_req: Request, res: Response) => {
  res.json({ _title: 'seasonpasses', _noIndex: false, _activeDate: new Date().toISOString(), lastModified: new Date().toISOString(), _locale: 'en-US', _templateName: 'blank' });
});
router.post('/party/api/v1/Fortnite/parties/*/members/*/installStatus', (req: Request, res: Response) => { res.json({ accountId: req.body.accountId || '', isInstalled: false }); });
router.get('/fortnite/api/storefront/v2/catalog/bulk', (_req: Request, res: Response) => { res.json({}); });
router.get('/catalog/api/shared/namespace/fn/bulk/offers', (_req: Request, res: Response) => { 
  console.log('🛒 CATALOG BULK OFFERS ENDPOINT CALLED (GET)!');
  res.json({ 
    "storefronts": [],
    "offers": []
  }); 
});
router.post('/catalog/api/shared/namespace/fn/bulk/offers', (_req: Request, res: Response) => { 
  console.log('🛒 CATALOG BULK OFFERS ENDPOINT CALLED (POST)!');
  res.json({ 
    "storefronts": [],
    "offers": []
  }); 
});
router.get('/fortnite/api/game/v2/sales-event', (_req: Request, res: Response) => res.status(404).end());
router.get('/fortnite/api/game/v2/game-rating', (_req: Request, res: Response) => res.status(404).end());
router.get('/salesEvent/salesEvent/*', (_req: Request, res: Response) => res.status(404).end());
router.get('/gameRating/gameRating/*', (_req: Request, res: Response) => res.status(404).end());
router.get('/api/v1/assets/Fortnite/FortPlaylistAthena', (_req: Request, res: Response) => {
  try {
    const fs = require('fs'); const path = require('path');
    const playlists = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'AllPlaylists.json'), 'utf-8'));
    res.json(playlists.map((p: any) => ({
      id: p.id,
      name: p.name || p.id,
      subName: p.subName || '',
      description: p.description || '',
      gameType: p.gameType || 'EFortGameType::BR',
      minPlayers: p.minPlayers ?? -1,
      maxPlayers: p.maxPlayers ?? 100,
      maxTeams: p.maxTeams ?? 100,
      maxTeamSize: p.maxTeamSize ?? 4,
      isDefault: p.isDefault ?? false,
      isTournament: p.isTournament ?? false,
      isLimitedTimeMode: p.isLimitedTimeMode ?? false,
      isLargeTeamGame: p.isLargeTeamGame ?? false,
      gameplayTags: p.gameplayTags || [],
      images: p.images || {},
    })));
  } catch { res.status(204).end(); }
});
router.get('/api/v1/creator-content/link/:linkId/cooked-content-package', (_req: Request, res: Response) => res.json({}));
router.get('/api/content/v2/link/:linkId/cooked-content-package', (_req: Request, res: Response) => res.json({}));
router.get('/api/content/v4/link/:linkId/cooked-content-package', (_req: Request, res: Response) => res.json({}));
router.get('/fortnite/api/v2/versioncheck*', (_req: Request, res: Response) => res.json({ type: 'NO_UPDATE' }));
router.get('/fortnite/api/versioncheck*', (_req: Request, res: Response) => res.json({ type: 'NO_UPDATE' }));
router.get('/fortnite/api/version', (_req: Request, res: Response) => res.json({ type: 'NO_UPDATE' }));
router.post('/fortnite/api/game/v2/grant_access/:accountId', (_req: Request, res: Response) => res.status(204).end());
router.post('/fortnite/api/game/v2/profileToken/verify/*', (_req: Request, res: Response) => res.status(204).end());
router.get('/fortnite/api/storeaccess/v1/request_access/:accountId', (_req: Request, res: Response) => res.status(204).end());
// CRITICAL: Supervised settings endpoint - MUST return Status 200 with JSON, NOT 204
// This is the endpoint the game calls for UpdateSettings
router.all('/v1/epic-settings/public/users/:accountId/values', (req: Request, res: Response) => {
  console.log(`[SUPERVISED SETTINGS VALUES] ${req.method} /v1/epic-settings/public/users/${req.params.accountId}/values - Game: ${req.query.game}`);
  // Return Status 200 with valid JSON (game expects this, Epic returns 204 which causes error)
  res.status(200).json({
    accountId: req.params.accountId,
    settings: req.body || {},
    version: 1,
    supervised: false,
    parentalControls: { enabled: false }
  });
});

router.get('/v1/epic-settings/public/users/:accountId/*', (_req: Request, res: Response) => {
  console.log(`[EPIC SETTINGS GET] ${_req.method} ${_req.url}`);
  // Return the full epic-settings.json with permissive values to disable parental controls
  try {
    const fs = require('fs');
    const path = require('path');
    const epicSettings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'epic-settings.json'), 'utf-8'));
    res.json(epicSettings);
  } catch (error) {
    console.error('[EPIC SETTINGS GET] Error loading epic-settings.json:', error);
    // Fallback to empty settings if file doesn't exist
    res.json({ response: { settings: [] } });
  }
});
router.patch('/v1/epic-settings/public/users/:accountId/*', (_req: Request, res: Response) => {
  console.log(`[EPIC SETTINGS PATCH] ${_req.method} ${_req.url}`);
  // Return Status 200 with JSON instead of 204
  res.status(200).json({
    accountId: _req.params.accountId,
    settings: _req.body || {},
    version: 1
  });
});
router.options('/v1/epic-settings/public/users/:accountId/*', (_req: Request, res: Response) => res.status(204).end());
// KWS API endpoints - MUST be before any catch-all routes
router.get('/kws/v1/accounts/:accountId/settings', (req: Request, res: Response) => {
  console.log(`[KWS] GET /kws/v1/accounts/${req.params.accountId}/settings`);
  res.json({
    accountId: req.params.accountId,
    parentalControls: { enabled: false },
    supervised: false,
    settings: {},
    version: 1
  });
});

router.post('/kws/v1/accounts/:accountId/settings', (req: Request, res: Response) => {
  console.log(`[KWS] POST /kws/v1/accounts/${req.params.accountId}/settings`);
  res.json({
    accountId: req.params.accountId,
    parentalControls: { enabled: false },
    supervised: false,
    settings: req.body || {},
    version: 1
  });
});

router.put('/kws/v1/accounts/:accountId/settings', (req: Request, res: Response) => {
  console.log(`[KWS] PUT /kws/v1/accounts/${req.params.accountId}/settings`);
  res.json({
    accountId: req.params.accountId,
    parentalControls: { enabled: false },
    supervised: false,
    settings: req.body || {},
    version: 1
  });
});

router.patch('/kws/v1/accounts/:accountId/settings', (req: Request, res: Response) => {
  console.log(`[KWS] PATCH /kws/v1/accounts/${req.params.accountId}/settings`);
  res.json({
    accountId: req.params.accountId,
    parentalControls: { enabled: false },
    supervised: false,
    settings: req.body || {},
    version: 1
  });
});

router.get('/kws/v1/accounts/:accountId', (req: Request, res: Response) => {
  console.log(`[KWS] GET /kws/v1/accounts/${req.params.accountId}`);
  res.json({
    accountId: req.params.accountId,
    parentalControls: { enabled: false },
    supervised: false
  });
});

router.get('/kws/v1/users/:accountId/permissions', (_req: Request, res: Response) => res.json({ permissions: [], canReceiveEmail: true, isMinor: false }));
router.post('/kws/v1/users/:accountId/permissions', (_req: Request, res: Response) => res.json({ permissions: [], canReceiveEmail: true, isMinor: false }));
router.get('/kws/v1/users/:accountId/status', (_req: Request, res: Response) => res.json({ canReceiveEmail: true, isMinor: false, isVerified: true, parentEmail: null }));
router.post('/kws/v1/users', (_req: Request, res: Response) => res.json({ userId: 'kws-user', isMinor: false }));
router.get('/kws/v1/age-gate', (_req: Request, res: Response) => res.json({ isMinor: false }));
router.post('/kws/v1/age-gate', (_req: Request, res: Response) => res.json({ isMinor: false }));

// KWS catch-all - return JSON, NEVER 204
router.all('/kws/*', (req: Request, res: Response) => {
  console.log(`[KWS CATCH-ALL] ${req.method} ${req.url}`);
  res.json({ 
    success: true,
    supervised: false,
    parentalControls: { enabled: false }
  });
});
router.get('/api/v1/players/Fortnite/tokens', (_req: Request, res: Response) => res.json({ tokens: [] }));
router.get('/app_installation/status', (_req: Request, res: Response) => res.json({ accountId: '', isInstalled: false }));
router.get('/api/community/v1/fn-client/community-highlights', (_req: Request, res: Response) => res.status(204).end());
router.get('/mesh/Fortnite/:meshId/metadata', (_req: Request, res: Response) => res.json({}));
router.get('/api/v1/games/fortnite/tracks/activeBy/*', (_req: Request, res: Response) => res.status(204).end());
router.get('/api/v1/games/fortnite/trackprogress/*', (_req: Request, res: Response) => res.status(204).end());
router.get('/api/v1/games/fortnite/tracks/query*', (_req: Request, res: Response) => res.status(204).end());
router.get('/api/v1/public/accounts', (req: Request, res: Response) => res.json({ accounts: [{ accountId: req.query.accountId, tags: [] }] }));
router.get('/api/v1/players/Fortnite/tokens', (_req: Request, res: Response) => res.json({ tokens: [] }));
router.get('/content/api/pages/fortnite-game/eventscreens', (_req: Request, res: Response) => res.json({ _title: 'eventscreens', _activeDate: new Date().toISOString(), lastModified: new Date().toISOString(), _locale: 'en-US' }));
router.get('/content/api/pages/fortnite-game/seasonpasses', (_req: Request, res: Response) => res.json({ _title: 'seasonpasses', _activeDate: new Date().toISOString(), lastModified: new Date().toISOString(), _locale: 'en-US' }));
router.get('/api/quest/v3/:deploymentId/progress/account/:accountId', (_req: Request, res: Response) => res.json({ questProgress: [] }));
router.post('/api/v1/user/setting', (req: Request, res: Response) => res.json([{ accountId: req.body?.accountId || '', key: 'avatar', value: 'cid_001_athena_commando_f_default' }]));
router.get('/api/v1/leaderboards/Fortnite/:eventId/:eventWindowId/*', (req: Request, res: Response) => res.json({ gameId: 'Fortnite', eventId: req.params.eventId, eventWindowId: req.params.eventWindowId, entries: [], liveSessions: {} }));
router.get('/fortnite/api/game/v2/world/info', (_req: Request, res: Response) => {
  try {
    const fs = require('fs'); const path = require('path');
    res.json(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'worldinfo.json'), 'utf-8')));
  } catch { res.json({}); }
});
router.post('/region/check', (_req: Request, res: Response) => res.json({ content_id: 'AF9yLAAsklQALFTy', allowed: true, resolved: true }));
router.get('/api/content/v2/link/:linkId/cooked-content-package', (_req: Request, res: Response) => res.json({}));
router.get('/api/content/v4/link/:linkId/cooked-content-package', (_req: Request, res: Response) => res.json({}));
router.get('/valkyrie/cooked-content/:projectId/:fnVersion/:v/:cookJob/alt/*.manifest', (_req: Request, res: Response) => res.status(404).end());
router.get('/valkyrie/cooked-content/:projectId/:fnVersion/:v/:cookJob/alt/ChunksV4/:chunknum/:chunkFile', (_req: Request, res: Response) => res.status(404).end());
router.post('/api/v1/fortnite-br/interactions', (_req: Request, res: Response) => res.status(200).end());
router.post('/api/v1/fortnite-br/channel/interstitials/target', (_req: Request, res: Response) => res.status(204).end());
router.post('/api/v1/fortnite-br/interactions/contentHash', (_req: Request, res: Response) => res.status(204).end());
router.get('/fortnite/api/discovery/accessToken/*', (_req: Request, res: Response) => res.json({ token: `eg1~${require('uuid').v4()}` }));

router.get('/api/v1/public/tags', (_req: Request, res: Response) => {
  try {
    const fs = require('fs'); const path = require('path');
    const tags = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'Tags', 'Tags.json'), 'utf-8'));
    res.json(tags);
  } catch (error) {
    console.error('[TAGS] Error loading tags:', error);
    res.json({ tags: [], cursor: "" });
  }
});

router.post('/api/v1/discovery/surface/*', (_req: Request, res: Response) => {
  res.json({ Panels: [], TestCohorts: [], ModeSets: {} });
});
router.post('/api/v2/discovery/surface/*', (_req: Request, res: Response) => {
  // For version 28.30 (Chapter 5 Season 1), return Neonite-compatible discovery data
  res.json({
    "panels": [
      {
        "panelName": "Homebar",
        "panelDisplayName": "Homebar",
        "panelSubtitle": null,
        "featureTags": ["col:5", "homebar"],
        "firstPage": {
          "results": [{
            "lastVisited": null,
            "linkCode": "reference_byepicnocompetitive_5",
            "isFavorite": false,
            "globalCCU": 0,
            "lockStatus": "UNLOCKED",
            "lockStatusReason": "NONE",
            "isVisible": true
          }],
          "hasMore": true,
          "panelTargetName": null,
          "pageMarker": null
        },
        "panelType": "CuratedList",
        "playHistoryType": null
      },
      {
        "panelName": "ByEpicNoCompetitive",
        "panelDisplayName": "By Epic",
        "panelSubtitle": "Islands created by Epic Games",
        "featureTags": ["col:5"],
        "firstPage": {
          "results": [
            {
              "linkCode": "playlist_durian",
              "isFavorite": false,
              "globalCCU": 0,
              "lockStatus": "UNLOCKED",
              "lockStatusReason": "NONE",
              "isVisible": true
            },
            {
              "linkCode": "set_br_playlists",
              "isFavorite": false,
              "globalCCU": 0,
              "lockStatus": "UNLOCKED",
              "lockStatusReason": "NONE",
              "isVisible": true
            },
            {
              "linkCode": "playlist_pilgrimquickplay",
              "isFavorite": false,
              "globalCCU": 0,
              "lockStatus": "UNLOCKED",
              "lockStatusReason": "NONE",
              "isVisible": true
            },
            {
              "linkCode": "playlist_juno",
              "isFavorite": false,
              "globalCCU": 0,
              "lockStatus": "UNLOCKED",
              "lockStatusReason": "NONE",
              "isVisible": true
            },
            {
              "linkCode": "playlist_beanstalk",
              "isFavorite": false,
              "globalCCU": 0,
              "lockStatus": "UNLOCKED",
              "lockStatusReason": "NONE",
              "isVisible": true
            },
            {
              "lastVisited": null,
              "linkCode": "playlist_papaya",
              "isFavorite": false,
              "globalCCU": 0,
              "lockStatus": "UNLOCKED",
              "lockStatusReason": "NONE",
              "isVisible": true
            }
          ],
          "hasMore": true,
          "panelTargetName": null,
          "pageMarker": null
        },
        "panelType": "AnalyticsList",
        "playHistoryType": null
      }
    ]
  });
});

router.post('/api/v1/links/favorites/:accountId/check', (_req: Request, res: Response) => res.json({}));
router.post('/api/v1/links/lock-status/:accountId/check', (_req: Request, res: Response) => res.json({}));
router.post('/api/verify/match', (_req: Request, res: Response) => res.status(204).end());
router.get('/friends/api/v1/*/recent/fortnite', (_req: Request, res: Response) => res.json([]));
router.post('/auth/v1/turn/credentials', (_req: Request, res: Response) => res.json({ servers: [], ttl: 86400, username: '', password: '' }));
router.post('/epic/oauth/v2/tokenInfo', (_req: Request, res: Response) => res.json({ active: true }));
router.get('/epic/id/v2/sdk/accounts', (req: Request, res: Response) => {
  const accountId = req.query.accountId as string || 'default_user';
  console.log(`[EOS SDK Accounts] Request for accountId: ${accountId}`);
  res.json([
    {
      accountId: accountId,
      displayName: accountId,
      preferredLanguage: 'en',
      linkedAccounts: [],
      cabinedMode: false,
      empty: false
    }
  ]);
});
router.get('/sdk/v1/default', (_req: Request, res: Response) => {
  try {
    const fs = require('fs'); const path = require('path');
    res.json(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'sdkv1.json'), 'utf-8')));
  } catch { res.json({}); }
});
router.get('/sdk/v1/product/*', (_req: Request, res: Response) => {
  try {
    const fs = require('fs'); const path = require('path');
    res.json(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'sdkv1.json'), 'utf-8')));
  } catch { res.json({}); }
});
router.get('/epic/friends/v1/:accountId/blocklist', (_req: Request, res: Response) => res.json([]));
router.patch('/epic/presence/v1/:gameNs/:accountId/presence/:presenceUuid', (_req: Request, res: Response) => res.status(204).end());
router.post('/user/v9/product-users/search', (_req: Request, res: Response) => res.json({ data: [] }));
router.post('/telemetry/data*', (_req: Request, res: Response) => res.status(204).end());
router.get('/epic/chat/v1/public/_/users/:accountId/summary', (_req: Request, res: Response) => res.json({ conversations: [], settings: {} }));
router.get('/epic/chat/v1/public/_/users/hybrid/conversations*', (_req: Request, res: Response) => res.json({ conversations: [] }));
router.post('/publickey/v2/publickey', (_req: Request, res: Response) => res.json({ publicKey: '' }));
router.get('/api/v1/namespace/fn/worlds/accessibleTo/:accountId', (_req: Request, res: Response) => res.json([]));
router.post('/api/v1/namespace/fn/worlds/account/:accountId', (req: Request, res: Response) => {
  res.json({ namespaceId: 'fn', worldId: 'd5c7520e2b534046b739cee2a25c4022', ownerAccountId: req.params.accountId, version: 0, currentVersion: 0, name: '1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sanction: null, metadataConstraint: 'juno_default', metadata: {}, session: { owningSessionId: null, sessionKey: null, currentPlayers: null, sessionCreatedAt: null, lastServerHeartbeat: null, totalSecondsPlayed: 0 } });
});
router.get('/api/v1/namespace/fn/worlds/world/:worldId/session', (req: Request, res: Response) => {
  res.status(404).json({ errorCode: 'errors.com.epicgames.dbs.wasp.world_session_not_found', errorMessage: `could not find a session record for world ID ${req.params.worldId}`, numericErrorCode: 1004, responseStatus: 404 });
});
router.get('/api/v1/namespace/fn/worlds/world/:worldId/attest/:accountId', (req: Request, res: Response) => { res.json({ token: 'wasp~token', worldId: req.params.worldId }); });
router.get('/content/api/pages/fortnite-game/radio-stations', (_req: Request, res: Response) => {
  try {
    const fs = require('fs'); const path = require('path');
    res.json(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'sdkv1.json'), 'utf-8')));
  } catch { res.json({}); }
});
router.get('/v2', (_req: Request, res: Response) => res.status(204).end());
router.get('/hotconfigs/v2/livefn.json', (_req: Request, res: Response) => res.json({ "Hotfix": [] }));
router.get('/hotconfigs/v2/*', (_req: Request, res: Response) => res.json({ "Hotfix": [] }));
router.get('/ias/fortnite/:hash', (_req: Request, res: Response) => res.status(204).end());
router.get('/ias/fortnite/chunks/:chunkNum/:chunkFile', (_req: Request, res: Response) => res.status(204).end());
router.get('/iad/fortnite/chunks/:chunkNum/:chunkFile', (_req: Request, res: Response) => res.status(204).end());
router.post('/fortnite/api/game/v2/chat/:accountId/:platform/recommendGeneralChatRooms', (_req: Request, res: Response) => res.json({}));
router.get('/api/locker/v3/:deploymentId/account/:accountId/items', (_req: Request, res: Response) => res.json({ items: [] }));
router.put('/api/locker/v3/:deploymentId/loadout/:loadoutType/account/:accountId/:loadout', (_req: Request, res: Response) => res.status(204).end());
router.put('/api/locker/v3/:deploymentId/loadout/:loadoutType/account/:accountId/loadout-preset/index/:presetIndex', (_req: Request, res: Response) => res.status(204).end());
router.get('/api/locker/v4/:deploymentId/account/:accountId/items', (_req: Request, res: Response) => res.json({ items: [] }));
router.put('/api/locker/v4/:deploymentId/account/:accountId/active-loadout-group', (_req: Request, res: Response) => res.status(204).end());
router.put('/api/locker/v4/:deploymentId/account/:accountId/loadout-group-preset/index/:presetIndex', (_req: Request, res: Response) => res.status(204).end());
router.put('/api/locker/v4/:deploymentId/loadout/:loadoutType/account/:accountId/loadout-preset/index/:presetIndex', (_req: Request, res: Response) => res.status(204).end());
router.post('/api/locker/v4/:deploymentId/account/:accountId/lock-in-immutable-item/:companion', (_req: Request, res: Response) => res.status(204).end());
router.patch('/api/locker/v4/:deploymentId/account/:accountId/companion-name', (_req: Request, res: Response) => res.status(204).end());
router.get('/api/locker/v4/:deploymentId/account/:accountId/cosmetic-data', (_req: Request, res: Response) => res.json({}));

const tagsData = (() => {
  const fs = require('fs'); const path = require('path');
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'Tags', 'Tags.json'), 'utf-8')); }
  catch { return { tags: [], cursor: '' }; }
})();

router.get('/api/v1/social-tags/Fortnite/tags', (_req: Request, res: Response) => res.json(tagsData));
router.get('/api/v1/social-tags/:gameId/tags', (_req: Request, res: Response) => res.json(tagsData));
router.get('/social-tags/api/v1/:gameId/tags', (_req: Request, res: Response) => res.json(tagsData));
router.get('/fortnite/api/game/v2/social-tags', (_req: Request, res: Response) => res.json(tagsData));
router.get('/api/v1/social-tags/Fortnite/account/:accountId/tags', (req: Request, res: Response) => res.json({ accountId: req.params.accountId, tags: [] }));
router.put('/api/v1/social-tags/Fortnite/account/:accountId/tags', (_req: Request, res: Response) => res.status(204).end());
router.put('/social-tags/api/v1/:gameId/account/:accountId/tags', (_req: Request, res: Response) => res.status(204).end());

router.post('/caldera/api/v1/launcher/racp', (_req: Request, res: Response) => res.json({ jwt: 'caldera_token' }));
router.get('/caldera/api/v1/launcher/racp', (_req: Request, res: Response) => res.json({ jwt: 'caldera_token' }));
router.post('/caldera/api/v1/racp', (_req: Request, res: Response) => res.json({ jwt: 'caldera_token' }));

router.get('/library/api/public/items', (_req: Request, res: Response) => res.json({ responseMetadata: {}, records: [] }));
router.get('/library/api/public/items/bulk', (_req: Request, res: Response) => res.json({ responseMetadata: {}, records: [] }));

router.get('/fulfillment/api/public/fulfillmentquery', (_req: Request, res: Response) => res.json({ fulfillmentList: [] }));

router.get('/user-search/api/v1/search/:accountId', (req: Request, res: Response) => res.json({ accountId: req.params.accountId, matches: [] }));
router.post('/user-search/api/v1/search/:accountId', (req: Request, res: Response) => res.json({ accountId: req.params.accountId, matches: [] }));

router.get('/nelly/api/v1/notifications/:accountId', (_req: Request, res: Response) => res.json({ notifications: [] }));
router.delete('/nelly/api/v1/notifications/:accountId/:notificationId', (_req: Request, res: Response) => res.status(204).end());

router.post('/pops/api/v1/fortnite/account/:accountId/popups', (_req: Request, res: Response) => res.json({ popups: [] }));
router.post('/pops/api/v1/fortnite/account/:accountId/popups/acknowledge', (_req: Request, res: Response) => res.status(204).end());

router.post('/prm-dialog/api/v1/fortnite/account/:accountId/dialogs', (_req: Request, res: Response) => res.json({ dialogs: [] }));
router.post('/prm-dialog/api/v1/fortnite/account/:accountId/dialogs/acknowledge', (_req: Request, res: Response) => res.status(204).end());

router.get('/wex/api/v1/accounts/:accountId/wallet', (req: Request, res: Response) => res.json({ accountId: req.params.accountId, wallets: [] }));

router.get('/emerald/v1/accounts/:accountId', (req: Request, res: Response) => res.json({ accountId: req.params.accountId }));
router.post('/emerald/v1/accounts/:accountId', (req: Request, res: Response) => res.json({ accountId: req.params.accountId }));

router.get('/fortnite/api/game/v2/habanero/account/:accountId', (_req: Request, res: Response) => res.json({ questProgress: [] }));
router.post('/fortnite/api/game/v2/habanero/account/:accountId', (_req: Request, res: Response) => res.json({ questProgress: [] }));

router.get('/global/api/v1/config', (_req: Request, res: Response) => res.json({}));

const allPlaylistsData = (() => {
  const fs = require('fs'); const path = require('path');
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'AllPlaylists.json'), 'utf-8')); }
  catch { return []; }
})();

router.get('/fortnite/api/game/v2/playlists', (_req: Request, res: Response) => res.json(allPlaylistsData));
router.get('/fortnite/api/game/v2/playlists/:playlistId', (req: Request, res: Response) => {
  const found = allPlaylistsData.find((p: any) => p.id?.toLowerCase() === req.params.playlistId?.toLowerCase());
  if (!found) return res.status(404).json({ error: 'Playlist not found' });
  res.json(found);
});
router.get('/api/v1/playlists/Fortnite', (_req: Request, res: Response) => res.json(allPlaylistsData));
router.get('/api/v1/playlists/Fortnite/:playlistId', (req: Request, res: Response) => {
  const found = allPlaylistsData.find((p: any) => p.id?.toLowerCase() === req.params.playlistId?.toLowerCase());
  if (!found) return res.status(404).json({ error: 'Playlist not found' });
  res.json(found);
});

// EOS social overlay — returns current user's social graph summary
router.get('/api/v1/Fortnite/get', (_req: Request, res: Response) => {
  res.json({
    friends: [],
    blocklist: [],
    settings: { acceptInvites: 'public' },
  });
});

// Discovery mnemonic endpoints (LawinServer compatibility)
router.post('/links/api/fn/mnemonic', async (req: Request, res: Response) => {
  try {
    const discoveryPath = path.join(__dirname, '../../../NeoniteV2/discovery/discoveryMenuV2.json');
    if (fs.existsSync(discoveryPath)) {
      const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
      const mnemonicArray: any[] = [];
      
      if (discovery.Panels && discovery.Panels[1] && discovery.Panels[1].Pages && discovery.Panels[1].Pages[0]) {
        for (const result of discovery.Panels[1].Pages[0].results) {
          if (result.linkData) {
            mnemonicArray.push(result.linkData);
          }
        }
      }
      
      res.json(mnemonicArray);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('[MNEMONIC] Error loading mnemonic data:', error);
    res.json([]);
  }
});

router.get('/links/api/fn/mnemonic/:playlist/related', async (req: Request, res: Response) => {
  try {
    const discoveryPath = path.join(__dirname, '../../../NeoniteV2/discovery/discoveryMenuV2.json');
    const response: any = {
      "parentLinks": [],
      "links": {}
    };
    
    if (fs.existsSync(discoveryPath) && req.params.playlist) {
      const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
      
      if (discovery.Panels && discovery.Panels[1] && discovery.Panels[1].Pages && discovery.Panels[1].Pages[0]) {
        for (const result of discovery.Panels[1].Pages[0].results) {
          if (result.linkData && result.linkData.mnemonic === req.params.playlist) {
            response.links[req.params.playlist] = result.linkData;
          }
        }
      }
    }
    
    res.json(response);
  } catch (error) {
    console.error('[MNEMONIC] Error loading related mnemonic:', error);
    res.json({ "parentLinks": [], "links": {} });
  }
});

router.get('/links/api/fn/mnemonic/*', async (req: Request, res: Response) => {
  try {
    const discoveryPath = path.join(__dirname, '../../../NeoniteV2/discovery/discoveryMenuV2.json');
    const mnemonic = req.url.split("/").slice(-1)[0];
    
    if (fs.existsSync(discoveryPath)) {
      const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
      
      if (discovery.Panels && discovery.Panels[1] && discovery.Panels[1].Pages && discovery.Panels[1].Pages[0]) {
        for (const result of discovery.Panels[1].Pages[0].results) {
          if (result.linkData && result.linkData.mnemonic === mnemonic) {
            return res.json(result.linkData);
          }
        }
      }
    }
    
    res.status(404).json({});
  } catch (error) {
    console.error('[MNEMONIC] Error loading mnemonic:', error);
    res.status(404).json({});
  }
});

router.post('/api/v1/links/lock-status/:accountId/check', async (req: Request, res: Response) => {
  const response: any = {
    "results": [],
    "hasMore": false
  };
  
  if (req.body.linkCodes) {
    for (const linkCode of req.body.linkCodes) {
      response.results.push({
        "playerId": req.params.accountId,
        "linkCode": linkCode,
        "lockStatus": "UNLOCKED",
        "lockStatusReason": "NONE",
        "isVisible": true
      });
    }
  }
  
  res.json(response);
});

router.get('/fortnite/api/discovery/accessToken/:branch', async (req: Request, res: Response) => {
  res.json({
    "branchName": req.params.branch,
    "appId": "Fortnite",
    "token": "helix_discovery_token"
  });
});

export default router;
