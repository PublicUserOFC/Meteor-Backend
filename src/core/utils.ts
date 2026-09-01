import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { VersionInfo } from '../types';

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function GetVersionInfo(req: Request): VersionInfo {
  const memory: VersionInfo = {
    season: 0,
    build: 0.0,
    CL: '0',
    lobby: '',
  };

  if (req.headers['user-agent']) {
    let CL = '';

    try {
      const userAgent = req.headers['user-agent'] as string;
      let BuildID = userAgent.split('-')[3]?.split(',')[0];

      if (!isNaN(Number(BuildID))) {
        CL = BuildID;
      } else {
        BuildID = userAgent.split('-')[3]?.split(' ')[0];
        if (!isNaN(Number(BuildID))) CL = BuildID;
      }
    } catch {
      try {
        const userAgent = req.headers['user-agent'] as string;
        const BuildID = userAgent.split('-')[1]?.split('+')[0];
        if (!isNaN(Number(BuildID))) CL = BuildID;
      } catch {}
    }

    try {
      const userAgent = req.headers['user-agent'] as string;
      let Build = userAgent.split('Release-')[1]?.split('-')[0];

      if (Build?.split('.').length === 3) {
        const Value = Build.split('.');
        Build = Value[0] + '.' + Value[1] + Value[2];
      }

      memory.season = Number(Build.split('.')[0]);
      memory.build = Number(Build);
      memory.CL = CL;
      memory.lobby = `LobbySeason${memory.season}`;

      if (isNaN(memory.season)) throw new Error();
    } catch {
      if (Number(memory.CL) < 3724489) {
        memory.season = 0;
        memory.build = 0.0;
        memory.CL = CL;
        memory.lobby = 'LobbySeason0';
      } else if (Number(memory.CL) <= 3790078) {
        memory.season = 1;
        memory.build = 1.0;
        memory.CL = CL;
        memory.lobby = 'LobbySeason1';
      } else {
        memory.season = 2;
        memory.build = 2.0;
        memory.CL = CL;
        memory.lobby = 'LobbyWinterDecor';
      }
    }
  }

  return memory;
}

export function MakeID(): string {
  return uuidv4();
}

export function DecodeBase64(str: string): string {
  return Buffer.from(str, 'base64').toString();
}

export function GeneratePassword(length: number): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+';
  let retVal = '';
  for (let i = 0; i < length; i++) {
    retVal += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return retVal;
}

export function ParseDuration(duration: string): Date | null {
  const amount = parseInt(duration.slice(0, -1));
  const unit = duration.slice(-1).toLowerCase();

  if (isNaN(amount)) return null;

  const now = new Date();
  switch (unit) {
    case 'h':
      return new Date(now.getTime() + amount * 60 * 60 * 1000);
    case 'd':
      return new Date(now.getTime() + amount * 24 * 60 * 60 * 1000);
    case 'w':
      return new Date(now.getTime() + amount * 7 * 24 * 60 * 60 * 1000);
    case 'm':
      return new Date(now.getTime() + amount * 30 * 24 * 60 * 60 * 1000);
    default:
      return null;
  }
}

// Load AllPlaylists.json once at startup for name resolution
let _allPlaylistsCache: any[] | null = null;
function getAllPlaylists(): any[] {
  if (_allPlaylistsCache) return _allPlaylistsCache;
  try {
    const p = require('path');
    _allPlaylistsCache = JSON.parse(require('fs').readFileSync(p.join(__dirname, '..', '..', 'Base', 'responses', 'AllPlaylists.json'), 'utf-8'));
  } catch { _allPlaylistsCache = []; }
  return _allPlaylistsCache!;
}

