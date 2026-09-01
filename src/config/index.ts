export interface Config {
  port: number;
  environment: string;
  jwtSecret: string;
  mongodb: {
    uri: string;
  };
  discord: {
    botToken: string;
    clientId: string;
    guildId?: string;
    useBot: boolean;
    enablePlayerCount: boolean;
    itemShopChannelId: string;
  };
  moderators: string[];
  chat: {
    enableGlobalChat: boolean;
  };
  logging: {
    enableDebugLogs: boolean;
    enableFormattedLogs: boolean;
  };
  features: {
    enableRebootUser: boolean;
    enableCrossBans: boolean;
    enableBattlepass: boolean;
    battlepassSeason: number;
  };
  version: {
    enableOnlyOneVersion: boolean;
    versionJoinable: string;
  };
  matchmaking: {
    matchmakerIP: string;
    matchmakerPort: number;
    gameServerIPs: string[];
    regions: {
      NAE: string;
      NAW: string;
      OCE: string;
      EU: string;
      ME: string;
      BR: string;
    };
  };
  autoRotate: {
    useAutoRotate: boolean;
    enableDebugLogs: boolean;
    enableDiscordWebhook: boolean;
    chapterLimit: string;
    seasonLimit: string;
    rotateTime: string;
    dailyItemsAmount: number;
    featuredItemsAmount: number;
    useCustomShopDate: boolean;
    customShopDate: string;
    excludedItems: string[];
  };
  api: {
    apiKey: string;
    killReward: number;
    winReward: number;
  };
  website: {
    useWebsite: boolean;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    port: number;
  };
  reports: {
    enableReports: boolean;
    reportChannelId: string;
  };
  anticheat: {
    webhookUrl: string;
    autobanEnabled: boolean;
  };
  lobby: {
    useCustomBackground: boolean;
    backgroundImageUrl: string;
    useCustomShopBackground: boolean;
    shopBackgroundImageUrl: string;
  };
  waterLevel: {
    stages: Record<number, boolean>;
  };
}

export const config: Config = {
  port: parseInt(process.env.PORT || '5353', 10),
  environment: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
  
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1/Meteor',
  },
  
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    clientId: process.env.DISCORD_CLIENT_ID || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    useBot: process.env.DISCORD_USE_BOT === 'true',
    enablePlayerCount: process.env.DISCORD_ENABLE_PLAYER_COUNT === 'true',
    itemShopChannelId: process.env.DISCORD_ITEM_SHOP_CHANNEL_ID || '',
  },
  
  moderators: process.env.MODERATORS?.split(',') || [],
  
  chat: {
    enableGlobalChat: process.env.ENABLE_GLOBAL_CHAT === 'true',
  },
  
  logging: {
    enableDebugLogs: process.env.ENABLE_DEBUG_LOGS === 'true',
    enableFormattedLogs: process.env.ENABLE_FORMATTED_LOGS === 'true',
  },
  
  features: {
    enableRebootUser: process.env.ENABLE_REBOOT_USER === 'true',
    enableCrossBans: process.env.ENABLE_CROSS_BANS === 'true',
    enableBattlepass: process.env.ENABLE_BATTLEPASS === 'true',
    battlepassSeason: parseInt(process.env.BATTLEPASS_SEASON || '2', 10),
  },
  
  version: {
    enableOnlyOneVersion: process.env.ENABLE_ONLY_ONE_VERSION === 'true',
    versionJoinable: process.env.VERSION_JOINABLE || '2',
  },
  
  matchmaking: {
    matchmakerIP: process.env.MATCHMAKER_IP || '127.0.0.1:8080',
    matchmakerPort: parseInt(process.env.MATCHMAKER_PORT || '8080', 10),
    gameServerIPs: process.env.GAME_SERVER_IPS?.split(',') || ['127.0.0.1:7777:playlist_defaultsolo'],
    regions: {
      NAE: process.env.REGION_NAE || '127.0.0.1:7777',
      NAW: process.env.REGION_NAW || '127.0.0.1:7777',
      OCE: process.env.REGION_OCE || '127.0.0.1:7777',
      EU:  process.env.REGION_EU  || '127.0.0.1:7777',
      ME:  process.env.REGION_ME  || '127.0.0.1:7777',
      BR:  process.env.REGION_BR  || '127.0.0.1:7777',
    },
  },
  
  autoRotate: {
    useAutoRotate: process.env.USE_AUTO_ROTATE === 'true',
    enableDebugLogs: process.env.ENABLE_AUTO_ROTATE_DEBUG === 'true',
    enableDiscordWebhook: process.env.ENABLE_DISCORD_WEBHOOK === 'true',
    chapterLimit: process.env.CHAPTER_LIMIT || '1',
    seasonLimit: process.env.SEASON_LIMIT || '10',
    rotateTime: process.env.ROTATE_TIME || '03:20',
    dailyItemsAmount: parseInt(process.env.DAILY_ITEMS_AMOUNT || '6', 10),
    featuredItemsAmount: parseInt(process.env.FEATURED_ITEMS_AMOUNT || '2', 10),
    useCustomShopDate: process.env.USE_CUSTOM_SHOP_DATE === 'true',
    customShopDate: process.env.CUSTOM_SHOP_DATE || '',
    excludedItems: process.env.EXCLUDED_ITEMS?.split(',') || [],
  },
  
  api: {
    apiKey: process.env.API_KEY || 'your-api-key-here',
    killReward: parseInt(process.env.API_KILL_REWARD || '25', 10),
    winReward: parseInt(process.env.API_WIN_REWARD || '50', 10),
  },
  
  website: {
    useWebsite: process.env.USE_WEBSITE === 'true',
    clientId: process.env.WEBSITE_CLIENT_ID || '',
    clientSecret: process.env.WEBSITE_CLIENT_SECRET || '',
    redirectUri: process.env.WEBSITE_REDIRECT_URI || 'http://127.0.0.1:8080/oauth2/callback',
    port: parseInt(process.env.WEBSITE_PORT || '8080', 10),
  },
  
  reports: {
    enableReports: process.env.ENABLE_REPORTS === 'true',
    reportChannelId: process.env.REPORT_CHANNEL_ID || '',
  },

  anticheat: {
    webhookUrl: process.env.ANTICHEAT_WEBHOOK_URL || '',
    autobanEnabled: process.env.ANTICHEAT_AUTOBAN === 'true',
  },

  lobby: {
    useCustomBackground: process.env.USE_CUSTOM_BACKGROUND === 'true',
    backgroundImageUrl: process.env.CUSTOM_BACKGROUND_URL || 'https://cdn2.unrealengine.com/t-background-darkblue-2048x1024-4b5228ccabe2.png',
    useCustomShopBackground: process.env.USE_CUSTOM_SHOP_BACKGROUND === 'true',
    shopBackgroundImageUrl: process.env.CUSTOM_SHOP_BACKGROUND_URL || '',
  },

  waterLevel: {
    stages: {
      0: process.env.WaterLevel_0 === 'true',
      1: process.env.WaterLevel_1 === 'true',
      2: process.env.WaterLevel_2 === 'true',
      3: process.env.WaterLevel_3 === 'true',
      4: process.env.WaterLevel_4 === 'true',
      5: process.env.WaterLevel_5 === 'true',
      6: process.env.WaterLevel_6 === 'true',
      7: process.env.WaterLevel_7 === 'true',
    },
  },
};
