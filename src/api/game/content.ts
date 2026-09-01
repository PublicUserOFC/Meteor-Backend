import express, { Request, Response, Router } from 'express';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

const router: Router = express.Router();
const DATA = path.join(__dirname, '..', '..', '..', 'Base');

function getDisplayAssets(templateId: string): { displayAssetPath: string; newDisplayAssetPath: string } {
  const parts = templateId.split(':');
  if (parts.length < 2) return { displayAssetPath: '', newDisplayAssetPath: '' };
  const id = parts[1];
  return {
    displayAssetPath: `/Game/Catalog/DisplayAssets/DA_Featured_${id}.DA_Featured_${id}`,
    newDisplayAssetPath: `/Game/Catalog/NewDisplayAssets/DAv2_Featured_${id}.DAv2_Featured_${id}`,
  };
}

function buildCatalog() {
  // Use catalog.json as the base so all existing storefronts are preserved
  let base: any;
  const catalogPath = path.join(DATA, 'responses', 'catalog.json');
  try {
    base = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  } catch {
    base = {
      refreshIntervalHrs: 24,
      dailyPurchaseHrs: 24,
      expiration: new Date(Date.now() + 3600000).toISOString(),
      storefronts: [
        { name: 'BRWeeklyStorefront', catalogEntries: [] },
        { name: 'BRDailyStorefront', catalogEntries: [] },
      ],
    };
  }

  // Update expiration to 1 hour from now so the game doesn't cache stale data
  base.expiration = new Date(Date.now() + 3600000).toISOString();

  // CRITICAL: Ensure CurrencyStorefront exists - this is required for the shop tab to appear!
  if (!base.storefronts.find((s: any) => s.name === 'CurrencyStorefront')) {
    console.log('[CATALOG] Adding CurrencyStorefront - REQUIRED for shop tab visibility!');
    base.storefronts.unshift({
      name: 'CurrencyStorefront',
      catalogEntries: [
        {
          offerId: '09176E2848D642F6B426A5E8D8E94E3E',
          devName: 'MtxPack1000',
          offerType: 'StaticPrice',
          prices: [{ currencyType: 'RealMoney', currencySubType: '', regularPrice: 0, dynamicRegularPrice: -1, finalPrice: 0, saleExpiration: '9999-12-31T23:59:59.999Z', basePrice: 0 }],
          categories: [], dailyLimit: -1, weeklyLimit: -1, monthlyLimit: -1, refundable: false,
          appStoreId: ['a7f138b2e51945ffbfdacc1af0541053', '', '', '', '', '', '', '', '', ''],
          requirements: [], metaInfo: [{ key: 'MtxQuantity', value: '1000' }, { key: 'MtxBonus', value: '0' }, { key: 'IconSize', value: 'Small' }],
          catalogGroup: '', catalogGroupPriority: 0, sortPriority: 10,
          title: '1,000 V-Bucks', shortDescription: '', description: 'Buy 1,000 Fortnite V-Bucks',
          displayAssetPath: '/Game/Catalog/DisplayAssets/DA_MtxPack1000.DA_MtxPack1000', itemGrants: []
        },
        {
          offerId: '2B8B8E2B4E3A4B5C9D1E2F3A4B5C6D7E',
          devName: 'MtxPack2800',
          offerType: 'StaticPrice',
          prices: [{ currencyType: 'RealMoney', currencySubType: '', regularPrice: 0, dynamicRegularPrice: -1, finalPrice: 0, saleExpiration: '9999-12-31T23:59:59.999Z', basePrice: 0 }],
          categories: [], dailyLimit: -1, weeklyLimit: -1, monthlyLimit: -1, refundable: false,
          appStoreId: ['a7f138b2e51945ffbfdacc1af0541053', '', '', '', '', '', '', '', '', ''],
          requirements: [], metaInfo: [{ key: 'MtxQuantity', value: '2800' }, { key: 'MtxBonus', value: '300' }, { key: 'IconSize', value: 'Medium' }],
          catalogGroup: '', catalogGroupPriority: 0, sortPriority: 9,
          title: '2,800 V-Bucks', shortDescription: '', description: 'Buy 2,800 Fortnite V-Bucks',
          displayAssetPath: '/Game/Catalog/DisplayAssets/DA_MtxPack2800.DA_MtxPack2800', itemGrants: []
        },
        {
          offerId: '425FDD804D9D61AC2530CE8F31398BCD',
          devName: 'MtxPack7800',
          offerType: 'StaticPrice',
          prices: [{ currencyType: 'RealMoney', currencySubType: '', regularPrice: 0, dynamicRegularPrice: -1, finalPrice: 0, saleExpiration: '9999-12-31T23:59:59.999Z', basePrice: 0 }],
          categories: [], dailyLimit: -1, weeklyLimit: -1, monthlyLimit: -1, refundable: false,
          appStoreId: ['a7f138b2e51945ffbfdacc1af0541053', '', '', '', '', '', '', '', '', ''],
          requirements: [], metaInfo: [{ key: 'MtxQuantity', value: '7800' }, { key: 'MtxBonus', value: '800' }, { key: 'IconSize', value: 'Large' }],
          catalogGroup: '', catalogGroupPriority: 0, sortPriority: 8,
          title: '7,800 V-Bucks', shortDescription: '', description: 'Buy 7,800 Fortnite V-Bucks',
          displayAssetPath: '/Game/Catalog/DisplayAssets/DA_MtxPack7800.DA_MtxPack7800', itemGrants: []
        },
        {
          offerId: '5C6D7E8F9A0B1C2D3E4F5A6B7C8D9E0F',
          devName: 'MtxPack13500',
          offerType: 'StaticPrice',
          prices: [{ currencyType: 'RealMoney', currencySubType: '', regularPrice: 0, dynamicRegularPrice: -1, finalPrice: 0, saleExpiration: '9999-12-31T23:59:59.999Z', basePrice: 0 }],
          categories: [], dailyLimit: -1, weeklyLimit: -1, monthlyLimit: -1, refundable: false,
          appStoreId: ['a7f138b2e51945ffbfdacc1af0541053', '', '', '', '', '', '', '', '', ''],
          requirements: [], metaInfo: [{ key: 'MtxQuantity', value: '13500' }, { key: 'MtxBonus', value: '1500' }, { key: 'IconSize', value: 'Large' }],
          catalogGroup: '', catalogGroupPriority: 0, sortPriority: 7,
          title: '13,500 V-Bucks', shortDescription: '', description: 'Buy 13,500 Fortnite V-Bucks',
          displayAssetPath: '/Game/Catalog/DisplayAssets/DA_MtxPack13500.DA_MtxPack13500', itemGrants: []
        }
      ]
    });
  }

  // Clear BRSeasonStorefront entries from base catalog as we'll rebuild them
  const seasonStorefront = base.storefronts.find((s: any) => s.name === 'BRSeasonStorefront');
  if (seasonStorefront) {
    seasonStorefront.catalogEntries = [];
  }

  // Build dynamic shop entries from shop.json and inject into BRWeeklyStorefront and BRDailyStorefront
  const shopPath = path.join(DATA, 'shop.json');
  if (fs.existsSync(shopPath)) {
    const shop = JSON.parse(fs.readFileSync(shopPath, 'utf-8'));
    const featured: any[] = [];
    const daily: any[] = [];

    for (const [key, value] of Object.entries(shop) as [string, any][]) {
      if (!key.startsWith('daily') && !key.startsWith('featured')) continue;
      if (!value?.itemGrants?.length) continue;

      const isFeatured = key.startsWith('featured');
      const sectionId = isFeatured ? 'Featured' : 'Daily';
      const tileSize = isFeatured ? 'Normal' : 'Small';

      for (const templateId of value.itemGrants) {
        const { displayAssetPath, newDisplayAssetPath } = getDisplayAssets(templateId);

        const entry = {
          offerId: `v2:/${key}`,
          offerType: 'StaticPrice',
          devName: `[VIRTUAL] 1x ${templateId} for ${value.price} MtxCurrency`,
          itemGrants: [{ templateId, quantity: 1 }],
          requirements: [{ requirementType: 'DenyOnItemOwnership', requiredId: templateId, minQuantity: 1 }],
          categories: [],
          metaInfo: [
            { key: 'DisplayAssetPath', value: displayAssetPath },
            { key: 'NewDisplayAssetPath', value: newDisplayAssetPath },
            { key: 'TileSize', value: tileSize },
            { key: 'SectionId', value: sectionId },
          ],
          meta: { NewDisplayAssetPath: newDisplayAssetPath, displayAssetPath, SectionId: sectionId, TileSize: tileSize },
          catalogGroup: '',
          catalogGroupPriority: 0,
          giftInfo: { bIsEnabled: true, forcedGiftBoxTemplateId: '', purchaseRequirements: [{ requirementType: 'DenyOnItemOwnership', requiredId: templateId, minQuantity: 1 }], giftRecordIds: [] },
          prices: [{ currencyType: 'MtxCurrency', currencySubType: '', regularPrice: value.price, finalPrice: value.price, dynamicRegularPrice: -1, basePrice: value.price, saleExpiration: '9999-12-31T23:59:59.999Z' }],
          bannerOverride: '',
          displayAssetPath,
          NewDisplayAssetPath: newDisplayAssetPath,
          refundable: true,
          title: '',
          description: '',
          shortDescription: '',
          appStoreId: [],
          fulfillmentIds: [],
          dailyLimit: -1,
          weeklyLimit: -1,
          monthlyLimit: -1,
          sortPriority: isFeatured ? 1 : 0,
          filterWeight: 0,
          shopOfferVisuals: {
            displayAssetPath,
            newDisplayAssetPath,
            visualsList: [],
            visuals: []
          },
        };

        if (isFeatured) {
          featured.push(entry);
        } else {
          daily.push(entry);
        }
      }
    }

    // Replace BRWeeklyStorefront entries with featured items
    const weekly_sf = base.storefronts.find((s: any) => s.name === 'BRWeeklyStorefront');
    if (weekly_sf) {
      weekly_sf.catalogEntries = featured;
    } else {
      base.storefronts.push({ name: 'BRWeeklyStorefront', catalogEntries: featured });
    }

    // Replace BRDailyStorefront entries with daily items
    const daily_sf = base.storefronts.find((s: any) => s.name === 'BRDailyStorefront');
    if (daily_sf) {
      daily_sf.catalogEntries = daily;
    } else {
      base.storefronts.push({ name: 'BRDailyStorefront', catalogEntries: daily });
    }
  }

  return base;
}