export function PlaylistNames(playlist: string): string {
  const playlistMap: { [key: string]: string } = {
    'playlist_defaultsolo': 'Solo',
    'playlist_defaultduo': 'Duo',
    'playlist_defaultsquad': 'Squad',
    'playlist_playgroundv2': 'Playground',
    'playlist_creative': 'Creative',
    'playlist_showdownalt_solo': 'Arena Solo',
    'playlist_showdownalt_duos': 'Arena Duos',
    'playlist_showdownalt_trios': 'Arena Trios',
  };

  const lower = playlist.toLowerCase();
  if (playlistMap[lower]) return playlistMap[lower];

  // Fall back to AllPlaylists.json for any playlist not in the static map
  const found = getAllPlaylists().find((p: any) => p.id?.toLowerCase() === lower);
  if (found?.name) return found.name;

  return playlist;
}

export function sendXmppMessageToId(recipientId: string, message: any): void {
  if (!global.Clients) return;
  if (typeof message === 'object') message = JSON.stringify(message);
  const receiver = global.Clients.find((i: any) => i.accountId === recipientId);
  if (!receiver) return;
  const XMLBuilder = require('xmlbuilder');
  receiver.client.send(
    XMLBuilder.create('message')
      .attribute('from', `xmpp-admin@${global.xmppDomain}`)
      .attribute('to', receiver.jid)
      .attribute('xmlns', 'jabber:client')
      .element('body', `${message}`)
      .up()
      .toString()
  );
}

export function sendXmppMessageToAll(message: any): void {
  if (!global.Clients) return;
  if (typeof message === 'object') message = JSON.stringify(message);
  const XMLBuilder = require('xmlbuilder');
  global.Clients.forEach((ClientData: any) => {
    ClientData.client.send(
      XMLBuilder.create('message')
        .attribute('from', `xmpp-admin@${global.xmppDomain}`)
        .attribute('xmlns', 'jabber:client')
        .attribute('to', ClientData.jid)
        .element('body', `${message}`)
        .up()
        .toString()
    );
  });
}

export function getPresenceFromUser(fromId: string, toId: string, offline: boolean): void {
  if (!global.Clients) return;
  const XMLBuilder = require('xmlbuilder');
  const SenderData = global.Clients.find((i: any) => i.accountId === fromId);
  const ClientData = global.Clients.find((i: any) => i.accountId === toId);
  if (!SenderData || !ClientData) return;
  let xml = XMLBuilder.create('presence')
    .attribute('to', ClientData.jid)
    .attribute('xmlns', 'jabber:client')
    .attribute('from', SenderData.jid)
    .attribute('type', offline ? 'unavailable' : 'available');
  if (SenderData.lastPresenceUpdate.away) {
    xml = xml.element('show', 'away').up().element('status', SenderData.lastPresenceUpdate.status).up();
  } else {
    xml = xml.element('status', SenderData.lastPresenceUpdate.status).up();
  }
  ClientData.client.send(xml.toString());
}

export function getAccountIdData(UserID: string): string {
  return UserID ? UserID.split('|')[1] || '' : '';
}

