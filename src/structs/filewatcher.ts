import fs from 'fs';
import path from 'path';
import { backend } from '../core/logger';
import { sendXmppMessageToAll } from '../core/utils';

const BASE_DIR = path.join(__dirname, '..', '..', 'Base');
const DEBOUNCE_MS = 500;

let debounceTimer: NodeJS.Timeout | null = null;

function triggerRefresh(filename: string) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    backend(`Content changed (${filename}) — refreshing clients`);
    try {
      sendXmppMessageToAll({
        type: 'com.epicgames.fortnite.refresh',
        timestamp: new Date().toISOString(),
        payload: {}
      });
    } catch {}
  }, DEBOUNCE_MS);
}

export function startFileWatcher() {
  if (!fs.existsSync(BASE_DIR)) return;

  fs.watch(BASE_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    const ext = path.extname(filename).toLowerCase();
    if (!['.json', '.ini', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.m4s'].includes(ext)) return;
    triggerRefresh(filename);
  });

  backend('File watcher started on Base/');
}
