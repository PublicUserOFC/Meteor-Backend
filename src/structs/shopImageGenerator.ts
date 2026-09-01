import { createCanvas, loadImage, registerFont, CanvasRenderingContext2D } from 'canvas';
import path from 'path';
import fs from 'fs';
import log from '../core/logger';
import axios from 'axios';

const FONT_PATH = path.join(__dirname, '../../public/fonts/burbank-big-condensed-bold.otf');

const RARITY_GRADIENTS: Record<string, [string, string]> = {
  legendary: ['#c06c2a', '#f5a623'],
  epic:      ['#7d26cd', '#9b4dcc'],
  rare:      ['#2172b8', '#4fc3f7'],
  uncommon:  ['#2d7c3e', '#60aa31'],
  common:    ['#7d7d7d', '#bebebe'],
  marvel:    ['#b91111', '#e53935'],
  dc:        ['#2c4a9e', '#536dbd'],
  icon:      ['#0d8cb4', '#2dbcfd'],
  starwars:  ['#2e5883', '#4a7db5'],
  lava:      ['#b34700', '#ff9b00'],
  shadow:    ['#2b2b3b', '#5c5c8a'],
  frozen:    ['#2b6b8a', '#a8d8ea'],
  slurp:     ['#1a6b5a', '#00d4b4'],
  dark:      ['#1a1a2e', '#4a0e8f'],
};

const CARD_W = 260;
const CARD_H = 350;
const SPACING = 14;
const MARGIN = 44;
const CARDS_PER_ROW = 4;
const HEADER_H = 90;
const SECTION_LABEL_H = 52;
const SECTION_GAP = 28;

let cachedImage: Buffer | null = null;
let cachedImageTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;
let fontRegistered = false;

interface ShopItem {
  key: string;
  name: string;
  rarity: string;
  price: number;
  image: string | null;
}

interface ShopSection {
  label: string;
  items: ShopItem[];
}

interface CosmeticItem {
  name?: string;
  type?: { value?: string; displayValue?: string };
  rarity?: { value?: string; displayValue?: string };
  images?: { featured?: string; icon?: string; smallIcon?: string };
  price?: number;
}

interface ItemShop {
  featured: CosmeticItem[];
  daily: CosmeticItem[];
}

async function ensureFont() {
  if (fontRegistered) return;
  try {
    if (fs.existsSync(FONT_PATH)) {
      registerFont(FONT_PATH, { family: 'Burbank', weight: 'bold' });
      fontRegistered = true;
      log.backend('[ShopImage] Burbank font loaded');
    }
  } catch (err) {
    log.debug('[ShopImage] Could not load Burbank font, using fallback');
  }
}

export function isAvailable(): boolean {
  return true;
}

export function invalidateCache(): void {
  cachedImage = null;
  cachedImageTime = 0;
}

function getRarityColors(rarity: string): [string, string] {
  const key = (rarity || '').toLowerCase();
  return RARITY_GRADIENTS[key] || RARITY_GRADIENTS.common;
}

function calcHeight(sections: ShopSection[]): number {
  let h = HEADER_H;
  sections.forEach((sec, i) => {
    const rows = Math.ceil(sec.items.length / CARDS_PER_ROW);
    h += SECTION_LABEL_H + rows * (CARD_H + SPACING) - SPACING;
    if (i < sections.length - 1) h += SECTION_GAP;
  });
  return h + 40;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max - 1) + '…' : str;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function fetchImage(url: string): Promise<any | null> {
  try {
    const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
    return await loadImage(Buffer.from(res.data));
  } catch {
    return null;
  }
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) {
    text = text.slice(0, -1);
  }
  return text + '…';
}

