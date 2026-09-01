import express, { Application } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { backend, BANNER } from './core/logger';
import { connectDatabase } from './database/mongodb';
import { startDiscordBot } from './discord/bot';
import { startXMPP } from './xmpp/xmpp';
import { handleMatchmaking } from './matchmaker/matchmaker';
import { startServerProbe, getProbeStatus } from './core/serverProbe';
import { config } from './config';
import './structs/autorotate';
import { startFileWatcher } from './structs/filewatcher';

dotenv.config();

declare global {
  var accessTokens: Array<{ token: string; accountId: string }>;
  var kv: any;
}

global.accessTokens = [];
global.kv = {
  get: async (key: string) => null,
  set: async (key: string, value: any) => {},
};

import authRoutes from './api/account/index';
import mcpRoutes from './api/game/mcp';
import gameRoutes from './api/game/game';
import contentRoutes from './api/game/content';
import socialRoutes from './api/social/index';
import systemRoutes from './api/misc/system';
import generalRoutes from './api/misc/general';
import communityRoutes from './api/misc/community';
import leaderboardsRoutes from './api/misc/leaderboards';
import pagesRoutes from './api/misc/pages';
import anticheatRoutes from './api/misc/anticheat';
import gameserverRoutes from './api/GS/Gamserver';
import launcherRoutes from './api/Launcher/Launcher';
import calendarRoutes from './api/misc/calendar';

const app: Application = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SILENT_PATTERNS = [
  /^\/api\/v1\/events\/Fortnite\/[^/]+\/history\//,
  /^\/datarouter\/api\/v1\/public\/data/,
  /^\/fortnite\/api\/game\/v2\/creative\/discovery\/surface\//,
  /^\/api\/v1\/assets\/Fortnite\//,
  /^\/launcher\/api\/public\/assets\/Windows\/[^/]+\/FortniteContentBuilds/,
  /^\/Builds\/Fortnite\/Content\/CloudDir\//,
  /^\/hotconfigs\/v2\//,
  // Temporarily enable SDK logging to debug
  // /^\/sdk\/v1\//,
];

app.use((req, res, next) => {
  if (!SILENT_PATTERNS.some(p => p.test(req.url))) {
    backend(`${req.method} ${req.url}`);
  }
  
  // Log ALL requests that might be supervised settings or KWS related
  if (req.url.toLowerCase().includes('kws') || 
      req.url.toLowerCase().includes('supervised') ||
      req.url.toLowerCase().includes('parental')) {
    backend(`[CRITICAL] Potential supervised/KWS request: ${req.method} ${req.url}`);
  }
  
  next();
});

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Early catch-all for supervised settings and KWS - must be before other routes
app.use((req, res, next) => {
  const url = req.url.toLowerCase();
  const host = req.headers.host?.toLowerCase() || '';
  
  // Intercept requests to Epic's live MCP/catalog domains and handle them locally
  if (host.includes('fngw-mcp-gc-livefn.ol.epicgames.com') || 
      host.includes('fortnite-public-service-prod11.ol.epicgames.com')) {
    backend(`[EPIC DOMAIN INTERCEPT] ${req.method} ${req.url} (Host: ${req.headers.host})`);
    // Strip the host and re-route through our own handlers by just calling next()
    // The URL path is already correct (e.g. /fortnite/api/storefront/v2/catalog)
    // so our registered routes will match it normally
    return next();
  }
  
  // Handle requests to api.kws.ol.epicgames.com (redirected via hosts file)
  if (host.includes('api.kws.ol.epicgames.com') || url.includes('/kws/')) {
    backend(`[KWS INTERCEPT] ${req.method} ${req.url} (Host: ${req.headers.host})`);
    return res.json({
      accountId: req.params?.accountId || 'unknown',
      supervised: false,
      parentalControls: { enabled: false },
      settings: req.body || {},
      version: 1,
      permissions: [],
      canReceiveEmail: true,
      isMinor: false,
      success: true
    });
  }
  
  // Handle requests to content-controls-prod.ol.epicgames.net (redirected via hosts file)
  if (host.includes('content-controls-prod.ol.epicgames.net') || url.includes('/content-controls/')) {
    backend(`[CONTENT-CONTROLS INTERCEPT] ${req.method} ${req.url} (Host: ${req.headers.host})`);
    // Extract accountId from URL
    const accountIdMatch = req.url.match(/\/content-controls\/([a-f0-9]+)/);
    const accountId = accountIdMatch ? accountIdMatch[1] : 'unknown';
    return res.json({
      data: {
        ageGate: 0,
        controlsEnabled: false,
        maxEpicProfilePrivacy: 'none',
        principalId: accountId
      }
    });
  }
  
  // Handle datarouter/metrics endpoints - return JSON for EOS SDK
  if (url.includes('/datarouter/')) {
    backend(`[DATAROUTER EARLY CATCH] ${req.method} ${req.url}`);
    return res.json({ success: true });
  }
  
  // Handle supervised settings endpoints
  if (url.includes('supervised')) {
    backend(`[SUPERVISED SETTINGS EARLY CATCH] ${req.method} ${req.url}`);
    return res.json({
      accountId: req.params?.accountId || 'unknown',
      supervised: false,
      supervisedBy: null,
      settings: {},
      version: 1,
      canUpdateDisplayName: true,
      canUpdateAvatar: true,
      canReceiveGifts: true,
      canSendGifts: true,
      canTrade: true,
      canPurchase: true,
      requiresParentalConsent: false,
      parentEmail: null,
      restrictions: []
    });
  }
  next();
});