export function getContentPages(req: any): any {
  const fs = require('fs');
  const path = require('path');
  const memory = GetVersionInfo(req);
  const contentpages = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'Base', 'responses', 'contentpages.json')).toString().replace(/^\uFEFF/, ''));

  let Language = 'en';
  try {
    if (req.headers['accept-language']) {
      if (req.headers['accept-language'].includes('-') && req.headers['accept-language'] !== 'es-419') {
        Language = req.headers['accept-language'].split('-')[0];
      } else {
        Language = req.headers['accept-language'];
      }
    }
  } catch {}

  try {
    ['saveTheWorldUnowned', 'battleRoyale', 'creative', 'saveTheWorld'].forEach((mode) => {
      contentpages.subgameselectdata[mode].message.title = contentpages.subgameselectdata[mode].message.title[Language];
      contentpages.subgameselectdata[mode].message.body = contentpages.subgameselectdata[mode].message.body[Language];
    });
  } catch {}

  try {
    if (memory.build < 5.3) {
      ['savetheworldnews', 'battleroyalenews'].forEach((mode) => {
        contentpages[mode].news.messages[0].image = 'https://cdn.discordapp.com/attachments/927739901540188200/930879507496308736/discord.png';
        contentpages[mode].news.messages[1].image = 'https://i.imgur.com/ImIwpRm.png';
      });
    }
  } catch {}

  // Inject news.json into battleroyalenews and battleroyalenewsv2
  try {
    const newsPath = path.join(__dirname, '..', '..', 'Base', 'news.json');
    const newsItems: any[] = JSON.parse(fs.readFileSync(newsPath, 'utf-8'));
    if (newsItems.length) {
      // battleroyalenews — motds + messages (older builds)
      if (contentpages.battleroyalenews?.news) {
        contentpages.battleroyalenews.news.motds = newsItems.map((n: any) => ({
          entryType: 'Website',
          image: n.image || '',
          tileImage: n.tileImage || n.image || '',
          videoMute: false,
          hidden: n.hidden ?? false,
          tabTitleOverride: n.author || 'MeteorStaff',
          _type: 'CommonUI Simple Message MOTD',
          title: n.title,
          body: n.body,
          offerAction: 'ShowOfferDetails',
          videoLoop: false,
          videoStreamingEnabled: false,
          sortingPriority: n.sortingPriority ?? 0,
          websiteButtonText: n.websiteButtonText || 'Join Discord',
          websiteURL: n.websiteURL || '',
          id: n.id,
          videoAutoplay: false,
          videoFullscreen: false,
          spotlight: n.spotlight ?? false,
        }));
        contentpages.battleroyalenews.news.messages = newsItems.map((n: any) => ({
          image: n.image || '',
          hidden: n.hidden ?? false,
          _type: 'CommonUI Simple Message Base',
          adspace: n.author || 'MeteorStaff',
          title: n.title,
          body: n.body,
          spotlight: n.spotlight ?? false,
        }));
      }
      // battleroyalenewsv2 — motds (newer builds)
      if (contentpages.battleroyalenewsv2?.news) {
        contentpages.battleroyalenewsv2.news.motds = newsItems.map((n: any) => ({
          entryType: 'Website',
          image: n.image || '',
          tileImage: n.tileImage || n.image || '',
          videoMute: false,
          hidden: n.hidden ?? false,
          tabTitleOverride: n.author || 'MeteorStaff',
          _type: 'CommonUI Simple Message MOTD',
          title: n.title,
          body: n.body,
          videoLoop: false,
          videoStreamingEnabled: false,
          sortingPriority: n.sortingPriority ?? 0,
          websiteButtonText: n.websiteButtonText || 'Join Discord',
          websiteURL: n.websiteURL || '',
          id: n.id,
          videoAutoplay: false,
          videoFullscreen: false,
          spotlight: n.spotlight ?? false,
        }));
      }
    }
  } catch { /* news.json missing or malformed — keep contentpages defaults */ }

  try {
    const bg = contentpages.dynamicbackgrounds.backgrounds.backgrounds;
    bg[0].stage = `season${memory.season}`;
    bg[1].stage = `season${memory.season}`;

    if (memory.season === 10) { bg[0].stage = 'seasonx'; bg[1].stage = 'seasonx'; }
    if (memory.build === 11.31 || memory.build === 11.4) { bg[0].stage = 'Winter19'; bg[1].stage = 'Winter19'; }

    if (memory.build === 19.01) {
      bg[0].stage = 'winter2021';
      bg[0].backgroundimage = 'https://cdn.discordapp.com/attachments/927739901540188200/930880158167085116/t-bp19-lobby-xmas-2048x1024-f85d2684b4af.png';
      contentpages.subgameinfo.battleroyale.image = 'https://cdn.discordapp.com/attachments/927739901540188200/930880421514846268/19br-wf-subgame-select-512x1024-16d8bb0f218f.jpg';
      contentpages.specialoffervideo.bSpecialOfferEnabled = 'true';
    }
    if (memory.season === 20) {
      bg[0].backgroundimage = memory.build === 20.4
        ? 'https://cdn2.unrealengine.com/t-bp20-40-armadillo-glowup-lobby-2048x2048-2048x2048-3b83b887cc7f.jpg'
        : 'https://cdn2.unrealengine.com/t-bp20-lobby-2048x1024-d89eb522746c.png';
    }
    if (memory.season === 21) {
      bg[0].backgroundimage = 'https://cdn2.unrealengine.com/s21-lobby-background-2048x1024-2e7112b25dc3.jpg';
      if (memory.build === 21.1) bg[0].stage = 'season2100';
      if (memory.build === 21.3) { bg[0].backgroundimage = 'https://cdn2.unrealengine.com/nss-lobbybackground-2048x1024-f74a14565061.jpg'; bg[0].stage = 'season2130'; }
    }
    if (memory.season === 22) bg[0].backgroundimage = 'https://cdn2.unrealengine.com/t-bp22-lobby-square-2048x2048-2048x2048-e4e90c6e8018.jpg';
    if (memory.season === 23) {
      if (memory.build === 23.1) { bg[0].backgroundimage = 'https://cdn2.unrealengine.com/t-bp23-winterfest-lobby-square-2048x2048-2048x2048-277a476e5ca6.png'; contentpages.specialoffervideo.bSpecialOfferEnabled = 'true'; }
      else bg[0].backgroundimage = 'https://cdn2.unrealengine.com/t-bp20-lobby-2048x1024-d89eb522746c.png';
    }
    if (memory.season === 24) bg[0].backgroundimage = 'https://cdn2.unrealengine.com/t-ch4s2-bp-lobby-4096x2048-edde08d15f7e.jpg';
    if (memory.season === 25) {
      bg[0].backgroundimage = 'https://cdn2.unrealengine.com/fn-shop-ch4s3-04-1920x1080-785ce1d90213.png';
      if (memory.build === 25.11) bg[0].backgroundimage = 'https://cdn2.unrealengine.com/t-s25-14dos-lobby-4096x2048-2be24969eee3.jpg';
    }
    if (memory.season === 27) bg[0].stage = 'rufus';

    const { config } = require('../config');
    if (config.lobby.useCustomBackground && config.lobby.backgroundImageUrl) {
      bg[0].stage = 'default';
      bg[0].backgroundimage = config.lobby.backgroundImageUrl;
      if (bg[1]) { bg[1].stage = 'default'; bg[1].backgroundimage = config.lobby.backgroundImageUrl; }
    }
  } catch {}

  try {
    const { config } = require('../config');
    if (config.lobby.useCustomShopBackground && config.lobby.shopBackgroundImageUrl) {
      const sections = contentpages.mpItemShop?.shopData?.sections;
      if (sections) {
        sections.forEach((section: any) => {
          if (section.metadata?.background) {
            section.metadata.background.backgroundImage = config.lobby.shopBackgroundImageUrl;
          }
        });
      }

      const oldSections = contentpages.shopSections?.sectionList?.sections;
      if (oldSections) {
        oldSections.forEach((section: any) => {
          if (section.background) {
            section.background.stage = 'default';
            section.background.backgroundimage = config.lobby.shopBackgroundImageUrl;
          }
        });
      }
    }
  } catch {}

  try {
    const customDesc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'Base', 'customDescriptions.json')).toString());

    if (customDesc.playlists?.length && contentpages.playlistinformation?.playlist_info?.playlists) {
      const playlists = contentpages.playlistinformation.playlist_info.playlists;
      customDesc.playlists.forEach((override: any) => {
        const match = playlists.find((p: any) => p.playlist_name?.toLowerCase() === override.playlist_name?.toLowerCase());
        if (match) {
          if (override.display_name !== undefined) match.display_name = override.display_name;
          if (override.description !== undefined) match.description = override.description;
          if (override.image !== undefined) match.image = override.image;
        }
      });
    }
    if (customDesc.tournaments?.length && contentpages.tournamentinformation?.tournament_info?.tournaments) {
      const tournaments = contentpages.tournamentinformation.tournament_info.tournaments;
      customDesc.tournaments.forEach((override: any) => {
        const match = tournaments.find((t: any) => t.tournament_display_id === override.tournament_display_id);
        if (match) {
          const fields = ['title_line_1', 'flavor_description', 'details_description', 'schedule_info', 'long_format_title', 'short_format_title',
            'title_color', 'primary_color', 'secondary_color', 'highlight_color', 'shadow_color', 'base_color',
            'background_left_color', 'background_right_color', 'background_text_color', 'poster_fade_color',
            'loading_screen_image', 'poster_front_image', 'poster_back_image', 'playlist_tile_image', 'pin_earned_text'];
          fields.forEach((f) => { if (override[f] !== undefined) match[f] = override[f]; });
        }
      });
    }
  } catch {}

  return contentpages;
}
export function getNextDivision(hypePoints: number, currentDivision: number): number {
  const thresholds = [400, 800, 1200, 2000, 3000, 5000, 7500, 10000, 14999, 15000];
  for (let i = 0; i < thresholds.length; i++) {
    if (hypePoints < thresholds[i]) return i;
  }
  return currentDivision;
}