router.get('/fortnite/api/storefront/v2/catalog', (_req: Request, res: Response) => {
  console.log('\n\n========================================');
  console.log('🛒 CATALOG ENDPOINT CALLED!');
  console.log('========================================\n');
  
  try {
    // Build catalog from Base/shop.json (this is your custom shop)
    console.log('[CATALOG] Building catalog from Base/shop.json');
    const catalog = buildCatalog();
    console.log('[CATALOG] Built catalog with storefronts:', catalog.storefronts.map((s: any) => `${s.name} (${s.catalogEntries?.length || 0} items)`).join(', '));
    
    const bpSeason = parseInt(process.env.BATTLEPASS_SEASON || '19', 10);
    const bpFile = path.join(DATA, 'responses', 'Athena', 'BattlePass', `Season${bpSeason}.json`);

    if (fs.existsSync(bpFile)) {
      const bp = JSON.parse(fs.readFileSync(bpFile, 'utf-8'));
      const pad = String(bpSeason).padStart(2, '0');
      const displayAsset = `/Game/Catalog/DisplayAssets/DA_Featured_BattlePass_S${pad}.DA_Featured_BattlePass_S${pad}`;
      const newDisplayAsset = `/Game/Catalog/NewDisplayAssets/DA_Featured_BattlePass_S${pad}.DA_Featured_BattlePass_S${pad}`;

      const mkEntry = (offerId: string, isBundle: boolean = false, isTier: boolean = false) => ({
        offerId,
        offerType: 'StaticPrice',
        devName: isTier
          ? `[VIRTUAL]Battle Pass Tier for 0 MtxCurrency`
          : isBundle
            ? `[VIRTUAL]Battle Bundle for 0 MtxCurrency`
            : `[VIRTUAL]Battle Pass for 0 MtxCurrency`,
        itemGrants: [],
        requirements: [],
        categories: [],
        metaInfo: [
          { key: 'DisplayAssetPath', value: displayAsset },
          { key: 'NewDisplayAssetPath', value: newDisplayAsset },
          { key: 'TileSize', value: 'DoubleWide' },
          { key: 'SectionId', value: 'BattlePass' },
        ],
        meta: {
          NewDisplayAssetPath: newDisplayAsset,
          displayAssetPath: displayAsset,
          SectionId: 'BattlePass',
          TileSize: 'DoubleWide',
        },
        catalogGroup: isTier ? 'BattlePassTier' : isBundle ? 'BattleBundle' : 'BattlePass',
        catalogGroupPriority: isTier ? 0 : isBundle ? 1 : 2,
        giftInfo: { bIsEnabled: false, forcedGiftBoxTemplateId: '', purchaseRequirements: [], giftRecordIds: [] },
        prices: [{
          currencyType: 'MtxCurrency',
          currencySubType: '',
          regularPrice: 0,
          finalPrice: 0,
          dynamicRegularPrice: 0,
          basePrice: 0,
          saleExpiration: '9999-12-31T23:59:59.999Z',
        }],
        bannerOverride: '',
        displayAssetPath: displayAsset,
        NewDisplayAssetPath: newDisplayAsset,
        refundable: false,
        title: isTier ? 'Battle Pass Tier' : isBundle ? 'Battle Bundle' : 'Battle Pass',
        description: isTier
          ? 'Skip ahead one Battle Pass level!'
          : isBundle
            ? 'Get the Battle Pass and jump ahead 25 Battle Pass levels!'
            : 'Level Up and Claim rewards!',
        shortDescription: isTier ? 'Battle Pass Tier' : isBundle ? 'Battle Bundle' : 'Battle Pass',
        appStoreId: [],
        fulfillmentIds: [],
        dailyLimit: -1,
        weeklyLimit: -1,
        monthlyLimit: -1,
        sortPriority: isTier ? 0 : isBundle ? 1 : 2,
        filterWeight: 0,
        shopOfferVisuals: {
          displayAssetPath: displayAsset,
          newDisplayAssetPath: newDisplayAsset,
          visualsList: [],
          visuals: []
        },
      });

      const bpEntries = [
        mkEntry(bp.battlePassOfferId, false, false),
        mkEntry(bp.battleBundleOfferId, true, false),
        mkEntry(bp.tierOfferId, false, true),
      ];

      // Find existing BRSeasonStorefront and replace its entries, or add one
      const existing = catalog.storefronts.find((s: any) => s.name === 'BRSeasonStorefront');
      if (existing) {
        existing.catalogEntries = bpEntries;
      } else {
        catalog.storefronts.push({ name: 'BRSeasonStorefront', catalogEntries: bpEntries });
      }
    }

    // Log final catalog state
    const weeklyItems = catalog.storefronts.find((s: any) => s.name === 'BRWeeklyStorefront')?.catalogEntries?.length || 0;
    const dailyItems = catalog.storefronts.find((s: any) => s.name === 'BRDailyStorefront')?.catalogEntries?.length || 0;
    console.log(`[CATALOG] Serving catalog: ${weeklyItems} featured items, ${dailyItems} daily items`);
    
    res.json(catalog);
  } catch (e) {
    console.error('[CATALOG] Error:', e);
    res.status(500).json({ error: 'Failed to load catalog' });
  }
});