export async function generateShopImage(itemShop: ItemShop): Promise<Buffer> {
  const now = Date.now();
  if (cachedImage && now - cachedImageTime < CACHE_TTL_MS) {
    return cachedImage;
  }

  await ensureFont();

  // Convert ItemShop format to sections
  const sections: ShopSection[] = [];

  if (itemShop.featured && itemShop.featured.length > 0) {
    sections.push({
      label: 'Featured',
      items: itemShop.featured.map((item, idx) => ({
        key: `featured_${idx}`,
        name: item.name || 'Unknown',
        rarity: item.rarity?.displayValue || item.rarity?.value || 'Common',
        price: item.price || 0,
        image: item.images?.featured || item.images?.icon || item.images?.smallIcon || null,
      })),
    });
  }

  if (itemShop.daily && itemShop.daily.length > 0) {
    sections.push({
      label: 'Daily',
      items: itemShop.daily.map((item, idx) => ({
        key: `daily_${idx}`,
        name: item.name || 'Unknown',
        rarity: item.rarity?.displayValue || item.rarity?.value || 'Common',
        price: item.price || 0,
        image: item.images?.featured || item.images?.icon || item.images?.smallIcon || null,
      })),
    });
  }

  if (sections.length === 0) {
    // Return empty shop image
    const canvas = createCanvas(800, 400);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b111e';
    ctx.fillRect(0, 0, 800, 400);
    ctx.fillStyle = '#ffffff';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('No items in shop', 400, 200);
    return canvas.toBuffer('image/png');
  }

  const canvasW = MARGIN * 2 + CARDS_PER_ROW * CARD_W + (CARDS_PER_ROW - 1) * SPACING;
  const canvasH = calcHeight(sections);

  const canvas = createCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');

  const useFont = fontRegistered ? 'Burbank' : 'Arial';

  // Background
  ctx.fillStyle = '#0b111e';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Header gradient
  const headerGrad = ctx.createLinearGradient(0, 0, 0, HEADER_H);
  headerGrad.addColorStop(0, 'rgba(99, 102, 241, 0.15)');
  headerGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, canvasW, HEADER_H);

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 52px ${useFont}, Arial`;
  ctx.textAlign = 'left';
  ctx.fillText('ITEM SHOP', MARGIN, 58);

  // Date
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.font = `bold 22px ${useFont}, Arial`;
  ctx.fillText(dateStr, MARGIN, 82);

  // Branding
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.font = `bold 20px ${useFont}, Arial`;
  ctx.textAlign = 'right';
  ctx.fillText('HELIX', canvasW - MARGIN, 58);

  let currentY = HEADER_H;

  for (const section of sections) {
    // Section label
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 30px ${useFont}, Arial`;
    ctx.textAlign = 'left';
    ctx.fillText(section.label.toUpperCase() + ' ITEMS', MARGIN, currentY + 36);

    // Separator line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN, currentY + 44);
    ctx.lineTo(canvasW - MARGIN, currentY + 44);
    ctx.stroke();

    currentY += SECTION_LABEL_H;

    for (let i = 0; i < section.items.length; i++) {
      const item = section.items[i];
      const col = i % CARDS_PER_ROW;
      const row = Math.floor(i / CARDS_PER_ROW);
      const x = MARGIN + col * (CARD_W + SPACING);
      const y = currentY + row * (CARD_H + SPACING);

      const imageAreaH = CARD_H - 78;
      const [c1, c2] = getRarityColors(item.rarity);

      // Save context for clipping
      ctx.save();
      roundedRect(ctx, x, y, CARD_W, CARD_H, 10);
      ctx.clip();

      // Rarity gradient background
      const rarityGrad = ctx.createLinearGradient(x + CARD_W, y, x, y + imageAreaH);
      rarityGrad.addColorStop(0, c2);
      rarityGrad.addColorStop(1, c1);
      ctx.fillStyle = rarityGrad;
      ctx.fillRect(x, y, CARD_W, imageAreaH);

      // Vignette overlay
      const vignetteGrad = ctx.createRadialGradient(
        x + CARD_W / 2, y + imageAreaH / 2, imageAreaH * 0.15,
        x + CARD_W / 2, y + imageAreaH / 2, imageAreaH * 0.85
      );
      vignetteGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignetteGrad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
      ctx.fillStyle = vignetteGrad;
      ctx.fillRect(x, y, CARD_W, imageAreaH);

      // Dark footer
      ctx.fillStyle = '#0f1520';
      ctx.fillRect(x, y + imageAreaH, CARD_W, 78);

      // Rarity top border
      ctx.fillStyle = c2;
      ctx.fillRect(x, y, CARD_W, 5);

      // Item image
      if (item.image) {
        const img = await fetchImage(item.image);
        if (img) {
          const size = Math.min(CARD_W - 24, imageAreaH - 16);
          const imgX = Math.round(x + (CARD_W - size) / 2);
          const imgY = Math.round(y + 8 + (imageAreaH - 8 - size) / 2);
          ctx.drawImage(img, imgX, imgY, size, size);
        }
      }

      ctx.restore();

      // Item name
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 19px ${useFont}, Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(fitText(ctx, truncate(item.name, 20), CARD_W - 24), x + 12, y + imageAreaH + 26);

      // Rarity label
      ctx.fillStyle = c2;
      ctx.font = `bold 13px ${useFont}, Arial`;
      ctx.fillText(item.rarity.toUpperCase(), x + 12, y + imageAreaH + 44);

      // V-Bucks icon (circle with V)
      ctx.fillStyle = '#5bc8f5';
      ctx.beginPath();
      ctx.arc(x + 18, y + CARD_H - 18, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0b111e';
      ctx.font = `bold 10px ${useFont}, Arial`;
      ctx.textAlign = 'center';
      ctx.fillText('V', x + 18, y + CARD_H - 14);

      // Price
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 16px ${useFont}, Arial`;
      ctx.textAlign = 'left';
      ctx.fillText(item.price.toLocaleString(), x + 32, y + CARD_H - 12);
    }

    const rows = Math.ceil(section.items.length / CARDS_PER_ROW);
    currentY += rows * (CARD_H + SPACING) - SPACING + SECTION_GAP;
  }

  const buffer = canvas.toBuffer('image/png');
  cachedImage = buffer;
  cachedImageTime = Date.now();

  log.backend(`[ShopImage] Generated shop PNG (${canvasW}x${canvasH}, ${Math.round(buffer.length / 1024)}KB)`);

  return buffer;
}