export async function getDivisionPoints(accountId: string, statType: string): Promise<number> {
  const fs = require('fs');
  const path = require('path');
  const { default: ArenaModel } = await import('../models/Stats');
  const eventList = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'Base', 'responses', 'eventlistactive.json'), 'utf-8'));
  const playerData = await ArenaModel.findOne({ accountId });
  const playerDivision = playerData ? (playerData as any).division : 0;
  const eventWindow = eventList.events[0].eventWindows.find((w: any) => w.metadata.divisionRank === playerDivision);
  if (!eventWindow) return 0;
  const template = eventList.templates.find((t: any) => t.eventTemplateId === eventWindow.eventTemplateId);
  if (!template) return 0;
  const rule = template.scoringRules.find((r: any) => r.trackedStat === statType);
  return rule ? rule.rewardTiers[0].pointsEarned : 0;
}

export async function updateHypePoints(user: any, points: number): Promise<{ success: boolean; data: string }> {
  const { Arena } = await import('../models/Stats');
  const accountId = user.account_id || user.accountId;
  const playerData = await Arena.findOne({ accountId });
  let currentHype = playerData ? (playerData as any).hype : 0;
  currentHype += points;
  const currentDivision = getNextDivision(currentHype, playerData ? (playerData as any).division : 0);
  await Arena.updateOne({ accountId }, { $set: { accountId, hype: currentHype, division: currentDivision } }, { upsert: true });
  return { success: true, data: `Hype updated to ${currentHype}, Division: ${currentDivision}` };
}

