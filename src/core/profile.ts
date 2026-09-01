import fs from 'fs';
import path from 'path';

export interface Profile {
  accountId: string;
  profileId: string;
  created: string;
  updated: string;
  [key: string]: any;
}

export interface Profiles {
  [profileId: string]: Profile;
}

export function createProfiles(accountId: string): Profiles {
  const profiles: Profiles = {};
  const profilesDir = path.join(__dirname, '..', '..', 'Base', 'DefaultProfiles');

  if (fs.existsSync(profilesDir)) {
    fs.readdirSync(profilesDir).forEach((fileName) => {
      try {
        const profilePath = path.join(profilesDir, fileName);
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));

        profile.accountId = accountId;
        profile.created = new Date().toISOString();
        profile.updated = new Date().toISOString();

        profiles[profile.profileId] = profile;
      } catch (error) {
        console.error(`Error loading profile ${fileName}:`, error);
      }
    });
  }

  // Load and add mini pass quests to athena profile
  try {
    const miniPassPath = path.join(__dirname, '..', '..', 'Base', 'responses', 'MiniPasses', 'MiniPass.json');
    if (fs.existsSync(miniPassPath) && profiles.athena) {
      const miniPassData = JSON.parse(fs.readFileSync(miniPassPath, 'utf-8'));
      if (!profiles.athena.items) profiles.athena.items = {};
      
      // Add all mini pass quests to athena profile
      for (const [questId, questData] of Object.entries(miniPassData)) {
        profiles.athena.items[questId] = questData;
      }
      
      console.log(`[MINI PASS] Loaded ${Object.keys(miniPassData).length} mini pass quests for account ${accountId}`);
    }
  } catch (error) {
    console.error('[MINI PASS] Error loading mini pass quests:', error);
  }

  if (Object.keys(profiles).length === 0) {
    const timestamp = new Date().toISOString();
    
    profiles.common_core = {
      accountId,
      profileId: 'common_core',
      created: timestamp,
      updated: timestamp,
      rvn: 1,
      wipeNumber: 1,
      commandRevision: 1,
      version: 'no_version',
      items: {},
      stats: {
        attributes: {
          survey_data: {},
          personal_offers: {},
          intro_game_played: true,
          import_friends_claimed: {},
          mtx_purchase_history: { refundsUsed: 0, refundCredits: 3, purchases: [] },
          undo_cooldowns: [],
          mtx_affiliate_set_time: timestamp,
          inventory_limit_bonus: 0,
          current_mtx_platform: 'EpicPC',
          mtx_affiliate: '',
          weekly_purchases: {},
          daily_purchases: {},
          ban_history: {},
          in_app_purchases: {
            receipts: [],
            ignoredReceipts: [],
            fulfillmentCounts: {},
            refreshTimers: {
              MicrosoftStore: { nextEntitlementRefresh: "9999-12-01T21:10:00.000Z" },
              SamsungGalaxyAppStore: {},
              EpicPurchasingService: { nextEntitlementRefresh: "9999-12-01T21:10:00.000Z" }
            },
            version: 1
          },
          permissions: [],
          undo_timeout: '9999-12-31T23:59:59.999Z',
          monthly_purchases: {},
          allowed_to_send_gifts: true,
          mfa_enabled: false,
          allowed_to_receive_gifts: true,
          gift_history: {}
        }
      }
    };

    profiles.athena = {
      accountId,
      profileId: 'athena',
      created: timestamp,
      updated: timestamp,
      rvn: 1,
      wipeNumber: 1,
      commandRevision: 1,
      version: 'no_version',
      items: {},
      stats: {
        attributes: {
          past_seasons: [],
          season_match_boost: 0,
          loadouts: [],
          mfa_reward_claimed: false,
          rested_xp_overflow: 0,
          quest_manager: {
            dailyLoginInterval: timestamp,
            dailyQuestRerolls: 1
          },
          book_level: 1,
          season_num: 10,
          season_update: 0,
          book_xp: 0,
          permissions: [],
          season: {
            numWins: 0,
            numHighBracket: 0,
            numLowBracket: 0
          },
          vote_data: {},
          lifetime_wins: 0,
          book_purchased: false,
          rested_xp_exchange: 1,
          level: 1,
          rested_xp: 0,
          rested_xp_mult: 1,
          accountLevel: 1,
          competitive_identity: {},
          inventory_limit_bonus: 0,
          last_applied_loadout: '',
          daily_rewards: {},
          xp: 0,
          season_friend_match_boost: 0,
          active_loadout_index: 0
        }
      }
    };

    profiles.common_public = {
      accountId,
      profileId: 'common_public',
      created: timestamp,
      updated: timestamp,
      rvn: 1,
      wipeNumber: 1,
      commandRevision: 1,
      version: 'no_version',
      items: {},
      stats: {
        attributes: {
          banner_icon: 'standardbanner1',
          banner_color: 'defaultcolor1',
          homebase_name: ''
        }
      }
    };

    profiles.collections = {
      accountId,
      profileId: 'collections',
      created: timestamp,
      updated: timestamp,
      rvn: 1,
      wipeNumber: 1,
      commandRevision: 1,
      version: 'no_version',
      items: {},
      stats: { attributes: {} }
    };

    profiles.profile0 = {
      accountId,
      profileId: 'profile0',
      created: timestamp,
      updated: timestamp,
      rvn: 1,
      wipeNumber: 1,
      commandRevision: 1,
      version: 'no_version',
      items: {},
      stats: {
        attributes: {
          mission_alert_redemption_record: {},
          quest_manager: {
            dailyLoginInterval: timestamp,
            dailyQuestRerolls: 1
          },
          level: 1,
          xp: 0,
          inventory_limit_bonus: 0
        }
      }
    };
  }

  return profiles;
}

export async function validateProfile(profileId: string, profiles: any): Promise<boolean> {
  try {
    const profile = profiles.profiles[profileId];
    if (!profile || !profileId) throw new Error('Invalid profile/profileId');
    return true;
  } catch {
    return false;
  }
}
