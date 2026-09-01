import express, { Request, Response, Router } from 'express';
import { config } from '../../config';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { getDiscordClient } from '../../discord/bot';

const router: Router = express.Router();

const MOTD_PATH = path.join(__dirname, '..', '..', '..', 'Base', 'responses', 'motdTarget.json');
const NEWS_PATH = path.join(__dirname, '..', '..', '..', 'Base', 'news.json');

// ── News Store ────────────────────────────────────────────────────────────────
interface NewsItem {
  id: string | number;
  image: string;
  author: string;
  title: string;
  message: string;
}

function loadNewsFromFile(): NewsItem[] {
  try {
    const items: any[] = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
    return items.map((n: any, i: number) => ({
      id: n.id ?? i + 1,
      image: n.image || '',
      author: n.author || 'MeteorStaff',
      title: n.title || '',
      message: n.body || n.message || '',
    }));
  } catch {
    return [{
      id: 1,
      image: 'https://cdn2.unrealengine.com/t-bp19-lobby-xmas-2048x1024-f85d2684b4af.png',
      author: 'MeteorStaff',
      title: 'Welcome to Meteor!',
      message: 'Welcome to the Meteorprivate server. Enjoy your stay!',
    }];
  }
}

let newsVersion = Date.now().toString();

// Watch news.json for changes and bump version so launcher polls fresh
try { fs.watch(NEWS_PATH, () => { newsVersion = Date.now().toString(); }); } catch { /* unavailable */ }

// GET news — reads live from news.json
router.get('/launcher/api/news', (_req: Request, res: Response) => {
  res.json(loadNewsFromFile());
});

// GET news version
router.get('/launcher/api/news/version', (_req: Request, res: Response) => {
  res.json({ version: newsVersion });
});

// POST news — appends to news.json (requires API key)
router.post('/launcher/api/news', (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey !== config.api.apiKey) return res.status(401).json({ error: 'Unauthorized' });

  const { image, author, title, message } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'title and message are required' });

  try {
    const items: any[] = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
    const newItem = { id: `news-${Date.now()}`, title, body: message, image: image || '', tileImage: image || '', author: author || 'MeteorStaff', websiteURL: '', websiteButtonText: 'Join Discord', hidden: false, spotlight: false, sortingPriority: 0 };
    items.unshift(newItem);
    fs.writeFileSync(NEWS_PATH, JSON.stringify(items, null, 2));
    newsVersion = Date.now().toString();
    return res.status(201).json({ id: newItem.id, image: newItem.image, author: newItem.author, title, message });
  } catch { return res.status(500).json({ error: 'Failed to write news.json' }); }
});

// DELETE news item by id (requires API key)
router.delete('/launcher/api/news/:id', (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey !== config.api.apiKey) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const items: any[] = JSON.parse(fs.readFileSync(NEWS_PATH, 'utf-8'));
    const before = items.length;
    const filtered = items.filter((n: any) => String(n.id) !== req.params.id);
    if (filtered.length === before) return res.status(404).json({ error: 'News item not found' });
    fs.writeFileSync(NEWS_PATH, JSON.stringify(filtered, null, 2));
    newsVersion = Date.now().toString();
    return res.json({ success: true });
  } catch { return res.status(500).json({ error: 'Failed to write news.json' }); }
});

// ── Shop Store ────────────────────────────────────────────────────────────────
interface ShopItem {
  id: string;
  name: string;
  description: string;
  price: number;
  regularPrice?: number;
  offerId?: string;
  section?: 'featured' | 'daily';
  isBundle?: boolean;
  images: { featured?: string; icon: string; smallIcon?: string };
  rarity: { value: string; displayValue: string };
  type?: { value: string; displayValue: string };
}

let shopCache: ShopItem[] = [];
let shopCacheTime = 0;
const SHOP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function rarityFromPrice(price: number): { value: string; displayValue: string } {
  if (price >= 2000) return { value: 'legendary', displayValue: 'Legendary' };
  if (price >= 1500) return { value: 'epic', displayValue: 'Epic' };
  if (price >= 1200) return { value: 'rare', displayValue: 'Rare' };
  if (price >= 800)  return { value: 'uncommon', displayValue: 'Uncommon' };
  return { value: 'common', displayValue: 'Common' };
}

