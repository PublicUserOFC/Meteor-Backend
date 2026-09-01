import axios from 'axios';
import fs from 'fs';
import path from 'path';
import log from '../core/logger';
import { generateShopImage } from './shopImageGenerator';
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { config } from '../config';
import { getDiscordClient } from '../discord/bot';

const fortniteapi = 'https://fortnite-api.com/v2/cosmetics/br';
const catalogcfg = path.join(__dirname, '..', '..', 'Base', 'shop.json');

interface CosmeticItem {
    id: string;
    name: string;
    introduction?: {
        chapter?: string;
        season?: string;
    };
    rarity?: {
        displayValue?: string;
        value?: string;
    };
    type?: {
        value: string;
    };
    backendValue?: string;
    series?: {
        value?: string;
    };
    images?: {
        featured?: string;
        icon?: string;
        smallIcon?: string;
    };
    added?: string;
}

interface ItemShop {
    daily: CosmeticItem[];
    featured: CosmeticItem[];
}

const getDailyItemsAmount = () => config.autoRotate.dailyItemsAmount || 6;
const getFeaturedItemsAmount = () => config.autoRotate.featuredItemsAmount || 2;

async function fetchitems(): Promise<CosmeticItem[]> {
    try {
        const response = await axios.get(fortniteapi);
        const cosmetics: CosmeticItem[] = response.data.data || [];
        const excludedItems = config.autoRotate.excludedItems || [];

        return cosmetics.filter(item => {
            const { id, introduction, rarity } = item;
            const chapter = introduction?.chapter ? parseInt(introduction.chapter, 10) : null;
            const season = introduction?.season ? introduction.season.toString() : null;
            const itemRarity = rarity?.displayValue?.toLowerCase();

            if (!chapter || !season) return false;
            if (excludedItems.includes(id)) return false;

            const maxChapter = parseInt(config.autoRotate.chapterLimit || '1', 10);
            const maxSeason = (config.autoRotate.seasonLimit || '10').toString();

            if (maxSeason === 'OG') {
                return chapter >= 1 && chapter <= maxChapter && itemRarity !== 'common';
            }

            if (
                chapter < 1 || chapter > maxChapter ||
                (chapter === maxChapter && (season === 'X' || parseInt(season, 10) > parseInt(maxSeason, 10)))
            ) {
                return false;
            }

            return itemRarity !== 'common';
        });
    } catch (error: any) {
        log.error('Error fetching cosmetics:', error.message || error);
        return [];
    }
}

async function fetchItemsByDate(dateStr: string): Promise<CosmeticItem[]> {
    try {
        const response = await axios.get(fortniteapi);
        const cosmetics: CosmeticItem[] = response.data.data || [];
        const excludedItems = config.autoRotate.excludedItems || [];
        const targetDate = dateStr.trim();

        const filtered = cosmetics.filter(item => {
            const { id, rarity, added } = item;
            if (!added) return false;

            const itemDate = added.substring(0, 10);
            if (itemDate !== targetDate) return false;

            if (excludedItems.includes(id)) return false;

            const itemRarity = rarity?.displayValue?.toLowerCase();
            if (itemRarity === 'common') return false;

            return true;
        });

        log.AutoRotation(`Found ${filtered.length} cosmetics added on ${targetDate}`);
        return filtered;
    } catch (error: any) {
        log.error('Error fetching cosmetics by date:', error.message || error);
        return [];
    }
}