router.get('/fortnite/api/storefront/v2/keychain', (_req: Request, res: Response) => {
  try { res.json(JSON.parse(fs.readFileSync(path.join(DATA, 'responses', 'keychain.json'), 'utf-8'))); } catch { res.json([]); }
});

router.get('/fortnite/api/storefront/v2/gift/check_eligibility/recipient/:recipientId/profile/:profileId', (_req: Request, res: Response) => {
  res.json({ eligibility: 'ELIGIBLE', ownedOfferIds: [] });
});

router.get('/fortnite/api/storefront/v2/gift/check_eligibility/recipient/:friendId/offer/:offerId', (_req: Request, res: Response) => {
  res.json({ price: { currencyType: 'MtxCurrency', currencySubType: '', regularPrice: 0, dynamicRegularPrice: 0, finalPrice: 0, saleExpiration: '9999-12-31T23:59:59.999Z', basePrice: 0 }, items: [] });
});

router.get('/fortnite/api/game/v2/receipts/:accountId', (_req: Request, res: Response) => {
  res.json([]);
});

router.get('/catalog/api/shared/bulk/offers', (_req: Request, res: Response) => res.json({}));

router.get('/fortnite/api/cloudstorage/system', (_req: Request, res: Response) => {
  console.log('[CLOUDSTORAGE] Game requested system cloudstorage file list');
  const dir = path.join(DATA, 'CloudStorage');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const files = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.ini')).map(name => {
    const buf = fs.readFileSync(path.join(dir, name));
    const stat = fs.statSync(path.join(dir, name));
    return { uniqueFilename: name, filename: name, hash: crypto.createHash('sha1').update(buf).digest('hex'), hash256: crypto.createHash('sha256').update(buf).digest('hex'), length: buf.length, contentType: 'application/octet-stream', uploaded: stat.mtime, storageType: 'S3', storageIds: {}, doNotCache: false };
  });
  console.log('[CLOUDSTORAGE] Returning files:', files.map(f => f.filename).join(', '));
  res.json(files);
});