export async function addEliminationHypePoints(user: any) {
  const points = await getDivisionPoints(user.account_id || user.accountId, 'TEAM_ELIMS_STAT_INDEX');
  return updateHypePoints(user, points);
}

export async function addVictoryHypePoints(user: any) {
  const points = await getDivisionPoints(user.account_id || user.accountId, 'PLACEMENT_STAT_INDEX');
  return updateHypePoints(user, points);
}

export async function deductBusFareHypePoints(user: any) {
  const points = await getDivisionPoints(user.account_id || user.accountId, 'MATCH_PLAYED_STAT');
  return updateHypePoints(user, -points);
}

export function getOfferID(offerId: string): any {
  try {
    const fs = require('fs');
    const path = require('path');
    const shop = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'Base', 'shop.json'), 'utf-8'));
    for (const [key, value] of Object.entries(shop) as [string, any][]) {
      if (!key.startsWith('daily') && !key.startsWith('featured')) continue;
      if (`v2:/${key}` === offerId || key === offerId) {
        return { name: key.startsWith('featured') ? 'BRWeeklyStorefront' : 'BRDailyStorefront', offerId: { prices: [{ currencyType: 'MtxCurrency', finalPrice: value.price }], itemGrants: value.itemGrants.map((t: string) => ({ templateId: t, quantity: 1 })) } };
      }
    }
    return null;
  } catch { return null; }
}
