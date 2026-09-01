import blessed from 'blessed';
import contrib from 'blessed-contrib';

let screen: any;
let log: any;
let stats: any;
let header: any;

export function init(): void {
    screen = blessed.screen({
        smartCSR: true,
        title: 'Meteor - Dashboard',
        fullUnicode: true,
        mouse: true
    });

    const grid = new contrib.grid({ rows: 12, cols: 12, screen: screen });

    header = grid.set(0, 0, 2, 12, blessed.box, {
        content: `\n {bold}{blue-fg}HELIX BACKEND{/blue-fg}{/bold}`,
        tags: true,
        border: { type: 'line' },
        style: { border: { fg: 'blue' } }
    });

    log = grid.set(2, 0, 8, 9, blessed.log, {
        fg: 'green',
        label: ' Server Logs ',
        border: { type: 'line' },
        style: { border: { fg: 'white' } },
        mouse: false,
        scrollable: true,
        alwaysScroll: true,
        scrollbar: {
            ch: ' ',
            inverse: true
        }
    });

    stats = grid.set(2, 9, 8, 3, blessed.box, {
        label: ' System Status ',
        content: 'Loading...',
        tags: true,
        border: { type: 'line' },
        style: { border: { fg: 'yellow' } }
    });

    const footer = grid.set(10, 0, 2, 12, blessed.box, {
        content: ' {bold}F1{/bold}: Restart  |  {bold}F5{/bold}: Clear  |  {bold}W{/bold} - Scroll Up  |  {bold}S{/bold} - Scroll Down  |  {bold}ESC/Q{/bold}: Exit',
        tags: true,
        border: { type: 'line' },
        style: { border: { fg: 'cyan' } }
    });

    screen.key(['f1'], function() {
        return process.exit(0);
    });

    screen.key(['escape', 'q', 'C-c'], function(ch: any, key: any) {
        return process.exit(1);
    });

    screen.key(['f5'], function() {
        log.log('--- Logs Cleared ---');
        screen.render();
    });

    screen.key(['w', 'W'], function() {
        log.scroll(-2);
        screen.render();
    });

    screen.key(['s', 'S'], function() {
        log.scroll(2);
        screen.render();
    });

    screen.render();
}

export function addLog(message: string): void {
    if (log && log.log) {
        log.log(message);
        screen.render();
    } else {
        console.log(message);
    }
}

function formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

interface StatsData {
    port?: number | string;
    websitePort?: number | string;
    mongodb?: string;
    xmpp?: boolean;
    bot?: boolean;
    players?: number;
}

export function updateStats(data: StatsData): void {
    if (stats) {
        let content = '';
        content += `{bold}Port:{/bold} ${data.port || 'N/A'}\n`;
        content += `{bold}Website:{/bold} ${data.websitePort || 'N/A'}\n`;
        content += `{bold}MongoDB:{/bold} ${data.mongodb || 'Connecting...'}\n`;
        content += `{bold}XMPP:{/bold} ${data.xmpp ? '{green-fg}ONLINE{/green-fg}' : '{red-fg}OFFLINE{/red-fg}'}\n`;
        content += `{bold}Bot:{/bold} ${data.bot ? '{green-fg}ONLINE{/green-fg}' : '{red-fg}OFFLINE{/red-fg}'}\n`;
        content += `{bold}Players:{/bold} ${data.players || 0}\n`;
        content += `\n{bold}Uptime:{/bold} ${formatUptime(process.uptime())}`;
        
        stats.setContent(content);
        screen.render();
    }
}