router.get('/fortnite/api/cloudstorage/system/:file', (req: Request, res: Response) => {
  console.log('[CLOUDSTORAGE] Game requested file:', req.params.file);
  if (req.params.file.includes('..') || req.params.file.includes('~')) return res.status(404).end();

  if (req.params.file === 'DefaultGame.ini') {
    // DefaultGame.ini served from CloudStorage directory below
  }

  const file = path.join(DATA, 'CloudStorage', path.basename(req.params.file));
  if (fs.existsSync(file)) {
    console.log('[CLOUDSTORAGE] Serving file:', req.params.file, 'Size:', fs.statSync(file).size, 'bytes');
    return res.status(200).send(fs.readFileSync(file));
  }
  console.log('[CLOUDSTORAGE] File not found:', req.params.file);
  res.status(200).end();
});

router.get('/fortnite/api/cloudstorage/user/:accountId', (_req: Request, res: Response) => res.json([]));
router.get('/fortnite/api/cloudstorage/user/config', (_req: Request, res: Response) => {
  res.json({ lastUpdated: new Date().toISOString(), disableV2: false, isAuthenticated: true, enumerateFilesPath: '/api/cloudstorage/user', enableMigration: false, enableWrites: true, epicAppName: 'Live', transports: { McpProxyTransport: { name: 'McpProxyTransport', type: 'ProxyStreamingFile', appName: 'fortnite', isEnabled: true, isRequired: true, isPrimary: true, timeoutSeconds: 30, priority: 10 } } });
});
router.get('/fortnite/api/cloudstorage/user/:accountId/:file', (_req: Request, res: Response) => res.status(204).end());
router.put('/fortnite/api/cloudstorage/user/:accountId/:file', (_req: Request, res: Response) => res.status(204).end());
router.post('/fortnite/api/cloudstorage/user/:accountId', (_req: Request, res: Response) => res.status(204).end());
router.delete('/fortnite/api/cloudstorage/user/:accountId/:file', (_req: Request, res: Response) => res.status(200).end());

export default router;