function pickRandomItems(items: CosmeticItem[], count: number): CosmeticItem[] {
    const itemTypeBuckets: Record<string, CosmeticItem[]> = {
        athenaCharacter: [],
        athenaDance: [],
        athenaBackpack: [],
        athenaGlider: [],
        athenaPickaxe: [],
        loadingScreen: [],
        emoji: []
    };

    items.forEach(item => {
        const type = item.type?.value.toLowerCase();
        switch (type) {
            case 'outfit':
                itemTypeBuckets.athenaCharacter.push(item);
                break;
            case 'emote':
                itemTypeBuckets.athenaDance.push(item);
                break;
            case 'backpack':
                itemTypeBuckets.athenaBackpack.push(item);
                break;
            case 'glider':
                itemTypeBuckets.athenaGlider.push(item);
                break;
            case 'pickaxe':
                itemTypeBuckets.athenaPickaxe.push(item);
                break;
            case 'loadingscreen':
                itemTypeBuckets.loadingScreen.push(item);
                break;
            case 'emoji':
                itemTypeBuckets.emoji.push(item);
                break;
        }
    });

    const selectedItems: CosmeticItem[] = [];

    function addItemsFromBucket(bucket: CosmeticItem[], requiredCount: number) {
        const availableItems = bucket.sort(() => 0.5 - Math.random()).slice(0, requiredCount);
        selectedItems.push(...availableItems);
    }

    addItemsFromBucket(itemTypeBuckets.athenaCharacter, Math.min(2, count));
    addItemsFromBucket(itemTypeBuckets.athenaDance, Math.min(1, count));
    addItemsFromBucket(itemTypeBuckets.athenaBackpack, Math.min(1, count));
    addItemsFromBucket(itemTypeBuckets.athenaGlider, Math.min(1, count));
    addItemsFromBucket(itemTypeBuckets.athenaPickaxe, Math.min(1, count));
    addItemsFromBucket(itemTypeBuckets.loadingScreen, Math.min(1, count));
    addItemsFromBucket(itemTypeBuckets.emoji, Math.min(1, count));

    const remainingCount = count - selectedItems.length;
    const remainingItems = items.filter(item => !selectedItems.includes(item));

    const extraItems = remainingItems.sort(() => 0.5 - Math.random()).slice(0, remainingCount);
    selectedItems.push(...extraItems);

    return selectedItems.slice(0, count);
}

function formatitemgrantsyk(item: CosmeticItem): string[] {
    const { id, backendValue, type } = item;
    let itemType: string;

    switch (type?.value.toLowerCase()) {
        case 'outfit':
            itemType = 'AthenaCharacter';
            break;
        case 'emote':
            itemType = 'AthenaDance';
            break;
        default:
            itemType = backendValue || `Athena${capitalizeomg(type?.value || '')}`;
            break;
    }

    return [`${itemType}:${id}`];
}