app.use(authRoutes);
app.use(mcpRoutes);
app.use(gameRoutes);
app.use(contentRoutes);
app.use(socialRoutes);
app.use(systemRoutes);
app.use(pagesRoutes);
app.use(generalRoutes);
app.use(communityRoutes);
app.use(leaderboardsRoutes);
app.use(anticheatRoutes);
app.use(gameserverRoutes);
app.use(launcherRoutes);
app.use(calendarRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/gameserver/status', (req, res) => {
  const servers = getProbeStatus();
  const anyReady = servers.some(s => s.ready);
  res.json({
    ready: anyReady,
    servers,
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res) => {
  if (!SILENT_PATTERNS.some(p => p.test(req.url))) {
    backend(`Missing endpoint: ${req.method} ${req.url}`);
  }
  
  // Return empty array for KWS/supervised settings to match what game expects
  const url = req.url.toLowerCase();
  if (url.includes('kws') || url.includes('supervised') || url.includes('parental')) {
    backend(`[CATCH-ALL KWS] Returning empty array for: ${req.method} ${req.url}`);
    return res.json([]);
  }
  
  // Return JSON for everything else
  backend(`[CATCH-ALL] Returning JSON for: ${req.method} ${req.url}`);
  res.json({ success: true, message: 'Endpoint not implemented' });
});

async function start() {
  console.log(BANNER);
  try {
    await connectDatabase();

    startXMPP();
    startFileWatcher();
    startServerProbe();

    // ── HTTPS server on port 443 to intercept fngw-mcp-gc-livefn.ol.epicgames.com ──
    try {
      const https = require('https');
      const fs = require('fs');
      const certPath = path.join(__dirname, '..', 'cert.pem');
      const keyPath = path.join(__dirname, '..', 'key.pem');
      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        const httpsOptions = {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        };
        https.createServer(httpsOptions, app).listen(443, () => {
          backend(`HTTPS server listening on port 443 (intercepts fngw-mcp-gc-livefn.ol.epicgames.com)`);
        });
      } else {
        backend(`No cert.pem/key.pem found — HTTPS server not started`);
      }
    } catch (httpsErr: any) {
      backend(`HTTPS server failed to start: ${httpsErr.message}`);
    }

    // ── Matchmaker WebSocket server ──────────────────────────────────────────
    const { Server: WebSocketServer } = await import('ws');
    const mmPort = config.matchmaking.matchmakerPort;
    const mmWss = new WebSocketServer({ port: mmPort });

    mmWss.on('connection', (ws, req) => {
      // Extract playlist from the URL query string safely
      let playlist: string | undefined;
      try {
        const rawUrl = req.url || '/';
        const base = rawUrl.startsWith('/') ? `http://localhost${rawUrl}` : rawUrl;
        const url = new URL(base);
        playlist = url.searchParams.get('playlist') ??
                   url.searchParams.get('bucketId')?.split(':')?.[3] ??
                   undefined;
      } catch {
        playlist = undefined;
      }
      handleMatchmaking(ws as any, playlist);
    });

    mmWss.on('listening', () => {
      backend(`Matchmaker WebSocket listening on port ${mmPort}`);
    });

    mmWss.on('error', (err) => {
      backend(`Matchmaker WebSocket error: ${err.message}`);
    });
    // ────────────────────────────────────────────────────────────────────────

    if (config.discord.useBot) {
      await startDiscordBot();
    }

    app.listen(config.port, () => {
      backend(`running on port ${config.port}`);
      backend(`discord bot: ${config.discord.useBot ? 'on' : 'off'}`);
      backend(`mongodb: connected`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

export default app;