async function buildShopItems(): Promise<ShopItem[]> {
  const shopPath = path.join(process.cwd(), 'Base', 'shop.json');
  let shopJson: Record<string, { itemGrants: string[]; price: number }> = {};

  try {
    shopJson = JSON.parse(fs.readFileSync(shopPath, 'utf-8'));
  } catch {
    return [];
  }

  const items: ShopItem[] = [];

  for (const [key, entry] of Object.entries(shopJson)) {
    const section: 'featured' | 'daily' = key.startsWith('featured') ? 'featured' : 'daily';
    const templateId = entry.itemGrants?.[0];
    if (!templateId) continue;

    const cosmeticId = templateId.split(':')[1];
    if (!cosmeticId) continue;

    try {
      const r = await fetch(`https://fortnite-api.com/v2/cosmetics/br/${cosmeticId}`, {
        signal: AbortSignal.timeout(8000) as any,
      });
      if (!r.ok) continue;
      const d = await r.json() as any;
      if (d.status !== 200 || !d.data) continue;

      const cosmetic = d.data;
      items.push({
        id: cosmetic.id,
        offerId: key,
        name: cosmetic.name,
        description: cosmetic.description ?? '',
        price: entry.price,
        section,
        images: {
          featured: cosmetic.images?.featured ?? undefined,
          icon: cosmetic.images?.icon ?? '',
          smallIcon: cosmetic.images?.smallIcon ?? undefined,
        },
        rarity: cosmetic.rarity
          ? { value: cosmetic.rarity.value, displayValue: cosmetic.rarity.displayValue }
          : rarityFromPrice(entry.price),
        type: cosmetic.type
          ? { value: cosmetic.type.value, displayValue: cosmetic.type.displayValue }
          : undefined,
      });
    } catch {
      // skip items that fail to fetch
      continue;
    }
  }

  return items;
}

// GET shop — enriched with cosmetic data from fortnite-api.com
router.get('/launcher/api/shop', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (shopCache.length > 0 && now - shopCacheTime < SHOP_CACHE_TTL) {
    return res.json(shopCache);
  }

  try {
    const items = await buildShopItems();
    shopCache = items;
    shopCacheTime = now;
    return res.json(items);
  } catch {
    return res.status(500).json({ error: 'Failed to build shop' });
  }
});

// POST /launcher/api/shop/refresh — force refresh the shop cache (requires API key)
router.post('/launcher/api/shop/refresh', async (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  if (apiKey !== config.api.apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const items = await buildShopItems();
    shopCache = items;
    shopCacheTime = Date.now();
    return res.json({ success: true, count: items.length });
  } catch {
    return res.status(500).json({ error: 'Failed to refresh shop' });
  }
});