function capitalizeomg(string: string): string {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function notproperpricegen(item: CosmeticItem): number {
    const rarity = item.rarity?.displayValue?.toLowerCase();
    const type = item.type?.value?.toLowerCase();
    const series = item.series?.value?.toLowerCase();

    if (series) {
        switch (series) {
            case 'gaming legends series':
            case 'marvel series':
            case 'star wars series':
            case 'dc series':
            case 'icon series':
                switch (type) {
                    case 'outfit': return 1500;
                    case 'pickaxe': return 1200;
                    case 'backpack': return 1200;
                    case 'emote': return 500;
                    case 'glider': return 1200;
                    case 'wrap': return 700;
                    case 'loadingscreen': return 500;
                    case 'music': return 200;
                    case 'emoji': return 200;
                    default: return 999999;
                }
            case 'lava series':
                switch (type) {
                    case 'outfit':
                    case 'glider':
                    case 'backpack': return 2000;
                    case 'pickaxe': return 1200;
                    case 'loadingscreen': return 500;
                    case 'music': return 200;
                    case 'emoji': return 200;
                    default: return 999999;
                }
            case 'shadow series':
            case 'frozen series':
            case 'slurp series':
            case 'dark series':
                switch (type) {
                    case 'outfit': return 1500;
                    case 'pickaxe': return 1200;
                    case 'backpack': return 1200;
                    case 'glider': return 1200;
                    case 'wrap': return 700;
                    case 'loadingscreen': return 500;
                    case 'music': return 200;
                    case 'emoji': return 200;
                    default: return 999999;
                }
            default: return 999999;
        }
    }

    switch (type) {
        case 'outfit':
            switch (rarity) {
                case 'legendary': return 2000;
                case 'epic': return 1500;
                case 'rare': return 1200;
                case 'uncommon': return 800;
                default: return 999999;
            }
        case 'pickaxe':
            switch (rarity) {
                case 'epic': return 1200;
                case 'rare': return 800;
                case 'uncommon': return 500;
                default: return 999999;
            }
        case 'backpack':
            switch (rarity) {
                case 'legendary': return 2000;
                case 'epic': return 1500;
                case 'rare': return 1200;
                case 'uncommon': return 200;
                default: return 999999;
            }
        case 'emote':
        case 'spray':
        case 'emoji':
            switch (rarity) {
                case 'legendary': return 2000;
                case 'epic': return 800;
                case 'rare': return 500;
                case 'uncommon': return 200;
                default: return 999999;
            }
        case 'glider':
            switch (rarity) {
                case 'legendary': return 2000;
                case 'epic': return 1200;
                case 'rare': return 800;
                case 'uncommon': return 500;
                default: return 999999;
            }
        case 'wrap':
            switch (rarity) {
                case 'legendary': return 1200;
                case 'epic': return 700;
                case 'rare': return 500;
                case 'uncommon': return 300;
                default: return 999999;
            }
        case 'loadingscreen':
            switch (rarity) {
                case 'legendary':
                case 'epic':
                case 'rare': return 500;
                case 'uncommon': return 200;
                default: return 999999;
            }
        case 'music':
            switch (rarity) {
                case 'legendary':
                case 'epic': return 500;
                case 'rare':
                case 'uncommon': return 200;
                default: return 999999;
            }
        default: return 999999;
    }
}

function updatecfgomg(dailyItems: CosmeticItem[], featuredItems: CosmeticItem[]): void {
    const catalogConfig: any = { '//': 'BR Item Shop Config' };

    dailyItems.forEach((item, index) => {
        catalogConfig[`daily${index + 1}`] = {
            itemGrants: formatitemgrantsyk(item),
            price: notproperpricegen(item)
        };
    });

    featuredItems.forEach((item, index) => {
        catalogConfig[`featured${index + 1}`] = {
            itemGrants: formatitemgrantsyk(item),
            price: notproperpricegen(item)
        };
    });

    const lines = Object.entries(catalogConfig)
        .filter(([k]) => k !== '//')
        .map(([k, v]) => `  "${k}": ${JSON.stringify(v)}`)
        .join(',\n');
    fs.writeFileSync(catalogcfg, `{\n${lines}\n}\n`, 'utf-8');
    log.AutoRotation('The item shop has rotated!');
}

async function discordpost(itemShop: ItemShop): Promise<void> {
    if (config.discord.useBot !== true || !config.discord.itemShopChannelId) return;

    function getNextRotationTime(): Date {
        const now = new Date();
        const [localHour, localMinute] = (config.autoRotate.rotateTime || '00:00').split(':').map(Number);
        const nextRotation = new Date(now);
        nextRotation.setHours(localHour, localMinute, 0, 0);
        if (now >= nextRotation) {
            nextRotation.setDate(nextRotation.getDate() + 1);
        }
        return nextRotation;
    }

    const nextRotation = getNextRotationTime();
    const now = new Date();
    const hoursRemaining = Math.max(0, Math.floor((nextRotation.getTime() - now.getTime()) / (1000 * 60 * 60)));

    try {
        const featuredWithPrices = itemShop.featured.map(item => ({
            ...item, price: notproperpricegen(item)
        }));
        const dailyWithPrices = itemShop.daily.map(item => ({
            ...item, price: notproperpricegen(item)
        }));

        const imageBuffer = await generateShopImage({
            featured: featuredWithPrices,
            daily: dailyWithPrices
        });

        if (getDiscordClient()) {
            const client = getDiscordClient()!;
            const channel = await client.channels.cache.get(config.discord.itemShopChannelId) ||
                await client.channels.fetch(config.discord.itemShopChannelId).catch(() => null);

            if (channel) {
                const attachment = new AttachmentBuilder(imageBuffer, { name: 'shop.png' });
                const embed = new EmbedBuilder()
                    .setTitle(`Helix Item Shop`)
                    .setDescription(`Shop resets in **${hoursRemaining} hours**.`)
                    .setColor(0x3498db)
                    .setImage('attachment://shop.png')
                    .setFooter({
                        text: `Today at ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
                    });

                await channel.send({ embeds: [embed], files: [attachment] });
                log.AutoRotation(`Item shop posted successfully via Discord Bot.`);
            } else {
                log.error(`Could not find Discord channel with ID: ${config.discord.itemShopChannelId}`);
            }
        }
    } catch (error: any) {
        log.error(`Error sending item shop to Discord: ${error.message}`);
    }
}

async function rotateshop(): Promise<void> {
    try {
        let dailyItems: CosmeticItem[], featuredItems: CosmeticItem[];

        if (config.autoRotate.useCustomShopDate && config.autoRotate.customShopDate) {
            log.AutoRotation(`Custom shop date enabled, fetching cosmetics from: ${config.autoRotate.customShopDate}`);
            const dateItems = await fetchItemsByDate(config.autoRotate.customShopDate);

            if (dateItems.length === 0) {
                log.error(`No cosmetics found for date: ${config.autoRotate.customShopDate}, falling back to random rotation`);
                const cosmetics = await fetchitems();
                if (cosmetics.length === 0) {
                    log.error('No cosmetics found?');
                    return;
                }
                dailyItems = pickRandomItems(cosmetics, getDailyItemsAmount());
                featuredItems = pickRandomItems(cosmetics, getFeaturedItemsAmount());
            } else {
                const shuffled = dateItems.sort(() => 0.5 - Math.random());
                featuredItems = shuffled.slice(0, Math.min(getFeaturedItemsAmount(), shuffled.length));
                const remaining = shuffled.slice(featuredItems.length);
                dailyItems = remaining.slice(0, Math.min(getDailyItemsAmount(), remaining.length));

                log.AutoRotation(`Custom date shop: ${featuredItems.length} featured, ${dailyItems.length} daily items from ${config.autoRotate.customShopDate}`);
            }
        } else {
            const cosmetics = await fetchitems();
            if (cosmetics.length === 0) {
                log.error('No cosmetics found?');
                return;
            }
            dailyItems = pickRandomItems(cosmetics, getDailyItemsAmount());
            featuredItems = pickRandomItems(cosmetics, getFeaturedItemsAmount());
        }

        updatecfgomg(dailyItems, featuredItems);
        await discordpost({ daily: dailyItems, featured: featuredItems });

        const nextRotationTime = milisecstillnextrotation();
        log.AutoRotation(`Scheduling next rotation in: ${nextRotationTime} milliseconds`);
        
        setTimeout(rotateshop, nextRotationTime);

    } catch (error: any) {
        log.error('Error while rotating:', error.message || error);
    }
}

function milisecstillnextrotation(): number {
    const now = new Date();
    const [localHour, localMinute] = (config.autoRotate.rotateTime || '00:00').toString().split(':').map(Number);
    let nextRotation = new Date(now.getFullYear(), now.getMonth(), now.getDate(), localHour, localMinute, 0);

    if (now.getTime() >= nextRotation.getTime()) {
        nextRotation.setDate(nextRotation.getDate() + 1);
    }

    const millisUntilNextRotation = nextRotation.getTime() - now.getTime();
    log.AutoRotation(`Current time: ${now.toLocaleString()}`);
    log.AutoRotation(`Next rotation time: ${nextRotation.toLocaleString()}`);
    log.AutoRotation(`Milliseconds until next rotation: ${millisUntilNextRotation}`);

    return millisUntilNextRotation;
}

(async () => {
    if (config.autoRotate.useAutoRotate) {
        if (config.autoRotate.useCustomShopDate === true) {
            log.AutoRotation('Custom shop date IS ENABLED! Running initial rotation...');
            await rotateshop();
        } else {
            log.AutoRotation(`Auto rotation scheduled in ${Math.round(milisecstillnextrotation() / 1000 / 60)} minutes.`);
            setTimeout(rotateshop, milisecstillnextrotation());
        }
    }
})();

export { rotateshop, fetchitems, pickRandomItems };
