import express, { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { GetVersionInfo, getContentPages } from '../../core/utils';

const router: Router = express.Router();
const DATA = path.join(__dirname, '..', '..', '..', 'Base', 'responses');

function getDiscovery() {
  return JSON.parse(fs.readFileSync(path.join(DATA, 'Discovery', 'discovery_frontend.json'), 'utf-8'));
}

function getDiscoveryV2() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'NeoniteV2', 'discovery', 'discoveryMenuV2.json'), 'utf-8'));
  } catch {
    return [];
  }
}

router.get('/content/api/pages/fortnite-game/spark-tracks', (_req: Request, res: Response) => res.json(JSON.parse(fs.readFileSync(path.join(DATA, 'sparkTracks.json'), 'utf-8'))));
router.get('/content/api/pages/fortnite-game/', (req: Request, res: Response) => {
  console.log('📄 FORTNITE-GAME CONTENTPAGES ENDPOINT CALLED!');
  res.json(getContentPages(req));
});
router.get('/content/api/pages/fortnite-game', (req: Request, res: Response) => {
  console.log('📄 FORTNITE-GAME CONTENTPAGES ENDPOINT CALLED (no slash)!');
  res.json(getContentPages(req));
});
router.get('/content/api/pages/*', (req: Request, res: Response) => res.json(getContentPages(req)));

function buildMotdFromNews(tags: string[] = []) {
  const newsPath = path.join(__dirname, '..', '..', '..', 'Base', 'news.json');
  let newsItems: any[] = [];
  try {
    newsItems = JSON.parse(fs.readFileSync(newsPath, 'utf-8'));
  } catch { newsItems = []; }

  const contentItems = newsItems
    .filter((n: any) => !n.hidden)
    .map((n: any, i: number) => ({
      contentType: 'motd',
      contentFields: {
        title: n.title || 'Welcome',
        body: n.body || '',
        image: n.image || n.tileImage || '',
        tileImage: n.tileImage || n.image || '',
        hidden: false,
        messagetype: 'normal',
        spotlight: n.spotlight || false,
        websiteURL: n.websiteURL || '',
        websiteButtonText: n.websiteButtonText || '',
        sortingPriority: n.sortingPriority ?? i,
      },
      placements: tags.map((tag: string, pos: number) => ({
        trackingId: `helix_${n.id || i}`,
        tag,
        position: pos,
      })),
    }));

  return { contentItems, contentItemResponse: [], responseVersion: 1 };
}

router.post('/api/v1/fortnite-br/surfaces/motd/target', (req: Request, res: Response) => {
  res.json(buildMotdFromNews(req.body?.tags || []));
});

router.post('/api/v1/fortnite-br/surfaces/:surface/target', (req: Request, res: Response) => {
  res.json(buildMotdFromNews(req.body?.tags || []));
});

router.post('*/api/v2/discovery/surface/*', (_req: Request, res: Response) => {
  // Return Neonite-compatible discovery data for version 28.30
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

router.post('*/discovery/surface/*', (_req: Request, res: Response) => {
  // Return Neonite-compatible discovery data for version 28.30
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

router.get('/fortnite/api/discovery/accessToken/:branch', (req: Request, res: Response) => res.json({ branchName: req.params.branch, appId: 'Fortnite', token: 'helixbackend' }));

router.post('/links/api/fn/mnemonic', (_req: Request, res: Response) => {
  const discoveryV2 = getDiscoveryV2();
  res.json(discoveryV2);
});

router.get('/links/api/fn/mnemonic/:playlist/related', (req: Request, res: Response) => {
  const discoveryV2 = getDiscoveryV2();
  const relatedResponse = {
    parentLinks: [] as any[],
    links: {} as any
  };
  
  const findPlaylist = discoveryV2.find((i: any) => i.mnemonic === req.params.playlist);
  if (findPlaylist) {
    if (findPlaylist.metadata && findPlaylist.metadata["sub_link_codes"]) {
      relatedResponse.parentLinks.push(findPlaylist);
      for (const subLinkCode of findPlaylist.metadata.sub_link_codes) {
        const subLink = discoveryV2.find((i: any) => i.mnemonic === subLinkCode);
        if (subLink) {
          relatedResponse.links[subLinkCode] = subLink;
        }
      }
    } else {
      relatedResponse.links[findPlaylist.mnemonic] = findPlaylist;
      if (findPlaylist.metadata && findPlaylist.metadata.parent_set) {
        const parentSet = discoveryV2.find((i: any) => i.mnemonic === findPlaylist.metadata.parent_set);
        if (parentSet && parentSet.metadata && parentSet.metadata["sub_link_codes"]) {
          relatedResponse.parentLinks.push(parentSet);
          const existingLinks = new Set(Object.keys(relatedResponse.links));
          parentSet.metadata["sub_link_codes"].forEach((code: string) => {
            const matchingResult = discoveryV2.find((i: any) => i.mnemonic === code);
            if (matchingResult && !existingLinks.has(code)) {
              relatedResponse.links[code] = matchingResult;
            }
          });
        }
      }
    }
  }
  
  res.json(relatedResponse);
});

router.get('/links/api/fn/mnemonic/*', (req: Request, res: Response) => {
  const discoveryV2 = getDiscoveryV2();
  const playlistId = req.url.split('/').slice(-1)[0];
  const match = discoveryV2.find((r: any) => r.mnemonic === playlistId);
  res.json(match || {});
});

router.get('/fortnite/api/calendar/v1/timeline', (req: Request, res: Response) => {
  const memory = GetVersionInfo(req);
  const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
  const beforeMidnight = new Date(midnight.getTime() - 60000);
  res.json({ channels: { 'client-matchmaking': { states: [], cacheExpire: '9999-01-01T00:00:00.000Z' }, 'client-events': { states: [{ validFrom: '2020-01-01T00:00:00.000Z', activeEvents: [{ eventType: `EventFlag.Season${memory.season}`, activeUntil: '9999-01-01T00:00:00.000Z', activeSince: '2020-01-01T00:00:00.000Z' }, { eventType: `EventFlag.${memory.lobby}`, activeUntil: '9999-01-01T00:00:00.000Z', activeSince: '2020-01-01T00:00:00.000Z' }], state: { activeStorefronts: [], eventNamedWeights: {}, seasonNumber: memory.season, seasonTemplateId: `AthenaSeason:athenaseason${memory.season}`, matchXpBonusPoints: 0, seasonBegin: '2020-01-01T00:00:00.000Z', seasonEnd: '9999-01-01T00:00:00.000Z', seasonDisplayedEnd: '9999-01-01T00:00:00.000Z', weeklyStoreEnd: beforeMidnight.toISOString(), stwEventStoreEnd: '9999-01-01T00:00:00.000Z', stwWeeklyStoreEnd: '9999-01-01T00:00:00.000Z', dailyStoreEnd: beforeMidnight.toISOString() } }], cacheExpire: '9999-01-01T00:00:00.000Z' } }, eventsTimeOffsetHrs: 0, cacheIntervalMins: 10, currentTime: new Date().toISOString() });
});

export default router;