// ── User Register ─────────────────────────────────────────────────────────────
router.post('/api/user/register', async (req: Request, res: Response) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({ error: 'username, password, and email are required' });
  }

  if (username.length < 3 || username.length > 26) {
    return res.status(400).json({ error: 'Username must be between 3 and 26 characters' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const { User } = await import('../../models/User');
    const { Profile } = await import('../../models/Profile');
    const { createProfiles } = await import('../../core/profile');
    const { MakeID } = await import('../../core/utils');

    const existing = await User.findOne({
      $or: [
        { username_lower: username.toLowerCase() },
        { email: email.toLowerCase() },
      ],
    });

    if (existing) {
      return res.status(409).json({ error: 'Username or email already taken' });
    }

    const accountId = MakeID().replace(/-/g, '');
    const hashedPassword = await Bun.password.hash(password);

    const user = new User({
      accountId,
      username,
      username_lower: username.toLowerCase(),
      email: email.toLowerCase(),
      password: hashedPassword,
      matchmakingId: MakeID().replace(/-/g, ''),
      banned: false,
    });

    await user.save();

    const profiles = createProfiles(accountId);
    await new Profile({ accountId, profiles }).save();

    // Create Friends document so presence and friend requests work immediately
    const { Friends } = await import('../../models/Friends');
    await new Friends({
      accountId,
      list: { accepted: [], incoming: [], outgoing: [], blocked: [] },
    }).save();

    return res.status(201).json({
      success: true,
      accountId,
      username,
      email: email.toLowerCase(),
      displayName: username,
    });
  } catch (error) {
    console.error('[REGISTER] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── User Login ────────────────────────────────────────────────────────────────
router.post('/api/user/login', async (req: Request, res: Response) => {
  console.log('[LOGIN] Full request body:', JSON.stringify(req.body, null, 2));
  
  const { username, password, email } = req.body;
  const loginIdentifier = username || email || req.body.identifier || req.body.user;
  
  console.log('[LOGIN] Attempt:', { username, email, loginIdentifier, hasPassword: !!password });

  if (!loginIdentifier || !password) {
    console.log('[LOGIN] Missing credentials');
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const { User } = await import('../../models/User');
    const user = await User.findOne({
      $or: [
        { username_lower: loginIdentifier.toLowerCase() },
        { email: loginIdentifier.toLowerCase() },
      ],
    });

    if (!user) {
      console.log('[LOGIN] User not found:', loginIdentifier);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    console.log('[LOGIN] User found:', user.username);

    const validPassword = await Bun.password.verify(password, user.password);
    if (!validPassword) {
      console.log('[LOGIN] Invalid password for:', loginIdentifier);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.banned) {
      console.log('[LOGIN] User is banned:', loginIdentifier);
      return res.status(403).json({ error: 'Your account has been banned' });
    }

    console.log('[LOGIN] Success:', user.username);
    // Return user data for the launcher
    return res.json({
      success: true,
      accountId: user.accountId,
      username: user.username,
      email: user.email,
      displayName: user.username,
      discordId: user.discordId ?? null,
    });
  } catch (error) {
    console.error('[LOGIN] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── User Profile ──────────────────────────────────────────────────────────────
router.get('/api/user/profile/:accountId', async (req: Request, res: Response) => {
  try {
    const { User } = await import('../../models/User');
    const user = await User.findOne({ accountId: req.params.accountId }).lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Try to resolve Discord avatar via the bot client
    let discordAvatar: string | null = null;
    if (user.discordId) {
      try {
        const discordClient = getDiscordClient();
        if (discordClient) {
          const discordUser = await discordClient.users.fetch(user.discordId);
          if (discordUser) {
            discordAvatar = discordUser.displayAvatarURL({ size: 128, extension: 'png' });
          }
        }
      } catch {
        // Bot unavailable or user not found — use default Discord avatar
        discordAvatar = `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discordId) % 5}.png`;
      }
    }

    return res.json({
      accountId: user.accountId,
      displayName: user.username,
      username: user.username,
      email: user.email,
      discordId: user.discordId ?? null,
      discordAvatar,
      lastUsernameChange: null,
      role: null,
    });
  } catch (error) {
    console.error('[PROFILE] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/launcher/api/public/launcher/status', (_req: Request, res: Response) => {
  res.json({ status: 'UP', message: 'Launcher is online' });
});

router.get('/launcher/api/public/assets/:platform/:catalogItemId/:appName', (req: Request, res: Response) => {
  res.json({
    appName: req.params.appName,
    labelName: `Live-${req.params.platform}`,
    buildVersion: 'Meteor',
    catalogItemId: req.params.catalogItemId,
    expires: '9999-12-31T23:59:59.999Z',
    items: {
      MANIFEST: {
        signature: 'Meteor',
        distribution: 'http://127.0.0.1:5353/',
        path: 'Builds/Fortnite/Content/CloudDir/Meteor.manifest',
        additionalDistributions: [],
      },
    },
    assetId: req.params.appName,
  });
});

router.get('/launcher/api/public/assets/v2/platform/:platform/catalogItem/:catalogItemId/app/:appName/label/:label', (req: Request, res: Response) => {
  res.json({
    appName: req.params.appName,
    labelName: `${req.params.label}-${req.params.platform}`,
    buildVersion: 'Meteor',
    catalogItemId: req.params.catalogItemId,
    expires: '9999-12-31T23:59:59.999Z',
    items: {
      MANIFEST: {
        signature: 'Meteor',
        distribution: 'http://127.0.0.1:5353/',
        path: 'Builds/Fortnite/Content/CloudDir/Meteor.manifest',
        additionalDistributions: [],
      },
    },
    assetId: req.params.appName,
  });
});

router.get('/launcher/api/public/distributionpoints/', (_req: Request, res: Response) => {
  res.json({
    distributions: [
      'http://127.0.0.1:5353/',
      'https://download.epicgames.com/',
      'https://epicgames-download1.akamaized.net/',
      'https://fastly-download.epicgames.com/',
    ],
  });
});

router.get('/launcher/api/public/installedApps', (_req: Request, res: Response) => {
  res.json([]);
});

router.get('/entitlement/api/account/:accountId/entitlements', (_req: Request, res: Response) => {
  res.json([]);
});

router.get('/catalog/api/shared/bulk/offers', (_req: Request, res: Response) => {
  res.json({});
});

router.get('/waitingroom/api/waitingroom', (_req: Request, res: Response) => {
  res.status(204).end();
});

router.get('/launcher/api/public/versioncheck', (_req: Request, res: Response) => {
  res.json({ type: 'NO_UPDATE' });
});

router.get('/launcher/api/public/buildinfo', (_req: Request, res: Response) => {
  res.json({ buildVersion: 'Meteor', appName: 'Fortnite' });
});

export default router;
