const c = {
  reset:      '\x1b[0m',
  bold:       '\x1b[1m',
  dim:        '\x1b[2m',
  grey:       '\x1b[90m',
  red:        '\x1b[91m',
  green:      '\x1b[92m',
  yellow:     '\x1b[93m',
  blue:       '\x1b[94m',
  magenta:    '\x1b[95m',
  cyan:       '\x1b[96m',
  white:      '\x1b[97m',
  bgRed:      '\x1b[41m',
  bgGreen:    '\x1b[42m',
  bgYellow:   '\x1b[43m',
  bgBlue:     '\x1b[44m',
  bgMagenta:  '\x1b[45m',
  bgCyan:     '\x1b[46m',
};

export const BANNER = [
  '',
  `${c.cyan}${c.bold}  _   _      _ _      ${c.reset}`,
  `${c.cyan}${c.bold} | | | | ___| (_)_  __${c.reset}`,
  `${c.cyan}${c.bold} | |_| |/ _ \\ | \\ \\/ /${c.reset}`,
  `${c.cyan}${c.bold} |  _  |  __/ | |>  < ${c.reset}`,
  `${c.cyan}${c.bold} |_| |_|\\___|_|_/_/\\_\\${c.reset}`,
  `${c.grey}${c.dim}  Meteor ${c.reset}`,
  '',
].join('\n');

const tags: Record<string, { bg: string; fg: string; msgColor: string; label: string }> = {
  backend: { bg: c.bgGreen,    fg: c.bold + '\x1b[30m', msgColor: c.green,   label: ' BACKEND ' },
  bot:     { bg: c.bgYellow,   fg: c.bold + '\x1b[30m', msgColor: c.yellow,  label: '   BOT   ' },
  xmpp:    { bg: c.bgBlue,     fg: c.bold + c.white,    msgColor: c.blue,    label: '  XMPP  ' },
  error:   { bg: c.bgRed,      fg: c.bold + c.white,    msgColor: c.red,     label: '  ERROR  ' },
  debug:   { bg: c.bgMagenta,  fg: c.bold + c.white,    msgColor: c.magenta, label: '  DEBUG  ' },
  website: { bg: c.bgCyan,     fg: c.bold + '\x1b[30m', msgColor: c.cyan,    label: ' WEBSITE ' },
  shop:    { bg: c.bgYellow,   fg: c.bold + '\x1b[30m', msgColor: c.white,   label: '  SHOP   ' },
};

function getTimestamp(): string {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const s = now.getSeconds().toString().padStart(2, '0');
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatLog(key: string, ...args: any[]): void {
  const t = tags[key];
  const msg = args.join(' ');
  const ts = `${c.grey}${getTimestamp()}${c.reset}`;
  const label = `${t.bg}${t.fg}${t.label}${c.reset}`;
  console.log(`${ts} ${label} ${t.msgColor}${msg}${c.reset}`);
}

export function backend(...args: any[]): void  { formatLog('backend', ...args); }
export function bot(...args: any[]): void      { formatLog('bot',     ...args); }
export function xmpp(...args: any[]): void     { formatLog('xmpp',    ...args); }
export function error(...args: any[]): void    { formatLog('error',   ...args); }
export function debug(...args: any[]): void    { formatLog('debug',   ...args); }
export function website(...args: any[]): void  { formatLog('website', ...args); }
export function AutoRotation(...args: any[]): void { formatLog('shop', ...args); }

export default { backend, bot, xmpp, error, debug, website, AutoRotation };
